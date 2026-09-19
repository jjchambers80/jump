// Contract tests for Online Store › Preferences and the private storefront gate.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'store-prefs-ct';
const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];

const DEFAULTS = {
  storefrontPrivate: false,
  hasPassword: false,
  storefrontMessage: null,
  seoTitle: null,
  seoDescription: null,
  autoRedirectLanguage: false,
};

describe('Online Store preferences contract', () => {
  let organization;
  let otherOrganization;
  let adminToken;
  let organizerToken;
  let otherToken;

  beforeAll(async () => {
    await prisma.organization
      .deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
      .catch(() => {});

    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[2], role: 'ADMIN' });

    organization = await prisma.organization.create({ data: { name: `${TAG} Store` } });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrganization.id, 'ADMIN');
  });

  afterAll(async () => {
    await prisma.organization
      .deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } })
      .catch(() => {});
    await cleanupStaff(emails);
  });

  it('returns defaults for a fresh organization', async () => {
    const response = await request(app)
      .get('/admin/online-store/preferences')
      .set(...auth(organizerToken));
    expect(response.status).toBe(200);
    expect(response.body).toEqual(DEFAULTS);
  });

  it('organizers can read but not write; unknown fields are rejected', async () => {
    const forbidden = await request(app)
      .patch('/admin/online-store/preferences')
      .set(...auth(organizerToken))
      .send({ seoTitle: 'x' });
    expect(forbidden.status).toBe(403);

    const bad = await request(app)
      .patch('/admin/online-store/preferences')
      .set(...auth(adminToken))
      .send({ storefrontPasswordHash: 'scrypt$x$y' });
    expect(bad.status).toBe(400);
  });

  it('saves the search engine listing and redirection toggle per organization', async () => {
    const saved = await request(app)
      .patch('/admin/online-store/preferences')
      .set(...auth(adminToken))
      .send({
        seoTitle: ' Retro Nights ',
        seoDescription: 'Tickets for retro gaming nights',
        autoRedirectLanguage: true,
      });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      ...DEFAULTS,
      seoTitle: 'Retro Nights',
      seoDescription: 'Tickets for retro gaming nights',
      autoRedirectLanguage: true,
    });

    const meta = await request(app).get(`/organizations/${organization.id}/public/meta`);
    expect(meta.status).toBe(200);
    expect(meta.body).toEqual({
      id: organization.id,
      name: `${TAG} Store`,
      title: 'Retro Nights',
      description: 'Tickets for retro gaming nights',
      imageUrl: null,
    });

    const other = await request(app)
      .get('/admin/online-store/preferences')
      .set(...auth(otherToken));
    expect(other.body).toEqual(DEFAULTS);
  });

  it('refuses private mode without a password', async () => {
    const response = await request(app)
      .patch('/admin/online-store/preferences')
      .set(...auth(adminToken))
      .send({ storefrontPrivate: true });
    expect(response.status).toBe(400);
    expect(response.body.details).toEqual([
      { field: 'password', message: 'A password is required while private mode is on' },
    ]);
  });

  it('locks the public storefront behind the password and unlocks with a token', async () => {
    const before = await request(app).get(`/organizations/${organization.id}/public`);
    expect(before.status).toBe(200);
    expect(before.body.locked).toBe(false);

    const saved = await request(app)
      .patch('/admin/online-store/preferences')
      .set(...auth(adminToken))
      .send({ storefrontPrivate: true, password: 'retro-1985', storefrontMessage: 'Opening soon' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      storefrontPrivate: true,
      hasPassword: true,
      storefrontMessage: 'Opening soon',
    });
    expect(saved.body).not.toHaveProperty('storefrontPasswordHash');
    expect(saved.body).not.toHaveProperty('password');

    // The hash never leaves through the generic organization endpoints either.
    const org = await request(app)
      .get(`/organizations/${organization.id}`)
      .set(...auth(adminToken));
    expect(org.status).toBe(200);
    expect(org.body).not.toHaveProperty('storefrontPasswordHash');
    const details = await request(app)
      .get('/admin/settings/business-details')
      .set(...auth(adminToken));
    expect(details.body).not.toHaveProperty('storefrontPasswordHash');

    const locked = await request(app).get(`/organizations/${organization.id}/public`);
    expect(locked.status).toBe(200);
    expect(locked.body).toEqual({
      organization: expect.objectContaining({ id: organization.id, name: `${TAG} Store` }),
      locked: true,
      message: 'Opening soon',
      events: [],
    });

    const wrong = await request(app)
      .post(`/organizations/${organization.id}/storefront-access`)
      .send({ password: 'nope' });
    expect(wrong.status).toBe(401);

    const unlocked = await request(app)
      .post(`/organizations/${organization.id}/storefront-access`)
      .send({ password: 'retro-1985' });
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.token).toEqual(expect.any(String));

    const open = await request(app)
      .get(`/organizations/${organization.id}/public`)
      .set('X-Storefront-Access', unlocked.body.token);
    expect(open.body.locked).toBe(false);
    expect(open.body).not.toHaveProperty('message');

    // The token is bound to this organization only.
    const foreign = await request(app)
      .patch('/admin/online-store/preferences')
      .set(...auth(otherToken))
      .send({ storefrontPrivate: true, password: 'other-pw' });
    expect(foreign.status).toBe(200);
    const crossed = await request(app)
      .get(`/organizations/${otherOrganization.id}/public`)
      .set('X-Storefront-Access', unlocked.body.token);
    expect(crossed.body.locked).toBe(true);

    // Changing the password revokes issued tokens.
    await request(app)
      .patch('/admin/online-store/preferences')
      .set(...auth(adminToken))
      .send({ password: 'retro-1986' });
    const stale = await request(app)
      .get(`/organizations/${organization.id}/public`)
      .set('X-Storefront-Access', unlocked.body.token);
    expect(stale.body.locked).toBe(true);
  });

  it('locks event, venue, checkout and application form routes too, and hides events from discovery', async () => {
    const venue = await prisma.venue.create({
      data: { organizationId: organization.id, name: `${TAG} Venue`, address: '1 Test St' },
    });
    const event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: `${TAG} Gated Event`,
        date: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        capacity: 100,
        status: 'PUBLISHED',
      },
    });
    const tier = await prisma.priceTier.create({
      data: { eventId: event.id, name: 'GA', price: 10, quantityTotal: 10 },
    });

    // Currently private with password retro-1986 (previous test).
    const eventLocked = await request(app).get(`/events/${event.id}`);
    expect(eventLocked.status).toBe(403);
    expect(eventLocked.body).toMatchObject({
      error: 'StorefrontLockedError',
      details: {
        locked: true,
        organization: { id: organization.id, name: `${TAG} Store` },
        message: 'Opening soon',
      },
    });
    expect(eventLocked.body.details.organization).not.toHaveProperty('storefrontPasswordHash');

    expect((await request(app).get(`/venues/${venue.id}`)).status).toBe(403);
    expect((await request(app).get(`/events/${event.id}/applications/forms`)).status).toBe(403);
    const checkout = await request(app)
      .post('/orders')
      .send({
        eventId: event.id,
        items: [{ priceTierId: tier.id, quantity: 1 }],
        contact: { firstName: 'A', lastName: 'B', email: `buyer@${TAG}.test` },
      });
    expect(checkout.status).toBe(403);
    expect(checkout.body.details.locked).toBe(true);

    const list = await request(app).get('/events');
    expect(list.status).toBe(200);
    expect(list.body.events.some((e) => e.id === event.id)).toBe(false);

    // A token for this org (sent alongside a stale/foreign one) opens them.
    const { body } = await request(app)
      .post(`/organizations/${organization.id}/storefront-access`)
      .send({ password: 'retro-1986' });
    const header = `stale-token, ${body.token}`;
    expect((await request(app).get(`/events/${event.id}`).set('X-Storefront-Access', header)).status).toBe(200);
    expect((await request(app).get(`/venues/${venue.id}`).set('X-Storefront-Access', header)).status).toBe(200);
    expect(
      (await request(app).get(`/events/${event.id}/applications/forms`).set('X-Storefront-Access', header)).status
    ).toBe(200);

    // Unknown ids still 404 rather than 403.
    expect((await request(app).get('/events/does-not-exist')).status).toBe(404);

    await prisma.priceTier.delete({ where: { id: tier.id } });
    await prisma.event.delete({ where: { id: event.id } });
    await prisma.venue.delete({ where: { id: venue.id } });
  });

  it('cannot clear the password while private; turning private off with it works', async () => {
    const refused = await request(app)
      .patch('/admin/online-store/preferences')
      .set(...auth(adminToken))
      .send({ password: null });
    expect(refused.status).toBe(400);

    const off = await request(app)
      .patch('/admin/online-store/preferences')
      .set(...auth(adminToken))
      .send({ storefrontPrivate: false, password: null });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ storefrontPrivate: false, hasPassword: false });

    const unlock = await request(app)
      .post(`/organizations/${organization.id}/storefront-access`)
      .send({ password: 'retro-1986' });
    expect(unlock.status).toBe(401);

    const open = await request(app).get(`/organizations/${organization.id}/public`);
    expect(open.body.locked).toBe(false);
  });
});
