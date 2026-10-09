// Spec 047 D0-C: the Order.organizationId migration runs against a scratch
// database at the schema just before it, seeded with ticket and application
// orders at two organizations. Asserts the backfill, the in-migration
// verification, the CHECK on event-less TICKET / APPLICATION orders and the
// trigger that fills organizationId on raw inserts. Real Postgres; nothing mocked.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@jump/db';
import { resolveTestDatabaseUrl, maintenanceUrl, withDatabaseName } from '../testDatabase.js';
import { executeSqlFile } from '../../src/scripts/backfill-application-orders.js';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/prisma/migrations'
);
const MIGRATION = '20261029110000_order_organization';
const SCRATCH_DB = 'jump_test_047_order_org';

describe('Order.organizationId migration (spec 047 D0-C)', () => {
  const scratchUrl = withDatabaseName(resolveTestDatabaseUrl(), SCRATCH_DB);
  let db;

  const execute = (sql) =>
    execFileSync('npx', ['prisma', 'db', 'execute', '--stdin', '--url', maintenanceUrl(scratchUrl)], {
      cwd: path.resolve(migrationsDir, '../..'),
      input: sql,
      env: { ...process.env, DATABASE_URL: scratchUrl },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

  /** Org + venue + event + contact, raw SQL against the pre-047 schema. */
  async function seedOrg(key) {
    const now = new Date();
    await db.$executeRawUnsafe(`INSERT INTO "Organization" ("id", "name", "slug", "createdAt", "updatedAt") VALUES ($1, $1, $1, $2, $2)`, `org-${key}`, now);
    await db.$executeRawUnsafe(`INSERT INTO "Venue" ("id", "organizationId", "name", "address", "slug", "createdAt", "updatedAt") VALUES ($1, $2, 'Hall', '1 Main St', $1, $3, $3)`, `venue-${key}`, `org-${key}`, now);
    await db.$executeRawUnsafe(`INSERT INTO "Event" ("id", "venueId", "name", "slug", "date", "capacity", "createdAt", "updatedAt") VALUES ($1, $2, 'Show', $1, $3, 100, $3, $3)`, `event-${key}`, `venue-${key}`, now);
    await db.$executeRawUnsafe(`INSERT INTO "Contact" ("id", "organizationId", "email", "firstName", "lastName", "createdAt", "updatedAt") VALUES ($1, $2, 'buyer@example.com', 'B', 'Uyer', $3, $3)`, `contact-${key}`, `org-${key}`, now);
  }

  const insertOrder = (id, kind, eventId, contactId, extra = '') =>
    db.$executeRawUnsafe(
      `INSERT INTO "Order" ("id", "kind", "eventId", "contactId", "orderRef", "totalAmount", "quantity", "updatedAt"${extra ? ', "organizationId"' : ''})
       VALUES ($1, $2::"OrderKind", $3, $4, $1, 10, 1, now()${extra ? `, '${extra}'` : ''})`,
      id,
      kind,
      eventId,
      contactId
    );

  beforeAll(async () => {
    execute(`DROP DATABASE IF EXISTS "${SCRATCH_DB}";`);
    execute(`CREATE DATABASE "${SCRATCH_DB}";`);
    const names = fs.readdirSync(migrationsDir).filter((n) => /^\d{14}_/.test(n)).sort();
    for (const name of names) {
      if (name >= MIGRATION) break;
      executeSqlFile(path.join(migrationsDir, name, 'migration.sql'), scratchUrl);
    }
    db = new PrismaClient({ datasourceUrl: scratchUrl });
    for (const key of ['a', 'b']) {
      await seedOrg(key);
      await insertOrder(`ticket-${key}`, 'TICKET', `event-${key}`, `contact-${key}`);
      await insertOrder(`app-${key}`, 'APPLICATION', `event-${key}`, `contact-${key}`);
    }
    executeSqlFile(path.join(migrationsDir, MIGRATION, 'migration.sql'), scratchUrl);
  }, 240_000);

  afterAll(async () => {
    await db?.$disconnect();
    execute(`DROP DATABASE IF EXISTS "${SCRATCH_DB}";`);
  });

  it('backfills each ticket and application order with its event’s organization', async () => {
    const rows = await db.$queryRawUnsafe(`SELECT "id", "organizationId" FROM "Order" ORDER BY "id"`);
    expect(rows).toEqual([
      { id: 'app-a', organizationId: 'org-a' },
      { id: 'app-b', organizationId: 'org-b' },
      { id: 'ticket-a', organizationId: 'org-a' },
      { id: 'ticket-b', organizationId: 'org-b' },
    ]);
  });

  it('refuses a TICKET or APPLICATION order without an event', async () => {
    for (const kind of ['TICKET', 'APPLICATION']) {
      await expect(insertOrder(`no-event-${kind}`, kind, null, 'contact-a', 'org-a')).rejects.toThrow(/Order_event_required_check/);
    }
  });

  it('fills organizationId from the event on a raw insert that omits it', async () => {
    await insertOrder('raw-b', 'TICKET', 'event-b', 'contact-b');
    const [row] = await db.$queryRawUnsafe(`SELECT "organizationId" FROM "Order" WHERE "id" = 'raw-b'`);
    expect(row.organizationId).toBe('org-b');
  });

  it('aborts when an order’s organization disagrees with its contact’s', async () => {
    // Re-run only the verification block of the migration against a bad row.
    await insertOrder('bad', 'TICKET', 'event-a', 'contact-b', 'org-a');
    const sql = fs.readFileSync(path.join(migrationsDir, MIGRATION, 'migration.sql'), 'utf8');
    const verify = sql.slice(sql.indexOf('DO $$'), sql.indexOf('$$;') + 3);
    await expect(db.$executeRawUnsafe(verify)).rejects.toThrow(/disagrees with Contact\.organizationId on 1 row/);
    await db.$executeRawUnsafe(`DELETE FROM "Order" WHERE "id" = 'bad'`);
  });
});
