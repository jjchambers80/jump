// Read-only store tools (spec 045 phase D). Every query is scoped to the
// grant's organization and selects an explicit allowlist of fields: no buyer,
// contact, staff or payment data can reach an agent (D5). Free text written by
// organizers or outsiders is wrapped as { untrusted_text } (plan §6).

import { z } from 'zod';
import { prisma } from '@jump/db';
import agentAuditService from '../../backend/src/services/AgentAuditService.js';
import { PAID_ORDER_STATUSES } from '../../backend/src/services/paidStatuses.js';

const MAX_RESULT_CHARS = 100_000;
const PAGE_SIZE = 50;
export const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const untrusted = (text) => (text == null ? null : { untrusted_text: String(text) });
const money = (value) => (value == null ? null : Number(value));

export class ToolError extends Error {}

const pageArgs = {
  page: z.number().int().min(1).optional().describe('1-based page number'),
};
const skip = (page) => ((page || 1) - 1) * PAGE_SIZE;

// ── Allowlisted selections ─────────────────────────────────────────────

const venueSelect = {
  id: true, name: true, slug: true, address: true, city: true, state: true,
  postalCode: true, country: true, timezone: true, isPublic: true, logoUrl: true,
};

const tierSelect = {
  id: true, name: true, description: true, price: true, quantityTotal: true,
  quantitySold: true, quantityReserved: true, displayOrder: true, minPerOrder: true,
  maxPerOrder: true, isActive: true, saleStartDate: true, saleEndDate: true,
  visibility: true, isRefundable: true,
};

const eventSelect = {
  id: true, name: true, slug: true, date: true, capacity: true, category: true,
  status: true, admissionMode: true, logoUrl: true,
  venue: { select: { id: true, name: true, timezone: true } },
};

function tier(row) {
  return {
    ...row,
    description: untrusted(row.description),
    price: money(row.price),
    quantityAvailable: row.quantityTotal - row.quantitySold - row.quantityReserved,
  };
}

// Event times are the venue's wall clock (AGENTS.md gotcha 28): always send
// the venue zone with the instant.
function eventSummary(row) {
  const { venue, ...rest } = row;
  return { ...rest, venueTimezone: venue?.timezone ?? null, venue: venue ? { id: venue.id, name: venue.name } : null };
}

async function getStore(orgId) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true, name: true, slug: true, logoUrl: true, coverUrl: true, brandColor: true,
      themeMode: true, storefrontPrivate: true, storefrontMessage: true,
      seoTitle: true, seoDescription: true,
    },
  });
  return { ...org, storefrontMessage: untrusted(org.storefrontMessage) };
}

async function listEvents(orgId, { page, status }) {
  const where = { venue: { organizationId: orgId }, ...(status && { status }) };
  const [events, total] = await Promise.all([
    prisma.event.findMany({ where, select: eventSelect, orderBy: { date: 'desc' }, skip: skip(page), take: PAGE_SIZE }),
    prisma.event.count({ where }),
  ]);
  return { events: events.map(eventSummary), total, page: page || 1, pageSize: PAGE_SIZE };
}

export async function getEvent(orgId, { eventId }) {
  const event = await prisma.event.findFirst({
    where: { OR: [{ id: eventId }, { slug: eventId }], venue: { organizationId: orgId } },
    select: {
      ...eventSelect,
      description: true, rsvpLimit: true, rsvpMaxPartySize: true, taxRate: true,
      createdAt: true, updatedAt: true,
      priceTiers: { select: tierSelect, orderBy: { displayOrder: 'asc' } },
    },
  });
  if (!event) throw new ToolError('Event not found');
  return {
    ...eventSummary(event),
    description: untrusted(event.description),
    taxRate: money(event.taxRate),
    priceTiers: event.priceTiers.map(tier),
  };
}

async function listVenues(orgId) {
  const venues = await prisma.venue.findMany({ where: { organizationId: orgId }, select: venueSelect, orderBy: { name: 'asc' } });
  return { venues };
}

export async function getVenue(orgId, { venueId }) {
  const venue = await prisma.venue.findFirst({
    where: { OR: [{ id: venueId }, { slug: venueId }], organizationId: orgId },
    select: { ...venueSelect, _count: { select: { events: true } } },
  });
  if (!venue) throw new ToolError('Venue not found');
  const { _count, ...rest } = venue;
  return { ...rest, eventCount: _count.events };
}

export async function listPriceTiers(orgId, { eventId }) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, venue: { organizationId: orgId } },
    select: { id: true, priceTiers: { select: tierSelect, orderBy: { displayOrder: 'asc' } } },
  });
  if (!event) throw new ToolError('Event not found');
  return { eventId: event.id, priceTiers: event.priceTiers.map(tier) };
}

const pageSelect = { id: true, title: true, slug: true, isVisible: true, template: true, updatedAt: true };

async function listPages(orgId) {
  return { pages: await prisma.page.findMany({ where: { organizationId: orgId }, select: pageSelect, orderBy: { title: 'asc' } }) };
}

