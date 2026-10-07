// Draft write tools (spec 045 phase E). An agent can build out a store, but
// nothing it writes is public: events are created DRAFT, pages and blog posts
// hidden, and every update tool refuses a record that is already live (a
// published or cancelled event, a venue such an event uses, a visible page or
// post). Changing live records needs the confirmed preview → apply step of
// phase F. Inputs are strict allowlists; status, visibility, publishing dates,
// templates and forms are never accepted. The backend services do the rest:
// org checks, validation, HTML sanitising and file-reference sync.

import { z } from 'zod';
import { prisma } from '@jump/db';
import eventService from '../../backend/src/services/EventService.js';
import venueService from '../../backend/src/services/VenueService.js';
import priceTierService from '../../backend/src/services/PriceTierService.js';
import pageService from '../../backend/src/services/PageService.js';
import blogPostService from '../../backend/src/services/BlogPostService.js';
import { zonedInputToInstant } from '../../backend/src/utils/eventTime.js';
import { ToolError, getBlogPost, getEvent, getPage, getVenue, listPriceTiers, registerTool } from './tools.js';

const LIVE = 'It is live on the storefront. Changing live records needs a confirmed publish step, which agents cannot do yet; ask a store Admin to make this change in Jump.';

const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const UPDATE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

// Event and sale times are the venue's wall clock (AGENTS.md gotcha 28).
const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use YYYY-MM-DDTHH:mm in the venue’s local time');
const html = z.string().max(200_000);
const money = z.number().min(0).max(100_000);

function toInstant(local, zone, field) {
  if (local === undefined) return undefined;
  if (local === null) return null;
  const instant = zonedInputToInstant(local, zone);
  if (!instant) throw new ToolError(`${field} is not a valid local time`);
  return instant.toISOString();
}

async function draftEvent(orgId, eventId) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, venue: { organizationId: orgId } },
    select: { id: true, status: true, venue: { select: { timezone: true } } },
  });
  if (!event) throw new ToolError('Event not found');
  if (event.status !== 'DRAFT') throw new ToolError(`This event is ${event.status.toLowerCase()}. ${LIVE}`);
  return event;
}

async function venueZone(orgId, venueId) {
  const venue = await prisma.venue.findFirst({ where: { id: venueId, organizationId: orgId }, select: { timezone: true } });
  if (!venue) throw new ToolError('Venue not found');
  return venue.timezone;
}

const tierShape = {
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  price: money,
  quantityTotal: z.number().int().min(1).max(100_000),
  minPerOrder: z.number().int().min(1).max(100).optional(),
  maxPerOrder: z.number().int().min(1).max(100).optional(),
  saleStartLocal: localTime.optional(),
  saleEndLocal: localTime.optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'HIDDEN']).optional(),
  isRefundable: z.boolean().optional(),
};

function tierData(input, zone) {
  const { saleStartLocal, saleEndLocal, ...rest } = input;
  return {
    ...rest,
    ...(saleStartLocal !== undefined && { saleStartDate: toInstant(saleStartLocal, zone, 'saleStartLocal') }),
    ...(saleEndLocal !== undefined && { saleEndDate: toInstant(saleEndLocal, zone, 'saleEndLocal') }),
  };
}

const eventTarget = (data) => ({ targetType: 'Event', targetId: data.id ?? data.eventId });

