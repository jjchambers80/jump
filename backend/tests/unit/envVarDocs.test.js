// docs/wiki/config/environment-variables.md calls itself the complete
// reference. Before this test it was not: it had gone 18 days without an
// update while 33 variables were added, 7 of them documented nowhere at all,
// and it still told new contributors the backend ran on port 3000.
//
// A reference nobody is forced to update becomes a trap, so this scans the
// source for `process.env.X` and fails when a name is missing from the page.
// The failure message is the whole point: it names the variable and the file
// that reads it.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '../../..');

const DOC = path.join(repo, 'docs/wiki/config/environment-variables.md');

/** Trees whose `process.env` reads are product code a contributor must configure. */
const ROOTS = ['backend/src', 'packages', 'frontend/src'];
/** Individual files outside those trees that still read the environment. */
const FILES = ['frontend/next.config.mjs'];

const SOURCE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const READ = /process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    // `generated` is the gitignored Prisma client: vendor code, not our env reads.
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist' || entry === 'generated') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE_EXT.has(path.extname(entry))) out.push(full);
  }
  return out;
}

/** Every env var the code reads statically -> the repo-relative files reading it. */
function readsByVariable() {
  const found = new Map();
  const files = [
    ...ROOTS.flatMap((root) => sourceFiles(path.join(repo, root))),
    ...FILES.map((file) => path.join(repo, file)),
  ];
  for (const file of files) {
    const rel = path.relative(repo, file);
    for (const match of readFileSync(file, 'utf8').matchAll(READ)) {
      const name = match[1] || match[2];
      if (!found.has(name)) found.set(name, new Set());
      found.get(name).add(rel);
    }
  }
  return found;
}

describe('environment variable documentation', () => {
  const doc = readFileSync(DOC, 'utf8');
  const reads = readsByVariable();

  it('finds the env reads it is supposed to be checking', () => {
    // Guards the scan itself: a refactor that moves or renames these trees
    // would otherwise leave an empty scan passing forever.
    expect(reads.size).toBeGreaterThan(50);
    expect(reads.has('DATABASE_URL')).toBe(true);
    expect(reads.has('STRIPE_SECRET_KEY')).toBe(true);
  });

  it('documents every variable the code reads', () => {
    const undocumented = [...reads.entries()]
      .filter(([name]) => !doc.includes(`\`${name}\``))
      .map(([name, files]) => `${name} (read in ${[...files].sort().join(', ')})`)
      .sort();

    // Jest's expect takes no message argument, so name the missing ones here.
    if (undocumented.length > 0) {
      throw new Error(`Add these to docs/wiki/config/environment-variables.md:\n  ${undocumented.join('\n  ')}`);
    }
  });

  it('records the backend dev port as 3002, the value server.js defaults to', () => {
    // The page told contributors 3000 for months. `stripe listen --forward-to`
    // and NEXT_PUBLIC_API_URL are both copied off it, so a wrong port here is
    // a silently broken local setup rather than an obvious error.
    const server = readFileSync(path.join(repo, 'backend/src/api/server.js'), 'utf8');
    expect(server).toContain('process.env.PORT || 3002');
    expect(doc).not.toMatch(/localhost:3000/);
  });
});
