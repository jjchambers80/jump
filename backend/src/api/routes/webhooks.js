// Stripe Webhook Handler
// POST /webhooks/stripe - Handle Stripe webhook events
// Per FR-028, FR-029, contracts/api.yaml

import express from 'express';
import stripe from '../../config/stripe.js';
import PaymentService from '../../services/PaymentService.js';
import RefundService from '../../services/RefundService.js';
import ConnectService from '../../services/ConnectService.js';
import ApplicationPaymentService from '../../services/ApplicationPaymentService.js';
import BillingService from '../../services/BillingService.js';
import WebhookEventService, { ENDPOINTS } from '../../services/WebhookEventService.js';
import { stripeMode } from '../../services/PaymentSettingsService.js';
import logger from '../../utils/logger.js';

const router = express.Router();

/** A missing signing secret where real money is at stake — our misconfiguration, not the caller's. */
class WebhookNotConfiguredError extends Error {}

/**
 * Where an unverified body must never be trusted.
 *
 * Deliberately two conditions, not one. `NODE_ENV` is the obvious signal, but
 * nothing in `railpack.backend.json` sets it — it comes from the platform, and
 * a security control should not rest on that holding. A **live Stripe key** is
 * unambiguous: real money is moving, whatever the environment claims to be.
 * `stripeMode()` treats anything that is not `sk_test_` as live, which is the
 * safe direction to be wrong in.
 */
function mustVerify() {
  return process.env.NODE_ENV === 'production' || stripeMode() === 'live';
}

/**
 * Parse and verify a Stripe webhook body.
 *
 * WHY this fails closed: without a secret the body is trusted, which makes the
 * endpoint an unauthenticated write path into the ledger — anyone on the
 * internet could post a `checkout.session.completed` and mint tickets. In
 * development, against a test key, the secret stays optional so local work and
 * the contract suite can post plain JSON.
 *
 * Throws WebhookNotConfiguredError when the secret is missing somewhere it
 * matters (see `mustVerify`), and the usual Stripe signature error on a bad
 * signature.
 */
function readStripeEvent(req, secretName, label) {
  const secret = process.env[secretName];
  if (secret) return stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);

  if (mustVerify()) {
    throw new WebhookNotConfiguredError(
      `${secretName} is not set; refusing to trust an unverified ${label} webhook`
    );
  }

  logger.warn(`Stripe ${label} webhook signature verification skipped (no ${secretName} configured)`);
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString());
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return req.body;
}

/**
 * Shared front half of every endpoint: verify, then claim the delivery in the
 * webhook ledger. Returns null when the caller has already answered.
 */
async function verifyAndClaim(req, res, { secretName, label, endpoint }) {
  let event;
  try {
    event = readStripeEvent(req, secretName, label);
  } catch (err) {
    if (err instanceof WebhookNotConfiguredError) {
      logger.error(`Stripe ${label} webhook rejected: signing secret not configured`, {
        event: 'stripe_webhook_not_configured',
        endpoint,
        secretName,
      });
      // 500, not 400: the delivery is fine, we are not. Stripe retries for up
      // to three days, so the backlog drains once the secret is set.
      res.status(500).json({ error: 'Webhook endpoint is not configured' });
      return null;
    }
    logger.error(`Stripe ${label} webhook signature verification failed`, { error: err.message });
    res.status(400).send(`Webhook Error: ${err.message}`);
    return null;
  }

  const claim = await WebhookEventService.claim(endpoint, event);
  if (!claim.proceed) {
    res.json({ received: true, duplicate: true });
    return null;
  }
  return { event, recordId: claim.recordId };
}

/**
 * POST /webhooks/stripe
 * Handle Stripe webhook events for order status transitions.
 * Idempotent: safe to receive the same event multiple times.
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const claimed = await verifyAndClaim(req, res, {
    secretName: 'STRIPE_WEBHOOK_SECRET',
    label: 'platform',
    endpoint: ENDPOINTS.PLATFORM,
  });
  if (!claimed) return;
  const { event, recordId } = claimed;

  try {
    // Jump subscription events belong on /webhooks/stripe/billing (spec 022);
    // one registered here by mistake must not be mistaken for an order.
    if (BillingService.isBillingEvent(event)) {
      logger.warn('Billing event received on the platform endpoint; ignored', { type: event.type });
      await WebhookEventService.settle(recordId, 'IGNORED');
      return res.json({ received: true, ignored: true });
    }

    // Application payments (spec 011 phase 2) share this endpoint. Dispatch
    // strictly on metadata.applicationId (ticket sessions never carry it).
    // charge.refunded is not dispatched here: every refund resolves through
    // the order's PaymentTransaction in RefundService (spec 024), whatever
    // the order kind.
    if (ApplicationPaymentService.isApplicationEvent(event)) {
      await ApplicationPaymentService.handleEvent(event);
      await WebhookEventService.settle(recordId, 'PROCESSED');
      return res.json({ received: true });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        logger.info('Stripe checkout session completed', {
          sessionId: session.id,
          paymentStatus: session.payment_status,
        });

        if (session.payment_status === 'paid') {
          await PaymentService.handleCheckoutCompleted(session.id, session.payment_intent);
        }
        break;
      }

      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        logger.info('Stripe async payment succeeded', { sessionId: session.id });
        await PaymentService.handleCheckoutCompleted(session.id, session.payment_intent);
        break;
      }

      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        logger.warn('Stripe async payment failed', { sessionId: session.id });
        await PaymentService.handleCheckoutFailed(session.id, 'Async payment failed');
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        logger.info('Stripe checkout session expired', { sessionId: session.id });
        await PaymentService.handleCheckoutFailed(session.id, 'Session expired');
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        logger.info('Stripe charge refunded', {
          chargeId: charge.id,
          paymentIntentId: charge.payment_intent,
        });

        // Process each refund on the charge
        if (charge.refunds?.data) {
          for (const refund of charge.refunds.data) {
            await RefundService.handleExternalRefund(charge.payment_intent, refund);
          }
        }
        break;
      }

      default:
        logger.info('Unhandled Stripe webhook event', { type: event.type });
        await WebhookEventService.settle(recordId, 'IGNORED');
        return res.json({ received: true });
    }

    await WebhookEventService.settle(recordId, 'PROCESSED');
    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing webhook', {
      event: 'stripe_webhook_failed',
      endpoint: ENDPOINTS.PLATFORM,
      stripeEventId: event?.id,
      type: event?.type,
      error: error.message,
    });
    // Still return 200 to prevent Stripe from retrying: the order sweeps
    // (OrderService.sweepAbandoned, ApplicationPaymentService.sweepOverdue)
    // are the recovery path, and a retry storm against a failing handler is
    // worse than a swept order. The FAILED row is how you find it afterwards:
    //   SELECT * FROM "StripeWebhookEvent" WHERE status = 'FAILED';
    await WebhookEventService.settle(recordId, 'FAILED', error.message);
    res.json({ received: true, error: error.message });
  }
});

/**
 * POST /webhooks/stripe/connect — events from connected accounts (spec 010
 * phase 2). A separate Stripe endpoint ("listen to events on connected
 * accounts") with its own signing secret, STRIPE_CONNECT_WEBHOOK_SECRET.
 * Destination-charge events (checkout.session.*, charge.refunded) still arrive
 * on the platform endpoint above. Every event carries `event.account`, the
 * connected account id, which is the only key the handlers use.
 */
