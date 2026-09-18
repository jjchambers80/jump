// Billing Service (spec 022 phase 2)
// Jump's subscription with each organization, on Jump's own Stripe account
// (the same `stripe` client as orders; the organization's connected account
// is never involved). State on PlatformCustomer is written only from Stripe
// objects: the Checkout session on return, and subscription events on
// POST /webhooks/stripe/billing.

import { prisma } from '@jump/db';
import stripe from '../config/stripe.js';
import logger from '../utils/logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { platformBaseUrl } from '../utils/storefrontUrl.js';
import { billingEnabled, trialDays, starterPriceId, PAID_SUBSCRIPTION_STATUSES } from '../config/billing.js';

const BILLING_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
]);

const toDate = (unixSeconds) => (unixSeconds ? new Date(unixSeconds * 1000) : null);

/** Pure mapping from a Stripe Subscription to PlatformCustomer columns. */
export function subscriptionToRow(subscription) {
  const status = subscription.status;
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
  return {
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: status,
    trialEndsAt: toDate(subscription.trial_end),
    currentPeriodEndsAt: toDate(subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end),
    plan: PAID_SUBSCRIPTION_STATUSES.has(status) && priceId === starterPriceId() ? 'STARTER' : 'FREE',
  };
}

class BillingService {
  enabled() {
    return billingEnabled();
  }

  /** Offer shown on the subscribe screen: trial length and the STARTER price. Cached 10 min. */
  async offer() {
    if (!this.enabled()) return null;
    const now = Date.now();
    if (this._offer && this._offerAt && now - this._offerAt < 10 * 60 * 1000) return this._offer;
    const price = await stripe.prices.retrieve(starterPriceId());
    this._offer = {
      trialDays: trialDays(),
      priceId: price.id,
      unitAmount: price.unit_amount,
      currency: price.currency,
      interval: price.recurring?.interval ?? 'month',
      intervalCount: price.recurring?.interval_count ?? 1,
      productName: typeof price.product === 'object' ? price.product?.name : null,
    };
    this._offerAt = now;
    return this._offer;
  }

