// `jump login`: the loopback + PKCE sign-in (RFC 8252), like `shopify theme
// dev` or `gh auth login`. A one-shot listener on 127.0.0.1 receives the
// code from /admin/cli/authorize; the verifier never leaves this process.

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';

export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    /* the URL is printed too */
  }
}

const PAGE = (text) =>
  `<!doctype html><meta charset="utf-8"><title>Jump CLI</title><body style="font:16px system-ui;margin:4rem auto;max-width:32rem">${text}</body>`;

/** A one-shot listener on 127.0.0.1: `{ port, code }`, where `code` resolves on our /callback. */
async function startListener(state, timeoutMs) {
  let settle;
  const code = new Promise((resolve, reject) => (settle = { resolve, reject }));
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/callback') return res.writeHead(404).end();
    if (url.searchParams.get('state') !== state) return res.writeHead(400).end(PAGE('This sign-in does not match. Run jump login again.'));
    const finish = (text, outcome) => {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE(text));
      clearTimeout(timer);
      server.close();
      outcome();
    };
    if (url.searchParams.get('error')) {
      return finish('Sign-in cancelled. You can close this tab.', () => settle.reject(new Error('Sign-in was cancelled in the browser')));
    }
    const value = url.searchParams.get('code');
    if (!value) return res.writeHead(400).end(PAGE('Missing code.'));
    finish('Signed in. You can close this tab and return to your terminal.', () => settle.resolve(value));
  });
  const timer = setTimeout(() => {
    server.close();
    settle.reject(new Error('Timed out waiting for the browser sign-in'));
  }, timeoutMs);
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, code };
}

/**
 * Returns the token response from POST /developer/token. `openUrl` is
 * injectable so tests can play the browser.
 */
export async function login({ store, appUrl, apiUrl, openUrl = openBrowser, log = console.log, timeoutMs = 5 * 60 * 1000 }) {
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString('base64url');
  const { port, code } = await startListener(state, timeoutMs);
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const url = new URL('/admin/cli/authorize', appUrl);
  url.search = new URLSearchParams({
    store,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    name: `Jump CLI on ${hostname()}`.slice(0, 80),
  }).toString();
  log(`Opening your browser to approve this sign-in:\n  ${url}\n`);
  openUrl(url.toString());
  const res = await fetch(`${apiUrl}/developer/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: await code, codeVerifier: verifier, redirectUri }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `Sign-in failed (${res.status})`);
  return body;
}
