// Organization suspension (Organization.status = INACTIVE).
//
// A suspended organization's storefront is gone (404 on every public read,
// checkout, apply and host lookup), its staff are locked out with 403
// ORGANIZATION_SUSPENDED, and the paths that must keep running for existing
// buyers still do: scanner-key ticket scans and SYSTEM_ADMIN access through
// X-Jump-Org (so a system admin can refund). Status is set through Prisma;
// the endpoint that sets it belongs to the system-admin card.

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: domainService } = await import('../../src/services/DomainService.js');

const AUTH_SECRET = process.env.AUTH_SECRET;
const EMAILS = ['admin@suspension-test.com', 'sysadmin@suspension-test.com'];
const HOST = 'tickets.suspension-test.example';
const futureDate = new Date('2027-06-30T20:00:00Z');

describe('Organization suspension', () => {
  let adminToken, sysToken;
  let org, event, tierId, ticket, application;

  const setStatus = async (status) => {
    await prisma.organization.update({ where: { id: org.id }, data: { status } });
    domainService.clearCache();
  };

  beforeAll(async () => {
    adminToken = await staffToken({ role: 'ADMIN', email: EMAILS[0] });
    sysToken = await staffToken({ role: 'SYSTEM_ADMIN', email: EMAILS[1] });

    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Suspension Test Org' });
    org = orgRes.body;
    await prisma.organization.update({ where: { id: org.id }, data: { onboardingCompletedAt: new Date() } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');

    const venueRes = await request(app)
      .post(`/organizations/${org.id}/venues`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Suspension Venue', address: '1 Closed St', timezone: 'America/New_York' });
    const eventRes = await request(app)
      .post(`/organizations/${org.id}/events`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Suspended Show',
        venueId: venueRes.body.id,
        date: futureDate.toISOString(),
        capacity: 50,
        priceTiers: [{ name: 'GA', price: 1000, quantityTotal: 50, displayOrder: 1 }],
      });
    event = eventRes.body;
    tierId = event.priceTiers[0].id;
    await request(app)
      .post(`/organizations/${org.id}/events/${event.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`);

    await prisma.organizationDomain.create({
      data: { organizationId: org.id, hostname: HOST, verificationToken: 'jump-verify=x', cnameTarget: 'edge.example', status: 'ACTIVE' },
    });

    const contact = await prisma.contact.create({
      data: { organizationId: org.id, email: 'buyer@suspension-test.com', firstName: 'B', lastName: 'Uyer' },
    });
    const order = await prisma.order.create({
      data: { organizationId: org.id, eventId: event.id, contactId: contact.id, orderRef: `SUSP-${Date.now()}`, totalAmount: 1000, quantity: 1, status: 'COMPLETED' },
    });
    ticket = await prisma.ticket.create({
      data: {
        orderId: order.id,
        eventId: event.id,
        ticketNumber: 1,
        priceTierId: tierId,
        contactId: contact.id,
        pricePaid: 1000,
        barcode: `JUMP-SUSP${Date.now()}`.slice(0, 20),
        status: 'VALID',
      },
    });
    const form = await prisma.applicationForm.create({
      data: { organizationId: org.id, kind: 'FREE', name: 'Press', slug: 'press' },
    });
    application = await prisma.application.create({
      data: { formId: form.id, organizationId: org.id, contactId: contact.id, statusTokenHash: `susp-${Date.now()}` },
    });

    await setStatus('INACTIVE');
  });

  afterAll(async () => {
    if (org?.id) {
      await prisma.organizationDomain.deleteMany({ where: { organizationId: org.id } });
    }
    await cleanupStaff(EMAILS);
  });

  describe('storefront', () => {
    it('404s public org, event and venue reads', async () => {
      expect((await request(app).get(`/organizations/${org.id}/public`)).status).toBe(404);
      expect((await request(app).get(`/organizations/${org.id}/public/menus`)).status).toBe(404);
      const res = await request(app).get(`/events/${event.id}`);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Organization not found');
      expect((await request(app).get(`/venues/${event.venueId}`)).status).toBe(404);
    });

    it('does not resolve the custom domain', async () => {
      expect((await request(app).get('/domains/resolve').query({ host: HOST })).status).toBe(404);
      await setStatus('ACTIVE');
      expect((await request(app).get('/domains/resolve').query({ host: HOST })).body).toEqual({ organizationId: org.id });
      await setStatus('INACTIVE');
    });

    it('refuses checkout', async () => {
      const res = await request(app)
        .post('/orders')
        .send({ eventId: event.id, priceTierId: tierId, quantity: 1, contact: { email: 'new@suspension-test.com', firstName: 'N', lastName: 'Ew' } });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Organization not found');
    });

    it('refuses application submit and status-link payment', async () => {
      const submit = await request(app).post(`/events/${event.id}/applications`).send({});
      expect(submit.status).toBe(404);
      expect(submit.body.message).toBe('Organization not found');
      const pay = await request(app).post(`/applications/${application.id}/pay`).query({ token: 'x' });
      expect(pay.status).toBe(404);
      expect(pay.body.message).toBe('Organization not found');
    });
  });

  describe('staff', () => {
    it('blocks a member with 403 ORGANIZATION_SUSPENDED', async () => {
      const byParam = await request(app).get(`/organizations/${org.id}/events`).set('Authorization', `Bearer ${adminToken}`);
      expect(byParam.status).toBe(403);
      expect(byParam.body.code).toBe('ORGANIZATION_SUSPENDED');

      const byHeader = await request(app)
        .get('/admin/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Jump-Org', org.id);
      expect(byHeader.status).toBe(403);
      expect(byHeader.body.code).toBe('ORGANIZATION_SUSPENDED');
    });

    it('drops the suspended org from the member org list', async () => {
      const res = await request(app).get('/organizations').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.map((o) => o.id)).not.toContain(org.id);
    });

    it('lets SYSTEM_ADMIN in through X-Jump-Org', async () => {
      const res = await request(app)
        .get(`/organizations/${org.id}/events`)
        .set('Authorization', `Bearer ${sysToken}`)
        .set('X-Jump-Org', org.id);
      expect(res.status).toBe(200);
      const orders = await request(app)
        .get('/admin/orders')
        .set('Authorization', `Bearer ${sysToken}`)
        .set('X-Jump-Org', org.id);
      expect(orders.status).toBe(200);
    });
  });

  it('still redeems tickets with the scanner key', async () => {
    const prev = process.env.SCANNER_API_KEY;
    process.env.SCANNER_API_KEY = 'suspension-reader-key';
    try {
      const qrPayload = jwt.sign({ sub: ticket.id, eventId: event.id, barcode: ticket.barcode }, AUTH_SECRET, {
        algorithm: 'HS256',
        expiresIn: '7d',
      });
      const res = await request(app).post('/tickets/redeem').set('X-Scanner-Key', 'suspension-reader-key').send({ qrPayload });
      expect(res.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.SCANNER_API_KEY;
      else process.env.SCANNER_API_KEY = prev;
    }
  });
});
