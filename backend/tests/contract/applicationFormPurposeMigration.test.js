// Spec 050 §6.2: the backfill step of 20261101110000_application_form_purpose
// maps form names to a purpose with the old GetInvolved.tsx patterns. Runs the
// migration's own UPDATE against the migrated test database, scoped to this
// test's organization so parallel suites keep their rows.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '@jump/db';

const sqlFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/prisma/migrations/20261101110000_application_form_purpose/migration.sql'
);
const sql = fs.readFileSync(sqlFile, 'utf8');
const ANCHOR = `WHERE "purpose" = 'OTHER';`;
const backfill = sql.slice(sql.indexOf('UPDATE "ApplicationForm"'));

const TAG = `purpose-mig-${Date.now()}`;

// [name, kind, event form?, expected purpose]
const FIXTURES = [
  ['2026 Game and Geek Vendor Application', 'PAID', true, 'VENDOR'],
  ['Artist Alley', 'FREE', true, 'VENDOR'],
  ['Exhibitor booths', 'PAID', true, 'VENDOR'],
  ['Sponsorship Packages', 'PAID', true, 'SPONSOR'],
  ['Press & Media', 'FREE', true, 'PRESS'],
  ['Social MEDIA creators', 'FREE', true, 'PRESS'],
  ['Panel proposals', 'FREE', true, 'PANEL'],
  ['Speaker call', 'FREE', true, 'PANEL'],
  ['Volunteer crew', 'FREE', true, 'VOLUNTEER'],
  ['Celebrity guests', 'FREE', true, 'SPECIAL_GUEST'],
  ['Talent signup', 'FREE', true, 'SPECIAL_GUEST'],
  ['Vendor sponsor combo', 'PAID', true, 'VENDOR'], // first match wins
  ['Food trucks', 'PAID', true, 'VENDOR'], // unmatched PAID event form
  ['Cosplay contest', 'FREE', true, 'OTHER'],
  ['Volunteer parking pass', 'PAID', true, 'VENDOR'], // FREE-only purpose: PAID falls through
  ['Celebrity photo ops', 'PAID', true, 'VENDOR'],
  ['Become a volunteer', 'FREE', false, 'VOLUNTEER'], // standing form, same rules
  ['General inquiries', 'FREE', false, 'OTHER'],
];

describe('application form purpose backfill (spec 050 §6.2)', () => {
  let org;
  const ids = [];

  beforeAll(async () => {
    expect(backfill.trim().endsWith(ANCHOR)).toBe(true);
    org = await prisma.organization.create({ data: { name: TAG } });
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC' } });
    const event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date('2027-09-18T15:00:00Z'), capacity: 10 } });
    for (const [i, [name, kind, onEvent]] of FIXTURES.entries()) {
      const form = await prisma.applicationForm.create({
        data: { organizationId: org.id, eventId: onEvent ? event.id : null, kind, name, slug: `f-${i}` },
      });
      ids.push(form.id);
    }
    // A purpose already set is never overwritten.
    await prisma.applicationForm.update({ where: { id: ids[0] }, data: { purpose: 'SPONSOR' } });
    await prisma.$executeRawUnsafe(backfill.replace(ANCHOR, `WHERE "purpose" = 'OTHER' AND "organizationId" = '${org.id}';`));
  });

  afterAll(async () => {
    await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } });
    await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } });
    await prisma.venue.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('maps each fixture name to its purpose', async () => {
    const rows = await prisma.applicationForm.findMany({ where: { id: { in: ids } }, select: { id: true, purpose: true } });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.purpose]));
    const expected = FIXTURES.map(([name, , , purpose], i) => [name, i === 0 ? 'SPONSOR' : purpose]);
    expect(ids.map((id, i) => [FIXTURES[i][0], byId[id]])).toEqual(expected);
  });
});
