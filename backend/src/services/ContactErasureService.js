// Contact Erasure Service (spec 040 card D, spec 023 §8.4): "Delete my data".
//
// Erasure is anonymization, never a row delete: orders, payments, refunds,
// tickets, applications and legal acceptances stay linked to a tombstone
// Contact so the organizer's tax and accounting records hold (spec 023
// §8.3, Gotcha 17). Everything that identifies the person is scrubbed.
//
// Flow: preview → request (emails a DELETE_CONFIRM code) → confirm (schedules
// erasure after ERASURE_GRACE_DAYS) → the sweep (or staff, at once) erases.
// Blockers — money in flight or an approved vendor place — stop it: the
// buyer is told why, and a scheduled erasure that meets one is postponed.
// Upcoming tickets are voided without a refund and their seats go back on
// sale (decision 2026-09-29: warn, then void).
//
// This is the ONLY way to erase a buyer. Never delete a Contact row.

import { createHash } from 'crypto';
import { prisma, Prisma } from '@jump/db';
import stripe from '../config/stripe.js';
import logger from '../utils/logger.js';
import { buyerAccountUrl } from '../utils/storefrontUrl.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import buyerAuthService from './BuyerAuthService.js';
import emailService from './EmailService.js';
import applicationService from './ApplicationService.js';
import imageService from './ImageService.js';
import { returnTicketsToSale } from './ticketInventory.js';

/** Grace period between confirming and erasing (days). */
export const erasureGraceDays = () => {
  const n = Number(process.env.ERASURE_GRACE_DAYS);
  return Number.isFinite(n) && n >= 0 && process.env.ERASURE_GRACE_DAYS !== '' && process.env.ERASURE_GRACE_DAYS !== undefined ? n : 7;
};
/** A scheduled erasure that meets a blocker is retried this much later. */
const POSTPONE_MS = 24 * 60 * 60 * 1000;
/** Tickets count as upcoming until 12 h after the event starts (same rule as the account page). */
const UPCOMING_GRACE_MS = 12 * 60 * 60 * 1000;
const TOKEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Salted SHA-256 of a normalized address; the suppression list never holds the address itself. */
export function suppressionHash(email, salt = process.env.LEGAL_IP_SALT || process.env.AUTH_SECRET || '') {
  return createHash('sha256').update(`erasure|${String(email).trim().toLowerCase()}|${salt}`).digest('hex');
}

/** The field values an anonymized Contact carries (spec 023 §8.4). */
export function anonymizedContactData(contact, now = new Date()) {
  return {
    email: `deleted-${contact.id.slice(-8)}@anonymized.invalid`,
    firstName: 'Deleted',
    lastName: 'User',
    phone: null,
    location: null,
    note: null,
    tags: [],
    emailSubscribed: false,
    emailSubscribedAt: null,
    emailSubscribedSource: null,
    emailUnsubscribedAt: contact.emailSubscribed ? now : contact.emailUnsubscribedAt ?? null,
    accountCreatedAt: null,
    stripeCustomerId: null,
    buyerSessionsValidAfter: now,
    erasureScheduledAt: null,
    anonymizedAt: now,
  };
}

function coded(error, code) {
  error.code = code;
  return error;
}

