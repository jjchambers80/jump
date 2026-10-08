// Deterministic fixture API for server-rendered storefront pages (spec 038
// §16, contracts C9). Playwright's page.route only sees browser requests;
// this answers the Next server's own fetches. No network, no Postgres, no
// Stripe. It listens on the API port the suite already uses (3002), so
// browser-side page.route mocks keep winning for the browser.
//
// Unknown organizations answer 404, which the storefront treats as "not in
// the rollout" and serves the legacy client page: existing specs are unaffected.

import { createServer } from 'node:http';
import { EVENT_ROUTES, EVENTS_TEMPLATE, FIXTURES } from './storefront.mjs';

const port = Number(process.env.FIXTURE_API_PORT || 3002);

function send(res, status, body) {
  // CORS so a browser call nobody mocked fails as a plain 404, not a CORS error.
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'private, no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function locked(fixture, req) {
  if (!fixture.gate) return false;
  const tokens = String(req.headers['x-storefront-access'] || '').split(',').map((t) => t.trim());
  return !tokens.includes(fixture.gate.token);
}

function gateBody(fixture) {
  const { id, name, logoUrl, brandColor, themeMode } = fixture.render.organization;
  return {
    error: 'StorefrontLockedError',
    message: 'This store is private',
    details: { locked: true, organization: { id, name, logoUrl, brandColor, themeMode }, message: fixture.gate.message },
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (req.method === 'OPTIONS') return send(res, 204);
  if (url.pathname === '/__fixtures/health') return send(res, 200, { ok: true });

  const eventMeta = url.pathname.match(/^\/events\/([^/]+)\/meta$/);
  if (eventMeta) {
    const meta = Object.prototype.hasOwnProperty.call(EVENT_ROUTES, eventMeta[1]) ? EVENT_ROUTES[eventMeta[1]] : null;
    return meta ? send(res, 200, meta) : send(res, 404, { error: 'NotFoundError', message: 'No fixture' });
  }

  const m = url.pathname.match(/^\/organizations\/([^/]+)(\/.*)$/);
  const fixture = m && Object.prototype.hasOwnProperty.call(FIXTURES, m[1]) ? FIXTURES[m[1]] : null;
  if (!fixture) return send(res, 404, { error: 'NotFoundError', message: 'No fixture' });
  const rest = m[2];

  if (rest === '/storefront-access' && req.method === 'POST') {
    const { password } = await readJson(req);
    if (fixture.gate && password === fixture.gate.password) return send(res, 200, { token: fixture.gate.token });
    return send(res, 401, { error: 'AuthenticationError', message: 'Incorrect password' });
  }

  if (rest === '/public/storefront/render') {
    if (fixture.render.renderer === 'legacy') return send(res, 200, fixture.render);
    if (locked(fixture, req)) return send(res, 403, gateBody(fixture));
    const page = url.searchParams.get('page');
    const withTemplate = (template, extra) => ({ ...fixture.render, ...extra, documents: { ...fixture.render.documents, template } });
    // Content pages (`page:<slug>`): the frame plus `resolved.page`, and a
    // full-width page's own document as the template.
    if (page?.startsWith('page:')) {
      const route = fixture.routes[`/public/pages/${page.slice(5)}`];
      if (!route) return send(res, 404, { error: 'NotFoundError', message: 'Page not found' });
      const resolved = { ...fixture.render.resolved, page: route.page };
      const doc = route.page.template?.name === 'full-width' ? fixture.pageDocuments?.[route.page.id] : null;
      return send(res, 200, doc ? withTemplate(doc, { page: `page:${route.page.id}`, resolved }) : withTemplate(null, { page: 'frame', resolved }));
    }
    const body =
      page === 'frame'
        ? withTemplate(null, { page: 'frame' })
        : page === 'events'
          ? withTemplate(EVENTS_TEMPLATE, { page: 'events', fallback: false })
          : fixture.render;
    // Card thumbnail (contracts C7): one valid token; any other value falls back to the live theme.
    const thumbnail = req.headers['x-theme-thumbnail'];
    if (thumbnail)
      return send(
        res,
        200,
        thumbnail === 'fixture-thumbnail'
          ? { ...body, preview: { themeId: 'draft-1', name: 'Summer draft', expiresAt: '2099-01-01T00:00:00.000Z', share: false, thumbnail: true } }
          : { ...body, previewInvalid: true },
      );
    // Draft preview (038K): one valid token; any other value is refused, so the frame clears the cookie.
    const preview = req.headers['x-theme-preview'];
    if (!preview) return send(res, 200, body);
    return send(
      res,
      200,
      preview === 'fixture-preview'
        ? { ...body, preview: { themeId: 'draft-1', name: 'Summer draft', expiresAt: '2099-01-01T00:00:00.000Z', share: false } }
        : { ...body, previewInvalid: true },
    );
  }

  const route = fixture.routes[`${rest}${url.search}`] ?? fixture.routes[rest];
  if (!route) return send(res, 404, { error: 'NotFoundError', message: 'Not found' });
  if (locked(fixture, req)) return send(res, 403, gateBody(fixture));
  return send(res, 200, route);
}).listen(port, () => console.log(`storefront fixture API on ${port}`));
