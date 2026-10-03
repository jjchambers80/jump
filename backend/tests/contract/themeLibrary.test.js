// Contract tests for draft themes (spec 038, card 038J2): rename, duplicate,
// publish swap, delete, the 20-theme limit and cross-org isolation.

import { createHash } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

process.env.THEME_EDITOR_ENABLED = 'true';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'theme-lib-ct';
const emails = [`admin@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];
const sha = (s) => createHash('sha256').update(s).digest('hex');

const homeDoc = (heading, image) => ({
  root: { props: { title: 'Home' } },
  content: [{ type: 'Hero', props: { id: 'Hero-1', heading, ...(image && { image: { fileId: image, alt: 'Stage' } }) } }],
});

describe('Draft themes contract (038J2)', () => {
  let organization;
  let other;
  let adminToken;
  let otherToken;
  let main;
  let draft;
  let storeFile;

  const api = (method, path, token = adminToken) => request(app)[method](`/admin/themes${path}`).set(...auth(token));
  const refs = (targetId) => prisma.storeFileReference.findMany({ where: { kind: 'THEME', targetId } });

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    organization = await prisma.organization.create({
      data: { name: `${TAG} Store`, slug: `${TAG}-store`, themesEnabled: true },
    });
    other = await prisma.organization.create({ data: { name: `${TAG} Other`, slug: `${TAG}-other`, themesEnabled: true } });
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    await joinOrgByToken(otherToken, other.id, 'ORGANIZER');
    const file = await prisma.file.upsert({
      where: { hash: sha(`${TAG}-hero`) },
      update: {},
      create: { hash: sha(`${TAG}-hero`), mimeType: 'image/png', sizeBytes: 10 },
    });
    storeFile = await prisma.storeFile.create({
      data: { organizationId: organization.id, fileId: file.id, name: 'hero', extension: 'png' },
    });

    main = (await api('get', '')).body.themes[0];
    const saved = await api('put', `/${main.id}/save`).send({
      themeVersion: main.version,
      settings: { social: { instagram: 'https://instagram.com/jump' } },
      documents: { home: { data: homeDoc('Live', storeFile.id), version: 0 } },
    });
    expect(saved.status).toBe(200);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [organization.id, other.id] } } }).catch(() => {});
    await prisma.file.deleteMany({ where: { hash: sha(`${TAG}-hero`) } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('duplicates every setting, document and image reference into a draft', async () => {
    const res = await api('post', `/${main.id}/duplicate`).send({});
    expect(res.status).toBe(201);
    draft = res.body;
    expect(draft).toMatchObject({ role: 'UNPUBLISHED', name: `Copy of ${main.name}`, version: 1 });

    const detail = (await api('get', `/${draft.id}`)).body;
    expect(detail.settings).toEqual({ social: { instagram: 'https://instagram.com/jump' } });
    const home = (await api('get', `/${draft.id}/documents/home`)).body;
    expect(home).toMatchObject({ isDefault: false, version: 1 });
    expect(home.data.content[0].props.heading).toBe('Live');
    expect((await refs(draft.id)).map((r) => [r.field, r.fileId])).toEqual([['home', storeFile.id]]);
    // The source keeps its own references.
    expect(await refs(main.id)).toHaveLength(1);
  });

  it('takes a name for the copy', async () => {
    const res = await api('post', `/${main.id}/duplicate`).send({ name: '  Development (Admin)  ' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Development (Admin)');
    await api('delete', `/${res.body.id}`);
  });

  it('saves on a draft do not touch the live theme or write revisions', async () => {
    const res = await api('put', `/${draft.id}/save`).send({
      themeVersion: 1,
      documents: { home: { data: homeDoc('Draft'), version: 1 } },
    });
    expect(res.status).toBe(200);
    const live = (await api('get', `/${main.id}/documents/home`)).body;
    expect(live.data.content[0].props.heading).toBe('Live');
    expect(await prisma.themeRevision.count({ where: { themeId: draft.id } })).toBe(0);
    const render = await request(app).get(`/organizations/${organization.id}/public/storefront/render?page=home`);
    expect(render.body.documents.template.content[0].props.heading).toBe('Live');
  });

  it('renames with the themeVersion rule', async () => {
    const stale = await api('patch', `/${draft.id}`).send({ name: 'Summer', themeVersion: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('THEME_CONFLICT');
    const bad = await api('patch', `/${draft.id}`).send({ name: 'x'.repeat(51), themeVersion: 1 });
    expect(bad.status).toBe(400);
    const res = await api('patch', `/${draft.id}`).send({ name: ' Summer ', themeVersion: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Summer', version: 2 });
  });

  it('publishes a draft by swapping roles', async () => {
    const again = await api('post', `/${main.id}/publish`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('THEME_ACTIVE');

    const res = await api('post', `/${draft.id}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('MAIN');
    const roles = await prisma.theme.findMany({ where: { organizationId: organization.id }, select: { id: true, role: true } });
    expect(Object.fromEntries(roles.map((t) => [t.id, t.role]))).toEqual({ [draft.id]: 'MAIN', [main.id]: 'UNPUBLISHED' });
    const render = await request(app).get(`/organizations/${organization.id}/public/storefront/render?page=home`);
    expect(render.body.theme.id).toBe(draft.id);
    expect(render.body.documents.template.content[0].props.heading).toBe('Draft');
  });

  it('keeps one MAIN theme under concurrent publishes', async () => {
    await Promise.all([api('post', `/${main.id}/publish`), api('post', `/${draft.id}/publish`)]);
    expect(await prisma.theme.count({ where: { organizationId: organization.id, role: 'MAIN' } })).toBe(1);
    // Leave the original live again for the next tests.
    const live = await prisma.theme.findFirst({ where: { organizationId: organization.id, role: 'MAIN' } });
    if (live.id !== main.id) expect((await api('post', `/${main.id}/publish`)).status).toBe(200);
  });

  it('deletes drafts only, with their file references', async () => {
    const refused = await api('delete', `/${main.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('THEME_ACTIVE');
    const res = await api('delete', `/${draft.id}`);
    expect(res.status).toBe(204);
    expect(await prisma.theme.findUnique({ where: { id: draft.id } })).toBeNull();
    expect(await refs(draft.id)).toHaveLength(0);
  });

  it('stops at 20 themes per organization', async () => {
    const existing = await prisma.theme.count({ where: { organizationId: organization.id } });
    await prisma.theme.createMany({
      data: Array.from({ length: 20 - existing }, (_, i) => ({
        organizationId: organization.id,
        name: `Filler ${i}`,
        presetKey: 'eventimus-default',
        presetVersion: '1.0',
      })),
    });
    const res = await api('post', `/${main.id}/duplicate`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('THEME_LIMIT');
    await prisma.theme.deleteMany({ where: { organizationId: organization.id, name: { startsWith: 'Filler ' } } });
  });

  it('is invisible to another organization', async () => {
    for (const [method, path] of [
      ['patch', `/${main.id}`],
      ['post', `/${main.id}/duplicate`],
      ['post', `/${main.id}/publish`],
      ['delete', `/${main.id}`],
    ]) {
      const res = await api(method, path, otherToken).send(method === 'patch' ? { name: 'x', themeVersion: 1 } : {});
      expect(res.status).toBe(404);
    }
  });
});
