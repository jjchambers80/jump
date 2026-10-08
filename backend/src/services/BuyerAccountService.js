// Buyer Account Service (spec 040): what a signed-in buyer changes on their
// own Contact at one organization — profile, a verified email change,
// RSVPs, marketing preference, and "sign out of all devices".
//
// Every method takes the session's contact id; nothing here looks a Contact
// up by email alone (Gotcha 8). Staff edits stay in CustomerService.

import { createHash, randomBytes } from 'crypto';
import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, TooManyRequestsError, ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';
import { buyerAccountUrl } from '../utils/storefrontUrl.js';
import { MARKETING_CONSENT_VERSION, marketingConsentText } from '../config/legal.js';
import buyerAuthService from './BuyerAuthService.js';
import contactOptInService from './ContactOptInService.js';
import legalAcceptanceService, { requestMeta } from './LegalAcceptanceService.js';
import emailService from './EmailService.js';
import rsvpService from './RsvpService.js';

export const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;
const EMAIL_CHANGE_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_CHANGE_REQUESTS_PER_WINDOW = 3;

const PROFILE_LABELS = { firstName: 'first name', lastName: 'last name', phone: 'phone', location: 'city or region' };

const PROFILE_SELECT = {
  id: true,
  organizationId: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  location: true,
  emailSubscribed: true,
  accountCreatedAt: true,
  erasureScheduledAt: true,
  organization: { select: { id: true, name: true, logoUrl: true, brandColor: true } },
};

const hashToken = (raw) => createHash('sha256').update(raw).digest('hex');

function coded(error, code) {
  error.code = code;
  return error;
}

