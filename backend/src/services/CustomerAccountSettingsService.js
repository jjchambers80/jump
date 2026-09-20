// Settings › Customer accounts (spec 031). Organizer-facing controls for the
// buyer account features that already exist (spec 007): whether the storefront
// header and checkout show a sign-in link, and where the account page lives.
// Phase 1: the sign-in links toggle and the resolved account URL. Phase 2:
// the self-serve refund policy (RefundPolicyService). Phase 3: the sign-in
// method (email link, or a six-digit code alongside it).

import { prisma } from '@jump/db';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import domainService from './DomainService.js';
import { buyerAccountUrl } from '../utils/storefrontUrl.js';
import logger from '../utils/logger.js';

const SELECT = {
  id: true,
  buyerSignInLinks: true,
  buyerSignInMethod: true,
  selfServeRefundsEnabled: true,
  selfServeRefundCutoffHours: true,
  selfServeRefundFeeType: true,
  selfServeRefundFeeValue: true,
};

const POLICY_KEYS = ['selfServeRefundsEnabled', 'selfServeRefundCutoffHours', 'selfServeRefundFeeType', 'selfServeRefundFeeValue'];

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
    if (data.buyerSignInMethod !== undefined) patch.buyerSignInMethod = data.buyerSignInMethod;
    for (const key of POLICY_KEYS) if (data[key] !== undefined) patch[key] = data[key];

    // A fee type needs a value and NONE clears it; check against the merged
    // row so a card can save either half on its own.
    if (POLICY_KEYS.some((key) => key in patch)) {
      const existing = await prisma.organization.findUnique({ where: { id: organizationId }, select: SELECT });
      if (!existing) throw new NotFoundError('Organization not found');
      const type = patch.selfServeRefundFeeType ?? existing.selfServeRefundFeeType;
      const value = 'selfServeRefundFeeValue' in patch ? patch.selfServeRefundFeeValue : existing.selfServeRefundFeeValue;
      if (type === 'NONE') patch.selfServeRefundFeeValue = null;
      else if (value == null || Number(value) <= 0) {
        throw new ValidationError('Validation failed', [
          { field: 'selfServeRefundFeeValue', message: 'A fee amount is required for this fee type' },
        ]);
      } else if (type === 'PERCENT' && Number(value) > 100) {
        throw new ValidationError('Validation failed', [
          { field: 'selfServeRefundFeeValue', message: 'A percentage fee cannot exceed 100' },
        ]);
      }
    }

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
      refundPolicy: {
        enabled: org.selfServeRefundsEnabled,
        cutoffHours: org.selfServeRefundCutoffHours,
        feeType: org.selfServeRefundFeeType,
        feeValue: org.selfServeRefundFeeValue == null ? null : Number(org.selfServeRefundFeeValue),
      },
      signInMethod: org.buyerSignInMethod,
      accountUrl,
      domain: hostname ? { hostname } : null,
    };
  }
}

export default new CustomerAccountSettingsService();
