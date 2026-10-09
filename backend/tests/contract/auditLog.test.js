// Contract tests for the audit trail capture core (spec 048-A).

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma, auditContext } = await import('@jump/db');
const { default: auditLogService } = await import('../../src/audit/AuditLogService.js');

const TAG = 'audit-log-ct';
const emails = [`organizer@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];

// Rows are written after the response has gone out.
async function rowsFor(where, { atLeast = 1, tries = 40 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } });
    if (rows.length >= atLeast) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return prisma.auditLog.findMany({ where });
}

describe('Audit log capture (048-A)', () => {
  let organization;
  let otherOrganization;
  let organizerToken;
  let otherToken;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    organizerToken = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    organization = await prisma.organization.create({ data: { name: `${TAG} Store` } });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrganization.id, 'ORGANIZER');
  });

  afterAll(async () => {
    const ids = [organization.id, otherOrganization.id];
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('records a staff create and update with actor, org, request and field diff', async () => {
    const created = await request(app)
      .post('/admin/pages')
      .set(...auth(organizerToken))
      .send({ title: 'About us', content: '<p>Hello</p>' });
    expect(created.status).toBe(201);
    const pageId = created.body.id;

    const [createRow] = await rowsFor({ entityId: pageId, operation: 'CREATE' });
    expect(createRow).toMatchObject({
      organizationId: organization.id,
      actorType: 'USER',
      actorLabel: expect.any(String),
      action: 'page.created',
      feature: 'Content › Pages',
      entityType: 'Page',
      entityLabel: 'About us',
      source: 'admin',
      method: 'POST',
      route: '/admin/pages',
    });
    expect(createRow.actorUserId).toBeTruthy();
    expect(createRow.requestId).toBeTruthy();
    expect(createRow.changes.title).toEqual([null, 'About us']);

    const updated = await request(app)
      .put(`/admin/pages/${pageId}`)
      .set(...auth(organizerToken))
      .send({ title: 'About Eventimus' });
    expect(updated.status).toBe(200);

    const [updateRow] = await rowsFor({ entityId: pageId, operation: 'UPDATE' });
    expect(updateRow.action).toBe('page.updated');
    expect(updateRow.route).toBe('/admin/pages/:pageId');
    expect(updateRow.changes.title).toEqual(['About us', 'About Eventimus']);
    expect(updateRow.changes.updatedAt).toBeUndefined();
  });

  it('writes nothing when the request fails', async () => {
    const before = await prisma.auditLog.count({ where: { organizationId: organization.id } });
    const response = await request(app)
      .put('/admin/pages/does-not-exist')
      .set(...auth(organizerToken))
      .send({ title: 'Nope' });
    expect(response.status).toBeGreaterThanOrEqual(400);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await prisma.auditLog.count({ where: { organizationId: organization.id } })).toBe(before);
  });

  it('keeps each organization to its own rows', async () => {
    const response = await request(app)
      .post('/admin/pages')
      .set(...auth(otherToken))
      .send({ title: 'Other page', content: '<p>x</p>' });
    expect(response.status).toBe(201);
    const [row] = await rowsFor({ entityId: response.body.id });
    expect(row.organizationId).toBe(otherOrganization.id);
  });

  it('records system changes with no request', async () => {
    await auditLogService.runAsSystem('sweep:test', 'Test sweep', () =>
      prisma.organization.update({ where: { id: organization.id }, data: { name: `${TAG} Store renamed` } }));
    const [row] = await rowsFor({ entityId: organization.id, source: 'sweep:test' });
    expect(row).toMatchObject({ actorType: 'SYSTEM', actorLabel: 'Test sweep', organizationId: organization.id });
    expect(row.changes.name).toEqual([`${TAG} Store`, `${TAG} Store renamed`]);
  });

  it('captures nothing outside an audit context', async () => {
    const before = await prisma.auditLog.count();
    await prisma.organization.update({ where: { id: otherOrganization.id }, data: { seoTitle: 'x' } });
    expect(auditContext.getStore()).toBeUndefined();
    expect(await prisma.auditLog.count()).toBe(before);
  });

  it('refuses to update an audit row', async () => {
    const [row] = await rowsFor({ organizationId: organization.id });
    await expect(
      prisma.$executeRaw`UPDATE "AuditLog" SET "actorLabel" = 'tampered' WHERE id = ${row.id}`,
    ).rejects.toThrow(/append-only/);
  });
});

describe('Audit log actors and exports (048-B)', () => {
  const B_TAG = 'audit-log-b-ct';
  const adminEmail = `admin@${B_TAG}.test`;
  let organization;
  let adminToken;
  const eventId = `evt_${B_TAG}_${Date.now()}`;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${B_TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: adminEmail, role: 'ADMIN' });
    organization = await prisma.organization.create({ data: { name: `${B_TAG} Store` } });
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.stripeWebhookEvent.deleteMany({ where: { stripeEventId: eventId } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: organization.id } }).catch(() => {});
    await cleanupStaff([adminEmail]);
  });

  it('records a staff download as an EXPORT row', async () => {
    const response = await request(app)
      .get('/admin/orders/export.csv')
      .set(...auth(adminToken));
    expect(response.status).toBe(200);
    const [row] = await rowsFor({ organizationId: organization.id, operation: 'EXPORT' });
    expect(row).toMatchObject({ action: 'data.exported', feature: 'Exports', actorType: 'USER' });
    expect(row.entityLabel).toMatch(/^orders-.*\.csv$/);
  });

  it('attributes webhook deliveries to Stripe', async () => {
    const { default: auditLogService } = await import('../../src/audit/AuditLogService.js');
    const { auditContext } = await import('@jump/db');
    const store = { req: { id: 'r1', method: 'POST', get: () => null, headers: {} }, events: [] };
    await auditContext.run(store, async () => {
      auditLogService.markSystemActor('webhook:stripe:platform', 'Stripe');
      await prisma.organization.update({ where: { id: organization.id }, data: { seoTitle: 'from stripe' } });
    });
    await auditLogService.flush(store);
    const [row] = await rowsFor({ organizationId: organization.id, source: 'webhook:stripe:platform' });
    expect(row).toMatchObject({ actorType: 'SYSTEM', actorLabel: 'Stripe', action: 'organization.updated' });
  });
});

describe('Activity log API (048-C)', () => {
  const C_TAG = 'audit-log-c-ct';
  const emails = [`admin@${C_TAG}.test`, `organizer@${C_TAG}.test`, `admin-b@${C_TAG}.test`];
  let orgA;
  let orgB;
  let adminToken;
  let organizerToken;
  let adminBToken;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${C_TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    adminBToken = await staffToken({ email: emails[2], role: 'ADMIN' });
    orgA = await prisma.organization.create({ data: { name: `${C_TAG} A` } });
    orgB = await prisma.organization.create({ data: { name: `${C_TAG} B` } });
    await joinOrgByToken(adminToken, orgA.id, 'ADMIN');
    await joinOrgByToken(organizerToken, orgA.id, 'ORGANIZER');
    await joinOrgByToken(adminBToken, orgB.id, 'ADMIN');
    const base = { actorType: 'USER', actorLabel: 'Seed', action: 'page.updated', operation: 'UPDATE', feature: 'Content › Pages', entityType: 'Page', source: 'admin' };
    await prisma.auditLog.createMany({
      data: [
        { ...base, organizationId: orgA.id, entityLabel: 'Home', changes: { title: ['=1+1', 'Home'] } },
        { ...base, organizationId: orgA.id, entityLabel: 'Old', createdAt: new Date(Date.now() - 800 * 24 * 3600 * 1000) },
        { ...base, organizationId: orgA.id, entityLabel: '=HYPERLINK("x")' },
        { ...base, organizationId: orgB.id, entityLabel: 'Secret B' },
      ],
    });
  });

  afterAll(async () => {
    const ids = [orgA.id, orgB.id];
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('lists only the active organization, newest first, with facets', async () => {
    const response = await request(app).get('/admin/audit-log').set(...auth(adminToken));
    expect(response.status).toBe(200);
    const labels = response.body.rows.map((r) => r.entityLabel);
    expect(labels).toContain('Home');
    expect(labels).not.toContain('Secret B');
    expect(response.body.facets.features).toContain('Content › Pages');
    expect(response.body.retentionDays).toBe(730);
    expect(response.body.rows[0]).not.toHaveProperty('ipHash');
  });

  it('filters by record name', async () => {
    const response = await request(app).get('/admin/audit-log?q=hom').set(...auth(adminToken));
    expect(response.body.rows.map((r) => r.entityLabel)).toEqual(['Home']);
  });

  it('refuses a store organizer and a bad filter', async () => {
    expect((await request(app).get('/admin/audit-log').set(...auth(organizerToken))).status).toBe(403);
    expect((await request(app).get('/admin/audit-log?operation=NOPE').set(...auth(adminToken))).status).toBe(400);
  });

  it('exports CSV without formula injection and logs the export', async () => {
    const response = await request(app).get('/admin/audit-log/export.csv').set(...auth(adminToken));
    expect(response.status).toBe(200);
    expect(response.text.split('\r\n')[0]).toMatch(/^When,Who/);
    expect(response.text).toContain('title: ""=1+1""');
    expect(response.text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(response.text).not.toContain('Secret B');
    const [row] = await rowsFor({ organizationId: orgA.id, operation: 'EXPORT' });
    expect(row.entityLabel).toMatch(/^activity-log-/);
  });

  it('sweeps rows past retention', async () => {
    const { default: auditLogService } = await import('../../src/audit/AuditLogService.js');
    await auditLogService.sweep();
    expect(await prisma.auditLog.count({ where: { organizationId: orgA.id, entityLabel: 'Old' } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: orgA.id, entityLabel: 'Home' } })).toBe(1);
  });
});
