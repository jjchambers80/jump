// Contract tests for page templates and the storefront contact form (spec 042):
// SYSTEM_ADMIN-only upload / replace / delete, assigning a template to a page,
// the public page payload, and contact-form delivery. Resend mocked.

import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const sentEmails = [];
let failNextEmail = false;
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: {
    emails: {
      send: jest.fn(async (msg) => {
        if (failNextEmail) {
          failNextEmail = false;
          return { data: null, error: { name: 'validation_error', message: 'refused' } };
        }
        sentEmails.push(msg);
        return { data: { id: 'mock' }, error: null };
      }),
    },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'page-templates-ct';
const emails = [
  `organizer@${TAG}.test`,
  `admin@${TAG}.test`,
  `sys@${TAG}.test`,
  `other@${TAG}.test`,
];
const auth = (token) => ['Authorization', `Bearer ${token}`];
const contactManifest = JSON.parse(
  readFileSync(new URL('../../../templates/pages/page.contact.json', import.meta.url), 'utf8')
);

describe('Page templates + contact form contract (spec 042)', () => {
  let organization;
  let otherOrganization;
  let organizerToken;
  let adminToken;
  let sysToken;
  let otherToken;
  let template;
  let page;

  const asSys = (req) => req.set(...auth(sysToken)).set('X-Jump-Org', organization.id);
  const contactUrl = (slug = page.slug) => `/organizations/${organization.id}/public/pages/${slug}/contact`;
  const message = {
    name: 'Ada Lovelace',
    email: 'Ada@Example.com',
    phone: '555-0100',
    subject: 'Booth question',
    message: 'Do you have power at the booths?\nThanks!',
  };

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    organizerToken = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    adminToken = await staffToken({ email: emails[1], role: 'ADMIN' });
    sysToken = await staffToken({ email: emails[2], role: 'SYSTEM_ADMIN' });
    otherToken = await staffToken({ email: emails[3], role: 'ORGANIZER' });
    organization = await prisma.organization.create({
      data: { name: `${TAG} Store`, email: 'store@page-templates-ct.test' },
    });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    await joinOrgByToken(otherToken, otherOrganization.id, 'ORGANIZER');
  });

  afterAll(async () => {
    await prisma.organization
      .deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } })
      .catch(() => {});
    await cleanupStaff(emails);
  });

  beforeEach(() => {
    sentEmails.length = 0;
  });

  it('lets only SYSTEM_ADMIN upload templates', async () => {
    for (const token of [organizerToken, adminToken]) {
      const denied = await request(app).post('/admin/page-templates').set(...auth(token)).send(contactManifest);
      expect(denied.status).toBe(403);
    }
    const created = await asSys(request(app).post('/admin/page-templates')).send(contactManifest);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'contact', label: 'Contact', pageCount: 0 });
    expect(created.body.sections.map((s) => s.type)).toEqual(['page_content', 'contact_form']);
    template = created.body;
  });

  it('reports manifest errors with their paths', async () => {
    const bad = await asSys(request(app).post('/admin/page-templates')).send({
      ...contactManifest,
      sections: [{ type: 'script' }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'sections[0].type' })])
    );
  });

  it('lists templates to org members only for their organization', async () => {
    const mine = await request(app).get('/admin/page-templates').set(...auth(organizerToken));
    expect(mine.status).toBe(200);
    expect(mine.body.templates.map((t) => t.name)).toEqual(['contact']);
    const theirs = await request(app).get('/admin/page-templates').set(...auth(otherToken));
    expect(theirs.body.templates).toEqual([]);
  });

  it('replaces a template uploaded again under the same name', async () => {
    const replaced = await asSys(request(app).post('/admin/page-templates')).send({
      ...contactManifest,
      label: 'Contact us',
    });
    expect(replaced.status).toBe(201);
    expect(replaced.body.id).toBe(template.id);
    expect(replaced.body.label).toBe('Contact us');
    const download = await asSys(request(app).get(`/admin/page-templates/${template.id}/manifest`));
    expect(download.status).toBe(200);
    expect(download.body).toMatchObject({ schemaVersion: 1, name: 'contact', label: 'Contact us' });
  });

  it('assigns a template to a page and rejects unknown ones', async () => {
    const unknown = await request(app)
      .post('/admin/pages')
      .set(...auth(organizerToken))
      .send({ title: 'Contact', content: '<p>Write to us</p>', template: 'nope' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('UNKNOWN_TEMPLATE');

    const otherOrg = await request(app)
      .post('/admin/pages')
      .set(...auth(otherToken))
      .send({ title: 'Contact', content: '<p>x</p>', template: 'contact' });
    expect(otherOrg.status).toBe(400);

    const created = await request(app)
      .post('/admin/pages')
      .set(...auth(organizerToken))
      .send({ title: 'Contact', content: '<p>Write to us</p>', template: 'contact', isVisible: true });
    expect(created.status).toBe(201);
    expect(created.body.template).toBe('contact');
    page = created.body;

    const cleared = await request(app)
      .put(`/admin/pages/${page.id}`)
      .set(...auth(organizerToken))
      .send({ template: null });
    expect(cleared.body.template).toBeNull();
    const back = await request(app)
      .put(`/admin/pages/${page.id}`)
      .set(...auth(organizerToken))
      .send({ template: 'contact' });
    expect(back.body.template).toBe('contact');
  });

  it('serves the template on the public page without the store email', async () => {
    const res = await request(app).get(`/organizations/${organization.id}/public/pages/${page.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.page.template.name).toBe('contact');
    expect(res.body.page.template.sections[1]).toMatchObject({ type: 'contact_form' });
    expect(res.body.page.contactFormAvailable).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('store@page-templates-ct.test');
  });

  it('emails a contact message to the store email and saves it', async () => {
    const res = await request(app).post(contactUrl()).send(message);
    expect(res.status).toBe(202);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({
      to: ['store@page-templates-ct.test'],
      reply_to: 'ada@example.com',
    });
    expect(sentEmails[0].subject).toContain('Booth question');
    expect(sentEmails[0].html).toContain('Do you have power at the booths?<br />Thanks!');
    const row = await prisma.contactInquiry.findFirst({
      where: { organizationId: organization.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).toMatchObject({ pageId: page.id, email: 'ada@example.com', subject: 'Booth question' });
    expect(row.emailedAt).not.toBeNull();
  });

  it('escapes visitor markup in the email', async () => {
    await request(app).post(contactUrl()).send({ ...message, name: '<b>x</b>', message: '<script>x()</script>' });
    expect(sentEmails[0].html).not.toContain('<script>');
    expect(sentEmails[0].html).toContain('&lt;script&gt;');
  });

  it('validates the message', async () => {
    const res = await request(app).post(contactUrl()).send({ name: '', email: 'nope', message: '' });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.field)).toEqual(expect.arrayContaining(['name', 'email', 'message']));
    expect(sentEmails).toHaveLength(0);
  });

  it('answers a filled honeypot with 202 and saves nothing', async () => {
    const before = await prisma.contactInquiry.count({ where: { organizationId: organization.id } });
    const res = await request(app).post(contactUrl()).send({ ...message, website: 'http://spam.test' });
    expect(res.status).toBe(202);
    expect(sentEmails).toHaveLength(0);
    expect(await prisma.contactInquiry.count({ where: { organizationId: organization.id } })).toBe(before);
  });

  it('keeps the message when the email fails', async () => {
    failNextEmail = true;
    const res = await request(app).post(contactUrl()).send({ ...message, subject: 'Email will fail' });
    expect(res.status).toBe(202);
    const row = await prisma.contactInquiry.findFirst({ where: { subject: 'Email will fail' } });
    expect(row.emailedAt).toBeNull();
    expect(row.emailError).toMatch(/refused/);
  });

  it('is 404 on pages without a contact form and hidden pages', async () => {
    const plain = await prisma.page.create({
      data: { organizationId: organization.id, title: 'About', slug: `about-${Date.now()}`, content: '<p>x</p>' },
    });
    expect((await request(app).post(contactUrl(plain.slug)).send(message)).status).toBe(404);
    await prisma.page.update({ where: { id: page.id }, data: { isVisible: false } });
    expect((await request(app).post(contactUrl()).send(message)).status).toBe(404);
    await prisma.page.update({ where: { id: page.id }, data: { isVisible: true } });
  });

  it('is 409 when the store has no email, and the page says so', async () => {
    await prisma.organization.update({ where: { id: organization.id }, data: { email: null } });
    const pageRes = await request(app).get(`/organizations/${organization.id}/public/pages/${page.slug}`);
    expect(pageRes.body.page.contactFormAvailable).toBe(false);
    const res = await request(app).post(contactUrl()).send(message);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONTACT_UNAVAILABLE');
    await prisma.organization.update({
      where: { id: organization.id },
      data: { email: 'store@page-templates-ct.test' },
    });
  });

  it('is gated on private stores', async () => {
    await prisma.organization.update({
      where: { id: organization.id },
      data: { storefrontPrivate: true, storefrontPasswordHash: 'x' },
    });
    const res = await request(app).post(contactUrl()).send(message);
    expect(res.status).toBe(403);
    expect(res.body.details?.locked).toBe(true);
    await prisma.organization.update({
      where: { id: organization.id },
      data: { storefrontPrivate: false, storefrontPasswordHash: null },
    });
  });

  it('deletes a template and resets the pages that used it', async () => {
    const denied = await request(app).delete(`/admin/page-templates/${template.id}`).set(...auth(adminToken));
    expect(denied.status).toBe(403);
    const res = await asSys(request(app).delete(`/admin/page-templates/${template.id}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pagesReset: 1 });
    const after = await prisma.page.findUnique({ where: { id: page.id } });
    expect(after.template).toBeNull();
    const pub = await request(app).get(`/organizations/${organization.id}/public/pages/${page.slug}`);
    expect(pub.body.page.template).toBeNull();
  });
});