class BuyerAccountService {
  async _contact(contactId, select = PROFILE_SELECT) {
    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select });
    if (!contact) throw new NotFoundError('Account not found');
    return contact;
  }

  /** The address an email change is waiting on, if any. */
  async pendingEmail(contactId) {
    const token = await prisma.buyerLoginToken.findFirst({
      where: { contactId, purpose: 'EMAIL_CHANGE', usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { payload: true },
    });
    return token?.payload?.newEmail ?? null;
  }

  /** GET /buyer/me body. */
  async profile(contactId) {
    const contact = await this._contact(contactId);
    return {
      id: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
      location: contact.location,
      emailSubscribed: contact.emailSubscribed,
      pendingEmail: await this.pendingEmail(contactId),
      // Spec 040 card D: "Delete my data" confirmed and waiting out the grace period.
      erasureScheduledAt: contact.erasureScheduledAt,
      marketingConsentText: marketingConsentText({ organizationName: contact.organization.name }),
      organization: contact.organization,
    };
  }

  /**
   * PATCH /buyer/me (validated by `validateUpdateBuyerProfile`). Writes a
   * PROFILE_UPDATED note on the customer timeline naming the fields, never
   * the values, so staff see that the customer changed something themselves.
   */
  async updateProfile(contactId, updates) {
    const contact = await this._contact(contactId);
    const changed = Object.keys(updates).filter((key) => (contact[key] ?? null) !== (updates[key] ?? null));
    if (changed.length === 0) return this.profile(contactId);
    const data = Object.fromEntries(changed.map((key) => [key, updates[key]]));
    await prisma.$transaction([
      prisma.contact.update({ where: { id: contactId }, data }),
      prisma.contactComment.create({
        data: {
          contactId,
          organizationId: contact.organizationId,
          authorUserId: null,
          kind: 'PROFILE_UPDATED',
          body: `Customer updated their ${changed.map((key) => PROFILE_LABELS[key]).join(', ')}`,
        },
      }),
    ]);
    return this.profile(contactId);
  }

  /**
   * POST /buyer/me/email — send a confirmation link to the new address and a
   * notice to the current one. 409 EMAIL_IN_USE when another contact at this
   * organization already has the address (merging is out of scope).
   */
  async requestEmailChange(contactId, newEmail) {
    const contact = await this._contact(contactId);
    const email = normalizeEmail(newEmail);
    if (email === contact.email) throw new ValidationError('That is already your email address');
    await this._assertEmailFree(contact.organizationId, email, contactId);

    const since = new Date(Date.now() - EMAIL_CHANGE_WINDOW_MS);
    const recent = await prisma.buyerLoginToken.count({
      where: { contactId, purpose: 'EMAIL_CHANGE', createdAt: { gte: since } },
    });
    if (recent >= EMAIL_CHANGE_REQUESTS_PER_WINDOW) {
      throw new TooManyRequestsError('Too many email change requests. Try again in a few minutes.');
    }

    const rawToken = randomBytes(32).toString('base64url');
    await prisma.$transaction([
      // One pending change at a time: a new request supersedes the old link.
      prisma.buyerLoginToken.updateMany({
        where: { contactId, purpose: 'EMAIL_CHANGE', usedAt: null },
        data: { usedAt: new Date() },
      }),
      prisma.buyerLoginToken.create({
        data: {
          contactId,
          organizationId: contact.organizationId,
          tokenHash: hashToken(rawToken),
          purpose: 'EMAIL_CHANGE',
          payload: { newEmail: email },
          expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
        },
      }),
    ]);

    const confirmUrl = `${await buyerAccountUrl(contact.organizationId)}/email-confirm?token=${encodeURIComponent(rawToken)}`;
    const organization = contact.organization;
    emailService
      .sendBuyerEmailChangeConfirmation({ to: email, currentEmail: contact.email, confirmUrl, organization })
      .catch((error) => logger.error('Buyer email change confirmation failed', { contactId, error: error.message }));
    emailService
      .sendBuyerEmailChangeNotice({ to: contact.email, newEmail: email, completed: false, organization })
      .catch((error) => logger.error('Buyer email change notice failed', { contactId, error: error.message }));
    return { pendingEmail: email };
  }

  /** DELETE /buyer/me/email — withdraw a pending change. */
  async cancelEmailChange(contactId) {
    await prisma.buyerLoginToken.updateMany({
      where: { contactId, purpose: 'EMAIL_CHANGE', usedAt: null },
      data: { usedAt: new Date() },
    });
    return { pendingEmail: null };
  }

  /**
   * POST /buyer/me/email/confirm — the link from the new address. The token is
   * the proof, so no session is needed (the link often opens in another
   * browser). Single use; the address is re-checked for a clash at the moment
   * of the change.
   */
  async confirmEmailChange(rawToken) {
    const invalid = () => coded(new ValidationError('This confirmation link is invalid or has expired'), 'EMAIL_CHANGE_INVALID');
    if (typeof rawToken !== 'string' || rawToken.length < 20 || rawToken.length > 200) throw invalid();
    const now = new Date();
    const tokenHash = hashToken(rawToken);

    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.buyerLoginToken.updateMany({
        where: { tokenHash, purpose: 'EMAIL_CHANGE', usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw invalid();
      const token = await tx.buyerLoginToken.findUnique({
        where: { tokenHash },
        select: { payload: true, contact: { select: PROFILE_SELECT } },
      });
      const contact = token.contact;
      const email = normalizeEmail(token.payload?.newEmail);
      if (!email) throw invalid();
      if (email !== contact.email) {
        await this._assertEmailFree(contact.organizationId, email, contact.id, tx);
        await tx.contact.update({ where: { id: contact.id }, data: { email } });
        await tx.contactComment.create({
          data: {
            contactId: contact.id,
            organizationId: contact.organizationId,
            authorUserId: null,
            kind: 'EMAIL_CHANGED',
            body: `Customer changed their email from ${contact.email} to ${email}`,
          },
        });
        // Sign-in codes were bound to the old address; drop them.
        await tx.buyerLoginToken.updateMany({
          where: { contactId: contact.id, purpose: { in: ['LOGIN', 'CODE', 'WELCOME'] }, usedAt: null },
          data: { usedAt: now },
        });
      }
      return { contact, oldEmail: contact.email, email };
    });

    if (result.oldEmail !== result.email) {
      emailService
        .sendBuyerEmailChangeNotice({ to: result.oldEmail, newEmail: result.email, completed: true, organization: result.contact.organization })
        .catch((error) => logger.error('Buyer email changed notice failed', { contactId: result.contact.id, error: error.message }));
      logger.info('Buyer email changed', { event: 'buyer_email_changed', contactId: result.contact.id, organizationId: result.contact.organizationId });
    }
    return { organizationId: result.contact.organizationId, email: result.email };
  }

  async _assertEmailFree(organizationId, email, contactId, db = prisma) {
    const existing = await db.contact.findUnique({
      where: { organizationId_email: { organizationId, email } },
      select: { id: true },
    });
    if (existing && existing.id !== contactId) {
      throw coded(new ConflictError('That email address already belongs to another account here'), 'EMAIL_IN_USE');
    }
  }

  /** GET /buyer/me/rsvps — this contact's RSVPs, soonest event first. */
  async listRsvps(contactId) {
    const rows = await prisma.eventRsvp.findMany({
      where: { contactId },
      select: {
        id: true,
        partySize: true,
        status: true,
        cancelledAt: true,
        createdAt: true,
        event: {
          select: {
            id: true,
            slug: true,
            name: true,
            date: true,
            venue: { select: { name: true, city: true, state: true, timezone: true } },
          },
        },
      },
      orderBy: { event: { date: 'asc' } },
    });
    return rows.map(({ event, ...rsvp }) => ({
      ...rsvp,
      event: {
        id: event.id,
        slug: event.slug,
        name: event.name,
        date: event.date,
        // Spec 033: event times are the venue's wall clock.
        timezone: event.venue?.timezone ?? null,
        venue: event.venue ? { name: event.venue.name, city: event.venue.city, state: event.venue.state } : null,
      },
    }));
  }

  cancelRsvp(contactId, rsvpId) {
    return rsvpService.cancelForContact(contactId, rsvpId);
  }

  /**
   * PATCH /buyer/me/preferences and the one-click unsubscribe link. Opting in
   * records a MARKETING acceptance with the exact label shown; opting out is
   * one step with no confirmation (GDPR Art. 7(3), CAN-SPAM).
   */
  async setMarketing(contactId, emailSubscribed, req = null) {
    const contact = await this._contact(contactId, {
      id: true,
      organizationId: true,
      email: true,
      emailSubscribed: true,
      organization: { select: { name: true } },
    });
    const data = contactOptInService.marketingChangeData(contact, emailSubscribed, 'ACCOUNT');
    if (Object.keys(data).length === 0) return { emailSubscribed: contact.emailSubscribed };
    await prisma.$transaction(async (tx) => {
      await tx.contact.update({ where: { id: contactId }, data });
      if (emailSubscribed) {
        const text = marketingConsentText({ organizationName: contact.organization.name });
        await legalAcceptanceService.record(
          tx,
          {
            subjectType: 'CONTACT',
            subjectId: contactId,
            email: contact.email,
            organizationId: contact.organizationId,
            source: 'ACCOUNT',
            referenceType: 'Contact',
            referenceId: contactId,
            ...requestMeta(req),
            presentedText: { MARKETING: text },
          },
          [{ document: 'MARKETING', version: MARKETING_CONSENT_VERSION }]
        );
      }
    });
    logger.info('Buyer marketing preference changed', {
      event: emailSubscribed ? 'buyer_marketing_subscribed' : 'buyer_marketing_unsubscribed',
      contactId,
      organizationId: contact.organizationId,
    });
    return { emailSubscribed };
  }

  /**
   * POST /buyer/me/sessions/revoke-all — every buyer session issued before now
   * stops working (checked by `requireBuyer`); the caller gets a fresh one.
   */
  async revokeAllSessions(contactId) {
    const contact = await this._contact(contactId, { id: true, organizationId: true, email: true });
    const now = new Date();
    await prisma.contact.update({ where: { id: contactId }, data: { buyerSessionsValidAfter: now } });
    logger.info('Buyer signed out everywhere', { event: 'buyer_sessions_revoked', contactId, organizationId: contact.organizationId });
    return buyerAuthService.signSession(
      { contactId: contact.id, organizationId: contact.organizationId, email: contact.email },
      { issuedAt: now }
    );
  }
}

export default new BuyerAccountService();
