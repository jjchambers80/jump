// Admin Routes — aggregate endpoints for admin dashboard
// Requires ORGANIZER, ADMIN, or SYSTEM_ADMIN role

import express from 'express';
import { prisma } from '@jump/db';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { NotFoundError } from '../../middleware/errorHandler.js';
import { resolveOrgScope, isUnscoped } from '../../middleware/orgScope.js';
import { validateUpdateAttendee } from '../validators/adminValidators.js';
import { validateUpdateBusinessDetails } from '../validators/organizationValidators.js';
import { validateCreateOrganizationPerson } from '../validators/organizationPersonValidators.js';
import organizationService from '../../services/OrganizationService.js';
import organizationPersonService from '../../services/OrganizationPersonService.js';
import orderService from '../../services/OrderService.js';
import ticketService from '../../services/TicketService.js';
import imageService from '../../services/ImageService.js';

const router = express.Router();

// All admin routes require authentication + admin/organizer role
router.use(requireAuth);
router.use(requireOrganizer);

/** GET /admin/settings/business-details — current user's assigned organization. */
router.get('/settings/business-details', async (req, res, next) => {
  try {
    const businessDetails = await organizationService.getBusinessDetailsForUser(req.user.id);
    if (!businessDetails) throw new NotFoundError('No organization is assigned to this user');
    res.json(businessDetails);
  } catch (error) {
    next(error);
  }
});

/** PATCH /admin/settings/business-details — update the current user's organization. */
router.patch(
  '/settings/business-details',
  validateUpdateBusinessDetails,
  async (req, res, next) => {
    try {
      const businessDetails = await organizationService.updateBusinessDetailsForUser(
        req.user.id,
        req.body
      );
      if (!businessDetails) throw new NotFoundError('No organization is assigned to this user');
      res.json(businessDetails);
    } catch (error) {
      next(error);
    }
  }
);

/** GET /admin/settings/people — list people in the current user's organization. */
router.get('/settings/people', async (req, res, next) => {
  try {
    const people = await organizationPersonService.listPeopleForUser(req.user.id);
    if (people === null) throw new NotFoundError('No organization is assigned to this user');
    res.json({ people });
  } catch (error) {
    next(error);
  }
});

