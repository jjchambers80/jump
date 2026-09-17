// Connect Service (spec 010 phase 2)
// Stripe Connect Express accounts per organization: onboarding, state sync from
// Stripe Account objects, payout settings, and the routing decision for
// destination charges. Money movement itself happens in Checkout (see
// PaymentSettingsService.checkoutOptionsFor) and refunds (RefundService); this
// file owns the account row and nothing else.
//
// Rules (specs/010-payments-settings/plan-phase-2.md §2):
// - one account per organization per Stripe mode; rows for the other mode are
//   invisible, so test-mode onboarding cannot leak into live charges
// - a charge is routed to the connected account only when the flag is on, the
//   account has the `transfers` capability active and is not disconnected;
//   payouts being paused does not block sales
// - row state is written only from Stripe (retrieve or webhook), never guessed

import { prisma } from '@jump/db';
import stripe from '../config/stripe.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { platformBaseUrl, orgPageUrl } from '../utils/storefrontUrl.js';
import logger from '../utils/logger.js';
import {
  deriveDescriptorSuffix,
  normalizeDescriptorText,
  stripeMode,
} from './PaymentSettingsService.js';

export const PAYOUT_INTERVALS = new Set(['daily', 'weekly', 'monthly']);
export const WEEKLY_ANCHORS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
// Stripe caps the payout statement descriptor at 22 characters like card descriptors.
const PAYOUT_DESCRIPTOR_MAX = 22;

const ORG_SELECT = { id: true, name: true, email: true, phoneCountryCode: true, phoneNumber: true };

/** Master gate. Off: routes 404, checkout never routes, page hides payouts. */
export function connectEnabled() {
  return String(process.env.STRIPE_CONNECT_ENABLED || '').toLowerCase() === 'true';
}

/**
 * Lifecycle state derived from a row. `null` row = nothing started for this mode.
 * @returns {'not_started'|'onboarding'|'restricted'|'active'|'disconnected'}
 */
export function connectStatus(row) {
  if (!row) return 'not_started';
  if (row.disconnectedAt) return 'disconnected';
  if (!row.detailsSubmitted) return 'onboarding';
  if (!row.transfersEnabled || row.disabledReason || (row.currentlyDue || []).length > 0) return 'restricted';
  return 'active';
}

/**
 * Pure mapping from a Stripe Account object to row columns. Shared by sync and
 * the Connect webhook so both write identical state.
 */
export function accountToRow(account) {
  const bank = (account.external_accounts?.data || []).find((a) => a.default_for_currency) || account.external_accounts?.data?.[0] || null;
  const payouts = account.settings?.payouts || {};
  const schedule = payouts.schedule || {};
  return {
    chargesEnabled: account.charges_enabled === true,
    transfersEnabled: account.capabilities?.transfers === 'active',
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    disabledReason: account.requirements?.disabled_reason || null,
    currentlyDue: account.requirements?.currently_due || [],
    bankName: bank?.bank_name || null,
    bankLast4: bank?.last4 || null,
    currency: bank?.currency || account.default_currency || null,
    payoutInterval: schedule.interval || null,
    payoutAnchor: schedule.weekly_anchor || (schedule.monthly_anchor != null ? String(schedule.monthly_anchor) : null),
    payoutDelayDays: schedule.delay_days ?? null,
    payoutDescriptor: payouts.statement_descriptor || null,
    lastSyncedAt: new Date(),
  };
}

class ConnectService {
  enabled() {
    return connectEnabled();
  }

  /** Row for the organization in the current Stripe mode, or null. */
  async accountFor(organizationId) {
    return prisma.organizationStripeAccount.findUnique({
      where: { organizationId_mode: { organizationId, mode: stripeMode() } },
    });
  }

  /** Page payload: `{ enabled, status, account }`. Never calls Stripe. */
  async statusFor(organizationId) {
    if (!this.enabled()) return { enabled: false, status: 'not_started', account: null };
    const row = await this.accountFor(organizationId);
    return { enabled: true, status: connectStatus(row), account: this._serialize(row) };
  }

