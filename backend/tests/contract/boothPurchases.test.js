// Contract tests for approved-vendor self-serve booth selection (spec 014 phase 2).
// Postgres is real; these tests stop at HELD so no Stripe call is needed.

import request from 'supertest';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { statusToken } = await import('../../src/services/applicationLinks.js');
const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');
const { default: applicationPaymentService } = await import('../../src/services/ApplicationPaymentService.js');

const TAG = `booth-buy-${Date.now()}`;

describe('Approved vendor booth purchase API', () => {
  let organization;
  let event;
  let form;
  let tier;
  let map;
  let booths;
  let applications;
  let contacts;

  beforeAll(async () => {
    organization = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    const venue = await prisma.venue.create({
      data: { organizationId: organization.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC' },
    });
    event = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date(Date.now() + 86_400_000), status: 'PUBLISHED', capacity: 100 },
    });
    form = await prisma.applicationForm.create({
      data: { eventId: event.id, kind: 'PAID', name: 'Vendors', slug: `${TAG}-vendors`, chargeTiming: 'APPROVAL', feeMode: 'ABSORB' },
    });
    tier = await prisma.applicationTier.create({
      data: { formId: form.id, name: '10x10', price: 275, quantityTotal: 5, quantityReserved: 5, mapBound: true },
    });
    map = await prisma.floorMap.create({
      data: { organizationId: organization.id, eventId: event.id, name: 'Vendor Hall', status: 'PUBLISHED', width: 50, height: 40, layout: { version: 1, elements: [] }, publishedAt: new Date() },
    });
    booths = await Promise.all(['A1', 'A2', 'A3', 'A4', 'A5'].map((label, index) => prisma.booth.create({
      data: { mapId: map.id, label, x: index * 10, y: 0, w: 8, h: 8, tierId: tier.id },
    })));

    contacts = [];
    applications = [];
    for (let i = 0; i < 5; i += 1) {
      const contact = await prisma.contact.create({
        data: { organizationId: organization.id, email: `vendor-${i}@${TAG}.test`, firstName: 'Vendor', lastName: String(i) },
      });
      const profile = await prisma.applicantProfile.create({
        data: { organizationId: organization.id, contactId: contact.id, businessName: `${TAG} Vendor ${i}` },
      });
      const row = await prisma.application.create({
        data: {
          eventId: event.id,
          organizationId: organization.id,
          formId: form.id,
          tierId: tier.id,
          contactId: contact.id,
          profileId: profile.id,
          status: i === 3 ? 'SUBMITTED' : 'APPROVED',
          paymentStatus: i === 3 ? 'CARD_ON_FILE' : 'PAYMENT_DUE',
          capacitySlot: i === 3 ? 'NONE' : 'RESERVED',
          submittedAt: new Date(),
          statusTokenHash: `${TAG}-hash-${i}`,
          order: {
            create: {
              kind: 'APPLICATION',
              eventId: event.id,
              contactId: contact.id,
              orderRef: `JMP-${TAG.slice(-4).toUpperCase()}${i}`,
              totalAmount: 275,
              subtotalAmount: 275,
              orgReceives: 275,
              feeMode: 'ABSORB',
              quantity: 1,
              status: 'PENDING',
              items: { create: { kind: 'APPLICATION_TIER', applicationTierId: tier.id, description: '10x10', quantity: 1, unitPrice: 275 } },
            },
          },
        },
      });
      contacts.push(contact);
      applications.push(row);
    }
  });

  afterAll(async () => {
    await prisma.booth.deleteMany({ where: { mapId: map.id } });
    await prisma.floorMap.deleteMany({ where: { id: map.id } });
    await prisma.paymentTransaction.deleteMany({ where: { order: { application: { organizationId: organization.id } } } });
    await prisma.order.deleteMany({ where: { application: { organizationId: organization.id } } });
    await prisma.application.deleteMany({ where: { organizationId: organization.id } });
    await prisma.applicantProfile.deleteMany({ where: { organizationId: organization.id } });
    await prisma.contact.deleteMany({ where: { organizationId: organization.id } });
    await prisma.applicationForm.deleteMany({ where: { eventId: event.id } });
    await prisma.event.deleteMany({ where: { id: event.id } });
    await prisma.venue.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.deleteMany({ where: { id: organization.id } });
  });

  it('requires a valid guest status token', async () => {
    const response = await request(app)
      .post(`/applications/${applications[0].id}/booth`)
      .send({ boothId: booths[0].id });

    expect(response.status).toBe(403);
  });

  it('holds a booth for an approved guest and returns an actionable conflict to the next vendor', async () => {
    const first = await request(app)
      .post(`/applications/${applications[0].id}/booth`)
      .query({ token: statusToken(applications[0].id) })
      .send({ boothId: booths[0].id });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ boothId: booths[0].id, status: 'HELD', paymentStatus: 'PAYMENT_DUE' });
    expect(new Date(first.body.holdExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const second = await request(app)
      .post(`/applications/${applications[1].id}/booth`)
      .query({ token: statusToken(applications[1].id) })
      .send({ boothId: booths[0].id });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('BOOTH_TAKEN');
  });

  it('authorizes the buyer-session endpoint by contact ownership', async () => {
    const session = buyerAuthService.signSession({
      contactId: contacts[1].id,
      organizationId: organization.id,
      email: contacts[1].email,
    });
    const response = await request(app)
      .post(`/buyer/me/applications/${applications[1].id}/booth`)
      .set('Authorization', `Bearer ${session}`)
      .send({ boothId: booths[1].id });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ boothId: booths[1].id, status: 'HELD' });

    const wrongOwner = await request(app)
      .post(`/buyer/me/applications/${applications[2].id}/booth`)
      .set('Authorization', `Bearer ${session}`)
      .send({ boothId: booths[2].id });
    expect(wrongOwner.status).toBe(404);
  });

  it('allows exactly one winner when two approved vendors race for a booth', async () => {
    await prisma.booth.update({ where: { id: booths[1].id }, data: { status: 'AVAILABLE', holdApplicationId: null, holdExpiresAt: null } });
    const contenders = [applications[1], applications[2]];
    const responses = await Promise.all(contenders.map((application) => request(app)
      .post(`/applications/${application.id}/booth`)
      .query({ token: statusToken(application.id) })
      .send({ boothId: booths[2].id })));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409).body.code).toBe('BOOTH_TAKEN');
  });

  it('refuses pay-now for a map-bound application without a booth hold', async () => {
    const application = applications[3];
    await prisma.application.update({
      where: { id: application.id },
      data: { status: 'APPROVED', paymentStatus: 'PAYMENT_DUE' },
    });

    const response = await request(app)
      .post(`/applications/${application.id}/pay`)
      .query({ token: statusToken(application.id) });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('BOOTH_HOLD_MISSING');
  });

  it('rejects an application that is not approved and awaiting payment', async () => {
    await prisma.application.update({
      where: { id: applications[3].id },
      data: { status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE' },
    });
    const response = await request(app)
      .post(`/applications/${applications[3].id}/booth`)
      .query({ token: statusToken(applications[3].id) })
      .send({ boothId: booths[3].id });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('APPLICATION_NOT_APPROVED');
  });

  it('moves the held booth to SOLD in the same successful-payment transition', async () => {
    const application = applications[4];
    const selectedBooth = booths[4];
    const held = await request(app)
      .post(`/applications/${application.id}/booth`)
      .query({ token: statusToken(application.id) })
      .send({ boothId: selectedBooth.id });
    expect(held.status).toBe(200);

    await applicationPaymentService._markPaidTx(application.id, `pi_${TAG}`, { source: 'test' });

    const [updatedApplication, soldBooth] = await Promise.all([
      prisma.application.findUnique({ where: { id: application.id } }),
      prisma.booth.findUnique({ where: { id: selectedBooth.id } }),
    ]);
    expect(updatedApplication).toMatchObject({ paymentStatus: 'PAID', boothLabel: 'A5' });
    expect(soldBooth).toMatchObject({ status: 'SOLD', applicationId: application.id, holdApplicationId: null, holdExpiresAt: null });
  });
});
