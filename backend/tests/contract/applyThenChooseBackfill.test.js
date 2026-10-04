// Spec 037 phase 5 (D6): `npm run db:backfill:037-applications` against real
// rows. The planner's rules are unit-tested (tests/unit/applyThenChoose.test.js);
// this checks what only a database can show — a dry run writes nothing, the
// moves land with capacity, holds and orders consistent, money that moved is
// never touched, and a second run is a no-op. Stripe is mocked (an open
// pay-now session is expired best effort).

import { jest } from '@jest/globals';

const mockSessionsExpire = jest.fn().mockResolvedValue({});
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: jest.fn(), retrieve: jest.fn(), expire: mockSessionsExpire } },
    customers: { create: jest.fn() },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    setupIntents: { retrieve: jest.fn() },
    refunds: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { prisma } = await import('@jump/db');
const { run } = await import('../../src/scripts/backfill-037-applications.js');
const { attachOrder, cleanupApplicationOrders } = await import('../helpers/applicationRow.js');

const TAG = `bf037-${Date.now()}`;

describe('Apply-then-choose backfill (spec 037 phase 5, D6)', () => {
  let org;
  let event;
  let reserving;
  let firstCome;
  let tier;
  let fcTier;
  let addOn;
  let map;
  let booth;
  const ids = {};
  const logs = [];
  const log = (line) => logs.push(line);

  async function application(key, form, tierId, data) {
    const contact = await prisma.contact.create({ data: { organizationId: org.id, email: `${key}@${TAG}.test`, firstName: 'V', lastName: key } });
    const profile = await prisma.applicantProfile.create({ data: { organizationId: org.id, contactId: contact.id, businessName: `${key} Co` } });
    const row = await prisma.application.create({
      data: { formId: form.id, eventId: event.id, organizationId: org.id, contactId: contact.id, profileId: profile.id, tierId, statusTokenHash: `${TAG}-${key}`, ...data },
    });
    ids[key] = row.id;
    return row;
  }

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main', city: 'Raleigh', state: 'NC' } });
    event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } });
    reserving = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: event.id, kind: 'PAID', name: 'Vendors', slug: `${TAG}-v`, status: 'OPEN' } });
    firstCome = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: event.id, kind: 'PAID', name: 'Trucks', slug: `${TAG}-t`, status: 'OPEN', reserveOnApproval: false } });
    tier = await prisma.applicationTier.create({ data: { formId: reserving.id, name: '10x10', price: 200, quantityTotal: 10, quantityReserved: 1, quantityApproved: 1 } });
    fcTier = await prisma.applicationTier.create({ data: { formId: firstCome.id, name: 'Truck', price: 100, quantityTotal: 5, quantityReserved: 1 } });
    addOn = await prisma.addOn.create({
      data: {
        event: { connect: { id: event.id } },
        product: { create: { organizationId: org.id, name: 'Power', defaultPrice: 50, scope: 'APPLICATION' } },
        name: 'Power',
        price: 50,
        scope: 'APPLICATION',
        quantityTotal: 5,
        quantityReserved: 1,
      },
    });
    map = await prisma.floorMap.create({ data: { organizationId: org.id, eventId: event.id, name: 'Hall', status: 'PUBLISHED', width: 40, height: 40, layout: { version: 1, elements: [] }, publishedAt: new Date() } });

    await application('draft', reserving, tier.id, { status: 'DRAFT', paymentStatus: 'AWAITING_CARD', optInMarketing: true });
    await attachOrder(ids.draft);
    await application('card', reserving, tier.id, { status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE', submittedAt: new Date(), stripePaymentMethodId: `pm_${TAG}` });
    await attachOrder(ids.card);
    await application('due', reserving, tier.id, { status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED', submittedAt: new Date(), decidedAt: new Date(), stripeCheckoutSessionId: `cs_${TAG}_open` });
    const dueOrder = await attachOrder(ids.due, { dueAt: new Date(Date.now() + 86_400_000) });
    await prisma.orderAddOn.create({ data: { orderId: dueOrder.id, addOnId: addOn.id, name: 'Power', quantity: 1, unitPrice: 50 } });
    booth = await prisma.booth.create({ data: { mapId: map.id, label: 'A1', x: 0, y: 0, w: 5, h: 5, tierId: tier.id, status: 'HELD', holdApplicationId: ids.due, holdExpiresAt: new Date(Date.now() + 600_000) } });
    await application('paid', reserving, tier.id, { status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED', submittedAt: new Date(), decidedAt: new Date() });
    await attachOrder(ids.paid, { paidAt: new Date() });
    await application('processing', reserving, tier.id, { status: 'APPROVED', paymentStatus: 'PROCESSING', capacitySlot: 'RESERVED', submittedAt: new Date(), decidedAt: new Date() });
    await attachOrder(ids.processing);
    await application('truck', firstCome, fcTier.id, { status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED', submittedAt: new Date(), decidedAt: new Date() });
    await attachOrder(ids.truck);
  });

  afterAll(async () => {
    await prisma.booth.deleteMany({ where: { mapId: map.id } });
    await prisma.floorMap.deleteMany({ where: { id: map.id } });
    await cleanupApplicationOrders(org.id);
    await prisma.application.deleteMany({ where: { organizationId: org.id } });
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } });
    await prisma.buyerLoginToken.deleteMany({ where: { contact: { organizationId: org.id } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } });
    await prisma.addOn.deleteMany({ where: { eventId: event.id } });
    await prisma.applicationForm.deleteMany({ where: { eventId: event.id } });
    await prisma.event.deleteMany({ where: { id: event.id } });
    await prisma.venue.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  });

  const scope = () => Object.values(ids);
  const row = (key) => prisma.application.findUnique({ where: { id: ids[key] }, include: { order: true } });

  it('a dry run reports the plan and writes nothing', async () => {
    const before = await prisma.application.findMany({ where: { id: { in: scope() } }, select: { id: true, status: true, paymentStatus: true, capacitySlot: true, updatedAt: true } });
    const result = await run({ dryRun: true, log, applicationIds: scope() });
    expect(result).toMatchObject({ checked: 6, moved: 0, reported: 1, planned: { DRAFT_TO_SUBMITTED: 1, TO_NOT_DUE: 1, TO_AWAITING_SELECTION: 2, SKIP: 1, REPORT: 1 } });
    expect(logs.join('\n')).toMatch(/DRY RUN/);
    const after = await prisma.application.findMany({ where: { id: { in: scope() } }, select: { id: true, status: true, paymentStatus: true, capacitySlot: true, updatedAt: true } });
    expect(after).toEqual(before);
    expect(mockSessionsExpire).not.toHaveBeenCalled();
    expect((await prisma.booth.findUnique({ where: { id: booth.id } })).status).toBe('HELD');
  });

  it('applying moves every in-flight row onto apply-then-choose and leaves money that moved alone', async () => {
    const result = await run({ dryRun: false, log, applicationIds: scope() });
    expect(result).toMatchObject({ moved: 4, reported: 1 });

    // DRAFT at the card step → SUBMITTED without a card, order cancelled, opt-ins applied.
    const draft = await row('draft');
    expect(draft).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'NOT_DUE', stripeCheckoutSessionId: null });
    expect(draft.submittedAt).toBeTruthy();
    expect(draft.optInsAppliedAt).toBeTruthy();
    expect(draft.order.status).toBe('CANCELLED');
    expect((await prisma.contact.findUnique({ where: { id: draft.contactId } })).emailSubscribed).toBe(true);

    // Submitted with a card → NOT_DUE; the card stays for "Pay with card ending …".
    const card = await row('card');
    expect(card).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'NOT_DUE', stripePaymentMethodId: `pm_${TAG}` });
    expect(card.order.status).toBe('CANCELLED');

    // Approved + unpaid on a reserving form → AWAITING_SELECTION with its slot; held add-on and booth released.
    const due = await row('due');
    expect(due).toMatchObject({ status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', capacitySlot: 'RESERVED', tierId: tier.id, stripeCheckoutSessionId: null, selectionHeldUntil: null });
    expect(due.order.status).toBe('CANCELLED');
    expect(await prisma.applicationTier.findUnique({ where: { id: tier.id } })).toMatchObject({ quantityReserved: 1, quantityApproved: 1 });
    expect((await prisma.addOn.findUnique({ where: { id: addOn.id } })).quantityReserved).toBe(0);
    expect(await prisma.booth.findUnique({ where: { id: booth.id } })).toMatchObject({ status: 'AVAILABLE', holdApplicationId: null });
    expect(mockSessionsExpire).toHaveBeenCalledWith(`cs_${TAG}_open`);

    // First-come form: the slot goes back too.
    const truck = await row('truck');
    expect(truck).toMatchObject({ paymentStatus: 'AWAITING_SELECTION', capacitySlot: 'NONE' });
    expect((await prisma.applicationTier.findUnique({ where: { id: fcTier.id } })).quantityReserved).toBe(0);

    // Paid and in-flight rows are untouched.
    expect(await row('paid')).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED', order: { status: 'COMPLETED' } });
    expect(await row('processing')).toMatchObject({ paymentStatus: 'PROCESSING', capacitySlot: 'RESERVED', order: { status: 'PENDING' } });
    expect(logs.join('\n')).toMatch(/REPORT[\s\S]*charge is in flight/);
  });

  it('a second run changes nothing', async () => {
    const result = await run({ dryRun: false, log, applicationIds: scope() });
    expect(result).toMatchObject({ moved: 0, reported: 1, planned: { SKIP: 5, REPORT: 1 } });
    expect((await prisma.addOn.findUnique({ where: { id: addOn.id } })).quantityReserved).toBe(0);
    expect((await prisma.applicationTier.findUnique({ where: { id: tier.id } })).quantityReserved).toBe(1);
  });
});