  /**
   * Routing decision for a new charge (plan-phase-2 §2.2). Synchronous apart
   * from one row read; never throws.
   * @returns {Promise<{ stripeAccountId: string } | null>}
   */
  async destinationFor(organizationId) {
    if (!this.enabled() || !organizationId) return null;
    try {
      const row = await this.accountFor(organizationId);
      if (!row || row.disconnectedAt || !row.transfersEnabled) return null;
      return { stripeAccountId: row.stripeAccountId };
    } catch (error) {
      logger.error('Connect routing lookup failed; charging on the platform account', {
        event: 'connect_routing_skipped',
        organizationId,
        error: error.message,
      });
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Onboarding
  // ---------------------------------------------------------------------------

  /**
   * Create the Express account on first call, then mint a single-use Account
   * Link. A disconnected row is replaced by a fresh account.
   * @returns {Promise<{ url: string }>}
   */
  async startOnboarding(organizationId, { actorId = null } = {}) {
    this._assertEnabled();
    const base = platformBaseUrl();
    if (stripeMode() === 'live' && !base.startsWith('https://')) {
      throw new ValidationError('Stripe requires an https return URL for live onboarding; FRONTEND_URL is not https');
    }

    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT });
    if (!organization) throw new NotFoundError('Organization not found');

    let row = await this.accountFor(organizationId);
    if (row?.disconnectedAt) {
      // The old account no longer authorizes this platform; start over.
      await prisma.organizationStripeAccount.delete({ where: { id: row.id } });
      row = null;
    }

    if (!row) {
      const account = await stripe.accounts.create(this._createParams(organization, await orgPageUrl(organizationId)));
      row = await prisma.organizationStripeAccount.create({
        data: {
          organizationId,
          mode: stripeMode(),
          stripeAccountId: account.id,
          ...accountToRow(account),
        },
      });
      logger.info('Connect onboarding started', {
        event: 'connect_onboarding_started',
        organizationId,
        stripeAccountId: account.id,
        actorId,
      });
    }

    const link = await stripe.accountLinks.create({
      account: row.stripeAccountId,
      type: 'account_onboarding',
      return_url: `${base}/admin/settings/payments/payouts?onboarding=complete`,
      refresh_url: `${base}/admin/settings/payments/payouts?onboarding=refresh`,
    });
    return { url: link.url };
  }

