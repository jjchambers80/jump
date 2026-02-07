// Stripe Webhook Handler
// POST /webhooks/stripe - Handle Stripe webhook events

import express from 'express';
import stripe from '../../config/stripe.js';
import PaymentService from '../../services/PaymentService.js';
import logger from '../../utils/logger.js';

const router = express.Router();

/**
 * POST /webhooks/stripe
 * Handle Stripe webhook events for payment status updates
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook signature
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // In development, skip signature verification
      event = JSON.parse(req.body.toString());
      logger.warn('Stripe webhook signature verification skipped (no STRIPE_WEBHOOK_SECRET)');
    }
  } catch (err) {
    logger.error('Webhook signature verification failed', {
      error: err.message,
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        logger.info('Stripe checkout session completed', {
          sessionId: session.id,
          paymentStatus: session.payment_status,
        });

        // Update payment status to SUCCEEDED
        if (session.payment_status === 'paid') {
          await PaymentService.updatePaymentStatus(session.id, 'SUCCEEDED');
        }

        break;
      }

      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;

        logger.info('Stripe async payment succeeded', {
          sessionId: session.id,
        });

        await PaymentService.updatePaymentStatus(session.id, 'SUCCEEDED');

        break;
      }

      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;

        logger.warn('Stripe async payment failed', {
          sessionId: session.id,
        });

        await PaymentService.updatePaymentStatus(session.id, 'FAILED', 'Async payment failed');

        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;

        logger.info('Stripe checkout session expired', {
          sessionId: session.id,
        });

        await PaymentService.updatePaymentStatus(session.id, 'FAILED', 'Session expired');

        break;
      }

      default:
        logger.info('Unhandled Stripe webhook event', {
          type: event.type,
        });
    }

    // Return 200 to acknowledge receipt
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
