// A registration event's form intro moves to the event description, which the
// Name step now edits: only where the event has none, and only once.

const { prisma } = await import('@jump/db');
const { run } = await import('../../src/scripts/backfill-registration-intro.js');

const TAG = 'reg-intro-backfill-ct';
const quiet = () => {};

describe('backfill-registration-intro', () => {
  let org;
  let bare;
  let described;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main', city: 'Raleigh', state: 'NC' } });
    const date = new Date(Date.now() + 30 * 86_400_000);
    bare = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Makers`, date, type: 'REGISTRATION' } });
    described = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Crew`, date, type: 'REGISTRATION', description: '<p>Kept</p>' } });
    await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: bare.id, kind: 'FREE', name: 'Makers', slug: `${TAG}-a`, intro: 'Bring <your> best.\n\nTables provided.' } });
    await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: described.id, kind: 'FREE', name: 'Crew', slug: `${TAG}-b`, intro: 'Ignored' } });
  });

  afterAll(async () => {
    await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } });
    await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } });
    await prisma.venue.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  });

  it('copies the intro as sanitised HTML where the event has no description, once', async () => {
    await run({ dryRun: true, log: quiet });
    expect((await prisma.event.findUnique({ where: { id: bare.id } })).description).toBeNull();

    await run({ dryRun: false, log: quiet });
    const html = (await prisma.event.findUnique({ where: { id: bare.id } })).description;
    expect(html).toContain('Bring &lt;your&gt; best.');
    expect(html).toContain('Tables provided.');
    expect((await prisma.event.findUnique({ where: { id: described.id } })).description).toBe('<p>Kept</p>');

    await run({ dryRun: false, log: quiet });
    expect((await prisma.event.findUnique({ where: { id: bare.id } })).description).toBe(html);
  });
});
