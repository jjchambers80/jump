import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { prisma } from '@jump/db';
import app from '../../src/api/server.js';
import { cleanupStaff, joinOrgByToken, staffToken } from '../helpers/staff.js';

const TAG = `payments-ready-${process.pid}-${Date.now()}`;
const email = `admin@${TAG}.test`;

describe('paid sales readiness', () => {
  let token;
  let organization;
  let venue;

  const auth = () => ['Authorization', `Bearer ${token}`];

  async function event({ admissionMode = 'TICKETED', price = 0, status = 'DRAFT' } = {}) {
    return prisma.event.create({
      data: {
        venueId: venue.id,
        name: `${TAG} ${admissionMode} ${price} ${Math.random()}`,
        date: new Date(Date.now() + 30 * 86_400_000),
        status,
        admissionMode,
        capacity: admissionMode === 'RSVP' ? 25 : 50,
        rsvpLimit: admissionMode === 'RSVP' ? 25 : null,
        ...(admissionMode === 'TICKETED' && {
          priceTiers: { create: [{ name: 'Admission', price, quantityTotal: 50, displayOrder: 0 }] },
        }),
      },
      include: { priceTiers: true },
    });
  }

  async function publish(row) {
    return request(app).post(`/organizations/${organization.id}/events/${row.id}/publish`).set(...auth());
  }

  async function createForm(kind) {
    const row = await event();
    const form = await prisma.applicationForm.create({
      data: { organizationId: organization.id, eventId: row.id, kind, name: `${kind} form`, slug: `${TAG}-${kind.toLowerCase()}-${row.id}`, status: 'DRAFT' },
    });
    if (kind === 'PAID') {
      await prisma.applicationTier.create({ data: { formId: form.id, name: 'Booth', price: 100, quantityTotal: 10, displayOrder: 0 } });
    }
    return { row, form };
  }

  async function openForm(row, form) {
    return request(app).patch(`/admin/events/${row.id}/application-forms/${form.id}`).set(...auth()).send({ status: 'OPEN' });
  }

  async function setAccount(ready) {
    await prisma.organizationStripeAccount.deleteMany({ where: { organizationId: organization.id } });
    if (ready) {
      await prisma.organizationStripeAccount.create({
        data: { organizationId: organization.id, mode: 'test', stripeAccountId: `acct_${TAG}`, detailsSubmitted: true, chargesEnabled: true },
      });
    }
  }

  beforeAll(async () => {
    process.env.STRIPE_CONNECT_ENABLED = 'true';
    process.env.APPLICATIONS_PAYMENTS_ENABLED = 'true';
    token = await staffToken({ email, role: 'ADMIN' });
    organization = await prisma.organization.create({ data: { name: TAG } });
    await joinOrgByToken(token, organization.id, 'ADMIN');
    venue = await prisma.venue.create({ data: { organizationId: organization.id, name: `${TAG} venue`, address: '1 Main St', city: 'Raleigh', state: 'NC' } });
  });

  beforeEach(async () => setAccount(false));

  afterAll(async () => {
    delete process.env.STRIPE_CONNECT_ENABLED;
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    await prisma.organizationStripeAccount.deleteMany({ where: { organizationId: organization.id } }).catch(() => {});
    await prisma.applicationTier.deleteMany({ where: { form: { organizationId: organization.id } } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { organizationId: organization.id } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: organization.id } } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: organization.id } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: organization.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => {});
    await cleanupStaff([email]);
  });

  it('refuses publishing a paid event without a chargeable account', async () => {
    const response = await publish(await event({ price: 20 }));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'PAYMENTS_NOT_READY', details: { settingsPath: '/admin/settings/payments' } });
  });

  it('publishes free and RSVP events without Stripe', async () => {
    expect((await publish(await event({ price: 0 }))).status).toBe(200);
    expect((await publish(await event({ admissionMode: 'RSVP' }))).status).toBe(200);
  });

  it('publishes a paid event when charges are enabled', async () => {
    await setAccount(true);
    expect((await publish(await event({ price: 20 }))).status).toBe(200);
  });

  it('gates paid tiers added to or activated on a published event', async () => {
    const live = await event({ price: 0, status: 'PUBLISHED' });
    await prisma.event.update({ where: { id: live.id }, data: { capacity: 60 } });
    const add = await request(app)
      .post(`/organizations/${organization.id}/events/${live.id}/price-tiers`)
      .set(...auth())
      .send({ name: 'Paid', price: 15, quantityTotal: 1 });
    expect(add.body.code).toBe('PAYMENTS_NOT_READY');

    const paid = await prisma.priceTier.create({ data: { eventId: live.id, name: 'Hidden paid', price: 15, quantityTotal: 1, isActive: false } });
    const activate = await request(app)
      .post(`/organizations/${organization.id}/events/${live.id}/price-tiers/${paid.id}/activate`)
      .set(...auth());
    expect(activate.body.code).toBe('PAYMENTS_NOT_READY');
  });

  it('refuses a paid form, allows a free form, and allows paid once charges are enabled', async () => {
    const paid = await createForm('PAID');
    const refused = await openForm(paid.row, paid.form);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('PAYMENTS_NOT_READY');

    const free = await createForm('FREE');
    expect((await openForm(free.row, free.form)).status).toBe(200);

    await setAccount(true);
    expect((await openForm(paid.row, paid.form)).status).toBe(200);
  });

  it('keeps legacy flag-off behavior', async () => {
    process.env.STRIPE_CONNECT_ENABLED = 'false';
    expect((await publish(await event({ price: 20 }))).status).toBe(200);
  });
});
