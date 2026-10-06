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
import { extractBearer, rejectCrossOrg, auditCall, toolResult } from '../services/auth.js';
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