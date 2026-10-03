// Jump CLI commands (spec 043). The developer loop from roman's Shopify
// workflow: login → pull → edit (by hand or by prompting an AI assistant) →
// check → push to a development theme → preview → publish.

import { watch } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { readCredentials, storeCredentials, writeCredentials } from './config.js';
import { ApiError, client } from './client.js';
import { login } from './login.js';
import { LOCK, changesFor, checkTheme, lockAfterSave, readLock, readTheme, writeAgentKit, writeLock, writeTheme } from './themeDir.js';

const DEFAULT_APP_URL = process.env.JUMP_APP_URL || 'http://localhost:3001';
const DEFAULT_API_URL = process.env.JUMP_API_URL || 'http://localhost:3000';
const NAME_MAX = 50;

const HELP = `Usage: jump <command> [options]

  login --store <slug>       Sign in through the browser (--app-url, --api-url)
  logout [--store <slug>]    Revoke this computer's sign-in
  whoami

  theme list                 Themes of the store
  theme pull [--theme <id> | --live]
                             Write the theme into this folder as JSON files
  theme check                Validate the files like the server does
  theme push [--live] [--allow-live]
                             Push changed files to the theme in jump.theme.json
  theme dev                  Use your development theme, push on every change
  theme preview [--share]    Print a preview link for the draft theme
  theme publish [--yes]      Make the theme in jump.theme.json live

Options: --dir <path> (default: current folder), --store <slug>
`;

const OPTIONS = {
  store: { type: 'string' },
  'app-url': { type: 'string' },
  'api-url': { type: 'string' },
  theme: { type: 'string' },
  dir: { type: 'string' },
  live: { type: 'boolean' },
  'allow-live': { type: 'boolean' },
  share: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  help: { type: 'boolean', short: 'h' },
};

/** Ask a yes/no or "type X to confirm" question; never on a non-interactive terminal. */
async function confirm(question, expected = 'y') {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim().toLowerCase() === expected.toLowerCase();
  } finally {
    rl.close();
  }
}

function printErrors(errors) {
  for (const [path, message] of Object.entries(errors)) console.error(`  ${path}: ${message}`);
}

/** Store credentials for this folder (the lock's store wins over the last login). */
async function session(values, dir) {
  const lockStore = await readLock(dir).then((l) => l.store).catch(() => null);
  const creds = await storeCredentials(values.store || lockStore);
  return { creds, call: client(creds) };
}

async function getTheme(call, themeId) {
  const detail = await call('GET', `/admin/themes/${themeId}`);
  const documents = {};
  for (const { key } of detail.documents) {
    const doc = await call('GET', `/admin/themes/${themeId}/documents/${encodeURIComponent(key)}`);
    documents[key] = { data: doc.data, version: doc.version };
  }
  return { theme: detail, settings: detail.settings ?? {}, content: detail.content ?? {}, documents };
}

async function pull(call, store, dir, themeId) {
  const pulled = await getTheme(call, themeId);
  const lock = await writeTheme(dir, { store, ...pulled });
  const kit = await writeAgentKit(dir);
  return { lock, kit };
}

/** Push what changed; returns the new lock, or the old one when nothing changed. */
async function push(call, dir, lock, { all = false, quiet = false } = {}) {
  const local = await readTheme(dir);
  const errors = checkTheme(local, lock.presetKey);
  if (Object.keys(errors).length) {
    console.error('Not pushed: fix these first (`jump theme check`):');
    printErrors(errors);
    return null;
  }
  const body = changesFor(lock, local, { all });
  if (!body) {
    if (!quiet) console.log('Nothing changed since the last pull or push.');
    return lock;
  }
  try {
    const result = await call('PUT', `/admin/themes/${lock.themeId}/save`, body);
    const next = lockAfterSave(lock, local, body, result);
    await writeLock(dir, next);
    console.log(`Pushed ${result.changedKeys.join(', ')} to ${lock.themeName}.`);
    return next;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'THEME_CONFLICT') {
      console.error(`${lock.themeName} changed on the server since your last pull. Commit or copy your edits, then run \`jump theme pull\`.`);
      return null;
    }
    if (error instanceof ApiError && error.details?.errors) {
      console.error('The server refused the push:');
      printErrors(error.details.errors);
      return null;
    }
    throw error;
  }
}

async function devThemeFor(call, creds) {
  const { themes } = await call('GET', '/admin/themes');
  const name = `Development (${creds.email})`.slice(0, NAME_MAX);
  const existing = themes.find((t) => t.role !== 'MAIN' && t.name === name);
  if (existing) return existing;
  const live = themes.find((t) => t.role === 'MAIN');
  console.log(`Creating your development theme "${name}" from ${live.name}…`);
  return call('POST', `/admin/themes/${live.id}/duplicate`, { name });
}

async function previewLink(call, themeId, share = false) {
  return call('POST', `/admin/themes/${themeId}/preview-link`, { share });
}

