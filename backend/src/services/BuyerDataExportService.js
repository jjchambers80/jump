// Buyer Data Export Service (spec 040 PA-10, PA-11): "Download my data" —
// everything one organization holds about one Contact, as one JSON document
// (GDPR Art. 15 access, Art. 20 portability: structured, machine-readable).
//
// Scope is always ONE Contact at ONE organization (the organizer is the
// controller; the same email elsewhere is someone else's data). Every query
// filters on both ids. Secrets never leave: no QR JWTs, no Stripe ids, no
// token hashes.
//
// The buyer's own copy leaves out what staff wrote about them (notes, tags,
// staff timeline comments, application review notes). The staff export
// (`includeStaffNotes`) carries them, so a full access request that arrives
// by email is answered from the admin customer page.

import { prisma } from '@jump/db';
import { NotFoundError, TooManyRequestsError } from '../middleware/errorHandler.js';
import { absoluteAssetUrl } from '../utils/publicUrl.js';
import imageService from './ImageService.js';

export const EXPORT_FORMAT_VERSION = 1;
/** Buyer self-serve exports per rolling 24 h (counted from the DATA_EXPORTED timeline lines). */
export const BUYER_EXPORTS_PER_DAY = 3;

const num = (value) => (value === null || value === undefined ? null : Number(value));
const imageUrl = (image) => (image?.file ? absoluteAssetUrl(imageService.servingUrl(image, 'original')) : null);
const IMAGE_SELECT = { id: true, file: { select: { hash: true, mimeType: true } } };

