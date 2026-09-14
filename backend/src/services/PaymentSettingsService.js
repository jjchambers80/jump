// Payment Settings Service (spec 010 phase 1)
// Organization-level payment configuration that Checkout reads at session
// creation: the statement descriptor suffix buyers see on their card statement
// and which optional Stripe payment methods the organization offers. Webhook
// processing stays in PaymentService; this file is configuration only.

import { prisma } from '@jump/db';
import stripe from '../config/stripe.js';
import { FEE_CONFIG } from '../config/fees.js';
import {
  ALWAYS_ON_METHODS,
  PAYMENT_METHOD_ALLOWLIST,
  PAYMENT_METHOD_TYPES,
  STATEMENT_DESCRIPTOR_JOINER,
  STATEMENT_DESCRIPTOR_MAX,
} from '../config/payments.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

// Platform account details (prefix, capabilities) change rarely; one call per 5 minutes.
const PROVIDER_STATUS_TTL_MS = 5 * 60 * 1000;

const ORG_SELECT = {
  id: true,
  name: true,
  phoneCountryCode: true,
  phoneNumber: true,
  statementDescriptorSuffix: true,
  enabledPaymentMethods: true,
  paymentSettingsUpdatedAt: true,
};

/** `test` when the configured key is a test key; live otherwise. */
export function stripeMode() {
  return String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_') ? 'test' : 'live';
}

function dashboardUrl(path = '') {
  return `https://dashboard.stripe.com/${stripeMode() === 'test' ? 'test/' : ''}${path}`;
}

/**
 * Upper-case, strip everything Stripe disallows and collapse whitespace.
 * Returns '' for input with nothing usable.
 */
