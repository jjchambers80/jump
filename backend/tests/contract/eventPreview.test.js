// Contract tests for private event previews (spec 050 F): the preview-link
// route (role + org guard), GET /events/:id and /meta with and without
// X-Event-Preview, private store mode, the themed frame, and the payload.

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff, signToken } from '../helpers/staff.js';

process.env.THEME_EDITOR_ENABLED = 'true';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { previewSecret } = await import('../../src/services/ThemePreviewService.js');

const TAG = 'event-preview-ct';
const emails = [`organizer@${TAG}.test`, `other@${TAG}.test`, `admin@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];
const tokenOf = (url) => new URL(url).searchParams.get('token');
const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

describe('Event preview contract (050-F)', () => {
  let orgA;
  let orgB;
  let organizerToken;
  let otherToken;
  let adminToken;
  let draft;
  let sibling;
  let foreign;

  const link = (eventId = draft.id, orgId = orgA.id, token = organizerToken) =>
    request(app).post(`/organizations/${orgId}/events/${eventId}/preview-link`).set(...auth(token)).send({});
  const getEvent = (id, preview, extra = {}) => {
    const req = request(app).get(`/events/${id}`);
    if (preview) req.set('X-Event-Preview', preview);
    for (const [k, v] of Object.entries(extra)) req.set(k, v);
    return req;
  };

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    organizerToken = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    adminToken = await staffToken({ email: emails[2], role: 'ADMIN' });
    orgA = await prisma.organization.create({ data: { name: `${TAG} A`, slug: `${TAG}-a`, themesEnabled: true } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} B`, slug: `${TAG}-b` } });
    await joinOrgByToken(organizerToken, orgA.id, 'ORGANIZER');
    await joinOrgByToken(adminToken, orgA.id, 'ADMIN');
    await joinOrgByToken(otherToken, orgB.id, 'ORGANIZER');

    const venueA = await prisma.venue.create({ data: { organizationId: orgA.id, name: 'Hall A', address: '1 Main St', timezone: 'America/New_York' } });
    const venueB = await prisma.venue.create({ data: { organizationId: orgB.id, name: 'Hall B', address: '2 Main St', timezone: 'America/New_York' } });
    const event = (venueId, slug, extra = {}) =>
      prisma.event.create({
        data: {
          venueId, name: `${slug} ${TAG}`, slug: `${slug}-${TAG}`, date: future, capacity: 10, status: 'DRAFT',
          priceTiers: { create: { name: 'GA', price: 10, quantityTotal: 10 } }, ...extra,
        },
      });
    draft = await event(venueA.id, 'draft');
    sibling = await event(venueA.id, 'sibling');
    foreign = await event(venueB.id, 'foreign');
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('mints a 1 h link for organizers of the event org only', async () => {
    const res = await link();
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/\/api\/events\/preview\?token=/);
    expect(Date.parse(res.body.expiresAt) - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);

    expect((await request(app).post(`/organizations/${orgA.id}/events/${draft.id}/preview-link`)).status).toBe(401);
    expect((await link(draft.id, orgA.id, otherToken)).status).toBe(403);
    expect((await link(draft.id, orgB.id, otherToken)).status).toBe(404);
    const unassigned = signToken({ id: 'nobody', email: `nobody@${TAG}.test`, role: 'UNASSIGNED' });
    expect((await link(draft.id, orgA.id, unassigned)).status).toBe(403);
  });

  it('a DRAFT is a 404 without the header and renders with it', async () => {
    expect((await getEvent(draft.id)).status).toBe(404);
    expect((await request(app).get(`/events/${draft.slug}/meta`)).status).toBe(404);

    const token = tokenOf((await link()).body.url);
    const res = await getEvent(draft.slug, token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: draft.id, preview: true, status: 'DRAFT' });
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.headers['cache-control']).toBe('private, no-store');
    const meta = await request(app).get(`/events/${draft.slug}/meta`).set('X-Event-Preview', token);
    expect(meta.body).toMatchObject({ id: draft.id, organizationId: orgA.id });
  });

  it('refuses a token for another event, another org, a theme or a session', async () => {
    const token = tokenOf((await link()).body.url);
    expect((await getEvent(sibling.id, token)).status).toBe(404);
    expect((await getEvent(foreign.id, token)).status).toBe(404);

    const theme = jwt.sign({ orgId: orgA.id, themeId: 'x', eventId: draft.id, share: false }, previewSecret(), { audience: 'theme-preview' });
    expect((await getEvent(draft.id, theme)).status).toBe(404);
    expect((await getEvent(draft.id, organizerToken)).status).toBe(404);
    // ...and the preview token is not a staff session.
    expect((await request(app).get(`/organizations/${orgA.id}/events`).set(...auth(token))).status).toBe(401);
    // ...nor a theme preview.
    const render = await request(app)
      .get(`/organizations/${orgA.id}/public/storefront/render?page=home`)
      .set('X-Theme-Preview', token);
    expect(render.body.preview ?? null).toBeNull();
  });

  it('refuses an expired token', async () => {
    const expired = jwt.sign(
      { typ: 'event-preview', orgId: orgA.id, eventId: draft.id, exp: Math.floor(Date.now() / 1000) - 1 },
      previewSecret(),
      { audience: 'event-preview' }
    );
    expect((await getEvent(draft.id, expired)).status).toBe(404);
  });

  it('private store: the preview passes the gate for the event and its theme frame only', async () => {
    const prefs = await request(app)
      .patch('/admin/online-store/preferences')
      .set(...auth(adminToken))
      .send({ storefrontPrivate: true, password: 'preview-1985' });
    expect(prefs.status).toBe(200);
    const token = tokenOf((await link()).body.url);

    expect((await getEvent(draft.id, token)).status).toBe(200);
    const frame = (page) =>
      request(app).get(`/organizations/${orgA.id}/public/storefront/render?page=${page}`).set('X-Event-Preview', token);
    expect((await frame('frame')).status).toBe(200);
    expect((await frame('home')).status).toBe(403);
    expect((await request(app).get(`/organizations/${orgA.id}/public/storefront/render?page=frame`)).status).toBe(403);

    await prisma.organization.update({ where: { id: orgA.id }, data: { storefrontPrivate: false, storefrontPasswordHash: null } });
  });

  it('a published event viewed with a token is marked preview', async () => {
    const published = await prisma.event.update({ where: { id: sibling.id }, data: { status: 'PUBLISHED' } });
    expect((await getEvent(published.id)).body.preview).toBeUndefined();
    const token = tokenOf((await link(sibling.id)).body.url);
    expect((await getEvent(published.id, token)).body.preview).toBe(true);
  });

  it('preview-payload returns the public shape whatever the status, org-guarded', async () => {
    const res = await request(app).get(`/organizations/${orgA.id}/events/${draft.id}/preview-payload`).set(...auth(organizerToken));
    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({ id: draft.id, status: 'DRAFT', organizationId: orgA.id });
    expect(res.body.event.priceTiers).toHaveLength(1);
    expect(res.body.organization).toMatchObject({ id: orgA.id, slug: orgA.slug, name: orgA.name });
    expect(res.body.organization).toHaveProperty('themeMode');
    expect(res.body.organization).toHaveProperty('brandColor');
    expect(res.body.forms).toEqual([]);

    const other = await request(app).get(`/organizations/${orgA.id}/events/${draft.id}/preview-payload`).set(...auth(otherToken));
    expect(other.status).toBe(403);
    const cross = await request(app).get(`/organizations/${orgB.id}/events/${draft.id}/preview-payload`).set(...auth(otherToken));
    expect(cross.status).toBe(404);
  });
});