  /** Express dashboard login link; Stripe refuses it before onboarding completes. */
  async loginLink(organizationId) {
    this._assertEnabled();
    const row = await this._requireRow(organizationId);
    if (!row.detailsSubmitted) throw new ConflictError('Finish Stripe onboarding before opening the Express dashboard');
    const link = await stripe.accounts.createLoginLink(row.stripeAccountId);
    return { url: link.url };
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Pull the account from Stripe now (page button, onboarding return). */
  async syncAccount(organizationId) {
    this._assertEnabled();
    const row = await this._requireRow(organizationId);
    const account = await stripe.accounts.retrieve(row.stripeAccountId, { expand: ['external_accounts'] });
    return this.applyAccount(row.stripeAccountId, account);
  }

  /**
   * Write a Stripe Account object onto its row (sync + webhook). Unknown
   * accounts are ignored, not created: the row is only ever born in onboarding.
   * @returns {Promise<object|null>} serialized state or null when unknown
   */
  async applyAccount(stripeAccountId, account) {
    const existing = await prisma.organizationStripeAccount.findUnique({ where: { stripeAccountId } });
    if (!existing) {
      logger.warn('Connect account event for an unknown account', { event: 'connect_account_unknown', stripeAccountId });
      return null;
    }
    const before = connectStatus(existing);
    const row = await prisma.organizationStripeAccount.update({
      where: { stripeAccountId },
      data: accountToRow(account),
    });
    const after = connectStatus(row);
    logger.info('Connect account synced', {
      event: 'connect_account_synced',
      organizationId: row.organizationId,
      stripeAccountId,
      status: after,
      ...(before !== after && { from: before }),
    });
    return this._serialize(row);
  }

  /** The organization revoked the platform from its Express dashboard. */
  async markDisconnected(stripeAccountId) {
    const existing = await prisma.organizationStripeAccount.findUnique({ where: { stripeAccountId } });
    if (!existing) return null;
    const row = await prisma.organizationStripeAccount.update({
      where: { stripeAccountId },
      data: { disconnectedAt: new Date(), transfersEnabled: false, chargesEnabled: false, payoutsEnabled: false },
    });
    logger.warn('Connect account disconnected', {
      event: 'connect_account_disconnected',
      organizationId: row.organizationId,
      stripeAccountId,
    });
    return this._serialize(row);
  }

  /** Record the latest payout outcome from `payout.paid` / `payout.failed`. */
  async recordPayout(stripeAccountId, payout) {
    const existing = await prisma.organizationStripeAccount.findUnique({ where: { stripeAccountId } });
    if (!existing) return null;
    const failed = payout.status === 'failed';
    const row = await prisma.organizationStripeAccount.update({
      where: { stripeAccountId },
      data: failed
        ? { lastPayoutFailure: payout.failure_message || payout.failure_code || 'Payout failed' }
        : { lastPayoutAt: new Date((payout.arrival_date || payout.created) * 1000), lastPayoutFailure: null },
    });
    if (failed) {
      logger.warn('Connect payout failed', {
        event: 'connect_payout_failed',
        organizationId: row.organizationId,
        stripeAccountId,
        code: payout.failure_code,
      });
    }
    return this._serialize(row);
  }

  // ---------------------------------------------------------------------------
  // Payout settings
  // ---------------------------------------------------------------------------

  /**
   * @param {string} organizationId
   * @param {{ interval?: string, anchor?: string|number, statementDescriptor?: string|null }} body
   */
  async updatePayoutSettings(organizationId, body) {
    this._assertEnabled();
    const row = await this._requireRow(organizationId);
    if (!row.detailsSubmitted) throw new ConflictError('Finish Stripe onboarding before changing payout settings');

    const payouts = {};
    if (body.interval !== undefined) payouts.schedule = this._validateSchedule(body.interval, body.anchor);
    if (body.statementDescriptor !== undefined) {
      payouts.statement_descriptor = this._validatePayoutDescriptor(body.statementDescriptor);
    }
    if (Object.keys(payouts).length === 0) throw new ValidationError('Nothing to update');

    let account;
    try {
      account = await stripe.accounts.update(row.stripeAccountId, { settings: { payouts } });
    } catch (error) {
      throw new ValidationError(`Stripe rejected the payout settings: ${error.message}`);
    }
    logger.info('Connect payout settings updated', {
      event: 'connect_payout_settings_updated',
      organizationId,
      changes: Object.keys(payouts),
    });
    return this.applyAccount(row.stripeAccountId, account);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  _assertEnabled() {
    if (!this.enabled()) throw new NotFoundError('Stripe Connect is not enabled');
  }

  async _requireRow(organizationId) {
    const row = await this.accountFor(organizationId);
    if (!row) throw new NotFoundError('No Stripe Connect account for this organization');
    return row;
  }

  /** Express account via the `controller` spelling (plan-phase-2 §2.4). */
  _createParams(organization, url) {
    const supportPhone =
      organization.phoneNumber ? `${organization.phoneCountryCode || '+1'}${organization.phoneNumber}`.replace(/[^\d+]/g, '') : undefined;
    return {
      country: 'US',
      ...(organization.email && { email: organization.email }),
      controller: {
        fees: { payer: 'application' },
        losses: { payments: 'application' },
        stripe_dashboard: { type: 'express' },
        requirement_collection: 'stripe',
      },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: {
        name: organization.name,
        ...(supportPhone && { support_phone: supportPhone }),
        ...(url && /^https:\/\//.test(url) && { url }),
      },
      settings: {
        payouts: {
          ...(deriveDescriptorSuffix(organization.name, 'JUMP') && {
            statement_descriptor: deriveDescriptorSuffix(organization.name, 'JUMP'),
          }),
        },
      },
      metadata: { organizationId: organization.id, mode: stripeMode() },
    };
  }

  _validateSchedule(interval, anchor) {
    if (!PAYOUT_INTERVALS.has(interval)) throw new ValidationError('interval must be daily, weekly or monthly');
    if (interval === 'daily') {
      if (anchor !== undefined && anchor !== null) throw new ValidationError('anchor is not allowed for daily payouts');
      return { interval };
    }
    if (interval === 'weekly') {
      if (!WEEKLY_ANCHORS.has(anchor)) throw new ValidationError('anchor must be a weekday name for weekly payouts');
      return { interval, weekly_anchor: anchor };
    }
    const day = Number(anchor);
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new ValidationError('anchor must be a day of month (1-31) for monthly payouts');
    return { interval, monthly_anchor: day };
  }

  _validatePayoutDescriptor(raw) {
    if (raw === null || raw === '') throw new ValidationError('Payout name is required');
    if (typeof raw !== 'string') throw new ValidationError('statementDescriptor must be a string');
    if (/[^A-Za-z0-9 ]/.test(raw.trim())) throw new ValidationError('Payout name may only contain letters, numbers and spaces');
    const clean = normalizeDescriptorText(raw);
    if (!/[A-Z]/.test(clean)) throw new ValidationError('Payout name must contain at least one letter');
    if (clean.length > PAYOUT_DESCRIPTOR_MAX) throw new ValidationError(`Payout name must be ${PAYOUT_DESCRIPTOR_MAX} characters or fewer`);
    return clean;
  }

  _serialize(row) {
    if (!row) return null;
    return {
      stripeAccountId: row.stripeAccountId,
      mode: row.mode,
      status: connectStatus(row),
      chargesEnabled: row.chargesEnabled,
      transfersEnabled: row.transfersEnabled,
      payoutsEnabled: row.payoutsEnabled,
      detailsSubmitted: row.detailsSubmitted,
      disabledReason: row.disabledReason,
      currentlyDue: row.currentlyDue || [],
      bank: row.bankLast4 ? { name: row.bankName, last4: row.bankLast4, currency: row.currency } : null,
      payouts: {
        interval: row.payoutInterval,
        anchor: row.payoutAnchor,
        delayDays: row.payoutDelayDays,
        statementDescriptor: row.payoutDescriptor,
        lastPayoutAt: row.lastPayoutAt,
        lastPayoutFailure: row.lastPayoutFailure,
      },
      disconnectedAt: row.disconnectedAt,
      lastSyncedAt: row.lastSyncedAt,
    };
  }
}

export default new ConnectService();
