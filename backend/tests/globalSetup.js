// Jest global setup: make sure the test database exists and is migrated.
// Runs once per `npm test`, before any test file. Skip with SKIP_TEST_DB_SETUP=1
// (CI that provisions the database itself).

import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveTestDatabaseUrl, maintenanceUrl, TEST_DB_NAME } from './testDatabase.js';

const dbPackageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../packages/db');

// No shell: arguments are passed as an array, so URLs never hit a command line.
function prisma(args, databaseUrl, input) {
  return execFileSync('npx', ['prisma', ...args], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).toString();
}

export default async function globalSetup() {
  if (process.env.SKIP_TEST_DB_SETUP) return;

  const testUrl = resolveTestDatabaseUrl();
  process.env.TEST_DATABASE_URL = testUrl; // so test files agree with this run

  try {
    prisma(['migrate', 'deploy'], testUrl);
  } catch (error) {
    const out = `${error.stdout || ''}${error.stderr || ''}`;
    if (!/does not exist|P1003/.test(out)) {
      throw new Error(`prisma migrate deploy failed for ${testUrl}:\n${out}`);
    }
    // Database missing: create it via the maintenance database, then migrate.
    prisma(['db', 'execute', '--stdin', '--url', maintenanceUrl(testUrl)], testUrl, `CREATE DATABASE "${TEST_DB_NAME}";`);
    prisma(['migrate', 'deploy'], testUrl);
  }
}