/** POST /admin/settings/people — add a person to the current user's organization. */
router.post(
  '/settings/people',
  validateCreateOrganizationPerson,
  async (req, res, next) => {
    try {
      const person = await organizationPersonService.createPersonForUser(req.user.id, req.body);
      if (person === null) throw new NotFoundError('No organization is assigned to this user');
      res.status(201).json(person);
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /admin/settings/people/:personId — remove only a same-organization person. */
router.delete('/settings/people/:personId', async (req, res, next) => {
  try {
    const deleted = await organizationPersonService.deletePersonForUser(
      req.user.id,
      req.params.personId
    );
    if (!deleted) throw new NotFoundError('Organization person not found');
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/dashboard/stats
 * Aggregate statistics across all accessible events
 */
router.get('/dashboard/stats', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role);

    if (!isUnscoped(scope) && !scope.organizationId) {
      // No org linked — return zeros
      return res.json({
        totalCapacity: 0,
        ticketsSold: 0,
        remainingCapacity: 0,
        ticketsRedeemed: 0,
        salesRate: 0,
        paymentSuccessRate: 100,
      });
    }

    const venueFilter = scope.venueFilter || {};

    // Get total capacity from all events
    const capacityResult = await prisma.event.aggregate({
      where: venueFilter,
      _sum: { capacity: true },
    });
    const totalCapacity = capacityResult._sum.capacity || 0;

    // Count tickets sold (from completed orders)
    const ticketsSold = await prisma.ticket.count({
      where: {
        order: { status: 'COMPLETED' },
        event: venueFilter,
      },
    });

    // Count tickets redeemed (REDEEMED status)
    const ticketsRedeemed = await prisma.ticket.count({
      where: {
        status: 'REDEEMED',
        event: venueFilter,
      },
    });

    // Calculate sales rate (tickets sold in last hour / 60 minutes)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentSales = await prisma.ticket.count({
      where: {
        createdAt: { gte: oneHourAgo },
        order: { status: 'COMPLETED' },
        event: venueFilter,
      },
    });
    const salesRate = Math.round(recentSales / 60);

    // Calculate payment success rate (scoped to org via event → venue)
    const [completedOrders, failedOrders] = await Promise.all([
      prisma.order.count({ where: { status: 'COMPLETED', event: venueFilter } }),
      prisma.order.count({ where: { status: 'FAILED', event: venueFilter } }),
    ]);
    const totalOrders = completedOrders + failedOrders;
    const paymentSuccessRate =
      totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 100;

    res.json({
      totalCapacity,
      ticketsSold,
      remainingCapacity: Math.max(0, totalCapacity - ticketsSold),
      ticketsRedeemed,
      salesRate,
      paymentSuccessRate,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/events
 * List events accessible to the current user
 */
router.get('/events', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role);

    if (!isUnscoped(scope) && !scope.organizationId) {
      return res.json({ events: [] });
    }

    const venueFilter = scope.venueFilter || {};

    const events = await prisma.event.findMany({
      where: venueFilter,
      include: {
        venue: {
          select: {
            id: true,
            name: true,
            organization: { select: { id: true, name: true } },
          },
        },
        priceTiers: {
          select: {
            id: true,
            name: true,
            price: true,
            quantityTotal: true,
            quantitySold: true,
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 50,
    });

    res.json({
      events: events.map((e) => ({
        id: e.id,
        name: e.name,
        date: e.date,
        status: e.status,
        capacity: e.capacity,
        venue: { id: e.venue.id, name: e.venue.name },
        organization: e.venue.organization,
        priceTiers: e.priceTiers.map((t) => ({
          id: t.id,
          name: t.name,
          priceCents: Math.round(Number(t.price) * 100),
          quantityTotal: t.quantityTotal,
          quantitySold: t.quantitySold,
        })),
        ticketsSold: e.priceTiers.reduce((sum, t) => sum + t.quantitySold, 0),
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/orders
 * List orders across all events for the user's organization.
 * Query: page, limit, status, eventId, search
 */
router.get('/orders', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role);

    if (!isUnscoped(scope) && !scope.organizationId) {
      return res.json({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    }

    const { page, limit, status, eventId, search } = req.query;
    const result = await orderService.getOrdersByOrganization(scope.organizationId, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      status: status || undefined,
      eventId: eventId || undefined,
      search: search || undefined,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/tickets
 * List tickets across all events for the user's organization (ticket-level rows).
 * Query: page, limit, status, eventId, search
 */
router.get('/tickets', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role);

    if (!isUnscoped(scope) && !scope.organizationId) {
      return res.json({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    }

    const { page, limit, status, eventId, search } = req.query;
    const result = await orderService.getTicketsByOrganization(scope.organizationId, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      status: status || undefined,
      eventId: eventId || undefined,
      search: search || undefined,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/tickets/:ticketId
 * Get full ticket detail for admin view (QR code, attendee, payment, sibling tickets).
 */
router.get('/tickets/:ticketId', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role);

    if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Ticket not found');

    const detail = await ticketService.getTicketDetailForAdmin(req.params.ticketId);

    // Verify ticket belongs to this organization (SYSTEM_ADMIN skips)
    if (!isUnscoped(scope)) {
      const event = await prisma.event.findUnique({
        where: { id: detail.event.id },
        include: { venue: { select: { organizationId: true } } },
      });

      if (!event || event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Ticket not found');
      }
    }

    res.json(detail);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /admin/tickets/:ticketId/attendee
 * Update attendee information on a ticket.
 */
router.patch('/tickets/:ticketId/attendee', validateUpdateAttendee, async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role);

    if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Ticket not found');

    // Verify ownership before update (SYSTEM_ADMIN skips)
    if (!isUnscoped(scope)) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: req.params.ticketId },
        include: { event: { include: { venue: { select: { organizationId: true } } } } },
      });

      if (!ticket || ticket.event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Ticket not found');
      }
    }

    const { firstName, lastName, email } = req.body;
    const updated = await ticketService.updateTicketAttendee(req.params.ticketId, {
      firstName,
      lastName,
      email,
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/tickets/:ticketId/check-in
 * Admin check-in: mark ticket as REDEEMED.
 */
router.post('/tickets/:ticketId/check-in', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role);

    if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Ticket not found');

    if (!isUnscoped(scope)) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: req.params.ticketId },
        include: { event: { include: { venue: { select: { organizationId: true } } } } },
      });

      if (!ticket || ticket.event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Ticket not found');
      }
    }

    const result = await ticketService.adminCheckIn(req.params.ticketId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/tickets/:ticketId/undo-check-in
 * Admin undo check-in: revert ticket from REDEEMED to VALID.
 */
router.post('/tickets/:ticketId/undo-check-in', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role);

    if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Ticket not found');

    if (!isUnscoped(scope)) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: req.params.ticketId },
        include: { event: { include: { venue: { select: { organizationId: true } } } } },
      });

      if (!ticket || ticket.event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Ticket not found');
      }
    }

    const result = await ticketService.adminUndoCheckIn(req.params.ticketId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/orders/:orderId
 * Get order detail, scoped to the user's organization.
 */
router.get('/orders/:orderId', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role);

    if (!isUnscoped(scope) && !scope.organizationId) {
      throw new NotFoundError('Order not found');
    }

    const order = await orderService.getOrderById(req.params.orderId);

    // Verify order belongs to this organizer's organization (SYSTEM_ADMIN skips)
    if (!isUnscoped(scope)) {
      const event = await prisma.event.findUnique({
        where: { id: order.event.id },
        include: { venue: { select: { organizationId: true } } },
      });

      if (!event || event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Order not found');
      }
    }

    res.json(order);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/images/cleanup
 * Delete orphaned file records with no image references.
 */
router.post('/images/cleanup', async (req, res, next) => {
  try {
    const deleted = await imageService.cleanupOrphans();
    res.json({ deleted });
  } catch (error) {
    next(error);
  }
});

export default router;
