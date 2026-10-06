// MCP server — Streamable HTTP (2025-11-25), read-only store tools.
// Express + official @modelcontextprotocol SDK v2.
//
// Architecture:
//   createMcpExpressApp  → Express app with Host/Origin validation + body parser
//   mcpAuthMetadataRouter→ .well-known/oauth-protected-resource endpoint
//   createMcpHandler     → SDK handler wrapping a McpServerFactory
//   toNodeHandler        → bridges fetch-shaped handler to Express (req, res)
//
// Every tool handler extracts the Bearer token and calls
// agentAuthService.agentAuthorize(token, { scope }) independently.  The SDK
// factory is called per-request, giving each request its own McpServer
// instance; tools are re-registered per request.

import 'dotenv/config';
import { createMcpExpressApp, mcpAuthMetadataRouter } from '@modelcontextprotocol/express';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { extractBearer, rejectCrossOrg, auditCall, toolResult, createEventDraft, updateEvent, createVenue, updateVenue, createPriceTier, updatePriceTier, reorderPriceTiers, createPageDraft, updatePage, createBlogPostDraft, updateBlogPost, updateMenu, createRedirect, uploadFile, saveTheme } from '../services/auth.js';
import * as backendAuth from '../services/auth.js';

const PORT = process.env.PORT || 3003;

// ── Express app ──────────────────────────────────────────────────────

const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: process.env.MCP_ALLOWED_HOSTS
    ? process.env.MCP_ALLOWED_HOSTS.split(',')
    : ['mcp.eventimus.net', 'localhost', '127.0.0.1'],
  allowedOrigins: process.env.MCP_ALLOWED_ORIGINS
    ? process.env.MCP_ALLOWED_ORIGINS.split(',')
    : ['https://claude.ai', 'https://chatgpt.com', 'https://claude.code'],
});

// ── OAuth protected-resource metadata ────────────────────────────────

const backendUrl = process.env.BACKEND_URL || 'http://localhost:3002';

