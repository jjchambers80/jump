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
 * Events that move money out of the account. A handler failure on one of these
 * must NOT be swallowed with a 200 — Stripe would record a successful delivery
 * and never retry, and the refund would be lost from Orders for good.
 */
const REFUND_EVENT_TYPES = new Set([
  'charge.refunded',
  'refund.created',
  'refund.updated',
  'charge.refund.updated',
]);

/** Stripe fields are an id or an expanded object depending on the endpoint. */
const idOf = (value) => (typeof value === 'string' ? value : (value?.id ?? null));

/** Per-request options for a connected-account event; platform events send none. */
const forAccount = (account) => (account ? { stripeAccount: account } : undefined);

/**
 * The refunds belonging to a `charge.refunded` event.
 *
 * Stripe does not put a `refunds` key on the charge it delivers in this event —
 * verified against every real charge.refunded on the test account, 3 of 3 with
 * no such key (the field was dropped from the charge object in the API version
 * the endpoint is pinned to). Reading `charge.refunds.data` therefore silently
 * yielded nothing. The refunds are read back from the API instead: Stripe is
 * the source of truth and the Orders row is the projection. An embedded list is
 * still honoured when one is present.
 */
async function refundsForCharge(charge, account) {
  if (charge.refunds?.data) return charge.refunds.data;
  const page = await stripe.refunds.list({ charge: charge.id, limit: 100 }, forAccount(account));
  return page.data;
}

/** The refund's payment intent, read back from its charge when not inlined. */
async function paymentIntentForRefund(refund, account) {
  const direct = idOf(refund.payment_intent);
  if (direct) return direct;
  const chargeId = idOf(refund.charge);
  if (!chargeId) return null;
  const charge = await stripe.charges.retrieve(chargeId, forAccount(account));
  return idOf(charge?.payment_intent);
}

/**
 * Parse and (when a secret is configured) verify a Stripe webhook body.
 * Without a secret — development and tests — the body is trusted and a warning
 * is logged. Throws on a bad signature.
 */
function readStripeEvent(req, secret, label) {
  if (secret) return stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  logger.warn(`Stripe ${label} webhook signature verification skipped (no secret configured)`);
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString());
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return req.body;
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
      // In development/test, skip signature verification
      // Body may already be parsed by express.json() or may be a Buffer
      if (Buffer.isBuffer(req.body)) {
        event = JSON.parse(req.body.toString());
      } else if (typeof req.body === 'string') {
        event = JSON.parse(req.body);
      } else {
        event = req.body;
      }
      logger.warn('Stripe webhook signature verification skipped (no STRIPE_WEBHOOK_SECRET)');
    }
  } catch (err) {
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
        const refunds = await refundsForCharge(charge, event.account);
        logger.info('Stripe charge refunded', {
          chargeId: charge.id,
          paymentIntentId: charge.payment_intent,
          refunds: refunds.length,
        });
        if (refunds.length === 0) {
          // amount_refunded says money left; if Stripe lists no refund for the
          // charge we have nothing to record and must not pretend otherwise.
          logger.error('charge.refunded carried no refunds', {
            event: 'charge_refunded_empty',
            chargeId: charge.id,
            amountRefunded: charge.amount_refunded,
          });
        }
        for (const refund of refunds) {
          await RefundService.handleExternalRefund(
            idOf(refund.payment_intent) || idOf(charge.payment_intent),
            refund
          );
        }
        break;
      }

      // The refund object arrives directly on these, with its settlement
      // status, so a refund that starts pending and settles later lands in the
      // ledger correctly. They overlap with charge.refunded on purpose — every
      // handler is idempotent on the Stripe refund id, and two independent
      // routes into the ledger is the point. Requires these event types to be
      // selected on the endpoint in the Stripe dashboard.
      case 'refund.created':
      case 'refund.updated':
      case 'charge.refund.updated': {
        const refund = event.data.object;
        const paymentIntentId = await paymentIntentForRefund(refund, event.account);
        logger.info('Stripe refund event', {
          type: event.type,
          refundId: refund.id,
          status: refund.status,
          paymentIntentId,
        });
        await RefundService.handleExternalRefund(paymentIntentId, refund);
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
    if (REFUND_EVENT_TYPES.has(event?.type)) {
      // Money already left the account. A 200 here would end Stripe's delivery
      // attempts with the refund still missing from Orders, so ask for a retry.
      return res.status(500).json({ error: 'Refund webhook processing failed' });
    }
    // Other events: 200 so Stripe does not retry; their recovery is elsewhere
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
