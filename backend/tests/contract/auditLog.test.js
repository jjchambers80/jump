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
