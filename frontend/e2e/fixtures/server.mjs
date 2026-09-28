// Spike 038-0 (§16 SSR harness): deterministic fixture API for server-rendered
// storefront pages. Playwright's page.route only sees browser requests; this
// answers the Next server's own fetches. Canned JSON per org id under
// e2e/fixtures/storefront/<orgId>.json; no network, no Postgres, no Stripe.
//
// Listens on the API port the e2e job already points NEXT_PUBLIC_API_URL at
// (3002 in CI), so no new env var is needed. Browser-side page.route mocks
// still win because Playwright intercepts before the request leaves Chromium.

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'storefront');
const port = Number(process.env.FIXTURE_API_PORT || 3002);

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store' });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === '/health') return send(res, 200, { ok: true });
  const unlock = url.pathname.match(/^\/organizations\/([^/]+)\/storefront-access$/);
  if (unlock && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const { password } = JSON.parse(raw || '{}');
      if (password === 'letmein') return send(res, 200, { token: 'good-token' });
      send(res, 401, { error: 'Incorrect password' });
    });
    return;
  }
  const m = url.pathname.match(/^\/organizations\/([^/]+)\/public\/storefront\/render$/);
  if (!m) return send(res, 404, { error: 'No fixture' });
  const file = path.join(dir, `${path.basename(decodeURIComponent(m[1]))}.json`);
  if (!existsSync(file)) return send(res, 404, { error: 'Organization not found' });
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  const { gate, ...body } = fixture;
  // Thumbnail tokens (§9a.5) render past the store gate. The real backend
  // verifies the signed token; the fixture accepts the `thumb-` prefix.
  const thumbnail = String(req.headers['x-theme-thumbnail'] || '').startsWith('thumb-');
  if (gate && !thumbnail) {
    const tokens = String(req.headers['x-storefront-access'] || '').split(',').map((t) => t.trim());
    if (!tokens.includes(gate.token)) {
      return send(res, 200, { locked: true, organization: body.organization, message: gate.message ?? null });
    }
  }
  send(res, 200, body);
}).listen(port, () => console.log(`fixture api on ${port}`));
