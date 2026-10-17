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
    { kind: 'PAID', collectBusiness: true },
    { kind: 'FREE', collectBusiness: false },
  ];

  it.each(cases)('a $kind form starts with no questions', async ({ kind, collectBusiness }) => {
    const res = await create({ kind, name: `Blank ${kind}` });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind, status: 'DRAFT', collectBusiness, collectName: true });
    expect(res.body.questions).toEqual([]);
  });

  it('the setup flows start every form with an email only, paid or free', async () => {
    const venueId = (await prisma.venue.findFirst({ where: { organizationId: org.id }, select: { id: true } })).id;
    const fresh = await prisma.event.create({ data: { venueId, name: `${TAG} Market`, date: new Date('2027-11-18T15:00:00Z'), status: 'DRAFT', capacity: 100 } });
    for (const kind of ['PAID', 'FREE']) {
      const res = await request(app).post(`/admin/events/${fresh.id}/application-forms`).set('Authorization', `Bearer ${token}`).send({ kind, name: kind, setup: true });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ collectName: false, collectBusiness: false, questions: [] });
    }
  });

  it('an explicit collectBusiness on a FREE form wins', async () => {
    const res = await create({ kind: 'FREE', name: 'Makers', collectBusiness: true });
    expect(res.status).toBe(201);
    expect(res.body.collectBusiness).toBe(true);
  });

  it('an ORGANIZER can delete a form without applications', async () => {
    const res = await create({ kind: 'FREE', name: 'Delete me' });
    const del = await request(app).delete(`${forms()}/${res.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBeLessThan(300);
  });

  it('form templates are gone (spec 056): no routes, and templateId is refused', async () => {
    expect((await request(app).get('/admin/application-templates').set('Authorization', `Bearer ${token}`)).status).toBe(404);
    const res = await create({ kind: 'FREE', name: 'From a template', templateId: 'tpl-old' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Unknown form field\(s\): templateId/);
  });

  it('setup is accepted on create only', async () => {
    const res = await create({ kind: 'FREE', name: 'Bad flag', setup: 'yes' });
    expect(res.status).toBe(400);
  });
});
