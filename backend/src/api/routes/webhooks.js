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
import logger from '../../utils/logger.js';

const router = express.Router();

/** No signing secret configured on an endpoint that requires one. */
class WebhookSecretMissingError extends Error {}

/**
 * Parse and verify a Stripe webhook body.
 *
 * With a secret, the signature is verified and a bad one throws. Without one,
 * behaviour depends on the environment: development and tests trust the body
 * and log a warning, but production **fails closed** — an endpoint that accepts
 * unsigned events is an unauthenticated write path into the ledger, and a
 * missing or mistyped Railway variable must not silently open one.
 */
function readStripeEvent(req, secret, label) {
  if (secret) return stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  if (process.env.NODE_ENV === 'production') {
    throw new WebhookSecretMissingError(`Stripe ${label} webhook has no signing secret configured`);
  }
  logger.warn(`Stripe ${label} webhook signature verification skipped (no secret configured)`);
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString());
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return req.body;
}

/**
 * Answer a request whose event could not be verified. A missing secret is an
 * operator error, so it answers 503 and Stripe keeps retrying for days — the
 * events survive until the secret is set. A bad signature is 400: retrying a
 * body we will never accept is pointless.
 */
function rejectUnverified(res, label, error) {
  if (error instanceof WebhookSecretMissingError) {
    logger.error('Stripe webhook rejected: no signing secret configured', {
      event: 'webhook_secret_missing',
      endpoint: label,
      error: error.message,
    });
    return res.status(503).send('Webhook Error: signing secret not configured');
  }
  logger.error(`Stripe ${label} webhook signature verification failed`, { error: error.message });
  return res.status(400).send(`Webhook Error: ${error.message}`);
}

/**
 * POST /webhooks/stripe
 * Handle Stripe webhook events for order status transitions.
 * Idempotent: safe to receive the same event multiple times.
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = readStripeEvent(req, process.env.STRIPE_WEBHOOK_SECRET, 'platform');
  } catch (err) {
    return rejectUnverified(res, 'platform', err);
  }

  try {
    // Jump subscription events belong on /webhooks/stripe/billing (spec 022);
    // one registered here by mistake must not be mistaken for an order.
    if (BillingService.isBillingEvent(event)) {
      logger.warn('Billing event received on the platform endpoint; ignored', { type: event.type });
      return res.json({ received: true, ignored: true });
    }

    // Application payments (spec 011 phase 2) share this endpoint. Dispatch
    // strictly on metadata.applicationId (ticket sessions never carry it).
    // charge.refunded is not dispatched here: every refund resolves through
    // the order's PaymentTransaction in RefundService (spec 024), whatever
    // the order kind.
    if (ApplicationPaymentService.isApplicationEvent(event)) {
      await ApplicationPaymentService.handleEvent(event);
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
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing webhook', {
      type: event?.type,
      error: error.message,
    });
    // Still return 200 to prevent Stripe from retrying
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
  let event;
  try {
    event = readStripeEvent(req, process.env.STRIPE_CONNECT_WEBHOOK_SECRET, 'Connect');
  } catch (err) {
    return rejectUnverified(res, 'Connect', err);
  }

  const accountId = event.account;
  try {
    if (!accountId) {
      logger.warn('Connect webhook without an account id', { type: event.type });
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
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing Connect webhook', { type: event.type, account: accountId, error: error.message });
    // 200 so Stripe does not retry; the page's Sync button is the recovery path
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
  let event;
  try {
    event = readStripeEvent(req, process.env.STRIPE_BILLING_WEBHOOK_SECRET, 'Billing');
  } catch (err) {
    return rejectUnverified(res, 'Billing', err);
  }

  try {
    if (!BillingService.isBillingEvent(event)) {
      logger.info('Ignoring non-billing event on the billing endpoint', { type: event.type });
      return res.json({ received: true, ignored: true });
    }
    await BillingService.handleEvent(event);
    res.json({ received: true });
  } catch (error) {
    logger.error('Billing webhook processing failed', { type: event.type, error: error.message });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