export async function getPage(orgId, { pageId }) {
  const page = await prisma.page.findFirst({
    where: { OR: [{ id: pageId }, { slug: pageId }], organizationId: orgId },
    select: { ...pageSelect, content: true, seoTitle: true, seoDescription: true },
  });
  if (!page) throw new ToolError('Page not found');
  return { ...page, content: untrusted(page.content), seoDescription: untrusted(page.seoDescription) };
}

// authorName is deliberately not selected: a byline names a staff member.
const postSelect = {
  id: true, title: true, handle: true, isVisible: true, publishedAt: true, updatedAt: true,
  blog: { select: { id: true, title: true, handle: true } },
};

async function listBlogPosts(orgId, { page }) {
  const where = { organizationId: orgId };
  const [posts, total] = await Promise.all([
    prisma.blogPost.findMany({ where, select: postSelect, orderBy: { updatedAt: 'desc' }, skip: skip(page), take: PAGE_SIZE }),
    prisma.blogPost.count({ where }),
  ]);
  return { posts, total, page: page || 1, pageSize: PAGE_SIZE };
}

export async function getBlogPost(orgId, { postId }) {
  const post = await prisma.blogPost.findFirst({
    where: { id: postId, organizationId: orgId },
    select: { ...postSelect, content: true, excerpt: true, seoTitle: true, seoDescription: true },
  });
  if (!post) throw new ToolError('Blog post not found');
  return {
    ...post,
    content: untrusted(post.content),
    excerpt: untrusted(post.excerpt),
    seoDescription: untrusted(post.seoDescription),
  };
}

async function listMenus(orgId) {
  return {
    menus: await prisma.menu.findMany({
      where: { organizationId: orgId },
      select: { id: true, title: true, handle: true, isDefault: true },
      orderBy: { title: 'asc' },
    }),
  };
}

async function getMenu(orgId, { menuId }) {
  const menu = await prisma.menu.findFirst({
    where: { OR: [{ id: menuId }, { handle: menuId }], organizationId: orgId },
    select: {
      id: true, title: true, handle: true, isDefault: true,
      items: {
        select: { id: true, parentId: true, position: true, label: true, linkType: true, targetId: true, url: true, newTab: true },
        orderBy: { position: 'asc' },
      },
    },
  });
  if (!menu) throw new ToolError('Menu not found');
  return menu;
}

async function listRedirects(orgId, { page }) {
  const where = { organizationId: orgId };
  const [redirects, total] = await Promise.all([
    prisma.urlRedirect.findMany({ where, select: { id: true, fromPath: true, toPath: true }, orderBy: { fromPath: 'asc' }, skip: skip(page), take: PAGE_SIZE }),
    prisma.urlRedirect.count({ where }),
  ]);
  return { redirects, total, page: page || 1, pageSize: PAGE_SIZE };
}

