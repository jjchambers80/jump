// Contract test for what a new event form starts with, created by an
// ORGANIZER (050-E opened form configuration to them): no questions; from the
// setup flows (`setup: true`, spec 056) an email only, paid or free.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'form-defaults-ct';

describe('createForm starts blank', () => {
  let token;
  let org;
  let eventId;
  const emails = [`organizer@${TAG}.test`];
  const forms = () => `/admin/events/${eventId}/application-forms`;
  const create = (body) => request(app).post(forms()).set('Authorization', `Bearer ${token}`).send(body);

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    token = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    await joinOrgByToken(token, org.id, 'ORGANIZER');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC' } });
    eventId = (await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date('2027-09-18T15:00:00Z'), status: 'DRAFT', capacity: 100 } })).id;
  });

  afterAll(async () => {
    await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(emails);
  });

  const cases = [
    { purpose: 'VENDOR', kind: 'PAID', collectBusiness: true },
    { purpose: 'VENDOR', kind: 'FREE', collectBusiness: false },
    { purpose: 'SPECIAL_GUEST', kind: 'FREE', collectBusiness: false },
    { purpose: 'VOLUNTEER', kind: 'FREE', collectBusiness: false },
    { purpose: 'SPONSOR', kind: 'PAID', collectBusiness: true },
    { purpose: 'PRESS', kind: 'FREE', collectBusiness: false },
    { purpose: 'PANEL', kind: 'FREE', collectBusiness: false },
    { purpose: 'OTHER', kind: 'FREE', collectBusiness: false },
  ];

  it.each(cases)('$purpose ($kind) starts with no questions', async ({ purpose, kind, collectBusiness }) => {
    const res = await create({ kind, purpose, name: `${purpose} ${kind}` });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ purpose, kind, status: 'DRAFT', collectBusiness, collectName: true, purposeLocked: false });
    expect(res.body.questions).toEqual([]);
  });

  it('the setup flows start every form with an email only, paid or free', async () => {
    const venueId = (await prisma.venue.findFirst({ where: { organizationId: org.id }, select: { id: true } })).id;
    const fresh = await prisma.event.create({ data: { venueId, name: `${TAG} Market`, date: new Date('2027-11-18T15:00:00Z'), status: 'DRAFT', capacity: 100 } });
    for (const kind of ['PAID', 'FREE']) {
      const res = await request(app).post(`/admin/events/${fresh.id}/application-forms`).set('Authorization', `Bearer ${token}`).send({ kind, purpose: kind === 'PAID' ? 'VENDOR' : 'PRESS', name: kind, setup: true });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ collectName: false, collectBusiness: false, questions: [] });
    }
  });

  it('an explicit collectBusiness on a FREE form wins', async () => {
    const res = await create({ kind: 'FREE', purpose: 'VENDOR', name: 'Makers', collectBusiness: true });
    expect(res.status).toBe(201);
    expect(res.body.collectBusiness).toBe(true);
  });

  it('FREE-only purposes refuse PAID for an ORGANIZER too', async () => {
    for (const purpose of ['SPECIAL_GUEST', 'VOLUNTEER']) {
      const res = await create({ kind: 'PAID', purpose, name: `Paid ${purpose}` });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PURPOSE_KIND_MISMATCH');
    }
  });

  it('an ORGANIZER can switch the purpose and delete a form without applications', async () => {
    const res = await create({ kind: 'FREE', purpose: 'OTHER', name: 'Switch me' });
    const patched = await request(app).patch(`${forms()}/${res.body.id}`).set('Authorization', `Bearer ${token}`).send({ purpose: 'PRESS' });
    expect(patched.status).toBe(200);
    expect(patched.body.purpose).toBe('PRESS');
    const del = await request(app).delete(`${forms()}/${res.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBeLessThan(300);
  });

  it('the setup flows keep one live form per purpose on an event', async () => {
    // A fresh event: the cases above already made a form of every purpose.
    const venueId = (await prisma.venue.findFirst({ where: { organizationId: org.id }, select: { id: true } })).id;
    const fresh = await prisma.event.create({ data: { venueId, name: `${TAG} Fair`, date: new Date('2027-10-18T15:00:00Z'), status: 'DRAFT', capacity: 100 } });
    const create = (body) => request(app).post(`/admin/events/${fresh.id}/application-forms`).set('Authorization', `Bearer ${token}`).send(body);
    const first = await create({ kind: 'FREE', purpose: 'PANEL', name: 'Panels', setup: true });
    expect(first.status).toBe(201);
    const second = await create({ kind: 'FREE', purpose: 'PANEL', name: 'Panels again', setup: true });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('FORM_EXISTS');
    // Another purpose is fine, and so is the same one once the first is closed.
    expect((await create({ kind: 'FREE', purpose: 'SPONSOR', name: 'Sponsors', setup: true })).status).toBe(201);
    await prisma.applicationForm.update({ where: { id: first.body.id }, data: { status: 'CLOSED' } });
    expect((await create({ kind: 'FREE', purpose: 'PANEL', name: 'Panels 2028', setup: true })).status).toBe(201);
  });

  it('setup is accepted on create only', async () => {
    const res = await create({ kind: 'FREE', purpose: 'OTHER', name: 'Bad flag', setup: 'yes' });
    expect(res.status).toBe(400);
  });
});
