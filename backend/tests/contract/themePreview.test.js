// Contract tests for draft theme previews (spec 038 D11, card 038K): signed
// preview links, the render endpoint's X-Theme-Preview header, staff vs share
// links on a private store, card thumbnails, and fallback to the live theme.

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

process.env.THEME_EDITOR_ENABLED = 'true';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'theme-preview-ct';
const emails = [`admin@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];
const homeDoc = (heading) => ({ root: { props: {} }, content: [{ type: 'Hero', props: { id: 'Hero-1', heading } }] });
const tokenOf = (url) => new URL(url).searchParams.get('token');

describe('Draft theme preview contract (038K)', () => {
  let organization;
  let other;
  let adminToken;
  let otherToken;
  let main;
  let draft;

  const api = (method, path, token = adminToken) => request(app)[method](`/admin/themes${path}`).set(...auth(token));
  const render = (preview, extra = {}) => {
    const req = request(app).get(`/organizations/${organization.slug}/public/storefront/render?page=home`);
    if (preview) req.set('X-Theme-Preview', preview);
    for (const [k, v] of Object.entries(extra)) req.set(k, v);
    return req;
  };
  const link = async (share = false, themeId = draft.id) => (await api('post', `/${themeId}/preview-link`).send({ share })).body;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    otherToken = await staffToken({ email: emails[1], role: 'ADMIN' });
    organization = await prisma.organization.create({ data: { name: `${TAG} Store`, slug: `${TAG}-store`, themesEnabled: true } });
    other = await prisma.organization.create({ data: { name: `${TAG} Other`, slug: `${TAG}-other`, themesEnabled: true } });
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    await joinOrgByToken(otherToken, other.id, 'ADMIN');

    main = (await api('get', '')).body.themes[0];
    await api('put', `/${main.id}/save`).send({ themeVersion: 1, documents: { home: { data: homeDoc('Live'), version: 0 } } });
    draft = (await api('post', `/${main.id}/duplicate`).send({})).body;
    await api('put', `/${draft.id}/save`).send({ themeVersion: 1, documents: { home: { data: homeDoc('Draft'), version: 1 } } });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [organization.id, other.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('mints staff (1 h) and share (14 d) links for drafts only', async () => {
    const staff = await link(false);
    expect(staff.url).toMatch(/\/api\/storefront\/preview\?token=/);
    expect(staff.share).toBe(false);
    expect(Date.parse(staff.expiresAt) - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
    const share = await link(true);
    expect(Date.parse(share.expiresAt) - Date.now()).toBeGreaterThan(13 * 24 * 60 * 60 * 1000);

    const live = await api('post', `/${main.id}/preview-link`).send({});
    expect(live.status).toBe(400);
    const foreign = await api('post', `/${draft.id}/preview-link`, otherToken).send({});
    expect(foreign.status).toBe(404);
  });

  it('renders the draft with a preview marker and noindex', async () => {
    const res = await render(tokenOf((await link()).url));
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.theme.id).toBe(draft.id);
    expect(res.body.documents.template.content[0].props.heading).toBe('Draft');
    expect(res.body.preview).toMatchObject({ themeId: draft.id, name: draft.name, share: false });
  });

  it('falls back to the live theme for a malformed or forged token, and says so', async () => {
    const forged = jwt.sign({ orgId: organization.id, themeId: draft.id, share: false }, 'wrong-secret', { audience: 'theme-preview' });
    for (const token of ['not-a-token', forged]) {
      const res = await render(token);
      expect(res.status).toBe(200);
      expect(res.body.theme.id).toBe(main.id);
      expect(res.body.preview).toBeUndefined();
      expect(res.body.previewInvalid).toBe(true);
    }
    const res = await render();
    expect(res.body.previewInvalid).toBeUndefined();
  });

  it('a token for another organization never renders its theme here', async () => {
    const otherMain = (await api('get', '', otherToken)).body.themes[0];
    const otherDraft = (await api('post', `/${otherMain.id}/duplicate`, otherToken).send({})).body;
    const foreign = (await api('post', `/${otherDraft.id}/preview-link`, otherToken).send({})).body;
    const res = await render(tokenOf(foreign.url));
    expect(res.body.theme.id).toBe(main.id);
    expect(res.body.previewInvalid).toBe(true);
  });

  it('private store: a staff link passes the gate, a share link does not', async () => {
    const prefs = await request(app)
      .patch('/admin/online-store/preferences')
      .set(...auth(adminToken))
      .send({ storefrontPrivate: true, password: 'preview-1985' });
    expect(prefs.status).toBe(200);

    expect((await render()).status).toBe(403);
    const staff = await render(tokenOf((await link(false)).url));
    expect(staff.status).toBe(200);
    expect(staff.body.theme.id).toBe(draft.id);

    const shareToken = tokenOf((await link(true)).url);
    const gated = await render(shareToken);
    expect(gated.status).toBe(403);
    expect(JSON.stringify(gated.body)).not.toContain('Draft');
    const unlock = await request(app).post(`/organizations/${organization.id}/storefront-access`).send({ password: 'preview-1985' });
    const open = await render(shareToken, { 'X-Storefront-Access': unlock.body.token });
    expect(open.status).toBe(200);
    expect(open.body.preview).toMatchObject({ themeId: draft.id, share: true });

    // An invalid token gets no gate bypass either.
    expect((await render('not-a-token')).status).toBe(403);
  });

  it('thumbnails: one cookie-free token per draft that renders past the gate and is not a preview link', async () => {
    const res = await api('get', '/thumbnails');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.thumbnails)).toEqual([draft.id]);
    const path = res.body.thumbnails[draft.id];
    expect(path.startsWith(`/theme-thumbnail/${organization.id}?t=`)).toBe(true);
    const t = new URL(path, 'http://x').searchParams.get('t');

    // The store is private here: the thumbnail still renders the draft.
    const shot = await render(null, { 'X-Theme-Thumbnail': t });
    expect(shot.status).toBe(200);
    expect(shot.body.theme.id).toBe(draft.id);
    expect(shot.body.preview).toMatchObject({ themeId: draft.id, thumbnail: true });

    // Neither audience is accepted as the other.
    expect((await render(t)).status).toBe(403);
    expect((await render(null, { 'X-Theme-Thumbnail': tokenOf((await link()).url) })).status).toBe(403);
    expect((await api('get', '/thumbnails', otherToken)).body.thumbnails[draft.id]).toBeUndefined();
  });

  it('once published, the token shows the live theme with no preview bar', async () => {
    const token = tokenOf((await link()).url);
    await api('post', `/${draft.id}/publish`);
    const unlock = await request(app).post(`/organizations/${organization.id}/storefront-access`).send({ password: 'preview-1985' });
    const res = await render(token, { 'X-Storefront-Access': unlock.body.token });
    expect(res.body.theme.id).toBe(draft.id);
    expect(res.body.preview).toBeUndefined();
    expect(res.body.previewInvalid).toBe(true);
  });
});
