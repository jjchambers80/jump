// Contract tests for CSV import into a manual list (spec 055-D).

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { issueReauthProof } = await import('../../src/middleware/recentAuth.js');
const { suppressionHash } = await import('../../src/services/ContactErasureService.js');

const TAG = 'contact-import-ct';
const RUN_ID = Date.now();
const mail = (key) => `${key}-${RUN_ID}@${TAG}.test`;

describe('Contact list CSV import (spec 055-D)', () => {
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`];
  let adminToken;
  let organizerToken;
  let reauth;
  let org;
  let otherOrg;
  let list;
  let autoList;
  let existing;
  const auth = (token) => ['Authorization', `Bearer ${token}`];

  const csv = (lines) => Buffer.from(lines.join('\r\n'), 'utf8');
  const preview = (body, listId = list.id) =>
    request(app).post(`/admin/contact-lists/${listId}/import/preview`).set(...auth(adminToken)).attach('file', body, 'contacts.csv');
  const runImport = (body, mapping, { listId = list.id, token = adminToken, proof = reauth, name = 'contacts.csv' } = {}) => {
    const req = request(app).post(`/admin/contact-lists/${listId}/import`).set(...auth(token));
    if (proof) req.set('X-Jump-Reauth', proof);
    return req.field('mapping', JSON.stringify(mapping)).attach('file', body, name);
  };

  beforeAll(async () => {
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    reauth = issueReauthProof(jwt.decode(adminToken).sub).reauthToken;
    org = await prisma.organization.create({ data: { name: `${TAG} Org ${RUN_ID}`, email: `owner@${TAG}.test` } });
    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other ${RUN_ID}`, email: `owner2@${TAG}.test` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');

    existing = await prisma.contact.create({
      data: { organizationId: org.id, email: mail('existing'), firstName: 'Kept', lastName: 'Name', emailSubscribed: true, tags: ['VIP'] },
    });
    await prisma.contact.create({
      data: { organizationId: org.id, email: mail('leaving'), firstName: 'Leaving', lastName: 'Soon', erasureScheduledAt: new Date() },
    });
    await prisma.erasureSuppression.create({ data: { organizationId: org.id, emailHash: suppressionHash(mail('erased')) } });
    // Same email at another organization: a different person here (Gotcha 8).
    await prisma.contact.create({ data: { organizationId: otherOrg.id, email: mail('elsewhere'), firstName: 'Other', lastName: 'Org' } });

    list = (await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name: `Import ${RUN_ID}`, type: 'MANUAL' })).body;
    autoList = (await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name: `Auto ${RUN_ID}`, type: 'AUTOMATIC', filters: {} })).body;
  });

  afterAll(async () => {
    for (const o of [org, otherOrg].filter(Boolean)) {
      await prisma.contactList.deleteMany({ where: { organizationId: o.id } });
      await prisma.erasureSuppression.deleteMany({ where: { organizationId: o.id } });
      await prisma.contactComment.deleteMany({ where: { organizationId: o.id } });
      await prisma.contact.deleteMany({ where: { organizationId: o.id } });
      await prisma.organization.delete({ where: { id: o.id } });
    }
    await cleanupStaff(emails);
  });

  const FILE = csv([
    '﻿E-mail,First name,Last name,Phone,Tags',
    `${mail('existing').toUpperCase()},Changed,Person,+19195550100,"Volunteer, VIP"`,
    `${mail('new')},Ada,Lovelace,+19195550123,Volunteer`,
    'not-an-email,Bad,Row,,',
    `${mail('new')},Ada,Again,,`,
    `${mail('erased')},Gone,Person,,`,
    `${mail('leaving')},Leaving,Soon,,`,
    `${mail('elsewhere')},"Quoted, Name",Here,,`,
  ]);

  it('previews the columns and guesses the mapping', async () => {
    const res = await preview(FILE);
    expect(res.status).toBe(200);
    expect(res.body.headers).toEqual(['E-mail', 'First name', 'Last name', 'Phone', 'Tags']);
    expect(res.body.mapping).toEqual({ email: 0, firstName: 1, lastName: 2, name: null, phone: 3, tags: 4 });
    expect(res.body.rowCount).toBe(7);
    expect(res.body.sample).toHaveLength(5);
  });

  it('imports: joins existing contacts unchanged, creates unsubscribed ones, skips with reasons', async () => {
    const mapping = { email: 0, firstName: 1, lastName: 2, phone: 3, tags: 4 };
    const res = await runImport(FILE, mapping);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rowCount: 7, added: 3, created: 2, alreadyOn: 0 });
    expect(res.body.skipped).toEqual([
      { row: 4, email: 'not-an-email', reason: 'invalid email' },
      { row: 5, email: mail('new'), reason: 'duplicate in file' },
      { row: 6, email: mail('erased'), reason: 'contact asked to be deleted' },
      { row: 7, email: mail('leaving'), reason: 'contact asked to be deleted' },
    ]);

    // Existing: name and opt-in untouched, the file's tags added.
    const kept = await prisma.contact.findUnique({ where: { id: existing.id } });
    expect(kept).toMatchObject({ firstName: 'Kept', lastName: 'Name', emailSubscribed: true, phone: null });
    expect(kept.tags.sort()).toEqual(['VIP', 'Volunteer']);

    // New: never subscribed, with name, phone, tags and a staff timeline note.
    const created = await prisma.contact.findUnique({ where: { organizationId_email: { organizationId: org.id, email: mail('new') } } });
    expect(created).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', phone: '+19195550123', emailSubscribed: false, tags: ['Volunteer'] });
    const note = await prisma.contactComment.findFirst({ where: { contactId: created.id } });
    expect(note).toMatchObject({ authorUserId: jwt.decode(adminToken).sub, body: `Created by import into “Import ${RUN_ID}”` });
    expect(await prisma.legalAcceptance.count({ where: { subjectId: created.id } })).toBe(0);

    // The other organization's contact is not touched; this org gets its own.
    const here = await prisma.contact.findUnique({ where: { organizationId_email: { organizationId: org.id, email: mail('elsewhere') } } });
    expect(here).toMatchObject({ firstName: 'Quoted, Name', lastName: 'Here' });
    expect(await prisma.contact.count({ where: { email: mail('elsewhere') } })).toBe(2);
    // No contact is created for an erased address.
    expect(await prisma.contact.count({ where: { organizationId: org.id, email: mail('erased') } })).toBe(0);

    const again = await runImport(FILE, mapping);
    expect(again.body).toMatchObject({ added: 0, created: 0, alreadyOn: 3 });
  });

  it('splits a full Name column when there are no first / last columns', async () => {
    const res = await runImport(csv(['Name,Email', `Grace Brewster Hopper,${mail('grace')}`]), { email: 1, name: 0 });
    expect(res.body).toMatchObject({ added: 1, created: 1 });
    const grace = await prisma.contact.findUnique({ where: { organizationId_email: { organizationId: org.id, email: mail('grace') } } });
    expect(grace).toMatchObject({ firstName: 'Grace Brewster', lastName: 'Hopper' });
  });

  it('refuses bad files, bad mappings, automatic lists, missing step-up and roles without customers.import', async () => {
    expect((await runImport(FILE, { firstName: 1 })).status).toBe(400);
    expect((await runImport(FILE, { email: 9 })).status).toBe(400);
    expect((await runImport(FILE, { email: 0, segment: 1 })).status).toBe(400);
    expect((await runImport(csv(['Email']), { email: 0 })).status).toBe(400);
    expect((await runImport(FILE, { email: 0 }, { name: 'contacts.xlsx' })).status).toBe(400);
    const auto = await runImport(FILE, { email: 0 }, { listId: autoList.id });
    expect(auto.status).toBe(409);
    expect(auto.body.code).toBe('LIST_NOT_MANUAL');
    const noProof = await runImport(FILE, { email: 0 }, { proof: null });
    expect(noProof.status).toBe(401);
    expect(noProof.body.code).toBe('REAUTH_REQUIRED');
    const organizer = await runImport(FILE, { email: 0 }, { token: organizerToken, proof: issueReauthProof(jwt.decode(organizerToken).sub).reauthToken });
    expect(organizer.status).toBe(403);
  });
});
