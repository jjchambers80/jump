// A theme on disk (spec 043):
//
//   jump.theme.json        lock: store, theme id, versions and content hashes as pulled
//   settings.json          theme settings (overrides of the preset)
//   content.json           default-content overrides
//   documents/<key>.json   one Puck document per key (header, footer, home, events, …)
//   .jump/schema.json      every section, block, field and limit the server accepts
//   AGENTS.md, CLAUDE.md   instructions for AI coding assistants (written once, never overwritten)
//
// The lock's hashes say what changed since the pull, so a push sends only
// those keys with the versions they were pulled at (409 if someone else saved).

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { themeSchema } from '@jump/theme';

export const LOCK = 'jump.theme.json';
const KEY_RE = /^[a-z_]+(:[A-Za-z0-9_-]+)?$/;

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export const hashOf = (value) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`${path}: ${error.message}`);
  }
}

export async function readLock(dir) {
  const lock = await readJson(join(dir, LOCK), null);
  if (!lock) throw new Error(`No ${LOCK} here. Run \`jump theme pull\` first.`);
  return lock;
}

export const writeLock = (dir, lock) => writeFile(join(dir, LOCK), json(lock));

/** settings, content and every document file in the folder. */
export async function readTheme(dir) {
  const documents = {};
  const docDir = join(dir, 'documents');
  const files = await readdir(docDir).catch(() => []);
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    const key = file.slice(0, -5);
    if (KEY_RE.test(key)) documents[key] = await readJson(join(docDir, file));
  }
  return {
    settings: await readJson(join(dir, 'settings.json'), {}),
    content: await readJson(join(dir, 'content.json'), {}),
    documents,
  };
}

/** Write a pulled theme and its lock. Document files not on the server are removed. */
export async function writeTheme(dir, { store, theme, settings, content, documents }) {
  await mkdir(join(dir, 'documents'), { recursive: true });
  await writeFile(join(dir, 'settings.json'), json(settings));
  await writeFile(join(dir, 'content.json'), json(content));
  const existing = (await readdir(join(dir, 'documents'))).filter((f) => f.endsWith('.json'));
  for (const file of existing) if (!(file.slice(0, -5) in documents)) await rm(join(dir, 'documents', file));
  for (const [key, doc] of Object.entries(documents)) await writeFile(join(dir, 'documents', `${key}.json`), json(doc.data));
  const lock = {
    store,
    themeId: theme.id,
    themeName: theme.name,
    role: theme.role,
    presetKey: theme.presetKey,
    themeVersion: theme.version,
    documents: Object.fromEntries(Object.entries(documents).map(([key, doc]) => [key, doc.version])),
    hashes: {
      settings: hashOf(settings),
      content: hashOf(content),
      documents: Object.fromEntries(Object.entries(documents).map(([key, doc]) => [key, hashOf(doc.data)])),
    },
  };
  await writeLock(dir, lock);
  return lock;
}

/**
 * The /save body for what changed since the pull, or null when nothing did.
 * A deleted document file is sent as `data: null` (back to the preset default).
 * `all` sends everything (first push to another theme).
 */
export function changesFor(lock, local, { all = false } = {}) {
  const body = { themeVersion: lock.themeVersion };
  if (all || hashOf(local.settings) !== lock.hashes.settings) body.settings = local.settings;
  if (all || hashOf(local.content) !== lock.hashes.content) body.content = local.content;
  const documents = {};
  for (const [key, data] of Object.entries(local.documents)) {
    if (all || hashOf(data) !== lock.hashes.documents[key]) documents[key] = { data, version: lock.documents[key] ?? 0 };
  }
  for (const key of Object.keys(lock.documents)) {
    if (!(key in local.documents) && lock.documents[key] > 0) documents[key] = { data: null, version: lock.documents[key] };
  }
  if (Object.keys(documents).length) body.documents = documents;
  return Object.keys(body).length > 1 ? body : null;
}

/** The lock after a successful save of `body`. */
export function lockAfterSave(lock, local, body, result) {
  const next = structuredClone(lock);
  next.themeVersion = result.theme.version;
  if (body.settings !== undefined) next.hashes.settings = hashOf(local.settings);
  if (body.content !== undefined) next.hashes.content = hashOf(local.content);
  for (const [key, version] of Object.entries(result.documents ?? {})) {
    if (body.documents[key].data === null) {
      delete next.documents[key];
      delete next.hashes.documents[key];
    } else {
      next.documents[key] = version;
      next.hashes.documents[key] = hashOf(local.documents[key]);
    }
  }
  return next;
}

export { checkTheme } from '@jump/theme';

const AGENTS_MD = `# Jump theme

This folder is an Eventimus (Jump) online store theme, pulled with the Jump CLI.
Edit the JSON files to change the store's look and content, then push them.

## Files

- \`settings.json\`: theme settings (colors, fonts, layout, social links). Only the values that differ from the preset.
- \`content.json\`: overrides of the storefront's default wording.
- \`documents/<key>.json\`: one page layout each (\`header\`, \`footer\`, \`home\`, \`events\`). Each is \`{ root: { props }, content: [ { type, props } ] }\`.
- \`.jump/schema.json\`: every section and block type, its fields (kind, options, max length) and the limits. **Use only what it lists.**
- \`jump.theme.json\`: the lock (theme id, versions). Never edit it.

## Rules

1. Edit only \`settings.json\`, \`content.json\` and \`documents/*.json\`. There is no CSS, HTML, script or template code to edit, and none is accepted.
2. Every section needs a unique \`props.id\`. Sections marked \`locked\` in the schema (Header, Footer, EventList) must stay in their document.
3. Images are \`{ "fileId": "<id>", "alt": "…" }\` references to files already uploaded in Content › Files. Never invent a fileId; leave an image unset if you have none. Every image needs \`alt\` text or \`"decorative": true\`.
4. Widths: the theme's page width is \`settings.json\` \`layout.pageWidth\` (1000-1600 px). A page can override it with \`root.props.pageWidth\` in its document. Each section takes \`props.sectionWidth\`: \`page\` (default), \`narrow\`, \`wide\` or \`full\` (edge to edge).
5. Rich text fields take simple HTML (p, strong, em, a, ul, ol, li, h2-h4); the server sanitises it.
6. After every change run \`jump theme check\` and fix every error before pushing.
7. Push with \`jump theme push\` to the development theme and check the preview link. Never push or publish to the live theme (\`--live\`, \`jump theme publish\`) unless the user explicitly asks.

## Commands

\`\`\`
jump theme check     # validate locally, like the server does
jump theme dev       # push to your development theme on every change, print the preview link
jump theme push      # push changed files to the theme in jump.theme.json
jump theme preview   # a fresh preview link
jump theme publish   # make this theme live (asks first)
\`\`\`
`;

/** Agent instructions and the schema. The instructions are written only once. */
export async function writeAgentKit(dir) {
  await mkdir(join(dir, '.jump'), { recursive: true });
  await writeFile(join(dir, '.jump', 'schema.json'), json(themeSchema()));
  const written = [];
  for (const [name, body] of [
    ['AGENTS.md', AGENTS_MD],
    ['CLAUDE.md', '@AGENTS.md\n'],
  ]) {
    try {
      await writeFile(join(dir, name), body, { flag: 'wx' });
      written.push(name);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  return written;
}