router.post('/stripe/connect', express.raw({ type: 'application/json' }), async (req, res) => {
  const claimed = await verifyAndClaim(req, res, {
    secretName: 'STRIPE_CONNECT_WEBHOOK_SECRET',
    label: 'Connect',
    endpoint: ENDPOINTS.CONNECT,
  });
  if (!claimed) return;
  const { event, recordId } = claimed;

  const accountId = event.account;
  try {
    if (!accountId) {
      logger.warn('Connect webhook without an account id', { type: event.type });
      await WebhookEventService.settle(recordId, 'IGNORED');
      return res.json({ received: true });
    }

    switch (event.type) {
      case 'account.updated':
        await ConnectService.applyAccount(accountId, event.data.object);
        break;

      case 'capability.updated':
      case 'account.external_account.created':
      case 'account.external_account.updated':
      case 'account.external_account.deleted': {
        // The payload is the sub-object; re-read the account for the full state.
        const account = await stripe.accounts.retrieve(accountId, { expand: ['external_accounts'] });
        await ConnectService.applyAccount(accountId, account);
        break;
      }

      case 'account.application.deauthorized':
        await ConnectService.markDisconnected(accountId);
        break;

      case 'payout.paid':
      case 'payout.failed':
        await ConnectService.recordPayout(accountId, event.data.object);
        break;

      default:
        logger.info('Unhandled Stripe Connect webhook event', { type: event.type, account: accountId });
        await WebhookEventService.settle(recordId, 'IGNORED');
        return res.json({ received: true });
    }

    await WebhookEventService.settle(recordId, 'PROCESSED');
    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing Connect webhook', {
      event: 'stripe_webhook_failed',
      endpoint: ENDPOINTS.CONNECT,
      stripeEventId: event?.id,
      type: event.type,
      account: accountId,
      error: error.message,
    });
    // 200 so Stripe does not retry; the page's Sync button is the recovery path
    await WebhookEventService.settle(recordId, 'FAILED', error.message);
    res.json({ received: true, error: error.message });
  }
});

/**
 * POST /webhooks/stripe/billing
 * Jump's own subscriptions (spec 022 phase 2). Same Stripe account as the
 * platform endpoint above, but a separate endpoint registration with its own
 * event list and signing secret (STRIPE_BILLING_WEBHOOK_SECRET), so
 * subscription events never reach the order dispatch and vice versa.
 */
router.post('/stripe/billing', express.raw({ type: 'application/json' }), async (req, res) => {
  const claimed = await verifyAndClaim(req, res, {
    secretName: 'STRIPE_BILLING_WEBHOOK_SECRET',
    label: 'Billing',
    endpoint: ENDPOINTS.BILLING,
  });
  if (!claimed) return;
  const { event, recordId } = claimed;

  try {
    if (!BillingService.isBillingEvent(event)) {
      logger.info('Ignoring non-billing event on the billing endpoint', { type: event.type });
      await WebhookEventService.settle(recordId, 'IGNORED');
      return res.json({ received: true, ignored: true });
    }
    await BillingService.handleEvent(event);
    await WebhookEventService.settle(recordId, 'PROCESSED');
    res.json({ received: true });
  } catch (error) {
    logger.error('Billing webhook processing failed', {
      event: 'stripe_webhook_failed',
      endpoint: ENDPOINTS.BILLING,
      stripeEventId: event?.id,
      type: event.type,
      error: error.message,
    });
    // Unlike the other two, billing has no sweep to fall back on, so Stripe's
    // retry is the recovery path: answer 500 and let it come back. The FAILED
    // row lets the retry through (WebhookEventService.claim).
    await WebhookEventService.settle(recordId, 'FAILED', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
