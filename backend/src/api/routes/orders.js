// Order Routes
// POST /orders (public — guest checkout)
// GET /orders/:orderId (authenticated — owner or admin)
// POST /orders/lookup (public — email + orderRef)
// GET /orders/my (authenticated)
// GET /events/:eventId/orders (org-scoped — organizer/admin)
// Per FR-052, FR-053, FR-054, contracts/api.yaml

import express from 'express';
import orderService from '../../services/OrderService.js';
import { requireAuth, optionalAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { validateCreateOrder, validateOrderLookup } from '../validators/orderValidators.js';

const router = express.Router();

/**
 * POST /orders
 * Create a new order (guest checkout — no auth required).
 * Returns orderId, orderRef, stripeCheckoutUrl.
 */
router.post('/', validateCreateOrder, async (req, res, next) => {
  try {
    const { eventId, priceTierId, quantity, contact } = req.body;

    // Check if user is authenticated (optional)
    let userId = null;
    try {
      // Try to extract user from token if present
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const jwt = await import('jsonwebtoken');
        const token = authHeader.slice(7);
        const decoded = jwt.default.verify(token, process.env.AUTH_SECRET, {
          algorithms: ['HS256'],
        });
        userId = decoded.sub;
      }
    } catch {
      // No valid auth — proceed as guest
    }

    const result = await orderService.createOrder({
      eventId,
      priceTierId,
      quantity: parseInt(quantity),
      contact,
      userId,
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /orders/my
 * Get current user's orders (authenticated).
 * Must be defined BEFORE /:orderId to avoid route conflict.
 */
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await orderService.getMyOrders(req.user.email, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /orders/lookup
 * Guest order lookup by email + orderRef (public, no auth).
 */
router.post('/lookup', validateOrderLookup, async (req, res, next) => {
  try {
    const { email, orderRef } = req.body;
    const order = await orderService.lookupOrder(email, orderRef);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /orders/:orderId/verify-payment
 * Verify payment with Stripe and complete the order if paid.
 * Belt-and-suspenders for when webhooks haven't arrived yet.
 */
router.post('/:orderId/verify-payment', requireAuth, async (req, res, next) => {
  try {
    const result = await orderService.verifyAndCompleteOrder(req.params.orderId);

    // Authorization: must be the contact's linked user, or ADMIN
    if (req.user.role !== 'ADMIN' && result.contact?.email !== req.user.email) {
      return res.status(403).json({
        error: 'ForbiddenError',
        message: 'You do not have access to this order',
      });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /orders/:orderId
 * Get order detail (authenticated — owner check or admin).
 */
router.get('/:orderId', requireAuth, async (req, res, next) => {
  try {
    const order = await orderService.getOrderById(req.params.orderId);

    // Authorization: must be the contact's linked user, or ADMIN
    if (req.user.role !== 'ADMIN' && order.contact?.email !== req.user.email) {
      return res.status(403).json({
        error: 'ForbiddenError',
        message: 'You do not have access to this order',
      });
    }

    res.json(order);
  } catch (error) {
    next(error);
  }
});

export default router;

/**
 * Org-scoped event orders router.
 * Mounted at /organizations/:orgId/events/:eventId/orders
 * GET / — list orders for an event (organizer/admin)
 */
export const eventOrdersRouter = express.Router({ mergeParams: true });

eventOrdersRouter.get('/', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const { page, limit } = req.query;
    const result = await orderService.getOrdersByEvent(eventId, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});
