/**
 * Spec 024 backfill for databases kept in sync with `prisma db push` (dev).
 *
 * Production runs `prisma migrate deploy`, whose 20260930000000/0001
 * migrations add the order-side columns, copy every PAID-form application
 * into an Order (lines, payment, refunds) and drop the application-side
 * ledger. A `db push` database has no migration history, and `db push`
 * itself would drop the old columns without copying them — so run this
 * FIRST, then `db push` (which then finds nothing left to change).
 *
 * The script applies the same two migration files through `prisma db execute`,
 * so there is exactly one implementation of the backfill. It is idempotent:
 * once `Order.kind` exists it does nothing.
 *
 * Usage: cd backend && npm run db:backfill:024
 *   (reads DATABASE_URL from backend/.env)
 */

import 'dotenv/config';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '@jump/db';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPackageDir = path.resolve(here, '../../../packages/db');
const MIGRATIONS = ['20260930000000_application_orders_enums', '20260930000001_application_orders'];

export async function alreadyApplied(db = prisma) {
  const rows =
    await db.$queryRaw`SELECT 1 FROM information_schema.columns WHERE table_name = 'Order' AND column_name = 'kind'`;
  return rows.length > 0;
}

export function migrationFile(name) {
  const file = path.join(dbPackageDir, 'prisma', 'migrations', name, 'migration.sql');
  if (!fs.existsSync(file)) throw new Error(`Migration file missing: ${file}`);
  return file;
}

/** The Prisma CLI of this workspace (the root install), or `npx prisma` when not found. */
function prismaCli() {
  const bin = path.resolve(dbPackageDir, '../../node_modules/.bin/prisma');
  return fs.existsSync(bin) ? [bin] : ['npx', 'prisma'];
}

/** Apply one SQL file with `prisma db execute` (no shell; the URL never hits a command line). */
export function executeSqlFile(file, databaseUrl) {
  const [cmd, ...pre] = prismaCli();
  execFileSync(cmd, [...pre, 'db', 'execute', '--file', file, '--url', databaseUrl], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function run({ databaseUrl = process.env.DATABASE_URL, log = console.log } = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (await alreadyApplied()) {
    log('[024] Order.kind already exists — nothing to do');
    return { applied: false };
  }
  for (const name of MIGRATIONS) {
    log(`[024] applying ${name}`);
    executeSqlFile(migrationFile(name), databaseUrl);
  }
  const [{ count }] =
    await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "Order" WHERE "kind" = 'APPLICATION'`;
  log(`[024] done — ${count} application order(s)`);
  return { applied: true, applicationOrders: count };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error('[024] backfill failed:', error.message);
      await prisma.$disconnect();
      process.exit(1);
    });
}
