// Resolves the database URL the test suite runs against.
//
// Order of precedence:
//   1. TEST_DATABASE_URL (explicit)
//   2. DATABASE_URL from backend/.env with the database name replaced by
//      `jump_test`, so the suite reuses the developer's Postgres (host, port,
//      credentials) without touching their dev database
//   3. the historical default, postgres:postgres@localhost:5432/jump_test
//
// Shared by tests/setup.js (per test file) and tests/globalSetup.js (once).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const TEST_DB_NAME = 'jump_test';
const FALLBACK = `postgresql://postgres:postgres@localhost:5432/${TEST_DB_NAME}?schema=public`;

function readDotenvDatabaseUrl() {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
  if (!fs.existsSync(envPath)) return null;
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!line) return null;
  return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

export function withDatabaseName(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export function resolveTestDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const fromEnv = process.env.DATABASE_URL || readDotenvDatabaseUrl();
  if (fromEnv) {
    try {
      return withDatabaseName(fromEnv, TEST_DB_NAME);
    } catch {
      /* malformed; fall through */
    }
  }
  return FALLBACK;
}

/** Maintenance URL (database `postgres`) used to create the test database. */
export function maintenanceUrl(testUrl) {
  return withDatabaseName(testUrl, 'postgres');
}

export { TEST_DB_NAME };
