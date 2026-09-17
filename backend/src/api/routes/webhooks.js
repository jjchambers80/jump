// Stripe Webhook Handler
// POST /webhooks/stripe - Handle Stripe webhook events
// Per FR-028, FR-029, contracts/api.yaml

import express from 'express';
import stripe from '../../config/stripe.js';
import PaymentService from '../../services/PaymentService.js';
import RefundService from '../../services/RefundService.js';
import ConnectService from '../../services/ConnectService.js';
import ApplicationPaymentService from '../../services/ApplicationPaymentService.js';
import logger from '../../utils/logger.js';

const router = express.Router();

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
    // Application payments (spec 011 phase 2) share this endpoint. Dispatch
    // strictly on metadata.applicationId (ticket sessions never carry it);
    // charge.refunded needs a row lookup because the charge has no metadata
    // of its own when the refund was made from the dashboard.
    if (ApplicationPaymentService.isApplicationEvent(event) || (await ApplicationPaymentService.isApplicationRefundEvent(event))) {
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

export default router;
