// Admin Routes — aggregate endpoints for admin dashboard
// Requires ADMIN or ORGANIZER role

import express from 'express';
import { prisma } from '@jump/db';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';

const router = express.Router();

// All admin routes require authentication + admin/organizer role
router.use(requireAuth);
router.use(requireOrganizer);

/**
 * GET /admin/dashboard/stats
 * Aggregate statistics across all accessible events
 */
router.get('/dashboard/stats', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Build venue filter based on role (events are tied to venues, venues to orgs)
    let venueFilter = {};
    if (userRole !== 'ADMIN') {
      // ORGANIZER can only see their own organization's data
      const membership = await prisma.organizationMember.findFirst({
        where: { userId },
        select: { organizationId: true },
      });
      if (membership) {
        venueFilter = { venue: { organizationId: membership.organizationId } };
      } else {
        // No org membership — return zeros
        return res.json({
          totalCapacity: 0,
          ticketsSold: 0,
          remainingCapacity: 0,
          ticketsRedeemed: 0,
          salesRate: 0,
          paymentSuccessRate: 100,
        });
      }
    }

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

    // Calculate payment success rate
    const [completedOrders, failedOrders] = await Promise.all([
      prisma.order.count({ where: { status: 'COMPLETED' } }),
      prisma.order.count({ where: { status: 'FAILED' } }),
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
    const userId = req.user.id;
    const userRole = req.user.role;

    // Build venue filter based on role
    let venueFilter = {};
    if (userRole !== 'ADMIN') {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId },
        select: { organizationId: true },
      });
      if (membership) {
        venueFilter = { venue: { organizationId: membership.organizationId } };
      } else {
        return res.json({ events: [] });
      }
    }

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

export default router;
