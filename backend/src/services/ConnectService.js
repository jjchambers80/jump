// Connect Service (spec 010 phase 2, spec 047 D0-S)
// The organization's own Stripe account: onboarding (connect an existing
// account with OAuth, or create a new one it owns with the full Stripe
// dashboard), state sync from Stripe Account objects, payout settings, and the
// routing decision for charges. Money movement itself happens in Checkout (see
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

import { createHmac, timingSafeEqual } from 'crypto';
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
// Finance › Payouts shows the most recent payouts only; the full history stays in Stripe.
const PAYOUT_HISTORY_LIMIT = 25;

/** Sum a Stripe balance bucket (`available` / `pending`) into dollars for the account's currency. */
function balanceSummary(balance) {
  const sum = (bucket) => (bucket || []).reduce((total, entry) => total + (entry.amount || 0), 0) / 100;
  const currency = balance.available?.[0]?.currency || balance.pending?.[0]?.currency || 'usd';
  return { available: sum(balance.available), pending: sum(balance.pending), currency };
}

/** Pure mapping from a Stripe Payout object to what the page renders (amounts in dollars). */
export function serializePayout(payout) {
  const bank = payout.destination && typeof payout.destination === 'object' ? payout.destination : null;
  return {
    id: payout.id,
    amount: (payout.amount || 0) / 100,
    currency: payout.currency || 'usd',
    status: payout.status || 'pending',
    arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null,
    createdAt: payout.created ? new Date(payout.created * 1000).toISOString() : null,
    automatic: payout.automatic !== false,
    statementDescriptor: payout.statement_descriptor || null,
    failureMessage: payout.failure_message || null,
    bank: bank ? { name: bank.bank_name || null, last4: bank.last4 || null } : null,
  };
}

// A Connect OAuth round trip (authorize → Stripe → back) takes minutes, not hours.
const OAUTH_STATE_TTL_MS = 30 * 60 * 1000;
const OAUTH_AUTHORIZE_URL = 'https://connect.stripe.com/oauth/authorize';

const ORG_SELECT = { id: true, name: true, email: true, phoneCountryCode: true, phoneNumber: true };

/** Platform Connect client id (`ca_…`) for "Connect with Stripe" (OAuth); unset hides that option. */
export function oauthClientId() {
  return process.env.STRIPE_CONNECT_CLIENT_ID || null;
}

/** The organization signs in to its own full Stripe dashboard; there is no per-account login link. */
export function dashboardUrl(mode = stripeMode()) {
  return `https://dashboard.stripe.com/${mode === 'test' ? 'test/' : ''}dashboard`;
}

function stateSignature(body) {
  return createHmac('sha256', String(process.env.AUTH_SECRET || '')).update(`connect-oauth:${body}`).digest('base64url');
}

/**
 * OAuth `state`: binds the round trip to the organization and the staff user
 * who started it, so a code minted for one organization can never be attached
 * to another (CSRF / account-swap). Signed with AUTH_SECRET, expires in 30 min.
 */
export function signOAuthState({ organizationId, userId }, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ o: organizationId, u: userId, e: now + OAUTH_STATE_TTL_MS })).toString('base64url');
  return `${body}.${stateSignature(body)}`;
}

