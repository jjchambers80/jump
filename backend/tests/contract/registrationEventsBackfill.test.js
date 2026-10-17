// Spec 057 backfill: every form on a live event becomes a registration event
// linked to it, with its applications, application orders and the add-ons its
// tiers offer. A dry run writes nothing; a second run finds nothing to move.

const { prisma } = await import('@jump/db');
const { run, planAddOns, registrationStatus } = await import('../../src/scripts/backfill-057-registration-events.js');

const TAG = 'reg-backfill-ct';
const quiet = () => {};

describe('backfill-057-registration-events', () => {
  let org;
  let live;
  let deleted;
  let vendors;
  let volunteers;
  let orphan;
  let tier;
  let application;
  let order;
  let power;
  let parking;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main', city: 'Raleigh', state: 'NC' } });
    const date = new Date(Date.now() + 30 * 86_400_000);
    live = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Market`, date, status: 'PUBLISHED', capacity: 100, category: 'Market', taxRate: 0.0725 } });
    deleted = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Old`, date, status: 'CANCELLED', capacity: 10, deletedAt: new Date() } });
    vendors = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: live.id, kind: 'PAID', purpose: 'VENDOR', name: `${TAG} Vendors`, slug: 'vendors', status: 'OPEN' } });
    volunteers = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: live.id, kind: 'FREE', purpose: 'VOLUNTEER', name: `${TAG} Helpers`, slug: 'helpers', status: 'DRAFT' } });
    orphan = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: deleted.id, kind: 'FREE', name: `${TAG} Old form`, slug: 'old', status: 'OPEN' } });
    tier = await prisma.applicationTier.create({ data: { formId: vendors.id, name: '10x10', price: 100, quantityTotal: 10 } });

    const product = (name, scope) => prisma.addOnProduct.create({ data: { organizationId: org.id, name, defaultPrice: 10, scope } });
    power = await prisma.addOn.create({ data: { eventId: live.id, productId: (await product('Power', 'APPLICATION')).id, name: 'Power', price: 25, scope: 'APPLICATION', allTiers: false } });
    await prisma.applicationTierAddOn.create({ data: { applicationTierId: tier.id, addOnId: power.id } });
    parking = await prisma.addOn.create({ data: { eventId: live.id, productId: (await product('Parking', 'BOTH')).id, name: 'Parking', price: 10, scope: 'BOTH', allTiers: true } });

    const contact = await prisma.contact.create({ data: { organizationId: org.id, email: `vendor@${TAG}.test`, firstName: 'Val', lastName: 'Vendor' } });
    application = await prisma.application.create({
      data: { organizationId: org.id, eventId: live.id, formId: vendors.id, contactId: contact.id, tierId: tier.id, status: 'APPROVED', paymentStatus: 'PAID', submittedAt: new Date(), statusTokenHash: `${TAG}-a` },
    });
    order = await prisma.order.create({
      data: { kind: 'APPLICATION', organizationId: org.id, eventId: live.id, contactId: contact.id, applicationId: application.id, orderRef: `${TAG}-1`, totalAmount: 107.25, subtotalAmount: 100, taxAmount: 7.25, orgReceives: 100, quantity: 1, status: 'COMPLETED' },
    });
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.addOn.deleteMany({ where: { event: { venue: { organizationId: org.id } } } }).catch(() => {});
    await prisma.addOnProduct.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.updateMany({ where: { venue: { organizationId: org.id } }, data: { linkedEventId: null } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
  });

  it('plans statuses and add-ons without the database', () => {
    expect(registrationStatus({ status: 'PUBLISHED' }, { status: 'OPEN' })).toBe('PUBLISHED');
    expect(registrationStatus({ status: 'PUBLISHED' }, { status: 'DRAFT' })).toBe('DRAFT');
    expect(registrationStatus({ status: 'CANCELLED' }, { status: 'OPEN' })).toBe('CANCELLED');
    const addOn = { id: 'a', scope: 'APPLICATION', allTiers: false, name: 'Power' };
    const form = (id, attached) => ({ id, kind: 'PAID', tiers: [{ addOns: attached ? [{ addOnId: 'a' }] : [] }] });
    const liveEvent = (forms) => ({ addOns: [addOn], applicationForms: forms });
    expect(planAddOns(form('f1', true), liveEvent([form('f1', true)]))[0].action).toBe('MOVE');
    expect(planAddOns(form('f1', true), liveEvent([form('f1', true), form('f2', true)]))[0].action).toBe('REPORT');
  });

  it('a dry run writes nothing', async () => {
    const result = await run({ dryRun: true, log: quiet, organizationId: org.id });
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect((await prisma.applicationForm.findUnique({ where: { id: vendors.id } })).eventId).toBe(live.id);
    expect(await prisma.event.count({ where: { linkedEventId: live.id } })).toBe(0);
  });

  it('moves each form, its applications, orders and add-ons onto a linked registration event', async () => {
    await run({ dryRun: false, log: quiet, organizationId: org.id });
    const registrations = await prisma.event.findMany({ where: { linkedEventId: live.id }, orderBy: { createdAt: 'asc' } });
    expect(registrations).toHaveLength(2);
    const [forVendors, forHelpers] = registrations;
    expect(forVendors).toMatchObject({ type: 'REGISTRATION', name: `${TAG} Vendors`, status: 'PUBLISHED', venueId: live.venueId, capacity: null, category: 'Market' });
    expect(forVendors.date.toISOString()).toBe(live.date.toISOString());
    expect(Number(forVendors.taxRate)).toBe(0.0725);
    expect(forHelpers).toMatchObject({ name: `${TAG} Helpers`, status: 'DRAFT' });

    expect((await prisma.applicationForm.findUnique({ where: { id: vendors.id } })).eventId).toBe(forVendors.id);
    expect((await prisma.applicationForm.findUnique({ where: { id: volunteers.id } })).eventId).toBe(forHelpers.id);
    expect((await prisma.application.findUnique({ where: { id: application.id } })).eventId).toBe(forVendors.id);
    const moved = await prisma.order.findUnique({ where: { id: order.id } });
    expect(moved.eventId).toBe(forVendors.id);
    // Money is untouched.
    expect(Number(moved.totalAmount)).toBe(107.25);
    expect(moved.status).toBe('COMPLETED');

    // The application-only add-on moved; the ticket-and-application one stays and is copied.
    expect((await prisma.addOn.findUnique({ where: { id: power.id } })).eventId).toBe(forVendors.id);
    expect((await prisma.addOn.findUnique({ where: { id: parking.id } })).eventId).toBe(live.id);
    const copy = await prisma.addOn.findFirst({ where: { eventId: forVendors.id, name: 'Parking' } });
    expect(copy).toMatchObject({ scope: 'APPLICATION', allTiers: true });

    // The deleted event's form stays where it was.
    expect((await prisma.applicationForm.findUnique({ where: { id: orphan.id } })).eventId).toBe(deleted.id);
  });

  it('a second run finds nothing to move', async () => {
    const result = await run({ dryRun: false, log: quiet, organizationId: org.id });
    expect(result.moved).toBe(0);
    expect(await prisma.event.count({ where: { linkedEventId: live.id } })).toBe(2);
  });
});