// createdById is deliberately not selected: it names a staff member.
async function listFiles(orgId, { page }) {
  const where = { organizationId: orgId };
  const [rows, total] = await Promise.all([
    prisma.storeFile.findMany({
      where,
      select: {
        id: true, name: true, extension: true, altText: true, width: true, height: true, createdAt: true,
        file: { select: { hash: true, mimeType: true, sizeBytes: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: skip(page),
      take: PAGE_SIZE,
    }),
    prisma.storeFile.count({ where }),
  ]);
  const files = rows.map(({ file, ...row }) => ({
    ...row,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    path: `/files/${row.id}/${file.hash}/${encodeURIComponent(row.name)}.${row.extension}`,
  }));
  return { files, total, page: page || 1, pageSize: PAGE_SIZE };
}

async function getTheme(orgId, { themeId }) {
  const theme = await prisma.theme.findFirst({
    where: { organizationId: orgId, ...(themeId ? { id: themeId } : { role: 'MAIN' }) },
    select: {
      id: true, name: true, role: true, presetKey: true, presetVersion: true, version: true,
      publishedAt: true, scheduledPublishAt: true, settings: true, content: true, updatedAt: true,
    },
  });
  if (!theme) throw new ToolError('Theme not found');
  return theme;
}

async function getSalesSummary(orgId) {
  // Ticket orders only: application orders (spec 024) have their own money view.
  const paid = { kind: 'TICKET', status: { in: PAID_ORDER_STATUSES }, event: { venue: { organizationId: orgId } } };
  const [byEvent, refunds, events] = await Promise.all([
    prisma.order.groupBy({ by: ['eventId'], where: paid, _sum: { totalAmount: true, quantity: true }, _count: { _all: true } }),
    prisma.refund.groupBy({
      by: ['orderId'],
      where: { status: 'SUCCEEDED', order: { kind: 'TICKET', event: { venue: { organizationId: orgId } } } },
      _sum: { amount: true },
    }),
    prisma.event.findMany({ where: { venue: { organizationId: orgId } }, select: { id: true, name: true } }),
  ]);
  const refundOrders = refunds.length
    ? await prisma.order.findMany({ where: { id: { in: refunds.map((r) => r.orderId) } }, select: { id: true, eventId: true } })
    : [];
  const eventOfOrder = new Map(refundOrders.map((o) => [o.id, o.eventId]));
  const refundByEvent = new Map();
  for (const r of refunds) {
    const eventId = eventOfOrder.get(r.orderId);
    refundByEvent.set(eventId, (refundByEvent.get(eventId) || 0) + Number(r._sum.amount || 0));
  }
  const salesByEvent = new Map(byEvent.map((g) => [g.eventId, g]));
  const rows = events.map((e) => {
    const g = salesByEvent.get(e.id);
    const revenue = Number(g?._sum.totalAmount || 0);
    const refunded = refundByEvent.get(e.id) || 0;
    return {
      eventId: e.id,
      eventName: e.name,
      paidOrders: g?._count._all || 0,
      ticketsSold: g?._sum.quantity || 0,
      revenue,
      refunded,
      net: revenue - refunded,
    };
  });
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  return {
    paidOrders: sum('paidOrders'),
    ticketsSold: sum('ticketsSold'),
    revenue: sum('revenue'),
    refunded: sum('refunded'),
    net: sum('net'),
    byEvent: rows,
  };
}

// ── Registration ───────────────────────────────────────────────────────

const TOOLS = [
  ['get_store', 'Get store', 'The store name, branding and storefront settings.', {}, getStore],
  ['list_events', 'List events', `Events in the store, newest first, ${PAGE_SIZE} per page.`, {
    ...pageArgs,
    status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED']).optional(),
  }, listEvents],
  ['get_event', 'Get event', 'One event with its price tiers. Times are in venueTimezone.', {
    eventId: z.string().min(1).describe('Event id or slug'),
  }, getEvent],
  ['list_venues', 'List venues', 'Venues of the store.', {}, listVenues],
  ['get_venue', 'Get venue', 'One venue.', { venueId: z.string().min(1).describe('Venue id or slug') }, getVenue],
  ['list_price_tiers', 'List price tiers', 'Price tiers of one event, including inactive ones.', {
    eventId: z.string().min(1),
  }, listPriceTiers],
  ['list_pages', 'List pages', 'Content pages of the store.', {}, listPages],
  ['get_page', 'Get page', 'One content page with its HTML.', { pageId: z.string().min(1).describe('Page id or slug') }, getPage],
  ['list_blog_posts', 'List blog posts', `Blog posts, most recently edited first, ${PAGE_SIZE} per page.`, pageArgs, listBlogPosts],
  ['get_blog_post', 'Get blog post', 'One blog post with its HTML.', { postId: z.string().min(1) }, getBlogPost],
  ['list_menus', 'List menus', 'Navigation menus of the store.', {}, listMenus],
  ['get_menu', 'Get menu', 'One menu with its items.', { menuId: z.string().min(1).describe('Menu id or handle') }, getMenu],
  ['list_redirects', 'List URL redirects', `Storefront URL redirects, ${PAGE_SIZE} per page.`, pageArgs, listRedirects],
  ['list_files', 'List files', `Uploaded store files, newest first, ${PAGE_SIZE} per page.`, pageArgs, listFiles],
  ['get_theme', 'Get theme', 'One theme, or the published theme when themeId is omitted.', {
    themeId: z.string().min(1).optional(),
  }, getTheme],
  ['get_sales_summary', 'Get sales summary', 'Ticket sales per event: paid orders, tickets sold, revenue, refunds. Aggregates only.', {}, getSalesSummary],
];

export const TOOL_NAMES = TOOLS.map(([name]) => name);

export function textResult(data, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], ...(isError && { isError: true }) };
}

// Service errors a caller can act on (validation, not found, conflict) come
// back as tool errors the agent can read; anything else is a server fault.
const isCallerError = (error) => error instanceof ToolError || [400, 404, 409, 422].includes(error?.statusCode);

/**
 * Register one tool on a per-request server. `auth` is the result of
 * agentAuthorize() for this HTTP request; the organization comes only from it.
 * `scope` is re-checked here even though tools a grant cannot use are never
 * registered.
 */
export function registerTool(server, auth, { name, title, description, shape, annotations = READ, scope = 'store:read', run, target }) {
  server.registerTool(name, { title, description, inputSchema: z.object(shape).strict(), annotations }, async (args) => {
    const audit = (outcome, summary, data) => agentAuditService.write({
      authorization: auth, tool: name, args, summary, outcome, ...(data && target ? target(data) : {}),
    });
    try {
      if (!auth.scopes.includes(scope)) throw new ToolError(`This connection does not have the ${scope} permission`);
      const data = await run(auth.organizationId, args || {}, auth);
      const text = JSON.stringify(data);
      if (text.length > MAX_RESULT_CHARS) {
        await audit('error', 'Result too large');
        return textResult({ error: 'The result is too large. Ask for a narrower page or a single record.' }, true);
      }
      await audit('ok', `${name} ok`, data);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      if (!isCallerError(error)) throw error;
      await audit('error', error.message);
      return textResult({ error: error.message }, true);
    }
  });
}

export function registerReadTools(server, auth) {
  for (const [name, title, description, shape, run] of TOOLS) {
    registerTool(server, auth, { name, title, description, shape, run });
  }
}