const commands = {
  async login(values) {
    if (!values.store) throw new Error('jump login --store <your store slug>');
    const appUrl = (values['app-url'] || DEFAULT_APP_URL).replace(/\/$/, '');
    const apiUrl = (values['api-url'] || DEFAULT_API_URL).replace(/\/$/, '');
    const result = await login({ store: values.store, appUrl, apiUrl });
    const credentials = await readCredentials();
    const key = result.organization.slug || values.store;
    credentials.stores[key] = {
      appUrl,
      apiUrl,
      organizationId: result.organization.id,
      organizationName: result.organization.name,
      email: result.user.email,
      token: result.token,
      expiresAt: result.expiresAt,
    };
    credentials.current = key;
    await writeCredentials(credentials);
    console.log(`Signed in to ${result.organization.name} as ${result.user.email} (until ${result.expiresAt.slice(0, 10)}).`);
  },

  async logout(values) {
    const creds = await storeCredentials(values.store);
    await client(creds)('DELETE', '/developer/token').catch(() => {});
    const credentials = await readCredentials();
    delete credentials.stores[creds.key];
    if (credentials.current === creds.key) credentials.current = Object.keys(credentials.stores)[0] ?? null;
    await writeCredentials(credentials);
    console.log(`Signed out of ${creds.organizationName}.`);
  },

  async whoami(values) {
    const creds = await storeCredentials(values.store);
    const me = await client(creds)('GET', '/developer/me');
    console.log(`${me.user.email} on ${creds.organizationName} (${creds.key}) via ${creds.apiUrl}`);
  },

  async 'theme list'(values, dir) {
    const { call } = await session(values, dir);
    const { themes } = await call('GET', '/admin/themes');
    for (const t of themes) console.log(`${t.role === 'MAIN' ? 'live ' : 'draft'}  ${t.id}  ${t.name}`);
  },

  async 'theme pull'(values, dir) {
    const { creds, call } = await session(values, dir);
    let themeId = values.theme;
    if (!themeId && !values.live) themeId = await readLock(dir).then((l) => l.themeId).catch(() => null);
    if (!themeId) themeId = (await call('GET', '/admin/themes')).themes.find((t) => t.role === 'MAIN').id;
    const { lock, kit } = await pull(call, creds.key, dir, themeId);
    console.log(`Pulled ${lock.themeName} (${lock.role === 'MAIN' ? 'live' : 'draft'}) into ${dir}.`);
    if (kit.length) console.log(`Wrote ${kit.join(' and ')} for AI assistants; .jump/schema.json lists every section and field.`);
  },

  async 'theme check'(values, dir) {
    const lock = await readLock(dir);
    const errors = checkTheme(await readTheme(dir), lock.presetKey);
    if (!Object.keys(errors).length) return console.log('No errors.');
    console.error(`${Object.keys(errors).length} error(s):`);
    printErrors(errors);
    return 1;
  },

  async 'theme push'(values, dir) {
    const { creds, call } = await session(values, dir);
    const lock = await readLock(dir);
    if (lock.role === 'MAIN' || values.live) {
      if (!values.live) throw new Error(`${lock.themeName} is your live theme. Use \`jump theme dev\` to push to a draft, or pass --live.`);
      const sure =
        values['allow-live'] ||
        (await confirm(`This changes your live store at once. Type the store (${creds.key}) to continue: `, creds.key));
      if (!sure) throw new Error('Not pushed.');
    }
    return (await push(call, dir, lock)) ? 0 : 1;
  },

  async 'theme dev'(values, dir) {
    const { creds, call } = await session(values, dir);
    const dev = await devThemeFor(call, creds);
    let lock = await readLock(dir).catch(() => null);
    if (!lock) {
      ({ lock } = await pull(call, creds.key, dir, dev.id));
    } else if (lock.themeId !== dev.id) {
      // Carry the folder onto the development theme: its versions, every file sent once.
      const detail = await call('GET', `/admin/themes/${dev.id}`);
      lock = {
        ...lock,
        themeId: dev.id,
        themeName: dev.name,
        role: 'UNPUBLISHED',
        themeVersion: detail.version,
        documents: Object.fromEntries(detail.documents.map((d) => [d.key, d.version])),
      };
      lock = (await push(call, dir, lock, { all: true })) ?? lock;
      await writeLock(dir, lock);
    }
    await push(call, dir, lock, { quiet: true }).then((next) => next && (lock = next));
    const { url, expiresAt } = await previewLink(call, dev.id);
    console.log(`\nPreview ${dev.name} (link valid until ${new Date(expiresAt).toLocaleTimeString()}):\n  ${url}\n`);
    console.log('Watching for changes. Ctrl+C to stop.');

    let timer;
    let running = Promise.resolve();
    const watcher = watch(dir, { recursive: true }, (event, file) => {
      if (!file || file.startsWith('.jump') || file === LOCK || !file.endsWith('.json')) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        running = running.then(async () => {
          const next = await push(call, dir, lock, { quiet: true }).catch((e) => console.error(e.message));
          if (next) lock = next;
        });
      }, 500);
    });
    await new Promise((resolve) => process.once('SIGINT', resolve));
    watcher.close();
  },

  async 'theme preview'(values, dir) {
    const { call } = await session(values, dir);
    const lock = await readLock(dir);
    if (lock.role === 'MAIN') throw new Error(`${lock.themeName} is live: open your store instead.`);
    const { url, expiresAt } = await previewLink(call, lock.themeId, values.share);
    console.log(`${url}\n(expires ${new Date(expiresAt).toLocaleString()}${values.share ? '; store password still applies' : ''})`);
  },

  async 'theme publish'(values, dir) {
    const { call } = await session(values, dir);
    const lock = await readLock(dir);
    const themeId = values.theme || lock.themeId;
    if (!values.yes && !(await confirm(`Publish ${lock.themeName}? It replaces your live theme at once. [y/N] `))) {
      throw new Error('Not published.');
    }
    const theme = await call('POST', `/admin/themes/${themeId}/publish`);
    if (themeId === lock.themeId) await writeLock(dir, { ...lock, role: 'MAIN' });
    console.log(`${theme.name} is live.`);
  },
};

export async function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const name = positionals[0] === 'theme' ? `theme ${positionals[1] ?? ''}` : positionals[0];
  const command = commands[name];
  if (values.help || !command) {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }
  return command(values, values.dir || process.cwd());
}