const TOOLS = [
  {
    name: 'create_event_draft',
    scope: 'events:write',
    annotations: CREATE,
    title: 'Create event draft',
    description: 'Create a new event as a DRAFT (never published). Times are the venue’s local time. Price tiers are optional.',
    shape: {
      venueId: z.string().min(1),
      name: z.string().min(1).max(255),
      startsAtLocal: localTime,
      description: html.optional(),
      category: z.string().max(100).optional(),
      admissionMode: z.enum(['TICKETED', 'RSVP']).optional(),
      capacity: z.number().int().min(1).max(100_000).optional(),
      rsvpLimit: z.number().int().min(1).max(100_000).optional(),
      priceTiers: z.array(z.object(tierShape).strict()).max(20).optional(),
    },
    target: eventTarget,
    async run(orgId, { venueId, startsAtLocal, priceTiers, ...input }) {
      const zone = await venueZone(orgId, venueId);
      const event = await eventService.createEvent(orgId, {
        ...input,
        venueId,
        date: toInstant(startsAtLocal, zone, 'startsAtLocal'),
        priceTiers: (priceTiers || []).map((tier) => tierData(tier, zone)),
      });
      return getEvent(orgId, { eventId: event.id });
    },
  },
  {
    name: 'update_event',
    scope: 'events:write',
    annotations: UPDATE,
    title: 'Update draft event',
    description: 'Edit a DRAFT event. Published or cancelled events cannot be changed by an agent.',
    shape: {
      eventId: z.string().min(1),
      name: z.string().min(1).max(255).optional(),
      startsAtLocal: localTime.optional(),
      description: html.optional(),
      category: z.string().max(100).optional(),
      capacity: z.number().int().min(1).max(100_000).optional(),
      rsvpLimit: z.number().int().min(1).max(100_000).optional(),
      venueId: z.string().min(1).optional(),
    },
    target: eventTarget,
    async run(orgId, { eventId, startsAtLocal, venueId, ...input }) {
      const event = await draftEvent(orgId, eventId);
      const zone = venueId ? await venueZone(orgId, venueId) : event.venue.timezone;
      await eventService.updateEvent(orgId, eventId, {
        ...input,
        ...(venueId && { venueId }),
        ...(startsAtLocal !== undefined && { date: toInstant(startsAtLocal, zone, 'startsAtLocal') }),
      });
      return getEvent(orgId, { eventId });
    },
  },
  {
    name: 'create_venue',
    scope: 'events:write',
    annotations: CREATE,
    title: 'Create venue',
    description: 'Add a venue. Its time zone is derived from the address.',
    shape: {
      name: z.string().min(1).max(255),
      address: z.string().min(1).max(500),
      city: z.string().max(100).optional(),
      state: z.string().max(100).optional(),
      postalCode: z.string().max(20).optional(),
      country: z.string().length(2).optional(),
    },
    target: (data) => ({ targetType: 'Venue', targetId: data.id }),
    async run(orgId, input) {
      const venue = await venueService.createVenue(orgId, { ...input, isPublic: false });
      return getVenue(orgId, { venueId: venue.id });
    },
  },
  {
    name: 'update_venue',
    scope: 'events:write',
    annotations: UPDATE,
    title: 'Update venue',
    description: 'Edit a venue that no published or cancelled event uses yet.',
    shape: {
      venueId: z.string().min(1),
      name: z.string().min(1).max(255).optional(),
      address: z.string().min(1).max(500).optional(),
      city: z.string().max(100).optional(),
      state: z.string().max(100).optional(),
      postalCode: z.string().max(20).optional(),
    },
    target: (data) => ({ targetType: 'Venue', targetId: data.id }),
    async run(orgId, { venueId, ...input }) {
      await venueZone(orgId, venueId);
      const live = await prisma.event.count({ where: { venueId, status: { not: 'DRAFT' } } });
      if (live) throw new ToolError(`A published or cancelled event uses this venue. ${LIVE}`);
      await venueService.updateVenue(orgId, venueId, input);
      return getVenue(orgId, { venueId });
    },
  },
  {
    name: 'create_price_tier',
    scope: 'events:write',
    annotations: CREATE,
    title: 'Add price tier to draft event',
    description: 'Add a price tier to a DRAFT event. Sale times are the venue’s local time.',
    shape: { eventId: z.string().min(1), ...tierShape },
    target: eventTarget,
    async run(orgId, { eventId, ...input }) {
      const event = await draftEvent(orgId, eventId);
      await priceTierService.createPriceTier(orgId, eventId, tierData(input, event.venue.timezone));
      return listPriceTiers(orgId, { eventId });
    },
  },
  {
    name: 'update_price_tier',
    scope: 'events:write',
    annotations: UPDATE,
    title: 'Update price tier of draft event',
    description: 'Edit a price tier of a DRAFT event.',
    shape: {
      eventId: z.string().min(1),
      priceTierId: z.string().min(1),
      ...Object.fromEntries(Object.entries(tierShape).map(([key, schema]) => [key, schema.optional()])),
    },
    target: eventTarget,
    async run(orgId, { eventId, priceTierId, ...input }) {
      const event = await draftEvent(orgId, eventId);
      await priceTierService.updatePriceTier(orgId, eventId, priceTierId, tierData(input, event.venue.timezone));
      return listPriceTiers(orgId, { eventId });
    },
  },
  {
    name: 'reorder_price_tiers',
    scope: 'events:write',
    annotations: UPDATE,
    title: 'Reorder price tiers of draft event',
    description: 'Set the display order of a DRAFT event’s price tiers. Pass every tier id once, in order.',
    shape: { eventId: z.string().min(1), priceTierIds: z.array(z.string().min(1)).min(1).max(100) },
    target: eventTarget,
    async run(orgId, { eventId, priceTierIds }) {
      await draftEvent(orgId, eventId);
      await priceTierService.reorderPriceTiers(orgId, eventId, priceTierIds);
      return listPriceTiers(orgId, { eventId });
    },
  },
  {
    name: 'create_page_draft',
    scope: 'content:write',
    annotations: CREATE,
    title: 'Create hidden page',
    description: 'Create a content page. It stays hidden until a store Admin makes it visible.',
    shape: {
      title: z.string().min(1).max(255),
      content: html,
      seoTitle: z.string().max(255).optional(),
      seoDescription: z.string().max(500).optional(),
    },
    target: (data) => ({ targetType: 'Page', targetId: data.id }),
    async run(orgId, input) {
      const page = await pageService.create(orgId, { ...input, isVisible: false });
      return getPage(orgId, { pageId: page.id });
    },
  },
  {
    name: 'update_page',
    scope: 'content:write',
    annotations: UPDATE,
    title: 'Update hidden page',
    description: 'Edit a hidden content page. Visible pages cannot be changed by an agent.',
    shape: {
      pageId: z.string().min(1),
      title: z.string().min(1).max(255).optional(),
      content: html.optional(),
      seoTitle: z.string().max(255).optional(),
      seoDescription: z.string().max(500).optional(),
    },
    target: (data) => ({ targetType: 'Page', targetId: data.id }),
    async run(orgId, { pageId, ...input }) {
      const page = await prisma.page.findFirst({ where: { id: pageId, organizationId: orgId }, select: { isVisible: true } });
      if (!page) throw new ToolError('Page not found');
      if (page.isVisible) throw new ToolError(`This page is visible. ${LIVE}`);
      await pageService.update(orgId, pageId, input);
      return getPage(orgId, { pageId });
    },
  },
  {
    name: 'create_blog_post_draft',
    scope: 'content:write',
    annotations: CREATE,
    title: 'Create hidden blog post',
    description: 'Create a blog post. It stays hidden until a store Admin publishes it.',
    shape: {
      title: z.string().min(1).max(255),
      content: html,
      excerpt: z.string().max(1000).optional(),
      seoTitle: z.string().max(255).optional(),
      seoDescription: z.string().max(500).optional(),
    },
    target: (data) => ({ targetType: 'BlogPost', targetId: data.id }),
    async run(orgId, input) {
      const post = await blogPostService.create(orgId, { ...input, isVisible: false }, null);
      return getBlogPost(orgId, { postId: post.id });
    },
  },
  {
    name: 'update_blog_post',
    scope: 'content:write',
    annotations: UPDATE,
    title: 'Update hidden blog post',
    description: 'Edit a hidden blog post. Published posts cannot be changed by an agent.',
    shape: {
      postId: z.string().min(1),
      title: z.string().min(1).max(255).optional(),
      content: html.optional(),
      excerpt: z.string().max(1000).optional(),
      seoTitle: z.string().max(255).optional(),
      seoDescription: z.string().max(500).optional(),
    },
    target: (data) => ({ targetType: 'BlogPost', targetId: data.id }),
    async run(orgId, { postId, ...input }) {
      const post = await prisma.blogPost.findFirst({ where: { id: postId, organizationId: orgId }, select: { isVisible: true } });
      if (!post) throw new ToolError('Blog post not found');
      if (post.isVisible) throw new ToolError(`This blog post is published. ${LIVE}`);
      await blogPostService.update(orgId, postId, input);
      return getBlogPost(orgId, { postId });
    },
  },
];

export const WRITE_TOOL_NAMES = TOOLS.map((tool) => tool.name);

/** Register the write tools this grant's scopes allow; the rest stay unlisted. */
export function registerWriteTools(server, auth) {
  for (const tool of TOOLS) {
    if (auth.scopes.includes(tool.scope)) registerTool(server, auth, tool);
  }
}
