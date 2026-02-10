// Stripe Webhook Handler
// POST /webhooks/stripe - Handle Stripe webhook events
// Per FR-028, FR-029, contracts/api.yaml

import express from 'express';
import stripe from '../../config/stripe.js';
import PaymentService from '../../services/PaymentService.js';
import logger from '../../utils/logger.js';

const router = express.Router();

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

      default:
        logger.info('Unhandled Stripe webhook event', { type: event.type });
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing webhook', {
      type: event.type,
      error: error.message,
    });
    // Still return 200 to prevent Stripe from retrying
    res.json({ received: true, error: error.message });
  }
});

export default router;
