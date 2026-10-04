// Contract tests for customer source filter (spec 044C).

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { allAcceptances } from '../helpers/legal.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (message) => { sentEmails.push(message); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'customer-source-filter-ct';
const RUN_ID = Date.now();

describe('Customer source filter contract (spec 044C)', () => {
  let adminToken;
  let org;
  let venue;
  let event;
  let eventForm;
  let standingForm;
  let paidOrderContact;
  let rsvpContact;
  let subscribedContact;
  let standingFormContact;
  let multiContact;
  let priceTier;
  const emails = [`admin@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];

  async function createStandingForm(body) {
    return request(app)
      .post('/admin/standing-application-forms')
      .set(...auth(adminToken))
      .send(body);
  }

  async function setStandingFormStatus(formId, status) {
    return request(app)
      .patch(`/admin/standing-application-forms/${formId}`)
      .set(...auth(adminToken))
      .send({ status });
  }

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Organization`, email: `owner@${TAG}.test` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    venue = await prisma.venue.create({
      data: { organizationId: org.id, name: `${TAG} Hall`, address: '500 S Salisbury St', city: 'Raleigh', state: 'NC' },
    });
    event = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Event`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 100 },
    });
    // Event form
    const eventFormRes = await request(app)
      .post(`/admin/events/${event.id}/application-forms`)
      .set(...auth(adminToken))
      .send({ kind: 'FREE', name: 'Event Volunteers' });
    expect(eventFormRes.status).toBe(201);
    eventForm = eventFormRes.body;
    // Standing form
    const standingRes = await createStandingForm({
      name: 'Become a Vendor',
      collectBusiness: true,
      questions: [{ label: 'Why are you applying?', type: 'LONG_TEXT', required: true }],
    });
    expect(standingRes.status).toBe(201);
    standingForm = standingRes.body;
    await setStandingFormStatus(standingForm.id, 'OPEN');

    // Shared price tier
    priceTier = await prisma.priceTier.create({
      data: { eventId: event.id, name: 'General', price: 50.00, quantityTotal: 100 },
    });

    // Paid order contact
    paidOrderContact = await prisma.contact.create({
      data: { organizationId: org.id, email: `paid@${TAG}.test`, firstName: 'Paid', lastName: 'Customer' },
    });
    await prisma.order.create({
      data: {
        eventId: event.id,
        contactId: paidOrderContact.id,
        orderRef: `JMP-${TAG}-${RUN_ID}-PAID`,
        kind: 'TICKET',
        status: 'COMPLETED',
        totalAmount: 50.00,
        quantity: 1,
        paidAt: new Date(),
        items: { create: { priceTierId: priceTier.id, quantity: 1, unitPrice: 50.00 } },
      },
    });

    // RSVP contact
    rsvpContact = await prisma.contact.create({
      data: { organizationId: org.id, email: `rsvp@${TAG}.test`, firstName: 'Rsvp', lastName: 'Contact' },
    });
    await prisma.eventRsvp.create({
      data: { eventId: event.id, contactId: rsvpContact.id, status: 'GOING', partySize: 1 },
    });

    // Subscribed contact
    subscribedContact = await prisma.contact.create({
      data: { organizationId: org.id, email: `subscribed@${TAG}.test`, firstName: 'Subscribed', lastName: 'Contact', emailSubscribed: true },
    });

    // Standing form contact
    standingFormContact = await prisma.contact.create({
      data: { organizationId: org.id, email: `standing-contact@${TAG}.test`, firstName: 'Standing', lastName: 'Form' },
    });
    await prisma.application.create({
      data: {
        formId: standingForm.id,
        eventId: null,
        organizationId: org.id,
        contactId: standingFormContact.id,
        status: 'SUBMITTED',
        paymentStatus: 'NOT_REQUIRED',
        submittedAt: new Date(),
        statusTokenHash: `token-${TAG}`,
      },
    });

    // Multi-source contact (paid order + standing form)
    multiContact = await prisma.contact.create({
      data: { organizationId: org.id, email: `multi@${TAG}.test`, firstName: 'Multi', lastName: 'Source' },
    });
    await prisma.order.create({
      data: {
        eventId: event.id,
        contactId: multiContact.id,
        orderRef: `JMP-${TAG}-${RUN_ID}-MULTI`,
        kind: 'TICKET',
        status: 'COMPLETED',
        totalAmount: 50.00,
        quantity: 1,
        paidAt: new Date(),
        items: { create: { priceTierId: priceTier.id, quantity: 1, unitPrice: 50.00 } },
      },
    });
    await prisma.application.create({
      data: {
        formId: standingForm.id,
        eventId: null,
        organizationId: org.id,
        contactId: multiContact.id,
        status: 'SUBMITTED',
        paymentStatus: 'NOT_REQUIRED',
        submittedAt: new Date(),
        statusTokenHash: `token-${TAG}-multi`,
      },
    });
  });

  afterAll(async () => {
    if (org) {
      await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } }).catch(() => {});
      await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    }
    await cleanupStaff(emails);
  });

  beforeEach(() => {
    sentEmails.length = 0;
  });

  it('source=tickets returns contacts with paid orders', async () => {
    const res = await request(app).get('/admin/customers?source=tickets').set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.email)).toContain(paidOrderContact.email);
    expect(res.body.data.map((c) => c.email)).not.toContain(rsvpContact.email);
    expect(res.body.data.map((c) => c.email)).not.toContain(subscribedContact.email);
    expect(res.body.data.map((c) => c.email)).not.toContain(standingFormContact.email);
    // Check source chips
    const paidCustomer = res.body.data.find((c) => c.email === paidOrderContact.email);
    expect(paidCustomer.sources).toContain('tickets');
  });

  it('source=rsvp returns contacts with RSVPs (alias for rsvp=going)', async () => {
    const res = await request(app).get('/admin/customers?source=rsvp').set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.email)).toContain(rsvpContact.email);
    expect(res.body.data.map((c) => c.email)).not.toContain(paidOrderContact.email);
    expect(res.body.data.map((c) => c.email)).not.toContain(subscribedContact.email);
    expect(res.body.data.map((c) => c.email)).not.toContain(standingFormContact.email);
    // Check source chips
    const rsvpCustomer = res.body.data.find((c) => c.email === rsvpContact.email);
    expect(rsvpCustomer.sources).toContain('rsvp');
  });

  it('source=subscribed returns contacts with emailSubscribed=true', async () => {
    const res = await request(app).get('/admin/customers?source=subscribed').set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.email)).toContain(subscribedContact.email);
    expect(res.body.data.map((c) => c.email)).not.toContain(paidOrderContact.email);
    expect(res.body.data.map((c) => c.email)).not.toContain(rsvpContact.email);
    expect(res.body.data.map((c) => c.email)).not.toContain(standingFormContact.email);
    // Check source chips
    const subscribedCustomer = res.body.data.find((c) => c.email === subscribedContact.email);
    expect(subscribedCustomer.sources).toContain('subscribed');
  });

  it('source=form returns contacts with standing form submissions', async () => {
    const res = await request(app).get('/admin/customers?source=form').set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.email)).toContain(standingFormContact.email);
    expect(res.body.data.map((c) => c.email)).not.toContain(paidOrderContact.email);
    expect(res.body.data.map((c) => c.email)).not.toContain(rsvpContact.email);
    expect(res.body.data.map((c) => c.email)).not.toContain(subscribedContact.email);
    // Check formSources
    const standingCustomer = res.body.data.find((c) => c.email === standingFormContact.email);
    expect(standingCustomer.formSources).toHaveLength(1);
    expect(standingCustomer.formSources[0].name).toBe(standingForm.name);
  });

  it('source=form with formId filters to specific standing form', async () => {
    const res = await request(app).get(`/admin/customers?source=form&formId=${standingForm.id}`).set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.email)).toContain(standingFormContact.email);
  });

  it('source=form automatically flips scope to all', async () => {
    // standingFormContact has no paid order, so scope=customers would hide them
    // source=form should flip to scope=all
    const res = await request(app).get('/admin/customers?source=form').set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.email)).toContain(standingFormContact.email);
  });

  it('rsvp=going still works as backward-compat alias', async () => {
    const res = await request(app).get('/admin/customers?rsvp=going').set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.email)).toContain(rsvpContact.email);
  });

  it('invalid source returns 400', async () => {
    const res = await request(app).get('/admin/customers?source=invalid').set(...auth(adminToken));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/source must be tickets, rsvp, subscribed, or form/);
  });

  it('formId without source=form returns 400', async () => {
    const res = await request(app).get(`/admin/customers?formId=${standingForm.id}`).set(...auth(adminToken));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/formId requires source=form/);
  });

  it('source=form includes formSources on all contacts with standing submissions', async () => {
    const res = await request(app).get('/admin/customers?source=tickets').set(...auth(adminToken));
    expect(res.status).toBe(200);
    const multiCustomer = res.body.data.find((c) => c.email === multiContact.email);
    expect(multiCustomer).toBeDefined();
    expect(multiCustomer.sources).toContain('tickets');
    expect(multiCustomer.formSources).toHaveLength(1);
    expect(multiCustomer.formSources[0].name).toBe(standingForm.name);
  });
});