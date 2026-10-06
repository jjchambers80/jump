// Backend service bridge for MCP read-only tools.
// Each function wraps an existing backend service method with org-scoping
// and personal-data filtering (D5).  No personal data (emails, names of
// buyers, phone, addresses of contacts, order/contact ids) reaches an agent.

import { prisma } from '@jump/db';
import agentAuthService from '../../backend/src/services/AgentAuthService.js';
import agentAuditService from '../../backend/src/services/AgentAuditService.js';
import { AGENT_RESOURCE } from '../../backend/src/services/AgentAuthService.js';
import eventService from '../../backend/src/services/EventService.js';
import venueService from '../../backend/src/services/VenueService.js';
import priceTierService from '../../backend/src/services/PriceTierService.js';
import pageService from '../../backend/src/services/PageService.js';
import blogPostService from '../../backend/src/services/BlogPostService.js';
import menuService from '../../backend/src/services/MenuService.js';
import urlRedirectService from '../../backend/src/services/UrlRedirectService.js';
import storeFileService from '../../backend/src/services/StoreFileService.js';
import themeService from '../../backend/src/services/ThemeService.js';
import { PAID_ORDER_STATUSES } from '../../backend/src/services/paidStatuses.js';

// ── Auth ─────────────────────────────────────────────────────────────

export function extractBearer(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return token || null;
  }
  return null;
}

export async function authorizeTool(token, scope) {
  return agentAuthService.agentAuthorize(token, { scope, audience: AGENT_RESOURCE });
}

export async function authorizeTokenOnly(token) {
  // Validates the token without a specific scope check.
  // The scope is checked in the tool handler.
  return agentAuthService.agentAuthorize(token, { scope: 'store:read', audience: AGENT_RESOURCE });
}

export async function auditCall(authorization, { tool, args, summary, outcome, targetType, targetId }) {
  return agentAuditService.write({ authorization, tool, args, summary, outcome, targetType, targetId });
}

export function rejectCrossOrg(args, authOrgId) {
  if (args.organizationId && args.organizationId !== authOrgId) {
    const err = new Error(`organizationId "${args.organizationId}" does not match the authorized organization`);
    err.code = -32602;
    err.statusCode = 400;
    throw err;
  }
}

export function toolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// ── get_store ────────────────────────────────────────────────────────

export async function getStore(orgId) {
  // Compose org fields + storefront preferences for a single store snapshot.
  // Exclude personal-data fields per D5: ein, companyName, email, phone, address.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      slug: true,
      name: true,
      slugCustomized: true,
      logoUrl: true,
      coverUrl: true,
      brandColor: true,
      themeMode: true,
      taxInclusivePricing: true,
      buyerSignInLinks: true,
      buyerSignInMethod: true,
      themesEnabled: true,
      agentAccessEnabled: true,
      storefrontPrivate: true,
      storefrontMessage: true,
      seoTitle: true,
      seoDescription: true,
      autoRedirectLanguage: true,
      enabledPaymentMethods: true,
      selfServeRefundsEnabled: true,
    },
  });
  return org;
}

// ── list_events ──────────────────────────────────────────────────────

export async function listOrgEvents(orgId, options) {
  const result = await eventService.listOrgEvents(orgId, options);
  // Strip personal-data fields from each event's venue and org references.
  // The formatting already excludes buyer data; just pass through.
  return result;
}

// ── get_event ─────────────────────────────────────────────────────────

export async function getOrgEvent(orgId, identifier) {
  // Fetch by id or slug, scoped to the org.  Unlike the public getEventById,
  // this returns events in any status (DRAFT included) and never exposes
  // personal data.
  const event = await prisma.event.findFirst({
    where: {
      OR: [{ id: identifier }, { slug: identifier }],
      venue: { organizationId: orgId },
    },
    include: {
      venue: {
        select: { id: true, name: true, slug: true, address: true, state: true, timezone: true, city: true, postalCode: true, country: true, logoUrl: true },
      },
      priceTiers: { orderBy: { displayOrder: 'asc' } },
      _count: { select: { orders: true } },
    },
  });

  if (!event) return null;

  // Format consistently with EventService._formatEventDetail (excluding buyer data).
  const formatted = {
    id: event.id,
    slug: event.slug,
    slugCustomized: event.slugCustomized,
    name: event.name,
    description: { untrusted_text: event.description || '' },
    logoUrl: event.logoUrl || null,
    date: event.date,
    venueTimezone: event.venue?.timezone || null,
    capacity: event.capacity,
    category: event.category,
    status: event.status,
    admissionMode: event.admissionMode || 'TICKETED',
    rsvpLimit: event.rsvpLimit ?? null,
    rsvpMaxPartySize: event.rsvpMaxPartySize ?? 1,
    taxRate: event.taxRate ? Number(event.taxRate) : 0,
    venue: event.venue
      ? { id: event.venue.id, name: event.venue.name, slug: event.venue.slug, address: event.venue.address, timezone: event.venue.timezone }
      : null,
    priceTiers: (event.priceTiers || []).map((t) => formatPriceTier(t)),
    orderCount: event._count?.orders || 0,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };

  return formatted;
}

