// Admin dashboard overview: the organizer's bird's-eye view beside the
// headline stats in GET /admin/dashboard/stats. Money follows the one ledger
// (spec 024, PAID_ORDER_STATUSES); RSVP events count EventRsvp rows, never
// orders (spec 034). Day buckets use the viewer's time zone (spec 030: "when
// it happened to me"), passed by the client.

import { prisma } from '@jump/db';
import { PAID_ORDER_STATUSES } from './paidStatuses.js';

const TREND_DAYS = 14;
const UPCOMING_LIMIT = 5;
const RECENT_ORDERS_LIMIT = 6;
const ATTENTION_LIMIT = 5;

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A valid IANA zone, else UTC. */
export function safeTimeZone(tz) {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** YYYY-MM-DD of an instant in a zone. */
export function dayKey(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** The last `days` calendar days in a zone, oldest first, ending today. */
export function lastDays(now, timeZone, days = TREND_DAYS) {
  const keys = [];
  // Step back in 24 h strides from noon-ish UTC; DST shifts never skip a whole calendar day.
  for (let i = days - 1; i >= 0; i -= 1) keys.push(dayKey(new Date(now.getTime() - i * 86_400_000), timeZone));
  return [...new Set(keys)];
}

class DashboardService {
  /**
   * @param {object} venueFilter  `{ venue: { organizationId } }`, or `{}` for SYSTEM_ADMIN across orgs
   * @param {object} [opts]
   * @param {string} [opts.timeZone]  viewer's IANA zone for day buckets
   * @param {Date}   [opts.now]
   */
  async overview(venueFilter, { timeZone, now = new Date() } = {}) {
    const zone = safeTimeZone(timeZone);
    const days = lastDays(now, zone);
    // One day of slack either side of the window so zone offsets never drop an edge order.
    const since = new Date(now.getTime() - (TREND_DAYS + 1) * 86_400_000);
    const eventWhere = venueFilter;
    // Org scope on the order itself (spec 047 D0-C): `event: {}` would drop event-less orders.
    const applicationScope = venueFilter.venue ? { organizationId: venueFilter.venue.organizationId } : {};
    const orderScope = applicationScope;

    const [windowOrders, upcomingEvents, recentOrders, draftEvents, toReview, checkedInToday] = await Promise.all([
      // ponytail: per-row bucketing in JS; move to a date_trunc GROUP BY if a 14-day window outgrows memory.
      prisma.order.findMany({
        where: {
          status: { in: PAID_ORDER_STATUSES },
          ...orderScope,
          OR: [{ paidAt: { gte: since } }, { paidAt: null, createdAt: { gte: since } }],
        },
        select: { kind: true, totalAmount: true, quantity: true, paidAt: true, createdAt: true },
      }),
      prisma.event.findMany({
        where: { ...eventWhere, status: { not: 'CANCELLED' }, date: { gte: now } },
        orderBy: { date: 'asc' },
        take: UPCOMING_LIMIT,
        select: {
          id: true,
          name: true,
          date: true,
          status: true,
          capacity: true,
          admissionMode: true,
          rsvpLimit: true,
          venue: { select: { name: true, timezone: true } },
          priceTiers: { select: { quantityTotal: true, quantitySold: true } },
        },
      }),
      prisma.order.findMany({
        where: { status: { in: PAID_ORDER_STATUSES }, ...orderScope },
        orderBy: { createdAt: 'desc' },
        take: RECENT_ORDERS_LIMIT,
        select: {
          id: true,
          orderRef: true,
          kind: true,
          status: true,
          totalAmount: true,
          quantity: true,
          createdAt: true,
          paidAt: true,
          contact: { select: { firstName: true, lastName: true } },
          event: { select: { name: true } },
        },
      }),
      prisma.event.findMany({
        where: { ...eventWhere, status: 'DRAFT', date: { gte: now } },
        orderBy: { date: 'asc' },
        take: ATTENTION_LIMIT,
        select: { id: true, name: true, date: true, venue: { select: { timezone: true } } },
      }),
      prisma.application.groupBy({
        by: ['eventId', 'formId'],
        where: { ...applicationScope, status: 'SUBMITTED' },
        _count: { _all: true },
      }),
      prisma.ticket.count({
        where: { status: 'REDEEMED', event: eventWhere, redeemedAt: { gte: new Date(now.getTime() - 86_400_000) } },
      }),
    ]);

    const rsvpCounts = await this._rsvpCounts(upcomingEvents.filter((e) => e.admissionMode === 'RSVP').map((e) => e.id));

    return {
      timeZone: zone,
      trend: this._trend(windowOrders, days, zone),
      upcoming: upcomingEvents.map((e) => this._upcoming(e, rsvpCounts)),
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderRef: o.orderRef,
        kind: o.kind,
        status: o.status,
        total: round(Number(o.totalAmount)),
        quantity: o.quantity,
        at: o.paidAt ?? o.createdAt,
        buyer: [o.contact?.firstName, o.contact?.lastName].filter(Boolean).join(' ') || 'Guest',
        eventName: o.event?.name ?? null,
      })),
      checkedInLast24h: checkedInToday,
      attention: {
        draftEvents: draftEvents.map((e) => ({ id: e.id, name: e.name, date: e.date, timezone: e.venue?.timezone ?? null })),
        applicationsToReview: await this._reviewQueue(toReview),
      },
    };
  }

  _trend(orders, days, zone) {
    const buckets = new Map(days.map((d) => [d, { date: d, revenue: 0, orders: 0, tickets: 0 }]));
    for (const o of orders) {
      const bucket = buckets.get(dayKey(o.paidAt ?? o.createdAt, zone));
      if (!bucket) continue;
      bucket.revenue += Number(o.totalAmount);
      bucket.orders += 1;
      if (o.kind === 'TICKET') bucket.tickets += o.quantity;
    }
    return [...buckets.values()].map((b) => ({ ...b, revenue: round(b.revenue) }));
  }

  _upcoming(e, rsvpCounts) {
    const rsvp = e.admissionMode === 'RSVP';
    const tierTotal = e.priceTiers.reduce((sum, t) => sum + t.quantityTotal, 0);
    return {
      id: e.id,
      name: e.name,
      date: e.date,
      status: e.status,
      admissionMode: e.admissionMode,
      venueName: e.venue?.name ?? null,
      timezone: e.venue?.timezone ?? null,
      // RSVP: guests against the RSVP limit; ticketed: sold against tier inventory (spec 004: capacity is per tier).
      sold: rsvp ? rsvpCounts.get(e.id) ?? 0 : e.priceTiers.reduce((sum, t) => sum + t.quantitySold, 0),
      capacity: rsvp ? e.rsvpLimit ?? e.capacity : tierTotal || e.capacity,
    };
  }

  async _rsvpCounts(eventIds) {
    if (eventIds.length === 0) return new Map();
    const rows = await prisma.eventRsvp.groupBy({
      by: ['eventId'],
      where: { eventId: { in: eventIds }, status: 'GOING' },
      _sum: { partySize: true },
    });
    return new Map(rows.map((r) => [r.eventId, r._sum.partySize ?? 0]));
  }

  /** SUBMITTED applications grouped per event (or per standing form), largest queue first. */
  async _reviewQueue(groups) {
    if (groups.length === 0) return [];
    const eventIds = [...new Set(groups.map((g) => g.eventId).filter(Boolean))];
    const formIds = [...new Set(groups.filter((g) => !g.eventId).map((g) => g.formId))];
    const [events, forms] = await Promise.all([
      prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, name: true } }),
      prisma.applicationForm.findMany({ where: { id: { in: formIds } }, select: { id: true, name: true } }),
    ]);
    const eventName = new Map(events.map((e) => [e.id, e.name]));
    const formName = new Map(forms.map((f) => [f.id, f.name]));

    const queue = new Map();
    for (const g of groups) {
      const key = g.eventId ? `event:${g.eventId}` : `form:${g.formId}`;
      const row = queue.get(key) ?? {
        eventId: g.eventId ?? null,
        formId: g.eventId ? null : g.formId,
        name: g.eventId ? eventName.get(g.eventId) ?? 'Event' : formName.get(g.formId) ?? 'Form',
        count: 0,
      };
      row.count += g._count._all;
      queue.set(key, row);
    }
    return [...queue.values()].sort((a, b) => b.count - a.count).slice(0, ATTENTION_LIMIT);
  }
}

export default new DashboardService();
