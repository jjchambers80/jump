// Jump CLI (spec 043) against an in-process fake of the API: browser login
// with PKCE, credentials file mode, pull → edit → push of only what changed,
// local check, conflicts, live-theme guard, development theme + preview.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { login } from '../src/login.js';
import { main } from '../src/commands.js';
import { changesFor, hashOf, readLock } from '../src/themeDir.js';

const TOKEN = 'jmp_test-token';
const header = { root: { props: {} }, content: [{ type: 'Header', props: { id: 'Header-1' } }] };
const footer = { root: { props: {} }, content: [{ type: 'Footer', props: { id: 'Footer-1' } }] };
const home = (heading) => ({ root: { props: {} }, content: [{ type: 'Hero', props: { id: 'Hero-1', heading } }] });
const events = { root: { props: {} }, content: [{ type: 'EventList', props: { id: 'EventList-1' } }] };

/** A tiny stand-in for the themes API: versions, 409s and saves like ThemeService. */
function fakeApi() {
  const state = {
    saves: [],
    pending: null,
    themes: {
      live: { id: 'live', name: 'Eventimus Default', role: 'MAIN', presetKey: 'eventimus-default', version: 1, settings: {}, content: {}, docs: { header: [header, 1], footer: [footer, 0], home: [home('Live'), 2], events: [events, 0] } },
    },
  };
  const send = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(body === undefined ? '' : JSON.stringify(body));
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/developer/token') {
      const ok = state.pending && body.code === 'the-code' && createHash('sha256').update(body.codeVerifier).digest('base64url') === state.pending.challenge && body.redirectUri === state.pending.redirect;
      return ok
        ? send(res, 201, { token: TOKEN, expiresAt: '2099-01-01T00:00:00.000Z', scopes: ['themes'], organization: { id: 'org1', name: 'River', slug: 'river' }, user: { email: 'dev@river.test' } })
        : send(res, 401, { message: 'This sign-in code is invalid or has expired' });
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { message: 'Invalid token', code: 'DEVELOPER_TOKEN_INVALID' });
    if (url.pathname === '/developer/me') return send(res, 200, { user: { email: 'dev@river.test' }, organizationId: 'org1' });
    if (url.pathname === '/developer/token' && req.method === 'DELETE') return send(res, 204);
    if (url.pathname === '/admin/themes/schema' && state.kit) return send(res, 200, state.kit);
    if (url.pathname === '/admin/themes') return send(res, 200, { themes: Object.values(state.themes).map(({ docs, ...t }) => t) });
    const m = url.pathname.match(/^\/admin\/themes\/([^/]+)(\/.*)?$/);
    const theme = m && state.themes[m[1]];
    if (!theme) return send(res, 404, { message: 'Theme not found' });
    const rest = m[2] || '';
    if (!rest) {
      const { docs, ...t } = theme;
      const keys = ['header', 'footer', 'home', 'events'];
      return send(res, 200, { ...t, documents: keys.map((key) => ({ key, version: docs[key]?.[1] ?? 0 })) });
    }
    const doc = rest.match(/^\/documents\/(.+)$/);
    if (doc) {
      const [data, version] = theme.docs[doc[1]];
      return send(res, 200, { key: doc[1], data, version });
    }
    if (rest === '/save') {
      const stale = Object.entries(body.documents ?? {}).some(([k, d]) => (theme.docs[k]?.[1] ?? 0) !== d.version);
      if (body.themeVersion !== theme.version || stale) return send(res, 409, { message: 'changed', code: 'THEME_CONFLICT' });
      state.saves.push({ themeId: theme.id, body });
      if (body.settings || body.content) theme.version += 1;
      if (body.settings) theme.settings = body.settings;
      const versions = {};
      for (const [k, d] of Object.entries(body.documents ?? {})) {
        theme.docs[k] = d.data === null ? [events, 0] : [d.data, (theme.docs[k]?.[1] ?? 0) + 1];
        versions[k] = theme.docs[k][1];
      }
      const changedKeys = [...(body.settings ? ['settings'] : []), ...(body.content ? ['content'] : []), ...Object.keys(body.documents ?? {})];
      return send(res, 200, { theme: { id: theme.id, version: theme.version }, documents: versions, changedKeys });
    }
    if (rest === '/duplicate') {
      const copy = { ...structuredClone(theme), id: 'dev', name: body.name, role: 'UNPUBLISHED', version: 1 };
      for (const k of Object.keys(copy.docs)) copy.docs[k][1] = copy.docs[k][1] ? 1 : 0;
      state.themes.dev = copy;
      const { docs, ...t } = copy;
      return send(res, 201, t);
    }
    if (rest === '/preview-link') return send(res, 200, { url: `http://store.test/api/storefront/preview?token=${theme.id}`, expiresAt: '2099-01-01T01:00:00.000Z', share: !!body?.share });
    if (rest === '/publish') {
      for (const t of Object.values(state.themes)) t.role = t.id === theme.id ? 'MAIN' : 'UNPUBLISHED';
      return send(res, 200, { id: theme.id, name: theme.name, role: 'MAIN' });
    }
    return send(res, 404, {});
  });
  return { server, state };
}

