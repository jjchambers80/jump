// Contract test for createForm's per-purpose defaults (spec 050 §5.2, card
// 050-L): what the wizard's "Blank form" gets for each purpose, created by an
// ORGANIZER (050-E opened form configuration to them).

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { defaultsFor } from '../../src/services/applicationFormDefaults.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'form-defaults-ct';

describe('createForm defaults per purpose (spec 050 §5.2)', () => {
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
    await prisma.event.deleteMany({ where: { id: eventId } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(emails);
  });

  const cases = [
    { purpose: 'VENDOR', kind: 'PAID', collectBusiness: true },
    { purpose: 'VENDOR', kind: 'FREE', collectBusiness: true },
    { purpose: 'SPECIAL_GUEST', kind: 'FREE', collectBusiness: true },
    { purpose: 'VOLUNTEER', kind: 'FREE', collectBusiness: false },
    { purpose: 'SPONSOR', kind: 'PAID', collectBusiness: true },
    { purpose: 'PRESS', kind: 'FREE', collectBusiness: true },
    { purpose: 'PANEL', kind: 'FREE', collectBusiness: true },
    { purpose: 'OTHER', kind: 'FREE', collectBusiness: true },
  ];

  it.each(cases)('$purpose ($kind) starts from its defaults', async ({ purpose, kind, collectBusiness }) => {
    const res = await create({ kind, purpose, name: `${purpose} ${kind}` });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ purpose, kind, status: 'DRAFT', collectBusiness });
    const expected = (defaultsFor(purpose).questions ?? []).map((q) => ({ label: q.label, type: q.type, required: q.required }));
    expect(res.body.questions.map((q) => ({ label: q.label, type: q.type, required: q.required }))).toEqual(expected);
  });

  it('the vendor, guest and volunteer defaults are not empty', () => {
    for (const purpose of ['VENDOR', 'SPECIAL_GUEST', 'VOLUNTEER']) expect(defaultsFor(purpose).questions.length).toBeGreaterThan(0);
    for (const purpose of ['SPONSOR', 'PRESS', 'PANEL', 'OTHER']) expect(defaultsFor(purpose)).toEqual({});
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
});