  async _customerFor(organizationId, userId) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, email: true, platformCustomer: true },
    });
    if (!org) throw new NotFoundError('Organization not found');
    let row = org.platformCustomer;
    if (!row) {
      row = await prisma.platformCustomer.create({ data: { organizationId, ownerUserId: userId } });
    }
    if (row.stripeCustomerId) return { org, row };

    const owner = await prisma.user.findUnique({ where: { id: row.ownerUserId }, select: { email: true, name: true } });
    const customer = await stripe.customers.create({
      email: org.email || owner?.email || undefined,
      name: org.name,
      metadata: { organizationId, platformCustomerId: row.id },
    });
    row = await prisma.platformCustomer.update({ where: { id: row.id }, data: { stripeCustomerId: customer.id } });
    return { org, row };
  }

  /**
   * Embedded Checkout session in subscription mode with the trial.
   * @param {string} organizationId
   * @param {string} userId - caller (owner when the row is created here)
   * @param {{ returnPath: string }} options - frontend path Stripe returns to; `{CHECKOUT_SESSION_ID}` is appended
   * @returns {Promise<{ clientSecret: string, sessionId: string, offer: Object }>}
   */
  async createCheckout(organizationId, userId, { returnPath }) {
    if (!this.enabled()) throw new ConflictError('Subscriptions are not available yet');
    const { row } = await this._customerFor(organizationId, userId);
    if (row.stripeSubscriptionId && PAID_SUBSCRIPTION_STATUSES.has(row.subscriptionStatus)) {
      throw new ConflictError('This organization already has a subscription');
    }
    const separator = returnPath.includes('?') ? '&' : '?';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'embedded',
      customer: row.stripeCustomerId,
      line_items: [{ price: starterPriceId(), quantity: 1 }],
      subscription_data: {
        ...(trialDays() > 0 ? { trial_period_days: trialDays() } : {}),
        metadata: { organizationId },
      },
      metadata: { organizationId, billing: 'subscription' },
      return_url: `${platformBaseUrl()}${returnPath}${separator}session_id={CHECKOUT_SESSION_ID}`,
    });
    logger.info('Billing checkout created', { event: 'billing_checkout_created', organizationId, sessionId: session.id });
    return { clientSecret: session.client_secret, sessionId: session.id, offer: await this.offer() };
  }

  /**
   * Record a completed Checkout session on return (the webhook may not have
   * arrived yet). Idempotent. Returns whether the subscription is in place.
   */
  async confirmCheckout(organizationId, sessionId) {
    if (!this.enabled()) throw new ConflictError('Subscriptions are not available yet');
    if (!sessionId || typeof sessionId !== 'string') throw new ValidationError('sessionId is required');
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
    if (session.metadata?.organizationId !== organizationId) throw new NotFoundError('Checkout session not found');
    if (session.status !== 'complete' || !session.subscription) return { subscribed: false };
    const subscription = typeof session.subscription === 'string'
      ? await stripe.subscriptions.retrieve(session.subscription)
      : session.subscription;
    await this._applySubscription(organizationId, subscription);
    return { subscribed: true };
  }

  async _applySubscription(organizationId, subscription) {
    const existing = await prisma.platformCustomer.findUnique({ where: { organizationId }, select: { onboarding: true } });
    const row = subscriptionToRow(subscription);
    const onboarding = existing?.onboarding && !existing.onboarding.subscribedAt
      ? { ...existing.onboarding, subscribedAt: new Date().toISOString() }
      : undefined;
    await prisma.platformCustomer.update({
      where: { organizationId },
      data: { ...row, ...(onboarding ? { onboarding } : {}) },
    });
    logger.info('Billing subscription applied', {
      event: 'billing_subscription_applied',
      organizationId,
      subscriptionId: subscription.id,
      status: subscription.status,
      plan: row.plan,
    });
  }

  /** Plan summary for Settings › Plan. A missing row is the FREE plan. */
  async statusFor(organizationId) {
    const row = await prisma.platformCustomer.findUnique({ where: { organizationId } });
    return {
      enabled: this.enabled(),
      plan: row?.plan ?? 'FREE',
      subscriptionStatus: row?.subscriptionStatus ?? null,
      trialEndsAt: row?.trialEndsAt ?? null,
      currentPeriodEndsAt: row?.currentPeriodEndsAt ?? null,
      hasSubscription: Boolean(row?.stripeSubscriptionId),
      canManage: Boolean(row?.stripeCustomerId),
      offer: this.enabled() ? await this.offer().catch(() => null) : null,
    };
  }

  /** Stripe customer portal (cancel, update card, invoices). */
  async portalLink(organizationId, { returnPath }) {
    if (!this.enabled()) throw new ConflictError('Subscriptions are not available yet');
    const row = await prisma.platformCustomer.findUnique({ where: { organizationId }, select: { stripeCustomerId: true } });
    if (!row?.stripeCustomerId) throw new NotFoundError('No billing account for this organization yet');
    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripeCustomerId,
      return_url: `${platformBaseUrl()}${returnPath}`,
    });
    return { url: session.url };
  }

  isBillingEvent(event) {
    if (!BILLING_EVENTS.has(event?.type)) return false;
    const object = event.data?.object;
    if (event.type === 'checkout.session.completed') return object?.mode === 'subscription';
    return true;
  }

  /** Mirror a billing webhook event onto PlatformCustomer. Unknown organizations are logged and ignored. */
  async handleEvent(event) {
    const object = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        const organizationId = object.metadata?.organizationId;
        if (!organizationId || !object.subscription) return;
        const subscription = await stripe.subscriptions.retrieve(object.subscription);
        await this._applyIfKnown(organizationId, subscription);
        return;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const organizationId = object.metadata?.organizationId || (await this._organizationForSubscription(object.id));
        if (!organizationId) {
          logger.warn('Billing webhook for an unknown subscription', { type: event.type, subscriptionId: object.id });
          return;
        }
        await this._applyIfKnown(organizationId, object);
        return;
      }
      case 'invoice.payment_failed': {
        logger.warn('Billing invoice payment failed', {
          event: 'billing_invoice_failed',
          customerId: object.customer,
          subscriptionId: object.subscription,
        });
        return; // the matching customer.subscription.updated carries the past_due status
      }
      default:
        return;
    }
  }

  async _applyIfKnown(organizationId, subscription) {
    const row = await prisma.platformCustomer.findUnique({ where: { organizationId }, select: { id: true } });
    if (!row) {
      logger.warn('Billing webhook for an unknown organization', { organizationId, subscriptionId: subscription.id });
      return;
    }
    await this._applySubscription(organizationId, subscription);
  }

  async _organizationForSubscription(subscriptionId) {
    const row = await prisma.platformCustomer.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      select: { organizationId: true },
    });
    return row?.organizationId ?? null;
  }
}

export default new BillingService();