app.use(mcpAuthMetadataRouter({
  oauthMetadata: {
    issuer: backendUrl,
    authorization_endpoint: `${backendUrl}/oauth/authorize`,
    token_endpoint: `${backendUrl}/oauth/token`,
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['store:read', 'content:write', 'events:write', 'events:publish', 'themes', 'settings:write'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
  },
  resourceServerUrl: new URL(process.env.MCP_PUBLIC_URL || 'http://localhost:3003'),
}));

// ── MCP handler factory ─────────────────────────────────────────────

const handler = createMcpHandler(
  (ctx) => {
    const server = new McpServer({ name: 'Jump Ticketing', version: '1.0.0' });
    const token = extractBearer(ctx.request.headers.get('authorization'));

    // ── get_store ──────────────────────────────────────────────────
    server.tool('get_store', {
      title: 'Get Store',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string', description: 'Optional. If provided, must match the authorized organization.' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          slug: { type: 'string' },
          logoUrl: { type: 'string' },
          brandColor: { type: 'string' },
          themeMode: { type: 'string' },
          agentAccessEnabled: { type: 'boolean' },
          storefrontPrivate: { type: 'boolean' },
          hasPassword: { type: 'boolean' },
          seoTitle: { type: 'string' },
          seoDescription: { type: 'string' },
          buyerSignInLinks: { type: 'boolean' },
          taxInclusivePricing: { type: 'boolean' },
          themesEnabled: { type: 'boolean' },
        },
      },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);

      const store = await backendAuth.getStore(auth.organizationId);

      await auditCall(auth, {
        tool: 'get_store', args,
        summary: `Store "${store.name}" (${store.slug})`,
        outcome: 'ok',
        targetType: 'Organization', targetId: store.id,
      });
      return toolResult(store);
    });

    // ── list_events ────────────────────────────────────────────────
    server.tool('list_events', {
      title: 'List Events',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          page: { type: 'number' },
          limit: { type: 'number' },
          status: { type: 'string' },
          sort: { type: 'string' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          events: { type: 'array' },
          pagination: {
            type: 'object',
            properties: { page: { type: 'number' }, limit: { type: 'number' }, total: { type: 'number' }, totalPages: { type: 'number' } },
          },
        },
      },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);

      const result = await backendAuth.listOrgEvents(auth.organizationId, args);

      await auditCall(auth, {
        tool: 'list_events', args,
        summary: `${result.pagination.total} events (page ${result.pagination.page}/${result.pagination.totalPages})`,
        outcome: 'ok',
        targetType: 'Organization', targetId: auth.organizationId,
      });
      return toolResult(result);
    });

    // ── get_event ──────────────────────────────────────────────────
    server.tool('get_event', {
      title: 'Get Event',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: 'Event ID or slug' },
          organizationId: { type: 'string' },
        },
        required: ['eventId'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);

      const event = await backendAuth.getOrgEvent(auth.organizationId, args.eventId);
      if (!event) return { content: [], isError: true, structuredContent: { error: 'Event not found' } };

      await auditCall(auth, {
        tool: 'get_event', args,
        summary: `Event "${event.name}" (${event.status})`,
        outcome: 'ok',
        targetType: 'Event', targetId: event.id,
      });
      return toolResult(event);
    });

    // ── list_venues ────────────────────────────────────────────────
    server.tool('list_venues', {
      title: 'List Venues',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          venues: { type: 'array' },
        },
      },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);
      const venues = await backendAuth.listVenues(auth.organizationId);

      await auditCall(auth, {
        tool: 'list_venues', args,
        summary: `${venues.length} venues`,
        outcome: 'ok',
        targetType: 'Organization', targetId: auth.organizationId,
      });
      return toolResult({ venues });
    });

    // ── get_venue ──────────────────────────────────────────────────
    server.tool('get_venue', {
      title: 'Get Venue',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          venueId: { type: 'string' },
          organizationId: { type: 'string' },
        },
        required: ['venueId'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);
      const venue = await backendAuth.getVenue(auth.organizationId, args.venueId);
      if (!venue) return { content: [], isError: true, structuredContent: { error: 'Venue not found' } };

      await auditCall(auth, {
        tool: 'get_venue', args,
        summary: `Venue "${venue.name}"`,
        outcome: 'ok',
        targetType: 'Venue', targetId: venue.id,
      });
      return toolResult(venue);
    });

    // ── list_price_tiers ───────────────────────────────────────────
    server.tool('list_price_tiers', {
      title: 'List Price Tiers',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          eventId: { type: 'string' },
          organizationId: { type: 'string' },
          includeAll: { type: 'boolean', description: 'Include inactive tiers (default: false)' },
        },
        required: ['eventId'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          priceTiers: { type: 'array' },
          eventId: { type: 'string' },
        },
      },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);
      const tiers = await backendAuth.listPriceTiersForOrg(auth.organizationId, args.eventId, args.includeAll);

      await auditCall(auth, {
        tool: 'list_price_tiers', args,
        summary: `${tiers.priceTiers?.length || 0} price tiers for event ${args.eventId}`,
        outcome: 'ok',
        targetType: 'Event', targetId: args.eventId,
      });
      return toolResult(tiers);
    });

    // ── list_pages ──────────────────────────────────────────────────
    server.tool('list_pages', {
      title: 'List Pages',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          pages: { type: 'array' },
        },
      },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);
      const pages = await backendAuth.listPages(auth.organizationId);

      await auditCall(auth, {
        tool: 'list_pages', args,
        summary: `${pages.length} pages`,
        outcome: 'ok',
        targetType: 'Organization', targetId: auth.organizationId,
      });
      return toolResult({ pages });
    });

    // ── get_page ───────────────────────────────────────────────────
    server.tool('get_page', {
      title: 'Get Page',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          organizationId: { type: 'string' },
        },
        required: ['pageId'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);
      const page = await backendAuth.getPage(auth.organizationId, args.pageId);
      if (!page) return { content: [], isError: true, structuredContent: { error: 'Page not found' } };

      await auditCall(auth, {
        tool: 'get_page', args,
        summary: `Page "${page.title}"`,
        outcome: 'ok',
        targetType: 'Page', targetId: page.id,
      });
      return toolResult(page);
    });

    // ── list_blog_posts ────────────────────────────────────────────
    server.tool('list_blog_posts', {
      title: 'List Blog Posts',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          page: { type: 'number' },
          pageSize: { type: 'number' },
          status: { type: 'string' },
          q: { type: 'string' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          posts: { type: 'array' },
          total: { type: 'number' },
        },
      },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);
      const result = await backendAuth.listBlogPosts(auth.organizationId, args);

      await auditCall(auth, {
        tool: 'list_blog_posts', args,
        summary: `${result.total} blog posts`,
        outcome: 'ok',
        targetType: 'Organization', targetId: auth.organizationId,
      });
      return toolResult(result);
    });

    // ── get_blog_post ──────────────────────────────────────────────
    server.tool('get_blog_post', {
      title: 'Get Blog Post',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          postId: { type: 'string' },
          organizationId: { type: 'string' },
        },
        required: ['postId'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);
      const post = await backendAuth.getBlogPost(auth.organizationId, args.postId);
      if (!post) return { content: [], isError: true, structuredContent: { error: 'Blog post not found' } };

      await auditCall(auth, {
        tool: 'get_blog_post', args,
        summary: `Blog post "${post.title || post.handle}"`,
        outcome: 'ok',
        targetType: 'BlogPost', targetId: post.id,
      });
      return toolResult(post);
    });

    // ── list_menus ──────────────────────────────────────────────────
    server.tool('list_menus', {
      title: 'List Menus',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          menus: { type: 'array' },
        },
      },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);
      const menus = await backendAuth.listMenus(auth.organizationId);

      await auditCall(auth, {
        tool: 'list_menus', args,
        summary: `${menus.length} menus`,
        outcome: 'ok',
        targetType: 'Organization', targetId: auth.organizationId,
      });
      return toolResult({ menus });
    });

    // ── get_menu ───────────────────────────────────────────────────
    server.tool('get_menu', {
      title: 'Get Menu',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          menuId: { type: 'string' },
          organizationId: { type: 'string' },
        },
        required: ['menuId'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);
      const menu = await backendAuth.getMenu(auth.organizationId, args.menuId);
      if (!menu) return { content: [], isError: true, structuredContent: { error: 'Menu not found' } };

      await auditCall(auth, {
        tool: 'get_menu', args,
        summary: `Menu "${menu.title}" (${menu.items?.length || 0} items)`,
        outcome: 'ok',
        targetType: 'Menu', targetId: menu.id,
      });
      return toolResult(menu);
    });

    // ── list_redirects ─────────────────────────────────────────────
    server.tool('list_redirects', {
      title: 'List URL Redirects',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          page: { type: 'number' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          redirects: { type: 'array' },
          total: { type: 'number' },
        },
      },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);
      const result = await backendAuth.listRedirects(auth.organizationId, { q: args.q, page: args.page });

      await auditCall(auth, {
        tool: 'list_redirects', args,
        summary: `${result.total} redirects`,
        outcome: 'ok',
        targetType: 'Organization', targetId: auth.organizationId,
      });
      return toolResult(result);
    });

    // ── list_files ──────────────────────────────────────────────────
    server.tool('list_files', {
      title: 'List Files',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          page: { type: 'number' },
          pageSize: { type: 'number' },
          type: { type: 'string' },
          q: { type: 'string' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array' },
          total: { type: 'number' },
        },
      },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);
      const result = await backendAuth.listFiles(auth.organizationId, { page: args.page, pageSize: args.pageSize, type: args.type, q: args.q });

      await auditCall(auth, {
        tool: 'list_files', args,
        summary: `${result.total} files`,
        outcome: 'ok',
        targetType: 'Organization', targetId: auth.organizationId,
      });
      return toolResult(result);
    });

    // ── get_theme ──────────────────────────────────────────────────
    server.tool('get_theme', {
      title: 'Get Theme',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          themeId: { type: 'string', description: 'Theme ID. Omit to return the active published theme.' },
          organizationId: { type: 'string' },
        },
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);

      let theme;
      if (args.themeId) {
        theme = await backendAuth.getThemeById(auth.organizationId, args.themeId);
      } else {
        theme = await backendAuth.getActiveTheme(auth.organizationId);
      }
      if (!theme) return { content: [], isError: true, structuredContent: { error: 'Theme not found' } };

      await auditCall(auth, {
        tool: 'get_theme', args,
        summary: `Theme "${theme.name}"`,
        outcome: 'ok',
        targetType: 'Theme', targetId: theme.id,
      });
      return toolResult(theme);
    });

    // ── get_sales_summary ──────────────────────────────────────────
    server.tool('get_sales_summary', {
      title: 'Get Sales Summary',
      readOnlyHint: true,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          totalRevenue: { type: 'number' },
          totalOrders: { type: 'number' },
          totalTicketsSold: { type: 'number' },
          totalRefunds: { type: 'number' },
          netRevenue: { type: 'number' },
          byEvent: { type: 'array' },
        },
      },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'store:read');
      rejectCrossOrg(args, auth.organizationId);
      const summary = await backendAuth.getSalesSummary(auth.organizationId);

      await auditCall(auth, {
        tool: 'get_sales_summary', args,
        summary: `Revenue $${summary.totalRevenue}, ${summary.totalTicketsSold} tickets sold`,
        outcome: 'ok',
        targetType: 'Organization', targetId: auth.organizationId,
      });
      return toolResult(summary);
    });

    // ── create_event_draft ──────────────────────────────────────────────
    server.tool('create_event_draft', {
      title: 'Create Event Draft',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          venueId: { type: 'string', description: 'Venue ID' },
          name: { type: 'string', description: 'Event name' },
          date: { type: 'string', description: 'Event date in venue timezone (YYYY-MM-DDTHH:MM)' },
          description: { type: 'string', description: 'Event description (HTML allowed)' },
          capacity: { type: 'number', description: 'Event capacity' },
          category: { type: 'string', description: 'Event category' },
          admissionMode: { type: 'string', enum: ['TICKETED', 'RSVP'], description: 'Admission mode' },
          rsvpLimit: { type: 'number', description: 'RSVP limit (RSVP mode)' },
          rsvpMaxPartySize: { type: 'number', description: 'Max party size (RSVP mode)' },
          priceTiers: {
            type: 'array',
            description: 'Price tiers for the event',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                price: { type: 'number' },
                quantityTotal: { type: 'number' },
                displayOrder: { type: 'number' },
                minPerOrder: { type: 'number' },
                maxPerOrder: { type: 'number' },
                saleStartDate: { type: 'string' },
                saleEndDate: { type: 'string' },
                visibility: { type: 'string', enum: ['PUBLIC', 'HIDDEN', 'UNLISTED'] },
                isRefundable: { type: 'boolean' },
              },
              required: ['name', 'price', 'quantityTotal'],
            },
          },
        },
        required: ['venueId', 'name', 'date'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'events:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, ...data } = args;

      // RSVP events don't use price tiers — reject if both provided
      if (data.admissionMode === 'RSVP' && data.priceTiers && data.priceTiers.length > 0) {
        throw Object.assign(new ValidationError('RSVP events cannot have price tiers'), { code: -32602, statusCode: 400 });
      }

      const result = await createEventDraft(auth.organizationId, data);

      await auditCall(auth, {
        tool: 'create_event_draft', args,
        summary: `Created event draft "${result.event.name}" (${result.event.status})`,
        outcome: 'ok',
        targetType: 'Event', targetId: result.event.id,
      });
      return toolResult(result);
    });

    // ── update_event ────────────────────────────────────────────────────
    server.tool('update_event', {
      title: 'Update Event',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          eventId: { type: 'string', description: 'Event ID' },
          name: { type: 'string' },
          date: { type: 'string', description: 'Event date in venue timezone (YYYY-MM-DDTHH:MM)' },
          description: { type: 'string' },
          capacity: { type: 'number' },
          category: { type: 'string' },
          admissionMode: { type: 'string', enum: ['TICKETED', 'RSVP'] },
          rsvpLimit: { type: 'number' },
          rsvpMaxPartySize: { type: 'number' },
          slug: { type: 'string' },
          status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] },
          logoUrl: { type: 'string' },
        },
        required: ['eventId'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'events:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, eventId, ...updates } = args;
      const result = await updateEvent(auth.organizationId, eventId, updates);

      await auditCall(auth, {
        tool: 'update_event', args,
        summary: `Updated event "${result.event.name}"`,
        outcome: 'ok',
        targetType: 'Event', targetId: result.event.id,
      });
      return toolResult(result);
    });

    // ── create_venue ────────────────────────────────────────────────────
    server.tool('create_venue', {
      title: 'Create Venue',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          name: { type: 'string', description: 'Venue name' },
          address: { type: 'string', description: 'Street address' },
          city: { type: 'string' },
          state: { type: 'string' },
          postalCode: { type: 'string' },
          country: { type: 'string', description: 'ISO country code (default US)' },
          timezone: { type: 'string', description: 'IANA timezone (e.g., America/New_York)' },
          isPublic: { type: 'boolean' },
          slug: { type: 'string' },
        },
        required: ['name', 'address'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'events:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, ...data } = args;
      const result = await createVenue(auth.organizationId, data);

      await auditCall(auth, {
        tool: 'create_venue', args,
        summary: `Created venue "${result.venue.name}"`,
        outcome: 'ok',
        targetType: 'Venue', targetId: result.venue.id,
      });
      return toolResult(result);
    });

    // ── update_venue ────────────────────────────────────────────────────
    server.tool('update_venue', {
      title: 'Update Venue',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          venueId: { type: 'string', description: 'Venue ID' },
          name: { type: 'string' },
          address: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          postalCode: { type: 'string' },
          country: { type: 'string' },
          timezone: { type: 'string', description: 'IANA timezone; null clears manual override' },
          isPublic: { type: 'boolean' },
          slug: { type: 'string' },
        },
        required: ['venueId'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'events:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, venueId, ...updates } = args;
      const result = await updateVenue(auth.organizationId, venueId, updates);

      await auditCall(auth, {
        tool: 'update_venue', args,
        summary: `Updated venue "${result.venue.name}"`,
        outcome: 'ok',
        targetType: 'Venue', targetId: result.venue.id,
      });
      return toolResult(result);
    });

    // ── create_price_tier ───────────────────────────────────────────────
    server.tool('create_price_tier', {
      title: 'Create Price Tier',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          eventId: { type: 'string', description: 'Event ID' },
          name: { type: 'string', description: 'Tier name' },
          description: { type: 'string' },
          price: { type: 'number', description: 'Price in cents' },
          quantityTotal: { type: 'number', description: 'Total inventory' },
          displayOrder: { type: 'number' },
          minPerOrder: { type: 'number' },
          maxPerOrder: { type: 'number' },
          saleStartDate: { type: 'string' },
          saleEndDate: { type: 'string' },
          visibility: { type: 'string', enum: ['PUBLIC', 'HIDDEN', 'UNLISTED'] },
          isRefundable: { type: 'boolean' },
        },
        required: ['eventId', 'name', 'price', 'quantityTotal'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'events:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, eventId, ...data } = args;
      const result = await createPriceTier(auth.organizationId, eventId, data);

      await auditCall(auth, {
        tool: 'create_price_tier', args,
        summary: `Created price tier "${result.priceTier.name}" for event ${eventId}`,
        outcome: 'ok',
        targetType: 'PriceTier', targetId: result.priceTier.id,
      });
      return toolResult(result);
    });

    // ── update_price_tier ───────────────────────────────────────────────
    server.tool('update_price_tier', {
      title: 'Update Price Tier',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          eventId: { type: 'string', description: 'Event ID' },
          tierId: { type: 'string', description: 'Price tier ID' },
          name: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'number' },
          quantityTotal: { type: 'number' },
          displayOrder: { type: 'number' },
          minPerOrder: { type: 'number' },
          maxPerOrder: { type: 'number' },
          saleStartDate: { type: 'string' },
          saleEndDate: { type: 'string' },
          visibility: { type: 'string', enum: ['PUBLIC', 'HIDDEN', 'UNLISTED'] },
          isRefundable: { type: 'boolean' },
        },
        required: ['eventId', 'tierId'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'events:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, eventId, tierId, ...data } = args;
      const result = await updatePriceTier(auth.organizationId, eventId, tierId, data);

      await auditCall(auth, {
        tool: 'update_price_tier', args,
        summary: `Updated price tier "${result.priceTier.name}"`,
        outcome: 'ok',
        targetType: 'PriceTier', targetId: result.priceTier.id,
      });
      return toolResult(result);
    });

    // ── reorder_price_tiers ─────────────────────────────────────────────
    server.tool('reorder_price_tiers', {
      title: 'Reorder Price Tiers',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          eventId: { type: 'string', description: 'Event ID' },
          tierIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ordered list of tier IDs',
          },
        },
        required: ['eventId', 'tierIds'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'events:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, eventId, tierIds } = args;
      const result = await reorderPriceTiers(auth.organizationId, eventId, tierIds);

      await auditCall(auth, {
        tool: 'reorder_price_tiers', args,
        summary: `Reordered ${result.priceTiers?.length || 0} price tiers for event ${eventId}`,
        outcome: 'ok',
        targetType: 'Event', targetId: eventId,
      });
      return toolResult(result);
    });

    // ── create_page_draft ───────────────────────────────────────────────
    server.tool('create_page_draft', {
      title: 'Create Page Draft',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          title: { type: 'string', description: 'Page title' },
          content: { type: 'string', description: 'Page content (HTML, will be sanitized)' },
          slug: { type: 'string' },
          isVisible: { type: 'boolean', description: 'Ignored — always created as draft (false)' },
          seoTitle: { type: 'string' },
          seoDescription: { type: 'string' },
          template: { type: 'string' },
          applicationFormId: { type: 'string' },
          applyLabel: { type: 'string' },
        },
        required: ['title', 'content'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'content:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, ...data } = args;
      const result = await createPageDraft(auth.organizationId, data);

      await auditCall(auth, {
        tool: 'create_page_draft', args,
        summary: `Created page draft "${result.page.title}"`,
        outcome: 'ok',
        targetType: 'Page', targetId: result.page.id,
      });
      return toolResult(result);
    });

    // ── update_page ─────────────────────────────────────────────────────
    server.tool('update_page', {
      title: 'Update Page',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          pageId: { type: 'string', description: 'Page ID' },
          title: { type: 'string' },
          content: { type: 'string' },
          isVisible: { type: 'boolean' },
          seoTitle: { type: 'string' },
          seoDescription: { type: 'string' },
          template: { type: 'string' },
          applicationFormId: { type: 'string' },
          applyLabel: { type: 'string' },
          slug: { type: 'string' },
        },
        required: ['pageId'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'content:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, pageId, ...updates } = args;
      const result = await updatePage(auth.organizationId, pageId, updates);

      await auditCall(auth, {
        tool: 'update_page', args,
        summary: `Updated page "${result.page.title}"`,
        outcome: 'ok',
        targetType: 'Page', targetId: result.page.id,
      });
      return toolResult(result);
    });

    // ── create_blog_post_draft ──────────────────────────────────────────
    server.tool('create_blog_post_draft', {
      title: 'Create Blog Post Draft',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          title: { type: 'string', description: 'Post title' },
          blogId: { type: 'string' },
          content: { type: 'string', description: 'Post content (HTML, will be sanitized)' },
          excerpt: { type: 'string' },
          authorName: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          featuredFileId: { type: 'string' },
          isVisible: { type: 'boolean', description: 'Ignored — always created as hidden (false)' },
          publishedAt: { type: 'string', description: 'ISO date; ignored for draft' },
          handle: { type: 'string' },
          slug: { type: 'string' },
          seoTitle: { type: 'string' },
          seoDescription: { type: 'string' },
        },
        required: ['title', 'content'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'content:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, ...data } = args;
      const result = await createBlogPostDraft(auth.organizationId, data, auth.userId);

      await auditCall(auth, {
        tool: 'create_blog_post_draft', args,
        summary: `Created blog post draft "${result.blogPost.title}"`,
        outcome: 'ok',
        targetType: 'BlogPost', targetId: result.blogPost.id,
      });
      return toolResult(result);
    });

    // ── update_blog_post ────────────────────────────────────────────────
    server.tool('update_blog_post', {
      title: 'Update Blog Post',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          postId: { type: 'string', description: 'Blog post ID' },
          title: { type: 'string' },
          content: { type: 'string' },
          excerpt: { type: 'string' },
          authorName: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          featuredFileId: { type: 'string' },
          isVisible: { type: 'boolean' },
          publishedAt: { type: 'string' },
          seoTitle: { type: 'string' },
          seoDescription: { type: 'string' },
          handle: { type: 'string' },
          slug: { type: 'string' },
        },
        required: ['postId'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'content:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, postId, ...updates } = args;
      const result = await updateBlogPost(auth.organizationId, postId, updates);

      await auditCall(auth, {
        tool: 'update_blog_post', args,
        summary: `Updated blog post "${result.blogPost.title}"`,
        outcome: 'ok',
        targetType: 'BlogPost', targetId: result.blogPost.id,
      });
      return toolResult(result);
    });

    // ── update_menu ─────────────────────────────────────────────────────
    server.tool('update_menu', {
      title: 'Update Menu',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          menuId: { type: 'string', description: 'Menu ID' },
          title: { type: 'string' },
          items: {
            type: 'array',
            description: 'Flat menu tree with parentId for nesting',
            items: {
              type: 'object',
              properties: {
                parentKey: { type: 'string' },
                position: { type: 'number' },
                label: { type: 'string' },
                linkType: { type: 'string', enum: ['HOME', 'EVENTS', 'EVENT', 'VENUE', 'PAGE', 'BLOG', 'BLOG_POST', 'ACCOUNT', 'EXTERNAL'] },
                targetId: { type: 'string' },
                url: { type: 'string' },
                newTab: { type: 'boolean' },
              },
              required: ['label', 'linkType'],
            },
          },
        },
        required: ['menuId', 'items'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'content:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, menuId, ...data } = args;
      const result = await updateMenu(auth.organizationId, menuId, data);

      await auditCall(auth, {
        tool: 'update_menu', args,
        summary: `Updated menu "${result.menu.title}"`,
        outcome: 'ok',
        targetType: 'Menu', targetId: result.menu.id,
      });
      return toolResult(result);
    });

    // ── create_redirect ─────────────────────────────────────────────────
    server.tool('create_redirect', {
      title: 'Create Redirect',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          fromPath: { type: 'string', description: 'Path to redirect from (e.g., /old-page)' },
          toPath: { type: 'string', description: 'Target path or full https:// URL' },
        },
        required: ['fromPath', 'toPath'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'content:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, ...data } = args;
      const result = await createRedirect(auth.organizationId, data);

      await auditCall(auth, {
        tool: 'create_redirect', args,
        summary: `Created redirect ${result.redirect.fromPath} → ${result.redirect.toPath}`,
        outcome: 'ok',
        targetType: 'UrlRedirect', targetId: result.redirect.id,
      });
      return toolResult(result);
    });

    // ── upload_file ─────────────────────────────────────────────────────
    server.tool('upload_file', {
      title: 'Upload File',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          bufferBase64: { type: 'string', description: 'File content as base64' },
          originalName: { type: 'string', description: 'Original filename' },
          claimedMimeType: { type: 'string', description: 'Optional MIME type hint' },
          url: { type: 'string', description: 'Alternative: public URL to fetch' },
        },
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'content:write');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, ...data } = args;
      const result = await uploadFile(auth.organizationId, data, auth.userId);

      await auditCall(auth, {
        tool: 'upload_file', args,
        summary: `Uploaded file "${result.file.name}" (${result.file.extension})`,
        outcome: 'ok',
        targetType: 'StoreFile', targetId: result.file.id,
      });
      return toolResult(result);
    });

    // ── theme_save ───────────────────────────────────────────────────────
    server.tool('theme_save', {
      title: 'Save Theme',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      inputSchema: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          themeId: { type: 'string', description: 'Theme ID' },
          themeVersion: { type: 'number', description: 'Current theme version for optimistic locking' },
          settings: { type: 'object', description: 'Theme settings override' },
          content: { type: 'object', description: 'Theme content override' },
          documents: {
            type: 'object',
            description: 'Theme documents to update (key: { data, version })',
            additionalProperties: {
              type: 'object',
              properties: {
                data: { type: 'object' },
                version: { type: 'number' },
              },
            },
          },
        },
        required: ['themeId', 'themeVersion'],
      },
      outputSchema: { type: 'object' },
    }, async (args) => {
      const auth = await backendAuth.authorizeTool(token, 'themes');
      rejectCrossOrg(args, auth.organizationId);

      const { organizationId, themeId, ...body } = args;
      const result = await saveTheme(auth.organizationId, themeId, body, auth.userId);

      await auditCall(auth, {
        tool: 'theme_save', args,
        summary: `Saved theme ${themeId}`,
        outcome: 'ok',
        targetType: 'Theme', targetId: themeId,
      });
      return toolResult(result);
    });

    return server;
  },
  { legacy: 'reject' },
);

// ── Route ───────────────────────────────────────────────────────────

app.all('/mcp', toNodeHandler(handler));

// ── Start ───────────────────────────────────────────────────────────

import logger from '../backend/src/utils/logger.js';

app.listen(PORT, () => {
  logger.warn(`MCP server listening on port ${PORT}`);
});

export default app;