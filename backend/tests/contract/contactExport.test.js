// Contract tests for the Contacts / list CSV export (spec 055-E).

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { parseCsv } from '../../src/utils/csv.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { issueReauthProof } = await import('../../src/middleware/recentAuth.js');

const TAG = 'contact-export-ct';
const RUN_ID = Date.now();
const mail = (key) => `${key}-${RUN_ID}@${TAG}.test`;
const today = new Date().toISOString().slice(0, 10);

describe('Contacts CSV export (spec 055-E)', () => {
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `other@${TAG}.test`];
  let adminToken;
  let organizerToken;
  let otherToken;
  let reauth;
  let org;
  let otherOrg;
  let list;
  let otherList;
  let ada;
  const auth = (token) => ['Authorization', `Bearer ${token}`];
  const get = (query, { token = adminToken, proof = reauth } = {}) => {
    const req = request(app).get(`/admin/customers/export.csv${query}`).set(...auth(token)).buffer(true).parse((res, cb) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => cb(null, text));
    });
    if (proof) req.set('X-Jump-Reauth', proof);
    return req;
  };

  beforeAll(async () => {
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[2], role: 'ADMIN' });
    reauth = issueReauthProof(jwt.decode(adminToken).sub).reauthToken;
    org = await prisma.organization.create({ data: { name: `${TAG} Org ${RUN_ID}`, email: `owner@${TAG}.test` } });
    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other ${RUN_ID}`, email: `owner2@${TAG}.test` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrg.id, 'ADMIN');

    ada = await prisma.contact.create({
      data: { organizationId: org.id, email: mail('ada'), firstName: 'Ada', lastName: 'Lovelace', phone: '+19195550123', tags: ['VIP', 'Crew'], emailSubscribed: true },
    });
    await prisma.contact.create({ data: { organizationId: org.id, email: mail('formula'), firstName: '=HYPERLINK("x")', lastName: 'Sneaky' } });
    await prisma.contact.create({ data: { organizationId: otherOrg.id, email: mail('foreign'), firstName: 'Other', lastName: 'Org' } });

    list = (await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name: 'Stage Crew!', type: 'MANUAL' })).body;
    await request(app).post(`/admin/contact-lists/${list.id}/members`).set(...auth(adminToken)).send({ contactIds: [ada.id] });
    otherList = (await request(app).post('/admin/contact-lists').set(...auth(otherToken)).send({ name: 'Theirs', type: 'MANUAL' })).body;
  });

  afterAll(async () => {
    for (const o of [org, otherOrg].filter(Boolean)) {
      await prisma.contactList.deleteMany({ where: { organizationId: o.id } });
      await prisma.contact.deleteMany({ where: { organizationId: o.id } });
      await prisma.organization.delete({ where: { id: o.id } });
    }
    await cleanupStaff(emails);
  });

  it('exports every contact for the filters, with safe cells and a dated filename', async () => {
    const res = await get('?scope=all&sort=name');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="contacts-${today}.csv"`);
    const rows = parseCsv(res.body);
    expect(rows[0]).toEqual(['First name', 'Last name', 'Email', 'Phone', 'Tags', 'Subscribed', 'Sources', 'Total spent', 'Last activity', 'Created']);
    expect(rows).toHaveLength(3);
    const byEmail = Object.fromEntries(rows.slice(1).map((row) => [row[2], row]));
    expect(byEmail[mail('ada')]).toEqual(['Ada', 'Lovelace', mail('ada'), '+19195550123', 'VIP; Crew', 'Yes', 'Subscribed', '0.00', '', today]);
    // A formula never reaches the spreadsheet as one.
    expect(byEmail[mail('formula')][0]).toBe(`'=HYPERLINK("x")`);
    // Another organization's contact is never in the file.
    expect(res.body).not.toContain(mail('foreign'));

    const filtered = await get(`?scope=all&search=${encodeURIComponent('Lovelace')}`);
    expect(parseCsv(filtered.body)).toHaveLength(2);
  });

  it("exports one list, named after it, and refuses another organization's list", async () => {
    const res = await get(`?scope=all&list=${list.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="stage-crew-contacts-${today}.csv"`);
    expect(parseCsv(res.body).slice(1).map((row) => row[2])).toEqual([mail('ada')]);

    const builtIn = await get('?scope=all&list=builtin:subscribers');
    expect(builtIn.headers['content-disposition']).toBe(`attachment; filename="email-subscribers-contacts-${today}.csv"`);

    expect((await get(`?scope=all&list=${otherList.id}`)).status).toBe(404);
  });

  it('logs the download in the activity log', async () => {
    await get('?scope=all');
    // The audit trail is flushed after the response goes out.
    let logged = 0;
    for (let i = 0; i < 40 && !logged; i += 1) {
      logged = await prisma.auditLog.count({ where: { organizationId: org.id, action: 'data.exported', entityLabel: `contacts-${today}.csv` } });
      if (!logged) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(logged).toBeGreaterThan(0);
  });

  it('needs a step-up, customers.export (ADMIN by default) and a valid scope', async () => {
    const noProof = await get('?scope=all', { proof: null });
    expect(noProof.status).toBe(401);
    expect(JSON.parse(noProof.body).code).toBe('REAUTH_REQUIRED');
    const organizer = await get('?scope=all', { token: organizerToken, proof: issueReauthProof(jwt.decode(organizerToken).sub).reauthToken });
    expect(organizer.status).toBe(403);
    expect((await get('?scope=everyone')).status).toBe(400);
  });
});