function formatPriceTier(t) {
  const now = new Date();
  const saleStart = t.saleStartDate ? new Date(t.saleStartDate) : null;
  const saleEnd = t.saleEndDate ? new Date(t.saleEndDate) : null;
  let saleStatus = 'ON_SALE';
  if (saleStart && now < saleStart) saleStatus = 'NOT_STARTED';
  else if (saleEnd && now > saleEnd) saleStatus = 'ENDED';

  return {
    id: t.id,
    eventId: t.eventId,
    name: t.name,
    description: t.description || null,
    price: Number(t.price),
    quantityTotal: t.quantityTotal,
    quantitySold: t.quantitySold,
    quantityReserved: t.quantityReserved,
    quantityAvailable: t.quantityTotal - t.quantitySold - t.quantityReserved,
    displayOrder: t.displayOrder,
    minPerOrder: t.minPerOrder,
    maxPerOrder: t.maxPerOrder,
    isActive: t.isActive,
    saleStartDate: t.saleStartDate,
    saleEndDate: t.saleEndDate,
    visibility: t.visibility,
    isRefundable: t.isRefundable,
    isOnSale: saleStatus === 'ON_SALE',
    saleStatus,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// ── list_venues ──────────────────────────────────────────────────────

export async function listVenues(orgId) {
  return venueService.listVenuesByOrganization(orgId);
}

// ── get_venue ─────────────────────────────────────────────────────────

export async function getVenue(orgId, venueId) {
  try {
    return await venueService.getVenueById(orgId, venueId);
  } catch (err) {
    if (err.name === 'NotFoundError') return null;
    throw err;
  }
}

// ── list_price_tiers (org-verified) ──────────────────────────────────

export async function listPriceTiersForOrg(orgId, eventId, includeAll) {
  // Verify the event belongs to the grant's org before listing tiers.
  const event = await prisma.event.findFirst({
    where: { id: eventId, venue: { organizationId: orgId } },
    select: { id: true },
  });
  if (!event) throw Object.assign(new Error('Event not found'), { code: -32602, statusCode: 404 });

  const result = await priceTierService.listPriceTiers(eventId, { includeAll: includeAll === true });
  return { priceTiers: result.priceTiers, eventId };
}

// ── list_pages ───────────────────────────────────────────────────────

export async function listPages(orgId) {
  return pageService.list(orgId);
}

// ── get_page ─────────────────────────────────────────────────────────

export async function getPage(orgId, pageId) {
  try {
    return await pageService.get(orgId, pageId);
  } catch (err) {
    if (err.name === 'NotFoundError') return null;
    throw err;
  }
}

// ── list_blog_posts ──────────────────────────────────────────────────

export async function listBlogPosts(orgId, query) {
  return blogPostService.list(orgId, {
    page: query.page || 1,
    pageSize: query.pageSize || 50,
    status: query.status,
    q: query.q,
  });
}

// ── get_blog_post ────────────────────────────────────────────────────

export async function getBlogPost(orgId, postId) {
  try {
    return await blogPostService.get(orgId, postId);
  } catch (err) {
    if (err.name === 'NotFoundError') return null;
    throw err;
  }
}

// ── list_menus ───────────────────────────────────────────────────────

export async function listMenus(orgId) {
  return menuService.list(orgId);
}

// ── get_menu ─────────────────────────────────────────────────────────

export async function getMenu(orgId, menuId) {
  try {
    return await menuService.get(orgId, menuId);
  } catch (err) {
    if (err.name === 'NotFoundError') return null;
    throw err;
  }
}

// ── list_redirects ───────────────────────────────────────────────────

export async function listRedirects(orgId, { q, page }) {
  return urlRedirectService.list(orgId, { q, page });
}

// ── list_files ───────────────────────────────────────────────────────

export async function listFiles(orgId, { page, pageSize, type, q }) {
  return storeFileService.list(orgId, { page, pageSize, type, q, sort: undefined });
}

// ── get_theme ─────────────────────────────────────────────────────────

export async function getThemeById(orgId, themeId) {
  try {
    return await themeService.get(orgId, themeId);
  } catch (err) {
    if (err.name === 'NotFoundError' || err.code === 'THEMES_NOT_ENABLED') return null;
    throw err;
  }
}

export async function getActiveTheme(orgId) {
  // Find the published theme for the org (role: 'PUBLISHED' if the spec 043
  // model uses roles, or find by isActive/publishedAt).
  const themes = await themeService.list(orgId);
  const published = themes.find((t) => t.role === 'PUBLISHED' || t.publishedAt);
  if (!published) return null;
  return themeService.get(orgId, published.id);
}

// ── get_sales_summary (aggregates only, no personal data) ─────────────

export async function getSalesSummary(orgId) {
  // Aggregate Orders, Tickets, and Refunds for the org.
  // Counts only — no individual buyer or order data.

  const paidOrdersAgg = await prisma.order.aggregate({
    where: {
      status: { in: PAID_ORDER_STATUSES },
      event: { venue: { organizationId: orgId } },
    },
    _sum: { totalAmount: true },
    _count: { id: true },
  });

  const ticketsSold = await prisma.ticket.count({
    where: {
      status: { in: ['VALID', 'REDEEMED'] },
      order: { status: { in: PAID_ORDER_STATUSES }, event: { venue: { organizationId: orgId } } },
    },
  });

  const refundsAgg = await prisma.refund.aggregate({
    where: {
      status: 'SUCCEEDED',
      order: { event: { venue: { organizationId: orgId } } },
    },
    _sum: { amount: true },
  });

  const totalRevenue = Number(paidOrdersAgg._sum?.totalAmount || 0);
  const totalRefunds = Number(refundsAgg._sum?.amount || 0);

  // Per-event breakdown
  const events = await prisma.event.findMany({
    where: { venue: { organizationId: orgId } },
    select: { id: true, name: true },
  });

  const eventIds = events.map((e) => e.id);

  // Batch per-event aggregates
  const eventsWithOrders = await prisma.order.groupBy({
    by: ['eventId'],
    where: {
      eventId: { in: eventIds },
      status: { in: PAID_ORDER_STATUSES },
    },
    _sum: { totalAmount: true },
    _count: { id: true },
  });

  // Simplified: fetch refunds per event via relation
  const refundData = await prisma.refund.findMany({
    where: {
      status: 'SUCCEEDED',
      order: { eventId: { in: eventIds } },
    },
    select: {
      amount: true,
      order: { select: { eventId: true } },
    },
  });

  const refundMap = {};
  for (const r of refundData) {
    const eId = r.order.eventId;
    refundMap[eId] = (refundMap[eId] || 0) + Number(r.amount);
  }

  // Get event-level ticket counts via order
  const orderTicketData = await prisma.order.findMany({
    where: {
      eventId: { in: eventIds },
      status: { in: PAID_ORDER_STATUSES },
    },
    select: {
      eventId: true,
      _count: { select: { tickets: { where: { status: { in: ['VALID', 'REDEEMED'] } } } } },
    },
  });

  const ticketMap = {};
  for (const o of orderTicketData) {
    ticketMap[o.eventId] = (ticketMap[o.eventId] || 0) + o._count.tickets;
  }

  const orderMap = Object.fromEntries(
    eventsWithOrders.map((g) => [g.eventId, { revenue: Number(g._sum.totalAmount || 0), orders: g._count.id }]),
  );

  const byEvent = events.map((e) => ({
    eventId: e.id,
    eventName: e.name,
    revenue: orderMap[e.id]?.revenue || 0,
    orders: orderMap[e.id]?.orders || 0,
    ticketsSold: ticketMap[e.id] || 0,
    refunds: refundMap[e.id] || 0,
    net: (orderMap[e.id]?.revenue || 0) - (refundMap[e.id] || 0),
  }));

  return {
    totalRevenue,
    totalOrders: paidOrdersAgg._count?.id || 0,
    totalTicketsSold: ticketsSold,
    totalRefunds,
    netRevenue: totalRevenue - totalRefunds,
    byEvent,
  };
}