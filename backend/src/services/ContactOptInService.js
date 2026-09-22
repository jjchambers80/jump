// Contact Opt-In Service (spec 007 checkout opt-ins, generalised by spec 024
// phase 3 for the apply form). Applies "create an account" and "email me"
// choices to a Contact once the thing that carried them is real — a paid
// ticket order, or an application that reached SUBMITTED. Both only ever turn
// on: an account is never revoked by a later guest checkout, and turning
// marketing off is the unsubscribe flow. Provenance (spec 023 LR-07) records
// where the subscription came from.

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import buyerAuthService from './BuyerAuthService.js';
import { buyerVerifyUrl } from '../utils/storefrontUrl.js';

class ContactOptInService {
  /**
   * @param {import('@prisma/client').Prisma.TransactionClient|typeof prisma} db
   * @param {string} contactId
   * @param {{ account?: boolean, marketing?: boolean, source: 'CHECKOUT'|'APPLY'|'RSVP'|'ADMIN'|'IMPORT', reason?: string }} options
   * @returns {Promise<{ accountJustCreated: boolean, marketingJustSubscribed: boolean }>}
   */
  async apply(db, contactId, { account = false, marketing = false, source }) {
    const result = { accountJustCreated: false, marketingJustSubscribed: false };
    if (!account && !marketing) return result;
    const contact = await db.contact.findUnique({
      where: { id: contactId },
      select: { accountCreatedAt: true, emailSubscribed: true },
    });
    if (!contact) return result;
    const now = new Date();
    const data = {};
    if (account && !contact.accountCreatedAt) {
      data.accountCreatedAt = now;
      result.accountJustCreated = true;
    }
    if (marketing && !contact.emailSubscribed) {
      Object.assign(data, {
        emailSubscribed: true,
        emailSubscribedAt: now,
        emailSubscribedSource: source,
        emailUnsubscribedAt: null,
      });
      result.marketingJustSubscribed = true;
    }
    if (Object.keys(data).length === 0) return result;
    await db.contact.update({ where: { id: contactId }, data });
    logger.info('Contact opt-ins applied', {
      event: 'buyer_opt_ins_applied',
      contactId,
      source,
      ...data,
    });
    return result;
  }

  /**
   * Apply an application's recorded opt-ins once (stamps `optInsAppliedAt`).
   * Called when the application first reaches SUBMITTED. Never throws.
   * @returns {Promise<{ accountJustCreated: boolean, marketingJustSubscribed: boolean }>}
   */
  async applyForApplication(db, applicationId) {
    const none = { accountJustCreated: false, marketingJustSubscribed: false };
    try {
      const application = await db.application.findUnique({
        where: { id: applicationId },
        select: {
          id: true,
          contactId: true,
          optInAccount: true,
          optInMarketing: true,
          optInsAppliedAt: true,
          status: true,
        },
      });
      if (!application || application.optInsAppliedAt || application.status === 'DRAFT')
        return none;
      const result = await this.apply(db, application.contactId, {
        account: application.optInAccount,
        marketing: application.optInMarketing,
        source: 'APPLY',
      });
      await db.application.update({
        where: { id: applicationId },
        data: { optInsAppliedAt: new Date() },
      });
      return result;
    } catch (error) {
      logger.error('Failed to apply application opt-ins', { applicationId, error: error.message });
      return none;
    }
  }

  /**
   * One-time sign-in link for a contact whose account was just created
   * (WELCOME token, 7 days). Never throws; null when it cannot be issued.
   */
  async welcomeUrl(contactId) {
    try {
      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { id: true, organizationId: true, accountCreatedAt: true },
      });
      if (!contact?.accountCreatedAt) return null;
      const { rawToken } = await buyerAuthService.issueToken(contact, 'WELCOME');
      return await buyerVerifyUrl(contact.organizationId, rawToken);
    } catch (error) {
      logger.error('Failed to issue welcome link', { contactId, error: error.message });
      return null;
    }
  }

  /**
   * Staff edit of the marketing flag (Customers page): provenance ADMIN,
   * `emailUnsubscribedAt` when turned off.
   */
  marketingChangeData(contact, emailSubscribed) {
    if (emailSubscribed === contact.emailSubscribed) return {};
    return emailSubscribed
      ? {
          emailSubscribed: true,
          emailSubscribedAt: new Date(),
          emailSubscribedSource: 'ADMIN',
          emailUnsubscribedAt: null,
        }
      : { emailSubscribed: false, emailUnsubscribedAt: new Date() };
  }
}

export default new ContactOptInService();
