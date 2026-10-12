// Contract tests for Contacts › Lists (spec 055-A): list CRUD, built-ins,
// automatic filters, manual members, tenancy and permissions.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: permissionService } = await import('../../src/services/PermissionService.js');

const TAG = 'contact-lists-ct';
const RUN_ID = Date.now();
const DAY = 24 * 60 * 60 * 1000;

describe('Contact lists contract (spec 055-A)', () => {
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `other@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];
  let adminToken;
  let organizerToken;
  let otherToken;
  let org;
  let otherOrg;
  let event;
  let otherEvent;
  let tier;
  const c = {};

  async function contact(key, data = {}, organizationId = org.id) {
    c[key] = await prisma.contact.create({
      data: { organizationId, email: `${key}-${RUN_ID}@${TAG}.test`, firstName: key, lastName: 'Test', ...data },
    });
    return c[key];
  }

  async function paidOrder(contactRow, { amount, eventId = event.id, paidAt = new Date(), suffix }) {
    await prisma.order.create({
      data: {
        organizationId: contactRow.organizationId,
        contactId: contactRow.id,
        eventId,
        orderRef: `JMP-${TAG}-${RUN_ID}-${suffix}`,
        kind: 'TICKET',
        status: 'COMPLETED',
        totalAmount: amount,
        quantity: 1,
        paidAt,
        items: { create: { priceTierId: tier.id, quantity: 1, unitPrice: amount } },
      },
    });
  }

  const listContacts = async (listId, token = adminToken) => {
    const res = await request(app)
      .get(`/admin/customers?scope=all&limit=100&list=${encodeURIComponent(listId)}`)
      .set(...auth(token));
    expect(res.status).toBe(200);
    return res.body.data.map((row) => row.firstName).sort();
  };

  beforeAll(async () => {
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[2], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org ${RUN_ID}`, email: `owner@${TAG}.test` } });
    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other ${RUN_ID}`, email: `owner2@${TAG}.test` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrg.id, 'ADMIN');
    const venue = await prisma.venue.create({
      data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC' },
    });
    event = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Spring`, date: new Date('2027-04-01T15:00:00Z'), status: 'PUBLISHED', capacity: 100 },
    });
    otherEvent = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Fall`, date: new Date('2027-10-01T15:00:00Z'), status: 'PUBLISHED', capacity: 100 },
    });
    tier = await prisma.priceTier.create({ data: { eventId: event.id, name: 'GA', price: 10, quantityTotal: 100 } });

    // big: $120 at Spring, recent. small: $20 at Fall, 400 days ago. vip: subscribed + tag, no orders.
    await paidOrder(await contact('big'), { amount: 120, suffix: 'BIG' });
    await paidOrder(await contact('small'), {
      amount: 20,
      eventId: otherEvent.id,
      paidAt: new Date(Date.now() - 400 * DAY),
      suffix: 'SMALL',
    });
    await contact('vip', { emailSubscribed: true, tags: ['VIP'] });
    await contact('plain');
    await contact('foreign', {}, otherOrg.id);
  });

  afterAll(async () => {
    permissionService.clearCache();
    for (const o of [org, otherOrg].filter(Boolean)) {
      await prisma.contactList.deleteMany({ where: { organizationId: o.id } });
      await prisma.order.deleteMany({ where: { organizationId: o.id } });
      await prisma.contact.deleteMany({ where: { organizationId: o.id } });
      await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: o.id } } } });
      await prisma.event.deleteMany({ where: { venue: { organizationId: o.id } } });
      await prisma.venue.deleteMany({ where: { organizationId: o.id } });
      await prisma.organization.delete({ where: { id: o.id } });
    }
    await cleanupStaff(emails);
  });

  afterEach(() => permissionService.clearCache());

  it('lists the three built-ins first, read-only, with live counts', async () => {
    const res = await request(app).get('/admin/contact-lists').set(...auth(adminToken));
    expect(res.status).toBe(200);
    const builtIns = res.body.lists.filter((list) => list.builtIn);
    expect(builtIns.map((list) => [list.id, list.contactCount])).toEqual([
      ['builtin:all', 4],
      ['builtin:paying', 2],
      ['builtin:subscribers', 1],
    ]);
    expect(builtIns.every((list) => list.createdBy === null)).toBe(true);

    expect((await request(app).patch('/admin/contact-lists/builtin:all').set(...auth(adminToken)).send({ name: 'X' })).status).toBe(403);
    const del = await request(app).delete('/admin/contact-lists/builtin:paying').set(...auth(adminToken));
    expect(del.status).toBe(403);
    expect(del.body.code).toBe('BUILT_IN_LIST');
    expect(await listContacts('builtin:subscribers')).toEqual(['vip']);
  });

  it('automatic list filters: ticket event, minimum spend, recent activity, tag', async () => {
    const make = async (name, filters) => {
      const res = await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name, type: 'AUTOMATIC', filters });
      expect(res.status).toBe(201);
      return res.body;
    };
    expect(await listContacts((await make('Spring buyers', { ticketEventId: event.id })).id)).toEqual(['big']);
    expect(await listContacts((await make('Big spenders', { minSpent: 50 })).id)).toEqual(['big']);
    expect(await listContacts((await make('Spent anything', { minSpent: 0.01 })).id)).toEqual(['big', 'small']);
    expect(await listContacts((await make('Active this year', { activeWithinDays: 365 })).id)).toEqual(['big']);
    expect(await listContacts((await make('VIPs', { tag: 'VIP', source: 'subscribed' })).id)).toEqual(['vip']);

    const preview = await request(app).post('/admin/contact-lists/preview').set(...auth(adminToken)).send({ filters: { minSpent: 0.01 } });
    expect(preview.status).toBe(200);
    expect(preview.body.count).toBe(2);
    expect(preview.body.sample).toHaveLength(2);
  });

  it('rejects unknown filters, duplicate names (any case) and filters on a manual list', async () => {
    const bad = await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name: 'Bad', type: 'AUTOMATIC', filters: { segment: 'New' } });
    expect(bad.status).toBe(400);
    expect(bad.body.details[0].field).toBe('filters.segment');

    const orphanForm = await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name: 'Bad 2', type: 'AUTOMATIC', filters: { formId: 'x' } });
    expect(orphanForm.status).toBe(400);

    await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name: 'Volunteers', type: 'MANUAL' });
    const dup = await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name: 'volunteers', type: 'MANUAL' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('LIST_NAME_TAKEN');
    const builtInName = await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name: 'All Contacts', type: 'MANUAL' });
    expect(builtInName.status).toBe(409);

    const manualFilters = await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name: 'M', type: 'MANUAL', filters: { tag: 'x' } });
    expect(manualFilters.status).toBe(400);
  });

  it('manual lists: add, re-add, remove, duplicate, rename, delete keeps contacts', async () => {
    const created = await request(app).post('/admin/contact-lists').set(...auth(organizerToken)).send({ name: 'Crew', type: 'MANUAL' });
    expect(created.status).toBe(201);
    expect(created.body.createdBy.id).toBeTruthy();
    const listId = created.body.id;
    const add = (ids) => request(app).post(`/admin/contact-lists/${listId}/members`).set(...auth(organizerToken)).send({ contactIds: ids });

    expect((await add([c.plain.id, c.vip.id])).body).toEqual({ added: 2, alreadyOn: 0 });
    expect((await add([c.plain.id])).body).toEqual({ added: 0, alreadyOn: 1 });
    expect(await listContacts(listId)).toEqual(['plain', 'vip']);

    const forContact = await request(app).get(`/admin/customers/${c.plain.id}/lists`).set(...auth(adminToken));
    expect(forContact.body.lists.map((list) => list.name)).toEqual(['Crew']);

    const copy = await request(app).post(`/admin/contact-lists/${listId}/duplicate`).set(...auth(adminToken));
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ name: 'Copy of Crew', type: 'MANUAL', contactCount: 2 });

    const removed = await request(app).delete(`/admin/contact-lists/${listId}/members`).set(...auth(organizerToken)).send({ contactIds: [c.vip.id] });
    expect(removed.body).toEqual({ removed: 1 });
    expect(await listContacts(listId)).toEqual(['plain']);

    const renamed = await request(app).patch(`/admin/contact-lists/${listId}`).set(...auth(adminToken)).send({ name: 'Stage crew' });
    expect(renamed.body.name).toBe('Stage crew');
    const typeChange = await request(app).patch(`/admin/contact-lists/${listId}`).set(...auth(adminToken)).send({ type: 'AUTOMATIC' });
    expect(typeChange.status).toBe(400);
    const filtersOnManual = await request(app).patch(`/admin/contact-lists/${listId}`).set(...auth(adminToken)).send({ filters: { tag: 'VIP' } });
    expect(filtersOnManual.status).toBe(409);

    expect((await request(app).delete(`/admin/contact-lists/${listId}`).set(...auth(adminToken))).status).toBe(204);
    expect(await prisma.contact.count({ where: { id: c.plain.id } })).toBe(1);

    const auto = await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name: 'Auto', type: 'AUTOMATIC', filters: {} });
    const noMembers = await request(app).post(`/admin/contact-lists/${auto.body.id}/members`).set(...auth(adminToken)).send({ contactIds: [c.plain.id] });
    expect(noMembers.status).toBe(409);
    expect(noMembers.body.code).toBe('LIST_NOT_MANUAL');
  });

  it('keeps lists and contacts inside their organization', async () => {
    const mine = await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name: 'Mine', type: 'MANUAL' });
    // Another org's contact id is not found, never a silent add.
    const foreign = await request(app).post(`/admin/contact-lists/${mine.body.id}/members`).set(...auth(adminToken)).send({ contactIds: [c.foreign.id] });
    expect(foreign.status).toBe(404);
    expect(await prisma.contactListMember.count({ where: { listId: mine.body.id } })).toBe(0);

    // Another org's staff cannot see, read through, change or delete it.
    expect((await request(app).get(`/admin/contact-lists/${mine.body.id}`).set(...auth(otherToken))).status).toBe(404);
    expect((await request(app).get(`/admin/customers?scope=all&list=${mine.body.id}`).set(...auth(otherToken))).status).toBe(404);
    expect((await request(app).patch(`/admin/contact-lists/${mine.body.id}`).set(...auth(otherToken)).send({ name: 'Theirs' })).status).toBe(404);
    expect((await request(app).delete(`/admin/contact-lists/${mine.body.id}`).set(...auth(otherToken))).status).toBe(404);
    const theirs = await request(app).get('/admin/contact-lists').set(...auth(otherToken));
    expect(theirs.body.lists.find((list) => list.id === mine.body.id)).toBeUndefined();
    expect(theirs.body.lists.find((list) => list.id === 'builtin:all').contactCount).toBe(1);
  });

  it('erasure removes the contact from every list; the staff export names them', async () => {
    const list = await request(app).post('/admin/contact-lists').set(...auth(adminToken)).send({ name: `Gone ${RUN_ID}`, type: 'MANUAL' });
    const person = await contact('erased');
    await request(app).post(`/admin/contact-lists/${list.body.id}/members`).set(...auth(adminToken)).send({ contactIds: [person.id] });

    const exported = await request(app).get(`/admin/customers/${person.id}/export`).set(...auth(adminToken));
    expect(exported.status).toBe(200);
    expect(exported.body.contactLists.map((entry) => entry.name)).toEqual([`Gone ${RUN_ID}`]);

    const { default: contactErasureService } = await import('../../src/services/ContactErasureService.js');
    await contactErasureService.erase(person.id);
    expect(await prisma.contactListMember.count({ where: { contactId: person.id } })).toBe(0);
  });

  it('403s every route for a role with Contacts hidden, and writes without customers.lists', async () => {
    permissionService._cache = { at: Date.now() + 3_600_000, value: { ADMIN: {}, ORGANIZER: { customers: false }, disabled: [] } };
    expect((await request(app).get('/admin/contact-lists').set(...auth(organizerToken))).status).toBe(403);
    expect((await request(app).post('/admin/contact-lists/preview').set(...auth(organizerToken)).send({ filters: {} })).status).toBe(403);

    permissionService._cache = { at: Date.now() + 3_600_000, value: { ADMIN: {}, ORGANIZER: { 'customers.lists': false }, disabled: [] } };
    expect((await request(app).get('/admin/contact-lists').set(...auth(organizerToken))).status).toBe(200);
    expect((await request(app).post('/admin/contact-lists').set(...auth(organizerToken)).send({ name: 'No', type: 'MANUAL' })).status).toBe(403);
    expect((await request(app).delete('/admin/contact-lists/anything').set(...auth(organizerToken))).status).toBe(403);
  });
});
