// Contract tests for Settings › Notifications (spec 053 card A): list,
// edit, reset, preview and test send of store-edited system emails, the
// settings.notifications permission, and the order confirmation using the
// store's wording while its order blocks stay fixed.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: permissionService } = await import('../../src/services/PermissionService.js');
const { default: resend } = await import('../../src/config/resend.js');
const { default: emailService } = await import('../../src/services/EmailService.js');

const TAG = 'notif-tpl-ct';
const KEY = 'order.confirmation';

describe('Settings › Notifications (spec 053)', () => {
  let adminToken;
  let organizerToken;
  let adminBToken;
  let org;
  let orgB;
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `admin-b@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];
  const send = jest.spyOn(resend.emails, 'send');

  beforeAll(async () => {
    permissionService._cache = { at: Date.now() + 3_600_000, value: { ADMIN: {}, ORGANIZER: {}, disabled: [] } };
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    adminBToken = await staffToken({ email: emails[2], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Retro` } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    await joinOrgByToken(adminBToken, orgB.id, 'ADMIN');
  });

  beforeEach(() => send.mockClear());

  afterAll(async () => {
    permissionService.clearCache();
    send.mockRestore();
    await prisma.notificationTemplate.deleteMany({ where: { organizationId: { in: [org.id, orgB.id] } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, orgB.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('lists the order confirmation with its defaults, blocks and merge fields', async () => {
    const res = await request(app).get('/admin/settings/notifications').set(...auth(adminToken));
    expect(res.status).toBe(200);
    const orders = res.body.groups.find((g) => g.key === 'orders');
    expect(orders.label).toBe('Orders & tickets');
    const row = orders.notifications.find((n) => n.key === KEY);
    expect(row).toMatchObject({ label: 'Order confirmation', isDefault: true, subject: 'Order Confirmed — {{event.name}} ({{order.ref}})' });
    expect(row.blocks.length).toBeGreaterThan(0);
    expect(row.mergeFields.map((m) => m.key)).toContain('buyer.firstName');
  });

  it('saves, keeps it per organization, and resets to the default', async () => {
    const put = await request(app).put(`/admin/settings/notifications/${KEY}`).set(...auth(adminToken)).send({ subject: 'Your {{event.name}} tickets', body: 'Thanks, {{buyer.firstName}}!' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ isDefault: false, subject: 'Your {{event.name}} tickets' });

    const other = await request(app).get('/admin/settings/notifications').set(...auth(adminBToken));
    expect(other.body.groups[0].notifications.find((n) => n.key === KEY).isDefault).toBe(true);

    const reset = await request(app).delete(`/admin/settings/notifications/${KEY}`).set(...auth(adminToken));
    expect(reset.status).toBe(200);
    expect(reset.body.isDefault).toBe(true);
  });

  it('refuses bad input: unknown key 404, empty subject or unbalanced section 400, extra fields 400', async () => {
    expect((await request(app).put('/admin/settings/notifications/nope').set(...auth(adminToken)).send({ subject: 'a', body: 'b' })).status).toBe(404);
    expect((await request(app).put(`/admin/settings/notifications/${KEY}`).set(...auth(adminToken)).send({ subject: ' ', body: 'b' })).status).toBe(400);
    expect((await request(app).put(`/admin/settings/notifications/${KEY}`).set(...auth(adminToken)).send({ subject: 'a', body: '{{#order}}x' })).status).toBe(400);
    expect((await request(app).put(`/admin/settings/notifications/${KEY}`).set(...auth(adminToken)).send({ subject: 'a', body: 'b', html: '<b>' })).status).toBe(400);
  });

  it('ORGANIZER can view and preview but not edit, reset or send a test', async () => {
    expect((await request(app).get('/admin/settings/notifications').set(...auth(organizerToken))).status).toBe(200);
    expect((await request(app).post(`/admin/settings/notifications/${KEY}/preview`).set(...auth(organizerToken)).send({})).status).toBe(200);
    expect((await request(app).put(`/admin/settings/notifications/${KEY}`).set(...auth(organizerToken)).send({ subject: 'a', body: 'b' })).status).toBe(403);
    expect((await request(app).delete(`/admin/settings/notifications/${KEY}`).set(...auth(organizerToken))).status).toBe(403);
    expect((await request(app).post(`/admin/settings/notifications/${KEY}/test`).set(...auth(organizerToken)).send({})).status).toBe(403);
  });

  it('an ADMIN whose role lost settings.notifications gets 403 on edits', async () => {
    permissionService._cache = { at: Date.now() + 3_600_000, value: { ADMIN: { 'settings.notifications': false }, ORGANIZER: {}, disabled: [] } };
    try {
      expect((await request(app).put(`/admin/settings/notifications/${KEY}`).set(...auth(adminToken)).send({ subject: 'a', body: 'b' })).status).toBe(403);
    } finally {
      permissionService._cache = { at: Date.now() + 3_600_000, value: { ADMIN: {}, ORGANIZER: {}, disabled: [] } };
    }
  });

  it('previews an unsaved draft against sample data, escaping merged text', async () => {
    const res = await request(app)
      .post(`/admin/settings/notifications/${KEY}/preview`)
      .set(...auth(adminToken))
      .send({ subject: 'Tickets for {{event.name}}', body: 'Hi {{buyer.firstName}} <script>x</script>' });
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Tickets for Sample event');
    expect(res.body.html).toContain('Hi Alex &lt;script&gt;x&lt;/script&gt;');
    expect(res.body.html).not.toContain('<script>');
    expect(res.body.html).toContain('View Tickets');
    expect(res.body.html).toContain('ORD-SAMPLE');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a test of the draft to the staff member only', async () => {
    const res = await request(app).post(`/admin/settings/notifications/${KEY}/test`).set(...auth(adminToken)).send({ subject: 'Draft {{order.ref}}', body: 'Hello' });
    expect(res.status).toBe(200);
    expect(res.body.sentTo).toBe(emails[0]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: [emails[0]], subject: '[Test] Draft ORD-SAMPLE' });
  });

  it('the order confirmation uses the store wording and keeps the order blocks', async () => {
    await request(app).put(`/admin/settings/notifications/${KEY}`).set(...auth(adminToken)).send({ subject: '{{organization.name}}: {{order.ref}}', body: 'See you soon, {{buyer.firstName}}.' });
    const order = {
      id: 'ord-ct',
      orderRef: 'ORD-CT1',
      totalAmount: 40,
      contact: { firstName: 'Sam', email: `buyer@${TAG}.test` },
      event: { name: `${TAG} Expo` },
      organization: { id: org.id, name: org.name },
      addOns: [],
    };
    await emailService.sendOrderConfirmation(order, [{ priceTier: { name: 'GA' } }]);
    const msg = send.mock.calls[0][0];
    expect(msg.subject).toBe(`${org.name}: ORD-CT1`);
    expect(msg.text).toBe('See you soon, Sam.');
    expect(msg.html).toContain('See you soon, Sam.');
    expect(msg.html).toContain('1x GA');
    expect(msg.html).toContain('$40.00');
    expect(msg.html).toContain('View Tickets');
  });

  it('an organization that never edited gets the default wording', async () => {
    await emailService.sendOrderConfirmation(
      { id: 'ord-ct2', orderRef: 'ORD-CT2', totalAmount: 10, contact: { email: `buyer@${TAG}.test` }, event: { name: 'Gala' }, organization: { id: orgB.id, name: orgB.name }, addOns: [] },
      [{ priceTier: { name: 'GA' } }]
    );
    const msg = send.mock.calls[0][0];
    expect(msg.subject).toBe('Order Confirmed — Gala (ORD-CT2)');
    expect(msg.text).toBe('Hi there,\n\nYour order ORD-CT2 has been confirmed.');
  });
});