/** @returns {{ organizationId: string, userId: string } | null} null when forged, malformed or expired */
export function readOAuthState(state, now = Date.now()) {
  if (typeof state !== 'string' || !state.includes('.')) return null;
  const [body, sig] = state.split('.');
  const expected = Buffer.from(stateSignature(body));
  const given = Buffer.from(String(sig));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { o, u, e } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!o || !u || typeof e !== 'number' || e < now) return null;
    return { organizationId: o, userId: u };
  } catch {
    return null;
  }
}

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

  /** Page payload: `{ enabled, status, account, oauthAvailable }`. Never calls Stripe. */
  async statusFor(organizationId) {
    if (!this.enabled()) return { enabled: false, status: 'not_started', account: null };
    const row = await this.accountFor(organizationId);
    return { enabled: true, status: connectStatus(row), account: this._serialize(row), oauthAvailable: Boolean(oauthClientId()) };
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
   * No Stripe account yet: create one the organization owns (full Stripe
   * dashboard, Stripe collects requirements, carries losses and bills fees to
   * the account) on first call, then mint a single-use Account Link. A
   * disconnected row is replaced by a fresh account.
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

    let link;
    try {
      link = await stripe.accountLinks.create({
        account: row.stripeAccountId,
        type: 'account_onboarding',
        return_url: `${base}/admin/settings/payments/payout-bank-account?onboarding=complete`,
        refresh_url: `${base}/admin/settings/payments/payout-bank-account?onboarding=refresh`,
      });
    } catch (error) {
      // An account connected with OAuth belongs to the organization, not to
      // Jump: Stripe refuses Account Links for it. Its owner finishes any
      // outstanding requirement in the Stripe dashboard.
      throw new ConflictError(`Finish setting up this account in your Stripe dashboard (${error.message})`);
    }
    return { url: link.url };
  }

  /**
   * "Connect with Stripe" for an organization that already has a Stripe
   * account: the OAuth authorize URL. Stripe sends the browser back to the
   * payout page with `code` + `state`, which `completeOAuth` exchanges.
   * The redirect URI must be registered in the platform's Connect settings.
   * @returns {Promise<{ url: string }>}
   */
  async oauthUrl(organizationId, { userId }) {
    this._assertEnabled();
    const clientId = oauthClientId();
    if (!clientId) throw new NotFoundError('Connecting an existing Stripe account is not configured');
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT });
    if (!organization) throw new NotFoundError('Organization not found');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'read_write',
      redirect_uri: this._oauthRedirectUri(),
      state: signOAuthState({ organizationId, userId }),
      'stripe_user[country]': 'US',
      'stripe_user[business_name]': organization.name,
      ...(organization.email && { 'stripe_user[email]': organization.email }),
    });
    return { url: `${OAUTH_AUTHORIZE_URL}?${params}` };
  }

  /**
   * Finish OAuth: verify `state` names this organization and user, exchange
   * the single-use code for the account id, and store it. Replaces a previous
   * account for the organization in this mode; refuses an account another
   * organization already uses (one account, one organization).
   */
  async completeOAuth(organizationId, { userId, code, state }) {
    this._assertEnabled();
    const claims = readOAuthState(state);
    if (!claims || claims.organizationId !== organizationId || claims.userId !== userId) {
      throw new ValidationError('This Stripe connection link is invalid or has expired. Start again from Settings › Payments.');
    }
    let token;
    try {
      token = await stripe.oauth.token({ grant_type: 'authorization_code', code });
    } catch (error) {
      throw new ValidationError(`Stripe could not connect the account: ${error.message}`);
    }
    const stripeAccountId = token.stripe_user_id;
    if (!stripeAccountId) throw new ValidationError('Stripe did not return an account id');
    if (Boolean(token.livemode) !== (stripeMode() === 'live')) {
      throw new ValidationError('The Stripe account was connected in a different mode (test vs live) than this platform');
    }

    const taken = await prisma.organizationStripeAccount.findUnique({ where: { stripeAccountId } });
    if (taken && taken.organizationId !== organizationId) {
      throw new ConflictError('This Stripe account is already connected to another organization');
    }
    const account = await stripe.accounts.retrieve(stripeAccountId, { expand: ['external_accounts'] });
    const mode = stripeMode();
    await prisma.$transaction(async (tx) => {
      await tx.organizationStripeAccount.deleteMany({ where: { organizationId, mode, stripeAccountId: { not: stripeAccountId } } });
      await tx.organizationStripeAccount.upsert({
        where: { stripeAccountId },
        create: { organizationId, mode, stripeAccountId, ...accountToRow(account) },
        update: { ...accountToRow(account), disconnectedAt: null },
      });
    });
    logger.info('Connect account connected with OAuth', {
      event: 'connect_oauth_connected',
      organizationId,
      stripeAccountId,
      actorId: userId,
    });
    return this.statusFor(organizationId);
  }

  _oauthRedirectUri() {
    return `${platformBaseUrl()}/admin/settings/payments/payout-bank-account`;
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

  /** The organization revoked the platform from its Stripe dashboard. */
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
  // Finance › Payouts
  // ---------------------------------------------------------------------------

  /**
   * Balance and recent payouts of the connected account, read live from
   * Stripe for the Finance › Payouts page. Null when there is nothing to show
   * yet (flag off, no account, onboarding unfinished) so the page can render
   * its empty state instead of an error. Never throws on a Stripe outage:
   * the page shows what the row already knows and an `error` string.
   * @returns {Promise<{ balance: object, payouts: object[], error: string|null } | null>}
   */
  async payoutActivity(organizationId, { limit = PAYOUT_HISTORY_LIMIT } = {}) {
    if (!this.enabled()) return null;
    const row = await this.accountFor(organizationId);
    if (!row || row.disconnectedAt || !row.detailsSubmitted) return null;
    const opts = { stripeAccount: row.stripeAccountId };
    try {
      const [balance, payouts] = await Promise.all([
        stripe.balance.retrieve(opts),
        stripe.payouts.list({ limit, expand: ['data.destination'] }, opts),
      ]);
      return {
        balance: balanceSummary(balance),
        payouts: (payouts.data || []).map(serializePayout),
        error: null,
      };
    } catch (error) {
      logger.warn('Connect payout activity unavailable', { event: 'connect_payout_activity_failed', organizationId, error: error.message });
      return { balance: null, payouts: [], error: 'Stripe could not be reached. Balance and payout history are temporarily unavailable.' };
    }
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

  /**
   * A new account the organization owns (spec 047 §3 S1): full Stripe
   * dashboard, so Stripe — not Jump — bills its processing fees, carries
   * negative balances, collects requirements and files the 1099-K. Stripe
   * requests the default capabilities (card_payments, transfers) for a
   * full-dashboard account; none are requested here.
   */
  _createParams(organization, url) {
    const supportPhone =
      organization.phoneNumber ? `${organization.phoneCountryCode || '+1'}${organization.phoneNumber}`.replace(/[^\d+]/g, '') : undefined;
    return {
      country: 'US',
      ...(organization.email && { email: organization.email }),
      controller: {
        fees: { payer: 'account' },
        losses: { payments: 'stripe' },
        stripe_dashboard: { type: 'full' },
        requirement_collection: 'stripe',
      },
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
      dashboardUrl: dashboardUrl(row.mode),
    };
  }
}

export default new ConnectService();