class ContactErasureService {
  async _contact(organizationId, contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, ...(organizationId && { organizationId }) },
      include: { organization: { select: { id: true, name: true, logoUrl: true, brandColor: true } } },
    });
    if (!contact) throw new NotFoundError('Customer not found');
    if (contact.anonymizedAt) throw coded(new ConflictError('This customer’s data has already been erased'), 'ALREADY_ERASED');
    return contact;
  }

  /**
   * What erasing this contact would do, and what stops it.
   * @returns {Promise<{ ticketsToVoid, applicationsToWithdraw, rsvpsToCancel, blockers, scheduledFor }>}
   */
  async preview(organizationId, contactId, { now = new Date() } = {}) {
    const contact = await this._contact(organizationId, contactId);
    const upcomingFrom = new Date(now.getTime() - UPCOMING_GRACE_MS);
    const [tickets, applications, rsvps, pendingOrders, pendingRefunds] = await Promise.all([
      prisma.ticket.findMany({
        where: { contactId, status: 'VALID', event: { date: { gt: upcomingFrom } } },
        select: { id: true, ticketNumber: true, priceTierId: true, event: { select: { name: true, date: true, venue: { select: { timezone: true } } } } },
        orderBy: { event: { date: 'asc' } },
      }),
      prisma.application.findMany({
        where: { contactId, organizationId: contact.organizationId, status: { in: ['SUBMITTED', 'WAITLISTED', 'APPROVED'] } },
        select: { id: true, status: true, paymentStatus: true, form: { select: { name: true } }, event: { select: { name: true } } },
      }),
      prisma.eventRsvp.findMany({
        where: { contactId, status: 'GOING', event: { date: { gt: upcomingFrom } } },
        select: { id: true, event: { select: { name: true } } },
      }),
      prisma.order.findMany({ where: { contactId, status: 'PENDING' }, select: { orderRef: true, event: { select: { name: true } } } }),
      prisma.refund.count({ where: { status: 'PENDING', order: { contactId } } }),
    ]);

    const blockers = [];
    for (const order of pendingOrders) {
      blockers.push({ code: 'PENDING_ORDER', message: `A checkout for ${order.event?.name ?? 'an event'} (${order.orderRef}) is still open. Finish or abandon it first — it closes by itself within the hour.` });
    }
    for (const a of applications) {
      if (a.status === 'APPROVED') {
        blockers.push({ code: 'APPROVED_APPLICATION', message: `Your approved ${a.form.name} application for ${a.event.name} holds a place. Ask the organizer to cancel it first.` });
      } else if (a.paymentStatus === 'PROCESSING') {
        blockers.push({ code: 'PAYMENT_PROCESSING', message: `A payment for your ${a.form.name} application is in progress. Try again in a few minutes.` });
      }
    }
    if (pendingRefunds > 0) {
      blockers.push({ code: 'REFUND_PENDING', message: 'A refund is still being processed. Try again once it has gone through.' });
    }

    return {
      ticketsToVoid: tickets.map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        eventName: t.event.name,
        eventDate: t.event.date,
        eventTimezone: t.event.venue?.timezone ?? null,
      })),
      applicationsToWithdraw: applications
        .filter((a) => a.status !== 'APPROVED')
        .map((a) => ({ id: a.id, formName: a.form.name, eventName: a.event.name })),
      rsvpsToCancel: rsvps.map((r) => ({ id: r.id, eventName: r.event.name })),
      blockers,
      scheduledFor: contact.erasureScheduledAt,
      graceDays: erasureGraceDays(),
    };
  }

  /** Buyer: blockers → 409 ERASURE_BLOCKED; otherwise email the confirmation code. */
  async request(organizationId, contactId) {
    const contact = await this._contact(organizationId, contactId);
    const preview = await this.preview(organizationId, contactId);
    if (preview.blockers.length > 0) {
      throw coded(new ConflictError('Your data can’t be deleted yet', { blockers: preview.blockers }), 'ERASURE_BLOCKED');
    }
    const { rawCode } = await buyerAuthService.issueContactCode(contact, 'DELETE_CONFIRM');
    emailService
      .sendBuyerNotice({
        to: contact.email,
        organization: contact.organization,
        subject: `${rawCode} confirms deleting your data with ${contact.organization.name}`,
        title: 'Confirm deleting your data',
        paragraphs: [
          `Enter this code on your account page to delete your data with ${contact.organization.name}. It expires in 10 minutes.`,
          'If you did not ask for this, ignore this email — nothing is deleted without the code.',
        ],
        code: rawCode,
      })
      .catch((error) => logger.error('Erasure code email failed', { contactId, error: error.message }));
    return { codeSent: true };
  }

  /** Buyer: the emailed code schedules erasure after the grace period. */
  async confirm(organizationId, contactId, code) {
    const contact = await this._contact(organizationId, contactId);
    if (!(await buyerAuthService.consumeContactCode(contactId, 'DELETE_CONFIRM', code))) {
      throw coded(new ValidationError('This code is incorrect or has expired'), 'CODE_INVALID');
    }
    const preview = await this.preview(organizationId, contactId);
    if (preview.blockers.length > 0) {
      throw coded(new ConflictError('Your data can’t be deleted yet', { blockers: preview.blockers }), 'ERASURE_BLOCKED');
    }
    const scheduledFor = new Date(Date.now() + erasureGraceDays() * 24 * 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.contact.update({ where: { id: contactId }, data: { erasureScheduledAt: scheduledFor } }),
      prisma.contactComment.create({
        data: { contactId, organizationId: contact.organizationId, authorUserId: null, kind: 'ERASURE_SCHEDULED', body: `Customer asked to delete their data; scheduled for ${scheduledFor.toISOString().slice(0, 10)}` },
      }),
    ]);
    const accountUrl = await buyerAccountUrl(contact.organizationId);
    emailService
      .sendBuyerNotice({
        to: contact.email,
        organization: contact.organization,
        subject: `Your data with ${contact.organization.name} will be deleted`,
        title: 'Deletion scheduled',
        paragraphs: [
          `Your data with ${contact.organization.name} will be deleted on ${scheduledFor.toUTCString().slice(0, 16)}.`,
          preview.ticketsToVoid.length > 0
            ? `${preview.ticketsToVoid.length} upcoming ticket${preview.ticketsToVoid.length === 1 ? '' : 's'} will be cancelled then, with no refund.`
            : 'Order and payment records are kept, without your name or contact details, as the law requires.',
          'Changed your mind? Sign in and cancel from the Privacy page before then.',
        ],
        link: { url: `${accountUrl}/privacy`, label: 'Cancel deletion' },
      })
      .catch((error) => logger.error('Erasure scheduled email failed', { contactId, error: error.message }));
    return { scheduledFor };
  }

  /** Buyer: withdraw a scheduled erasure during the grace period. */
  async cancel(organizationId, contactId) {
    const contact = await this._contact(organizationId, contactId);
    if (!contact.erasureScheduledAt) return { scheduledFor: null };
    await prisma.$transaction([
      prisma.contact.update({ where: { id: contactId }, data: { erasureScheduledAt: null } }),
      prisma.contactComment.create({
        data: { contactId, organizationId: contact.organizationId, authorUserId: null, kind: 'ERASURE_CANCELLED', body: 'Customer cancelled the deletion of their data' },
      }),
    ]);
    return { scheduledFor: null };
  }

  /**
   * Erase now (the sweep, or staff with `actorUserId`). Re-checks blockers:
   * the sweep postpones and tells the buyer; staff get 409 ERASURE_BLOCKED.
   * @returns {Promise<{ status: 'erased'|'postponed', voidedTickets?: number }>}
   */
  async erase(contactId, { organizationId = null, actorUserId = null } = {}) {
    const contact = await this._contact(organizationId, contactId);
    const preview = await this.preview(contact.organizationId, contactId);
    if (preview.blockers.length > 0) {
      if (actorUserId) {
        throw coded(new ConflictError('This customer can’t be erased yet', { blockers: preview.blockers }), 'ERASURE_BLOCKED');
      }
      await prisma.contact.update({ where: { id: contactId }, data: { erasureScheduledAt: new Date(Date.now() + POSTPONE_MS) } });
      emailService
        .sendBuyerNotice({
          to: contact.email,
          organization: contact.organization,
          subject: `Deleting your data with ${contact.organization.name} is on hold`,
          title: 'Deletion on hold',
          paragraphs: ['We could not delete your data yet:', ...preview.blockers.map((b) => b.message), 'We will try again tomorrow.'],
        })
        .catch(() => {});
      logger.info('Contact erasure postponed', { event: 'contact_erasure_postponed', contactId, blockers: preview.blockers.map((b) => b.code) });
      return { status: 'postponed' };
    }

    // Applications first: withdrawing releases their capacity in its own transaction.
    for (const application of preview.applicationsToWithdraw) {
      await applicationService.withdrawByApplicant(contact.organizationId, contactId, application.id).catch((error) => {
        logger.warn('Erasure could not withdraw an application', { contactId, applicationId: application.id, error: error.message });
      });
    }

    // The saved card lives on the platform Stripe account (spec 011): delete the Customer with it.
    if (contact.stripeCustomerId) {
      try {
        await stripe.customers.del(contact.stripeCustomerId);
      } catch (error) {
        if (error?.code !== 'resource_missing') throw error; // retry on the next sweep
      }
    }

    const originalEmail = contact.email;
    const now = new Date();
    const imageIds = [];
    await prisma.$transaction(async (tx) => {
      // Void upcoming tickets (no refund) and put their seats back on sale.
      const tickets = await tx.ticket.findMany({ where: { id: { in: preview.ticketsToVoid.map((t) => t.id) }, status: 'VALID' }, select: { id: true, priceTierId: true } });
      if (tickets.length > 0) {
        await tx.ticket.updateMany({ where: { id: { in: tickets.map((t) => t.id) }, status: 'VALID' }, data: { status: 'VOIDED' } });
        await returnTicketsToSale(tx, tickets);
      }
      await tx.ticket.updateMany({ where: { contactId }, data: { qrCodeJwt: null } });

      await tx.eventRsvp.updateMany({ where: { id: { in: preview.rsvpsToCancel.map((r) => r.id) }, status: 'GOING' }, data: { status: 'CANCELLED', cancelledAt: now } });

      // Applicant profile and free-text answers; photos are unlinked here and purged after commit.
      const profiles = await tx.applicantProfile.findMany({ where: { contactId }, select: { id: true, images: { select: { imageId: true } } } });
      for (const profile of profiles) imageIds.push(...profile.images.map((i) => i.imageId));
      await tx.applicantProfileImage.deleteMany({ where: { profileId: { in: profiles.map((p) => p.id) } } });
      await tx.applicantProfile.updateMany({ where: { contactId }, data: { businessName: 'Deleted', description: null, website: null, socials: Prisma.DbNull } });
      const answerImages = await tx.applicationAnswer.findMany({ where: { application: { contactId }, imageId: { not: null } }, select: { imageId: true } });
      imageIds.push(...answerImages.map((a) => a.imageId));
      await tx.applicationAnswer.updateMany({ where: { application: { contactId } }, data: { valueText: null, imageId: null } });

      // Staff notes about the person go too; one audit line remains.
      await tx.contactComment.deleteMany({ where: { contactId } });
      await tx.buyerLoginToken.deleteMany({ where: { contactId } });
      await tx.contact.update({ where: { id: contactId }, data: anonymizedContactData(contact, now) });
      await tx.contactComment.create({
        data: {
          contactId,
          organizationId: contact.organizationId,
          authorUserId: actorUserId,
          kind: 'ANONYMIZED',
          body: actorUserId ? 'Customer data erased by staff' : 'Customer data erased at the customer’s request',
        },
      });
      await tx.erasureSuppression.upsert({
        where: { organizationId_emailHash: { organizationId: contact.organizationId, emailHash: suppressionHash(originalEmail) } },
        update: {},
        create: { organizationId: contact.organizationId, emailHash: suppressionHash(originalEmail) },
      });
    });

    for (const imageId of imageIds) {
      await imageService.deleteImage(imageId).catch((error) => logger.warn('Erasure could not delete an image', { imageId, error: error.message }));
    }

    emailService
      .sendBuyerNotice({
        to: originalEmail,
        organization: contact.organization,
        subject: `Your data with ${contact.organization.name} has been deleted`,
        title: 'Your data has been deleted',
        paragraphs: [
          `Your details with ${contact.organization.name} have been removed.`,
          'Order and payment records are kept without your name or contact details, as the law requires. This is the last email you will get from this account.',
        ],
      })
      .catch(() => {});
    logger.info('Contact erased', { event: 'contact_erased', contactId, organizationId: contact.organizationId, byStaff: Boolean(actorUserId), voidedTickets: preview.ticketsToVoid.length });
    return { status: 'erased', voidedTickets: preview.ticketsToVoid.length };
  }

  /**
   * Hourly: erase contacts whose grace period ended, then drop sign-in tokens
   * a week past expiry (spec 023 LR-13, first part). Never throws.
   */
  async sweep({ now = new Date() } = {}) {
    const due = await prisma.contact.findMany({
      where: { erasureScheduledAt: { lte: now }, anonymizedAt: null },
      select: { id: true },
      take: 50,
    });
    const results = { erased: 0, postponed: 0, failed: 0, tokensPurged: 0 };
    for (const { id } of due) {
      try {
        const result = await this.erase(id);
        results[result.status] += 1;
      } catch (error) {
        results.failed += 1;
        logger.error('Contact erasure failed', { contactId: id, error: error.message });
      }
    }
    const purged = await prisma.buyerLoginToken
      .deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - TOKEN_RETENTION_MS) } } })
      .catch(() => ({ count: 0 }));
    results.tokensPurged = purged.count;
    if (due.length > 0 || purged.count > 0) logger.info('Erasure sweep', { event: 'erasure_sweep', ...results });
    return results;
  }
}

export default new ContactErasureService();