class BuyerDataExportService {
  /**
   * @param {string} organizationId
   * @param {string} contactId
   * @param {{ includeStaffNotes?: boolean }} [options]
   */
  async build(organizationId, contactId, { includeStaffNotes = false } = {}) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, organizationId },
      include: { organization: { select: { id: true, name: true, slug: true } } },
    });
    if (!contact) throw new NotFoundError('Customer not found');
    const scope = { contactId, organizationId };

    const [orders, tickets, rsvps, applications, profiles, acceptances, comments] = await Promise.all([
      prisma.order.findMany({
        where: { contactId, event: { venue: { organizationId } } },
        orderBy: { createdAt: 'asc' },
        include: {
          event: { select: { id: true, name: true, date: true, venue: { select: { name: true, timezone: true } } } },
          items: { select: { kind: true, description: true, quantity: true, unitPrice: true, platformFee: true, processingFee: true, tax: true } },
          addOns: { select: { name: true, quantity: true, unitPrice: true, refundedAt: true } },
          payment: { select: { amount: true, currency: true, status: true, source: true, offlineMethod: true, createdAt: true } },
          refunds: { select: { amount: true, feeAmount: true, status: true, reason: true, createdAt: true } },
        },
      }),
      prisma.ticket.findMany({
        where: { contactId, event: { venue: { organizationId } } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          orderId: true,
          ticketNumber: true,
          pricePaid: true,
          status: true,
          redeemedAt: true,
          createdAt: true,
          event: { select: { id: true, name: true, date: true } },
          priceTier: { select: { name: true } },
        },
      }),
      prisma.eventRsvp.findMany({
        where: { contactId, event: { venue: { organizationId } } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, partySize: true, status: true, cancelledAt: true, createdAt: true, event: { select: { id: true, name: true, date: true } } },
      }),
      prisma.application.findMany({
        where: scope,
        orderBy: { createdAt: 'asc' },
        include: {
          form: { select: { name: true, kind: true } },
          event: { select: { id: true, name: true, date: true } },
          tier: { select: { name: true } },
          answers: {
            select: {
              valueText: true,
              valueJson: true,
              question: { select: { label: true, type: true } },
              image: { select: IMAGE_SELECT },
            },
          },
          decisions: { select: { action: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        },
      }),
      prisma.applicantProfile.findMany({
        where: scope,
        include: { images: { orderBy: { displayOrder: 'asc' }, include: { image: { select: IMAGE_SELECT } } } },
      }),
      prisma.legalAcceptance.findMany({
        where: { organizationId, subjectType: 'CONTACT', subjectId: contactId },
        orderBy: { acceptedAt: 'asc' },
        select: { document: true, version: true, source: true, presentedText: true, acceptedAt: true },
      }),
      includeStaffNotes
        ? prisma.contactComment.findMany({
            where: scope,
            orderBy: { createdAt: 'asc' },
            select: { kind: true, body: true, createdAt: true, author: { select: { name: true, email: true } } },
          })
        : Promise.resolve([]),
    ]);

    return {
      format: { name: 'jump-customer-data', version: EXPORT_FORMAT_VERSION },
      generatedAt: new Date().toISOString(),
      organization: contact.organization,
      notice:
        'This file holds the personal data this organization keeps about you on Jump. Order, payment and refund records are also kept by the payment processor (Stripe) under its own policy.',
      contact: {
        id: contact.id,
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        location: contact.location,
        createdAt: contact.createdAt,
        accountCreatedAt: contact.accountCreatedAt,
        ...(includeStaffNotes && { note: contact.note, tags: contact.tags }),
      },
      marketing: {
        subscribed: contact.emailSubscribed,
        subscribedAt: contact.emailSubscribedAt,
        subscribedSource: contact.emailSubscribedSource,
        unsubscribedAt: contact.emailUnsubscribedAt,
      },
      orders: orders.map((o) => ({
        id: o.id,
        orderRef: o.orderRef,
        kind: o.kind,
        status: o.status,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        event: o.event ? { id: o.event.id, name: o.event.name, date: o.event.date, venue: o.event.venue?.name ?? null, timezone: o.event.venue?.timezone ?? null } : null,
        currency: o.currency,
        subtotal: num(o.subtotalAmount),
        fees: num(Number(o.platformFeeAmount) + Number(o.processingFeeAmount)),
        tax: num(o.taxAmount),
        total: num(o.totalAmount),
        items: o.items.map((i) => ({ kind: i.kind, description: i.description, quantity: i.quantity, unitPrice: num(i.unitPrice), tax: num(i.tax) })),
        addOns: o.addOns.map((a) => ({ name: a.name, quantity: a.quantity, unitPrice: num(a.unitPrice), refundedAt: a.refundedAt })),
        payment: o.payment ? { amount: num(o.payment.amount), currency: o.payment.currency, status: o.payment.status, method: o.payment.source === 'OFFLINE' ? o.payment.offlineMethod || 'offline' : 'card', createdAt: o.payment.createdAt } : null,
        refunds: o.refunds.map((r) => ({ amount: num(r.amount), feeRetained: num(r.feeAmount), status: r.status, reason: r.reason, createdAt: r.createdAt })),
        marketingOptIn: o.optInMarketing,
        accountOptIn: o.optInAccount,
      })),
      tickets: tickets.map((t) => ({
        id: t.id,
        orderId: t.orderId,
        ticketNumber: t.ticketNumber,
        event: t.event,
        tier: t.priceTier?.name ?? null,
        pricePaid: num(t.pricePaid),
        status: t.status,
        redeemedAt: t.redeemedAt,
        createdAt: t.createdAt,
      })),
      rsvps,
      applicantProfiles: profiles.map((p) => ({
        businessName: p.businessName,
        description: p.description,
        website: p.website,
        socials: p.socials,
        photos: p.images.map((pi) => imageUrl(pi.image)).filter(Boolean),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      applications: applications.map((a) => ({
        id: a.id,
        form: a.form,
        event: a.event,
        category: a.tier?.name ?? null,
        status: a.status,
        paymentStatus: a.paymentStatus,
        submittedAt: a.submittedAt,
        decidedAt: a.decidedAt,
        boothLabel: a.boothLabel,
        withdrawnBy: a.withdrawnBy,
        marketingOptIn: a.optInMarketing,
        accountOptIn: a.optInAccount,
        answers: a.answers.map((ans) => ({
          question: ans.question.label,
          type: ans.question.type,
          value: ans.image ? imageUrl(ans.image) : ans.valueJson ?? ans.valueText,
        })),
        decisions: a.decisions,
        ...(includeStaffNotes && { internalNote: a.internalNote, tags: a.tags }),
      })),
      legalAcceptances: acceptances,
      ...(includeStaffNotes && {
        staffTimeline: comments.map((c) => ({ kind: c.kind, body: c.body, createdAt: c.createdAt, author: c.author ? c.author.name || c.author.email : 'Customer' })),
      }),
    };
  }

  /**
   * The buyer's own download: at most BUYER_EXPORTS_PER_DAY a day, each
   * recorded on the customer timeline so staff can see it happened.
   */
  async exportForBuyer(organizationId, contactId) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await prisma.contactComment.count({
      where: { contactId, organizationId, kind: 'DATA_EXPORTED', authorUserId: null, createdAt: { gte: since } },
    });
    if (recent >= BUYER_EXPORTS_PER_DAY) {
      throw new TooManyRequestsError('You can download your data 3 times a day. Try again tomorrow.');
    }
    const data = await this.build(organizationId, contactId);
    await prisma.contactComment.create({
      data: { contactId, organizationId, authorUserId: null, kind: 'DATA_EXPORTED', body: 'Customer downloaded their data' },
    });
    return data;
  }

  /** Staff export for a request that arrived by email (includes staff notes). */
  async exportForStaff(organizationId, contactId, userId) {
    const data = await this.build(organizationId, contactId, { includeStaffNotes: true });
    await prisma.contactComment.create({
      data: { contactId, organizationId, authorUserId: userId, kind: 'DATA_EXPORTED', body: 'Exported this customer’s data' },
    });
    return data;
  }

  /** `acme-my-data-2026-09-30.json` */
  filename(data) {
    const slug = String(data.organization?.slug || data.organization?.name || 'organization')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    return `${slug || 'organization'}-my-data-${data.generatedAt.slice(0, 10)}.json`;
  }
}

export default new BuyerDataExportService();
