// Contract tests for Settings › Notifications (spec 053 cards A + B): list,
// edit, reset, preview and test send of store-edited system emails, the
// settings.notifications permission, the optional RSVP reminder switch, and
// each email using the store's wording while its system blocks stay fixed.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: permissionService } = await import('../../src/services/PermissionService.js');
const { default: resend } = await import('../../src/config/resend.js');
const { default: emailService } = await import('../../src/services/EmailService.js');
const { default: applicationTemplateService } = await import('../../src/services/ApplicationTemplateService.js');

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
    org = await prisma.organization.create({ data: { name: `${TAG} Retro`, email: `store@${TAG}.test` } });
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
  it('lists every registry email in its group; only the reminder is optional', async () => {
    const res = await request(app).get('/admin/settings/notifications').set(...auth(adminToken));
    const byGroup = Object.fromEntries(res.body.groups.map((g) => [g.key, g.notifications.map((n) => n.key)]));
    expect(byGroup).toEqual({
      orders: ['order.confirmation', 'order.event_cancelled'],
      rsvps: ['rsvp.confirmation', 'rsvp.reminder', 'rsvp.cancelled'],
      applicationPayments: ['application.receipt'],
      applications: ['RECEIVED', 'APPROVED', 'CHOOSE_SPACE', 'REJECTED', 'WAITLISTED', 'WITHDRAWN', 'PAYMENT_DUE', 'ADD_ONS_CHANGED', 'TIER_CHANGED', 'WAIVED', 'OFFLINE_PAID'].map((a) => `application.event.${a}`),
      standingForms: ['RECEIVED', 'APPROVED', 'WAITLISTED', 'REJECTED'].map((a) => `application.standing.${a}`),
    });
    const optional = res.body.groups.flatMap((g) => g.notifications).filter((n) => n.optional).map((n) => n.key);
    expect(optional).toEqual(['rsvp.reminder']);
  });

  it('every email previews against sample data', async () => {
    for (const key of ['order.confirmation', 'rsvp.confirmation', 'rsvp.reminder', 'rsvp.cancelled', 'application.receipt', 'application.event.CHOOSE_SPACE', 'application.standing.RECEIVED']) {
      const res = await request(app).post(`/admin/settings/notifications/${key}/preview`).set(...auth(adminToken)).send({});
      expect(res.status).toBe(200);
      expect(res.body.subject).not.toMatch(/\{\{/);
      expect(res.body.html).toMatch(/Sample|Pat/);
    }
  });

  it('the reminder can be switched off and back on; other emails cannot', async () => {
    const off = await request(app).put('/admin/settings/notifications/rsvp.reminder').set(...auth(adminToken)).send({ subject: 'Tomorrow: {{event.name}}', body: 'See you!', enabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ enabled: false, optional: true, isDefault: false });
    expect((await request(app).put(`/admin/settings/notifications/${KEY}`).set(...auth(adminToken)).send({ subject: 'a', body: 'b', enabled: false })).status).toBe(400);
    expect((await request(app).put('/admin/settings/notifications/rsvp.reminder').set(...auth(adminToken)).send({ subject: 'a', body: 'b', enabled: 'no' })).status).toBe(400);

    const rsvp = {
      id: 'rsvp-ct',
      eventId: 'evt-ct',
      partySize: 2,
      event: { name: `${TAG} Picnic`, date: new Date('2027-06-01T16:00:00Z'), venue: { timezone: 'America/New_York', organization: { id: org.id, name: org.name, email: org.email } } },
      contact: { firstName: 'Kim', email: `guest@${TAG}.test` },
    };
    await emailService.sendRsvpReminder(rsvp, { cancelUrl: 'https://x.test/cancel' });
    expect(send).not.toHaveBeenCalled();

    const on = await request(app).put('/admin/settings/notifications/rsvp.reminder').set(...auth(adminToken)).send({ subject: 'Tomorrow: {{event.name}}', body: 'See you, {{guest.firstName}}!', enabled: true });
    expect(on.body.enabled).toBe(true);
    await emailService.sendRsvpReminder(rsvp, { cancelUrl: 'https://x.test/cancel' });
    const msg = send.mock.calls[0][0];
    expect(msg.subject).toBe(`Tomorrow: ${TAG} Picnic`);
    expect(msg.html).toContain('See you, Kim!');
    expect(msg.html).toContain('Cancel RSVP');
    expect(msg.html).toContain('Party size:');

    const reset = await request(app).delete('/admin/settings/notifications/rsvp.reminder').set(...auth(adminToken));
    expect(reset.body).toMatchObject({ enabled: true, isDefault: true });
  });

  it('application decision emails save through Settings › Notifications and the decision flow reads them', async () => {
    const key = 'application.event.WAITLISTED';
    const put = await request(app).put(`/admin/settings/notifications/${key}`).set(...auth(adminToken)).send({ subject: 'Waitlist: {{event.name}}', body: 'Hang tight, {{applicant.firstName}}.' });
    expect(put.status).toBe(200);
    expect(await applicationTemplateService.getTemplate(org.id, 'WAITLISTED')).toMatchObject({ subject: 'Waitlist: {{event.name}}', isDefault: false });
    const rendered = await applicationTemplateService.render(org.id, 'WAITLISTED', { eventId: 'e1', organizationId: org.id, contact: { firstName: 'Pat' }, event: { name: 'Expo' } });
    expect(rendered).toEqual({ subject: 'Waitlist: Expo', body: 'Hang tight, Pat.' });
    await request(app).delete(`/admin/settings/notifications/${key}`).set(...auth(adminToken));
  });

  it('the RSVP cancellation replies to the store and no longer names support@jump.events', async () => {
    const event = { id: 'evt-ct', name: `${TAG} Picnic`, date: new Date('2027-06-01T16:00:00Z'), admissionMode: 'RSVP', venue: { timezone: 'America/New_York', organization: { id: org.id, name: org.name, email: org.email } } };
    await emailService.sendCancellationNotification(event, [{ contact: { firstName: 'Kim', email: `guest@${TAG}.test` } }, { contact: { firstName: 'Kim', email: `guest@${TAG}.test` } }]);
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0];
    expect(msg.subject).toBe(`Event Cancelled — ${TAG} Picnic`);
    expect(msg.reply_to).toBe(org.email);
    expect(msg.html).not.toContain('support@jump.events');
    expect(msg.text).toContain('reply to this email');
  });

  it('the RSVP confirmation and application receipt use the store wording and keep their blocks', async () => {
    await request(app).put('/admin/settings/notifications/rsvp.confirmation').set(...auth(adminToken)).send({ subject: 'Yes! {{event.name}}', body: 'Party of {{rsvp.partySize}}, {{guest.firstName}}.' });
    await request(app).put('/admin/settings/notifications/application.receipt').set(...auth(adminToken)).send({ subject: 'Paid: {{order.ref}}', body: '{{profile.businessName}} paid {{order.total}}.' });
    const venue = { name: 'Hall', address: '1 Main St', timezone: 'America/New_York', organization: { id: org.id, name: org.name, email: org.email } };
    await emailService.sendRsvpConfirmation(
      { id: 'rsvp-ct2', partySize: 3, event: { name: 'Gala', date: new Date('2027-06-01T16:00:00Z'), venue }, contact: { firstName: 'Kim', email: `guest@${TAG}.test` } },
      { cancelUrl: 'https://x.test/cancel' }
    );
    const conf = send.mock.calls[0][0];
    expect(conf.subject).toBe('Yes! Gala');
    expect(conf.html).toContain('Party of 3, Kim.');
    expect(conf.html).toContain('Cancel your RSVP');
    expect(conf.attachments[0].filename).toBe('gala.ics');

    const ok = await emailService.sendApplicationReceipt(
      { id: 'app-ct', contact: { firstName: 'Pat', email: `vendor@${TAG}.test` }, profile: { businessName: 'Pixel Pins' }, tier: { name: '10x10' }, event: { name: 'Gala', date: new Date('2027-06-01T16:00:00Z'), venue }, order: { id: 'ord-ct3', orderRef: 'APP-CT', totalAmount: 275, payment: { source: 'STRIPE' } } },
      { statusUrl: 'https://x.test/status', lines: [{ label: '10x10 space', amount: 275 }] }
    );
    expect(ok).toBe(true);
    const receipt = send.mock.calls[1][0];
    expect(receipt.subject).toBe('Paid: APP-CT');
    expect(receipt.html).toContain('Pixel Pins paid $275.00.');
    expect(receipt.html).toContain('10x10 space');
    expect(receipt.html).toContain('Total paid');
    expect(receipt.html).toContain('View your application');
  });
});