const quiet = async (fn) => {
  const logs = [];
  const { log, error, warn } = console;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  console.warn = (...a) => logs.push(a.join(' '));
  try {
    return { code: await fn(), logs: logs.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
    console.warn = warn;
  }
};

describe('jump CLI', () => {
  let api;
  let apiUrl;
  let dir;

  before(async () => {
    api = fakeApi();
    await new Promise((r) => api.server.listen(0, '127.0.0.1', r));
    apiUrl = `http://127.0.0.1:${api.server.address().port}`;
    process.env.JUMP_CONFIG_DIR = await mkdtemp(join(tmpdir(), 'jump-cfg-'));
    dir = await mkdtemp(join(tmpdir(), 'jump-theme-'));
  });

  after(async () => {
    api.server.close();
    await rm(process.env.JUMP_CONFIG_DIR, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  });

  it('logs in through the loopback redirect with PKCE', async () => {
    const result = await login({
      store: 'river',
      appUrl: 'http://app.test',
      apiUrl,
      log: () => {},
      // Play the browser: the consent page redirects to the loopback listener.
      openUrl: (url) => {
        const params = new URL(url).searchParams;
        assert.equal(new URL(url).pathname, '/admin/cli/authorize');
        api.state.pending = { challenge: params.get('code_challenge'), redirect: params.get('redirect_uri') };
        assert.match(params.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        void fetch(`${params.get('redirect_uri')}?code=the-code&state=${params.get('state')}`);
      },
    });
    assert.equal(result.token, TOKEN);
  });

  it('a callback with the wrong state is ignored, a cancel rejects', async () => {
    await assert.rejects(
      login({
        store: 'river',
        appUrl: 'http://app.test',
        apiUrl,
        log: () => {},
        openUrl: async (url) => {
          const params = new URL(url).searchParams;
          const forged = await fetch(`${params.get('redirect_uri')}?code=the-code&state=forged`);
          assert.equal(forged.status, 400);
          void fetch(`${params.get('redirect_uri')}?error=access_denied&state=${params.get('state')}`);
        },
      }),
      /cancelled/,
    );
  });

  it('stores credentials with mode 0600', async () => {
    const file = join(process.env.JUMP_CONFIG_DIR, 'credentials.json');
    await writeFile(file, JSON.stringify({ stores: { river: { apiUrl, appUrl: 'http://app.test', organizationId: 'org1', organizationName: 'River', email: 'dev@river.test', token: TOKEN } }, current: 'river' }), { mode: 0o644 });
    const { writeCredentials, readCredentials } = await import('../src/config.js');
    await writeCredentials(await readCredentials());
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  });

  it('pulls the live theme with the agent kit', async () => {
    const { code } = await quiet(() => main(['theme', 'pull', '--dir', dir]));
    assert.equal(code, undefined);
    const lock = await readLock(dir);
    assert.deepEqual([lock.themeId, lock.role, lock.themeVersion], ['live', 'MAIN', 1]);
    assert.deepEqual(lock.documents, { header: 1, footer: 0, home: 2, events: 0 });
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'documents/home.json'), 'utf8')), home('Live'));
    assert.match(await readFile(join(dir, '.jump/AGENTS.md'), 'utf8'), /Never invent a fileId/);
    assert.match(await readFile(join(dir, 'AGENTS.md'), 'utf8'), /@\.jump\/AGENTS\.md/);
    assert.equal(await readFile(join(dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
    const schema = JSON.parse(await readFile(join(dir, '.jump/schema.json'), 'utf8'));
    assert.ok(schema.sections.Hero && schema.settings.colors);
  });

  it('refuses to push to the live theme without --live', async () => {
    await writeFile(join(dir, 'documents/home.json'), JSON.stringify(home('Edited')));
    await assert.rejects(main(['theme', 'push', '--dir', dir]), /live theme/);
    assert.equal(api.state.saves.length, 0);
  });

  it('check catches what the server would refuse, and push will not send it', async () => {
    await writeFile(join(dir, 'documents/home.json'), JSON.stringify({ root: { props: {} }, content: [{ type: 'Marquee', props: { id: 'x' } }] }));
    const { code, logs } = await quiet(() => main(['theme', 'check', '--dir', dir]));
    assert.equal(code, 1);
    assert.match(logs, /documents\.home/);
  });

  it("writes the server's schema and guide; a stale CLI leaves validation to the server", async () => {
    api.state.kit = { version: 'newer', schema: { sections: { Marquee: {} } }, guide: '# Server guide\n' };
    try {
      const pulled = await quiet(() => main(['theme', 'pull', '--dir', dir]));
      assert.match(pulled.logs, /older than the server/);
      assert.equal(await readFile(join(dir, '.jump/AGENTS.md'), 'utf8'), '# Server guide\n');
      assert.equal(JSON.parse(await readFile(join(dir, '.jump/schema.json'), 'utf8')).version, 'newer');
      await writeFile(join(dir, 'documents/home.json'), JSON.stringify({ root: { props: {} }, content: [{ type: 'Marquee', props: { id: 'x' } }] }));
      const { logs } = await quiet(() => main(['theme', 'check', '--dir', dir]));
      assert.match(logs, /No errors/);
    } finally {
      api.state.kit = null;
      await quiet(() => main(['theme', 'pull', '--dir', dir]));
    }
  });

  it('dev: creates the development theme, carries the folder over, prints a preview link', async () => {
    await writeFile(join(dir, 'documents/home.json'), JSON.stringify(home('Retro night')));
    const pending = quiet(() => main(['theme', 'dev', '--dir', dir]));
    await new Promise((r) => setTimeout(r, 300));
    process.emit('SIGINT');
    const { logs } = await pending;
    assert.match(logs, /Creating your development theme "Development \(dev@river\.test\)"/);
    assert.match(logs, /preview\?token=dev/);
    const lock = await readLock(dir);
    assert.deepEqual([lock.themeId, lock.role], ['dev', 'UNPUBLISHED']);
    assert.deepEqual(api.state.themes.dev.docs.home[0], home('Retro night'));
    assert.deepEqual(api.state.themes.live.docs.home[0], home('Live'), 'the live theme is untouched');
  });

  it('push sends only the files that changed, with their versions', async () => {
    api.state.saves.length = 0;
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ social: { instagram: 'https://instagram.com/river' } }));
    const { code } = await quiet(() => main(['theme', 'push', '--dir', dir]));
    assert.equal(code, 0);
    assert.deepEqual(Object.keys(api.state.saves[0].body).sort(), ['settings', 'themeVersion']);
    const again = await quiet(() => main(['theme', 'push', '--dir', dir]));
    assert.match(again.logs, /Nothing changed/);
  });

  it('a stale folder gets a conflict message and nothing is written', async () => {
    api.state.themes.dev.version += 1; // someone saved in the editor
    await writeFile(join(dir, 'content.json'), JSON.stringify({}) + ' ');
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ social: { instagram: 'https://instagram.com/other' } }));
    const { code, logs } = await quiet(() => main(['theme', 'push', '--dir', dir]));
    assert.equal(code, 1);
    assert.match(logs, /changed on the server since your last pull/);
  });

  it('publish makes the draft live', async () => {
    const { logs } = await quiet(() => main(['theme', 'publish', '--yes', '--dir', dir]));
    assert.match(logs, /is live/);
    assert.equal(api.state.themes.dev.role, 'MAIN');
    assert.equal((await readLock(dir)).role, 'MAIN');
  });

  it('a deleted document file goes back to the preset default', () => {
    const lock = { themeVersion: 3, documents: { home: 4, events: 0 }, hashes: { settings: hashOf({}), content: hashOf({}), documents: { home: 'h', events: hashOf(events) } } };
    const body = changesFor(lock, { settings: {}, content: {}, documents: { events } });
    assert.deepEqual(body, { themeVersion: 3, documents: { home: { data: null, version: 4 } } });
  });
});
