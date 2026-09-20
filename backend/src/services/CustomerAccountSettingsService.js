// Settings › Customer accounts (spec 031). Organizer-facing controls for the
// buyer account features that already exist (spec 007): whether the storefront
// header and checkout show a sign-in link, and where the account page lives.
// Phase 1 owns the sign-in links toggle and the resolved account URL; later
// phases add the self-serve refund policy and the sign-in method.

import { prisma } from '@jump/db';
import { NotFoundError } from '../middleware/errorHandler.js';
import domainService from './DomainService.js';
import { buyerAccountUrl } from '../utils/storefrontUrl.js';
import logger from '../utils/logger.js';

const SELECT = { id: true, buyerSignInLinks: true };

class CustomerAccountSettingsService {
  async get(organizationId) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: SELECT });
    if (!org) throw new NotFoundError('Organization not found');
    return this._serialize(org);
  }

  /** Partial update; the validator has already whitelisted the keys. */
  async update(organizationId, data) {
    const patch = {};
    if (data.buyerSignInLinks !== undefined) patch.buyerSignInLinks = data.buyerSignInLinks;

    const org = await prisma.organization
      .update({ where: { id: organizationId }, data: patch, select: SELECT })
      .catch((error) => {
        if (error.code === 'P2025') throw new NotFoundError('Organization not found');
        throw error;
      });
    logger.info('Customer account settings updated', {
      event: 'customer_account_settings_updated',
      organizationId,
      changes: Object.keys(patch),
    });
    return this._serialize(org);
  }

  async _serialize(org) {
    const [accountUrl, hostname] = await Promise.all([
      buyerAccountUrl(org.id),
      domainService.primaryHostname(org.id).catch(() => null),
    ]);
    return {
      buyerSignInLinks: org.buyerSignInLinks,
      // Phase 3 makes this configurable; until then every organization uses the email link.
      signInMethod: 'LINK',
      accountUrl,
      domain: hostname ? { hostname } : null,
    };
  }
}

export default new CustomerAccountSettingsService();
