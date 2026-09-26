// Spec 037 phase 4: `npm run db:backfill:037-add-ons` (plan §4.2 steps 1–7).
// Fixtures cover each rule — grouping across spellings, most recent spelling /
// description, most common price with a tie, scope / taxable conflicts
// (suffixed), same-event duplicates (reported, not merged), reuse of an
// existing saved add-on — plus the dry run and idempotency.

import request from 'supertest';
import { staffToken, joinOrgByToken } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { run, planAddOnDedupe, suffixedName } = await import('../../src/scripts/backfill-037-add-ons.js');

const TAG = 'addon-backfill-037';

describe('Saved add-ons backfill (spec 037 §4.2)', () => {
  let orgId;
  let e1;
  let e2;
  let e3;
  let vipProduct;
  const ids = {};
  const quiet = () => {};

  const at = (minutes) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
  const addOn = (eventId, name, fields) =>
    prisma.addOn.create({ data: { eventId, name, price: 10, scope: 'BOTH', taxable: true, ...fields } });

  beforeAll(async () => {
    const token = await staffToken({ role: 'ADMIN', email: `admin@${TAG}.test` });
    const auth = { Authorization: `Bearer ${token}` };
    const org = await request(app).post('/organizations').set(auth).send({ name: `${TAG} Org` });
    orgId = org.body.id;
    await joinOrgByToken(token, orgId, 'ADMIN');
    const venue = await request(app).post(`/organizations/${orgId}/venues`).set(auth).send({ name: `${TAG} Venue`, address: '1 Dedupe Rd' });
    const mk = async (name) =>
      (
        await request(app)
          .post(`/organizations/${orgId}/events`)
          .set(auth)
          .send({ venueId: venue.body.id, name, date: '2027-12-01T19:00:00.000Z', capacity: 10, category: 'music', priceTiers: [{ name: 'GA', price: 5, quantityTotal: 10 }] })
      ).body.id;
    e1 = await mk(`${TAG} 2024`);
    e2 = await mk(`${TAG} 2025`);
    e3 = await mk(`${TAG} 2026`);

    // Rule 2: most recent spelling + non-empty description, most common price.
    ids.power1 = (await addOn(e1, 'Booth power', { price: 125, scope: 'APPLICATION', taxable: false, description: 'Old desc', createdAt: at(1) })).id;
    ids.power2 = (await addOn(e2, ' booth Power ', { price: 125, scope: 'APPLICATION', taxable: false, description: null, createdAt: at(2) })).id;
    ids.power3 = (await addOn(e3, 'BOOTH POWER', { price: 150, scope: 'APPLICATION', taxable: false, description: 'Newest desc', createdAt: at(3) })).id;
    // Price tie → most recent; description falls back to the latest non-empty one.
    ids.badge1 = (await addOn(e1, 'Badge', { price: 10, scope: 'APPLICATION', description: 'Staff badge', createdAt: at(4) })).id;
    ids.badge2 = (await addOn(e2, 'Badge', { price: 12, scope: 'APPLICATION', description: '  ', createdAt: at(5) })).id;
    // Rule 4: same name, different scope → the larger group keeps the name.
    ids.parking1 = (await addOn(e1, 'Parking', { price: 15, scope: 'TICKET', createdAt: at(6) })).id;
    ids.parking2 = (await addOn(e2, 'Parking', { price: 15, scope: 'TICKET', createdAt: at(7) })).id;
    ids.parking3 = (await addOn(e3, 'parking', { price: 20, scope: 'BOTH', createdAt: at(8) })).id;
    // Rule 5: two offerings of one product on the same event.
    ids.table1 = (await addOn(e1, 'Table', { price: 40, scope: 'APPLICATION', createdAt: at(9) })).id;
    ids.table2 = (await addOn(e1, 'table', { price: 45, scope: 'APPLICATION', createdAt: at(10) })).id;
    // Reuse an existing saved add-on; a taxable mismatch is suffixed.
    vipProduct = await prisma.addOnProduct.create({ data: { organizationId: orgId, name: 'VIP lounge', defaultPrice: 50, scope: 'TICKET', taxable: true } });
    ids.vip1 = (await addOn(e1, 'vip lounge', { price: 55, scope: 'TICKET', taxable: true, createdAt: at(11) })).id;
    ids.vip2 = (await addOn(e2, 'VIP Lounge', { price: 60, scope: 'TICKET', taxable: false, createdAt: at(12) })).id;
  });

  afterAll(async () => {
    await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: orgId } } } });
    await prisma.event.deleteMany({ where: { venue: { organizationId: orgId } } });
    await prisma.addOnProduct.deleteMany({ where: { organizationId: orgId } });
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it('dry run reports the plan and writes nothing', async () => {
    const lines = [];
    const report = await run({ dryRun: true, organizationId: orgId, log: (l) => lines.push(l) });
    expect(report.offeringsScanned).toBe(12);
    expect(report.productsCreated).toBe(6); // power, badge, parking, parking (suffixed), table, VIP (suffixed)
    expect(report.productsReused).toBe(1);
    expect(report.offeringsLinked).toBe(12);
    expect(report.conflicts).toHaveLength(2);
    expect(report.sameEventDuplicates).toHaveLength(1);
    expect(lines.join('\n')).toMatch(/DRY RUN/);
    expect(await prisma.addOnProduct.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await prisma.addOn.count({ where: { event: { venue: { organizationId: orgId } }, productId: { not: null } } })).toBe(0);
  });

  it('links every add-on to one saved add-on per name + scope + taxable', async () => {
    const report = await run({ dryRun: false, organizationId: orgId, log: quiet });
    expect(report).toMatchObject({ offeringsScanned: 12, productsCreated: 6, productsReused: 1, offeringsLinked: 12 });

    const byAddOn = async (id) => (await prisma.addOn.findUnique({ where: { id }, include: { product: true } })).product;

    const power = await byAddOn(ids.power1);
    expect(power).toMatchObject({ name: 'BOOTH POWER', description: 'Newest desc', scope: 'APPLICATION', taxable: false });
    expect(Number(power.defaultPrice)).toBe(125);
    expect((await byAddOn(ids.power2)).id).toBe(power.id);
    expect((await byAddOn(ids.power3)).id).toBe(power.id);
    // Prices and the offerings' own names stay put (D9; no storefront change).
    const p3 = await prisma.addOn.findUnique({ where: { id: ids.power3 } });
    expect(Number(p3.price)).toBe(150);
    expect((await prisma.addOn.findUnique({ where: { id: ids.power2 } })).name).toBe(' booth Power ');

    const badge = await byAddOn(ids.badge1);
    expect(Number(badge.defaultPrice)).toBe(12);
    expect(badge.description).toBe('Staff badge');
    expect((await byAddOn(ids.badge2)).id).toBe(badge.id);

    const parking = await byAddOn(ids.parking1);
    expect(parking).toMatchObject({ name: 'Parking', scope: 'TICKET' });
    expect((await byAddOn(ids.parking2)).id).toBe(parking.id);
    const parkingBoth = await byAddOn(ids.parking3);
    expect(parkingBoth).toMatchObject({ name: suffixedName('parking', 'BOTH', true), scope: 'BOTH' });
    expect(parkingBoth.name).toBe('parking (tickets & applications)');

    const table = await byAddOn(ids.table1);
    expect((await byAddOn(ids.table2)).id).toBe(table.id);
    expect(report.sameEventDuplicates).toEqual([expect.objectContaining({ eventId: e1, addOnIds: expect.arrayContaining([ids.table1, ids.table2]) })]);

    expect((await byAddOn(ids.vip1)).id).toBe(vipProduct.id);
    const vipUntaxed = await byAddOn(ids.vip2);
    expect(vipUntaxed).toMatchObject({ name: 'VIP Lounge (tickets, not taxable)', taxable: false });
    expect(report.conflicts.map((c) => c.name).sort()).toEqual(['Parking', 'VIP lounge']);
  });

  it('is idempotent: a second run creates and links nothing, duplicates still reported', async () => {
    const before = await prisma.addOnProduct.count({ where: { organizationId: orgId } });
    const report = await run({ dryRun: false, organizationId: orgId, log: quiet });
    expect(report).toMatchObject({ offeringsScanned: 0, productsCreated: 0, productsReused: 0, offeringsLinked: 0 });
    expect(report.conflicts).toHaveLength(0);
    expect(report.sameEventDuplicates).toHaveLength(1);
    expect(await prisma.addOnProduct.count({ where: { organizationId: orgId } })).toBe(before);
  });

  it('planAddOnDedupe is pure: a suffixed name never collides with a real one', () => {
    const o = (id, name, scope, taxable, eventId = 'e1', minutes = 0) => ({ id, eventId, organizationId: 'org', name, description: null, price: 1, scope, taxable, createdAt: at(minutes) });
    const plan = planAddOnDedupe([
      o('a', 'Power', 'TICKET', true, 'e1', 1),
      o('b', 'Power', 'TICKET', true, 'e2', 2),
      o('c', 'Power', 'APPLICATION', true, 'e3', 3),
      o('d', 'Power (applications)', 'TICKET', true, 'e4', 4),
    ]);
    const names = plan.products.map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(plan.products.find((p) => p.offeringIds.includes('a')).name).toBe('Power');
  });
});
