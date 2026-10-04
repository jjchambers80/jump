// Spec 039 card 039A: `npm run db:backfill:039-space-selection` against real
// rows. A PAID form whose event has a published map with booths on its tiers
// becomes MAP; everything else stays TIERS; a dry run writes nothing and a
// second run is a no-op.

const { prisma } = await import('@jump/db');
const { run } = await import('../../src/scripts/backfill-039-space-selection.js');

const TAG = `bf039-${Date.now()}`;

describe('Space selection backfill (spec 039)', () => {
  let org;
  const events = [];
  const forms = {};
  const log = () => {};

  async function eventWithForm(key, { kind = 'PAID', mapStatus = null, bindBooth = true } = {}) {
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} ${key}`, address: '1 Main', city: 'Raleigh', state: 'NC' } });
    const event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} ${key}`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } });
    events.push(event);
    const form = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: event.id, kind, name: key, slug: `${TAG}-${key}`, status: 'OPEN' } });
    const tier = await prisma.applicationTier.create({ data: { formId: form.id, name: 'Booth', price: 200, quantityTotal: 5 } });
    if (mapStatus) {
      const map = await prisma.floorMap.create({
        data: { organizationId: org.id, eventId: event.id, name: 'Hall', status: mapStatus, width: 40, height: 40, layout: { version: 1, elements: [] } },
      });
      await prisma.booth.create({ data: { mapId: map.id, label: 'A1', x: 0, y: 0, w: 5, h: 5, tierId: bindBooth ? tier.id : null } });
    }
    forms[key] = form;
  }

  const modeOf = async (key) => (await prisma.applicationForm.findUnique({ where: { id: forms[key].id }, select: { spaceSelection: true } })).spaceSelection;
  const ours = () => Object.values(forms).map((f) => f.id);

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    await eventWithForm('mapped', { mapStatus: 'PUBLISHED' });
    await eventWithForm('draftMap', { mapStatus: 'DRAFT' });
    await eventWithForm('unbound', { mapStatus: 'PUBLISHED', bindBooth: false });
    await eventWithForm('noMap');
    await eventWithForm('free', { kind: 'FREE', mapStatus: 'PUBLISHED' });
  });

  afterAll(async () => {
    const eventIds = events.map((e) => e.id);
    await prisma.booth.deleteMany({ where: { map: { eventId: { in: eventIds } } } });
    await prisma.floorMap.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.applicationForm.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.venue.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  });

  it('defaults every form to TIERS', async () => {
    for (const key of Object.keys(forms)) expect(await modeOf(key)).toBe('TIERS');
  });

  it('dry run reports the map-selling form and writes nothing', async () => {
    const result = await run({ dryRun: true, log, formIds: ours() });
    expect(result).toEqual({ checked: 1, moved: 0 });
    expect(await modeOf('mapped')).toBe('TIERS');
  });

  it('sets only a PAID form with booths on a published map to MAP', async () => {
    const result = await run({ dryRun: false, log, formIds: ours() });
    expect(result).toEqual({ checked: 1, moved: 1 });
    expect(await modeOf('mapped')).toBe('MAP');
    for (const key of ['draftMap', 'unbound', 'noMap', 'free']) expect(await modeOf(key)).toBe('TIERS');
  });

  it('is idempotent', async () => {
    expect(await run({ dryRun: false, log, formIds: ours() })).toEqual({ checked: 0, moved: 0 });
  });
});
