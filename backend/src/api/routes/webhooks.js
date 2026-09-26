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

/**
 * A webhook endpoint without signature verification is an unauthenticated write
 * path into the ledger: a forged `checkout.session.completed` issues tickets, and
 * a forged application event confirms a booth, for free. So an unsigned event is
 * only ever accepted when something explicitly opts out.
 *
 * WHY the opt-out is its own variable and not `NODE_ENV !== 'production'`: nothing
 * guarantees the deployed backend actually sets NODE_ENV=production, and a guard
 * that is inert in exactly the environment it protects is not a guard. This one
 * fails closed wherever the flag is absent, which includes every environment we
 * have not thought about. Only `backend/tests/setup.js` and a developer's own
 * `backend/.env` set it.
 */
function unsignedWebhooksAllowed() {
  return process.env.STRIPE_WEBHOOK_ALLOW_UNSIGNED === 'true';
}

class UnverifiedWebhookError extends Error {
  constructor(label) {
    super(`${label} webhook rejected: no signing secret configured`);
    this.name = 'UnverifiedWebhookError';
  }
}

function parseUnsignedBody(body) {
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString());
  if (typeof body === 'string') return JSON.parse(body);
  return body;
}

/**
 * Parse and (when a secret is configured) verify a Stripe webhook body.
 * Throws on a bad signature, and on a missing secret unless unsigned events are
 * explicitly allowed (development and tests).
 */
function readStripeEvent(req, secret, label) {
  if (secret) return stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  if (!unsignedWebhooksAllowed()) throw new UnverifiedWebhookError(label);
  logger.warn(`Stripe ${label} webhook signature verification skipped (no secret configured)`);
  return parseUnsignedBody(req.body);
}

/**
 * One refusal shape for every endpoint. 500, not 400: a missing secret is our
 * misconfiguration, not a malformed request, and 5xx is the only answer that puts
 * a genuine Stripe event on the retry schedule instead of discarding it — so
 * fixing the variable within Stripe's retry window recovers the event rather than
 * losing the order it was carrying.
 */
function refuseUnverified(res, label, err) {
  logger.error(`${label} webhook refused: signature verification is not configured`, {
    error: err.message,
    hint: 'Set the signing secret, or STRIPE_WEBHOOK_ALLOW_UNSIGNED=true for local development only',
  });
  return res.status(500).json({ error: 'Webhook signature verification is not configured' });
}

/**
 * POST /webhooks/stripe
 * Handle Stripe webhook events for order status transitions.
 * Idempotent: safe to receive the same event multiple times.
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      if (!unsignedWebhooksAllowed()) throw new UnverifiedWebhookError('Stripe');
      // Development and tests only, behind STRIPE_WEBHOOK_ALLOW_UNSIGNED.
      // Body may already be parsed by express.json() or may be a Buffer.
      event = parseUnsignedBody(req.body);
      logger.warn('Stripe webhook signature verification skipped (no STRIPE_WEBHOOK_SECRET)');
    }
  } catch (err) {
    if (err instanceof UnverifiedWebhookError) return refuseUnverified(res, 'Stripe', err);
    logger.error('Webhook signature verification failed', {
      error: err.message,
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
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
    // 500, so Stripe's retry schedule runs. A 200 here told Stripe the event was
    // handled, so a transient database blip during checkout.session.completed
    // permanently lost the paid-order transition — `OrderService.sweepAbandoned`
    // happens to cover ticket orders, but application payments and
    // charge.refunded have no equivalent sweep. Handlers are idempotent, so a
    // retry of an event that partly succeeded is safe.
    res.status(500).json({ error: 'Webhook processing failed' });
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
    if (err instanceof UnverifiedWebhookError) return refuseUnverified(res, 'Connect', err);
    logger.error('Connect webhook signature verification failed', { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
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
    // 500 so Stripe retries. The page's Sync button stays the manual recovery
    // path, but it only helps if someone notices; a retry is unattended.
    res.status(500).json({ error: 'Webhook processing failed' });
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
    if (err instanceof UnverifiedWebhookError) return refuseUnverified(res, 'Billing', err);
    logger.error('Billing webhook signature verification failed', { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
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