export function normalizeDescriptorText(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Characters left for the suffix once the platform prefix and joiner are counted. */
export function suffixBudget(prefix) {
  if (!prefix) return 0;
  return Math.max(0, STATEMENT_DESCRIPTOR_MAX - prefix.length - STATEMENT_DESCRIPTOR_JOINER.length);
}

/**
 * Default suffix for an organization with none set: its name, sanitised and cut
 * to the budget. Null when nothing usable remains (no letter, or no budget).
 */
export function deriveDescriptorSuffix(name, prefix) {
  const budget = suffixBudget(prefix);
  if (budget <= 0) return null;
  const clean = normalizeDescriptorText(name).slice(0, budget).trim();
  return /[A-Z]/.test(clean) ? clean : null;
}

class PaymentSettingsService {
  constructor() {
    this._statusCache = { value: null, expiresAt: 0 };
  }

  // ---------------------------------------------------------------------------
  // Platform Stripe account
  // ---------------------------------------------------------------------------

  /**
   * What the platform Stripe account can do for every organization. Cached
   * in-process for 5 minutes. Never throws: failures report `unavailable`.
   *
   * @returns {Promise<{ provider: 'STRIPE', mode: 'live'|'test', charges: 'active'|'unavailable', statementDescriptorPrefix: string|null, capabilities: Record<string, string|null>, manageUrl: string, radarUrl: string, error: string|null }>}
   */
  async getProviderStatus() {
    const now = Date.now();
    if (this._statusCache.value && this._statusCache.expiresAt > now) return this._statusCache.value;

    const base = { provider: 'STRIPE', mode: stripeMode(), manageUrl: dashboardUrl(), radarUrl: dashboardUrl('radar/rules') };
    let value;
    try {
      const account = await stripe.accounts.retrieve();
      const capabilities = {};
      for (const method of PAYMENT_METHOD_ALLOWLIST) {
        capabilities[method.type] = account.capabilities?.[method.capability] ?? null;
      }
      value = {
        ...base,
        charges: account.charges_enabled ? 'active' : 'unavailable',
        statementDescriptorPrefix: account.settings?.card_payments?.statement_descriptor_prefix || null,
        capabilities,
        error: account.charges_enabled ? null : 'Charges are not enabled on the Stripe account',
      };
    } catch (error) {
      logger.warn('Stripe account status unavailable', { event: 'payment_provider_unavailable', error: error.message });
      value = { ...base, charges: 'unavailable', statementDescriptorPrefix: null, capabilities: {}, error: error.message };
    }
    this._statusCache = { value, expiresAt: now + PROVIDER_STATUS_TTL_MS };
    return value;
  }

  /** Drop the cached provider status (tests). */
  _invalidate() {
    this._statusCache = { value: null, expiresAt: 0 };
  }

  // ---------------------------------------------------------------------------
  // Organization settings
  // ---------------------------------------------------------------------------

  /** Settings page payload for one organization. */
  async getSettings(organizationId) {
    const [organization, provider] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT }),
      this.getProviderStatus(),
    ]);
    if (!organization) throw new NotFoundError('Organization not found');
    return this._serialize(organization, provider);
  }

  /**
   * Update the suffix and/or enabled methods. Validates against the live
   * platform prefix and capabilities so a bad value can never reach Checkout.
   *
   * @param {string} organizationId
   * @param {{ statementDescriptorSuffix?: string|null, enabledPaymentMethods?: string[] }} body
   */
  async updateSettings(organizationId, body) {
    const provider = await this.getProviderStatus();
    const data = {};

    if (body.statementDescriptorSuffix !== undefined) {
      data.statementDescriptorSuffix = this._validateSuffix(body.statementDescriptorSuffix, provider);
    }
    if (body.enabledPaymentMethods !== undefined) {
      data.enabledPaymentMethods = this._validateMethods(body.enabledPaymentMethods, provider);
    }
    if (Object.keys(data).length === 0) throw new ValidationError('Nothing to update');
    data.paymentSettingsUpdatedAt = new Date();

    const organization = await prisma.organization.update({ where: { id: organizationId }, data, select: ORG_SELECT });
    logger.info('Payment settings updated', {
      event: 'payment_settings_updated',
      organizationId,
      changes: Object.keys(data).filter((k) => k !== 'paymentSettingsUpdatedAt'),
    });
    return this._serialize(organization, provider);
  }

  // ---------------------------------------------------------------------------
  // Checkout
  // ---------------------------------------------------------------------------

  /**
   * Checkout Session params for an organization. Never throws and never sends a
   * value Stripe would reject: a suffix that no longer fits the platform prefix
   * is dropped, a method the platform lost the capability for is filtered out.
   *
   * @param {{ id: string, name: string, statementDescriptorSuffix?: string|null, enabledPaymentMethods?: string[] }} organization
   * @returns {Promise<{ payment_method_types: string[], payment_intent_data?: { statement_descriptor_suffix: string } }>}
   */
  async checkoutOptionsFor(organization) {
    const fallback = { payment_method_types: ['card'] };
    if (!organization) return fallback;
    try {
      const provider = await this.getProviderStatus();
      const extras = (organization.enabledPaymentMethods || []).filter(
        (type) => PAYMENT_METHOD_TYPES.has(type) && provider.capabilities[type] === 'active'
      );
      const options = { payment_method_types: ['card', ...extras] };

      const suffix = this._effectiveSuffix(organization, provider);
      if (suffix) {
        options.payment_intent_data = { statement_descriptor_suffix: suffix };
      } else if (organization.statementDescriptorSuffix) {
        logger.warn('Statement descriptor suffix dropped at checkout', {
          event: 'statement_descriptor_dropped',
          organizationId: organization.id,
          prefix: provider.statementDescriptorPrefix,
        });
      }
      return options;
    } catch (error) {
      logger.error('Checkout options failed; using defaults', { organizationId: organization.id, error: error.message });
      return fallback;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Stored suffix when it still fits the platform prefix, else the derived one. */
  _effectiveSuffix(organization, provider) {
    const prefix = provider.statementDescriptorPrefix;
    const budget = suffixBudget(prefix);
    if (budget <= 0) return null;
    const stored = organization.statementDescriptorSuffix;
    if (stored && /^[A-Z0-9 ]+$/.test(stored) && /[A-Z]/.test(stored) && stored.length <= budget) return stored;
    return deriveDescriptorSuffix(organization.name, prefix);
  }

  _validateSuffix(raw, provider) {
    if (raw === null || raw === '') return null;
    if (typeof raw !== 'string') throw new ValidationError('statementDescriptorSuffix must be a string');
    const prefix = provider.statementDescriptorPrefix;
    if (!prefix) {
      throw new ValidationError(
        'The platform Stripe account has no statement descriptor prefix, so a suffix cannot be set yet'
      );
    }
    const trimmed = raw.trim();
    if (/[^A-Za-z0-9 ]/.test(trimmed)) {
      throw new ValidationError('Name on customer statement may only contain letters, numbers and spaces');
    }
    const clean = normalizeDescriptorText(trimmed);
    if (!/[A-Z]/.test(clean)) throw new ValidationError('Name on customer statement must contain at least one letter');
    const budget = suffixBudget(prefix);
    if (clean.length > budget) {
      throw new ValidationError(`Name on customer statement must be ${budget} characters or fewer with the "${prefix}" prefix`);
    }
    return clean;
  }

  _validateMethods(list, provider) {
    if (!Array.isArray(list) || list.some((t) => typeof t !== 'string')) {
      throw new ValidationError('enabledPaymentMethods must be an array of payment method types');
    }
    const unique = [...new Set(list)];
    for (const type of unique) {
      if (!PAYMENT_METHOD_TYPES.has(type)) throw new ValidationError(`Unknown payment method: ${type}`);
      if (provider.capabilities[type] !== 'active') {
        throw new ValidationError(`${type} is not available on the platform Stripe account`);
      }
    }
    // Keep allowlist order so the checkout page is stable.
    return PAYMENT_METHOD_ALLOWLIST.map((m) => m.type).filter((t) => unique.includes(t));
  }

  _serialize(organization, provider) {
    const prefix = provider.statementDescriptorPrefix;
    const stored = organization.statementDescriptorSuffix;
    const effective = this._effectiveSuffix(organization, provider);
    const enabled = new Set(organization.enabledPaymentMethods || []);
    return {
      // Trade name and support phone live on Settings › General; shown read-only here.
      organization: { name: organization.name, phoneCountryCode: organization.phoneCountryCode ?? null, phoneNumber: organization.phoneNumber ?? null },
      statementDescriptorSuffix: stored,
      descriptor: {
        prefix,
        suffix: effective,
        full: prefix && effective ? `${prefix}${STATEMENT_DESCRIPTOR_JOINER}${effective}` : null,
        derived: !stored || stored !== effective,
        budget: suffixBudget(prefix),
      },
      enabledPaymentMethods: organization.enabledPaymentMethods || [],
      methods: {
        cards: ALWAYS_ON_METHODS.cards,
        wallets: ALWAYS_ON_METHODS.wallets,
        optional: PAYMENT_METHOD_ALLOWLIST.map((m) => {
          const capability = provider.capabilities[m.type] ?? null;
          return {
            type: m.type,
            label: m.label,
            group: m.group,
            help: m.help,
            available: capability === 'active',
            enabled: enabled.has(m.type) && capability === 'active',
          };
        }),
      },
      rates: {
        platformFeePercent: FEE_CONFIG.platformFeePercent,
        processingFeePercent: FEE_CONFIG.stripeFeePercent,
        processingFeeFixed: FEE_CONFIG.stripeFeeFixed,
      },
      updatedAt: organization.paymentSettingsUpdatedAt,
    };
  }
}

export default new PaymentSettingsService();
