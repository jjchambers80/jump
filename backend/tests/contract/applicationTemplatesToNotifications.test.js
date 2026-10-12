// Spec 053-D: 20261106120000_application_templates_to_notifications copies
// each ApplicationMessageTemplate row into NotificationTemplate under
// application.<event|standing>.<ACTION>, and keeps a row the store already
// saved there. Runs the migration's own SQL against the test database.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '@jump/db';

const sql = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/db/prisma/migrations/20261106120000_application_templates_to_notifications/migration.sql'),
  'utf8'
);
const insert = sql.slice(sql.indexOf('INSERT INTO'));

const TAG = `app-tpl-mig-${Date.now()}`;

describe('application templates → NotificationTemplate (spec 053-D)', () => {
  let org;

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    await prisma.applicationMessageTemplate.createMany({
      data: [
        { organizationId: org.id, scope: 'EVENT', action: 'APPROVED', subject: 'Old approved', body: 'Old body' },
        { organizationId: org.id, scope: 'STANDING', action: 'RECEIVED', subject: 'Old standing', body: 'Standing body' },
        { organizationId: org.id, scope: 'EVENT', action: 'REJECTED', subject: 'Old rejected', body: 'Old rejected body' },
      ],
    });
    // Already saved through the new table: the copy must not overwrite it.
    await prisma.notificationTemplate.create({ data: { organizationId: org.id, key: 'application.event.REJECTED', subject: 'New rejected', body: 'New body' } });
  });

  afterAll(async () => {
    await prisma.notificationTemplate.deleteMany({ where: { organizationId: org.id } });
    await prisma.applicationMessageTemplate.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('copies event and standing rows, keeps newer rows, and is safe to re-run', async () => {
    await prisma.$executeRawUnsafe(insert);
    await prisma.$executeRawUnsafe(insert);
    const rows = await prisma.notificationTemplate.findMany({ where: { organizationId: org.id }, orderBy: { key: 'asc' } });
    expect(rows.map((r) => [r.key, r.subject, r.body, r.enabled])).toEqual([
      ['application.event.APPROVED', 'Old approved', 'Old body', true],
      ['application.event.REJECTED', 'New rejected', 'New body', true],
      ['application.standing.RECEIVED', 'Old standing', 'Standing body', true],
    ]);
  });
});
