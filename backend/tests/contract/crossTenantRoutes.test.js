// Cross-tenant authorization on org-param routes.
//
// Every route that takes an organization id from the URL must check that the
// caller is a member of that organization (requireOrgMembership), and every
// route that takes an event id must check the event belongs to that
// organization. Staff of org A must get 403/404 on org B's events, price
// tiers, event orders, organization record and users.

import request from 'supertest';
import jwt from 'jsonwebtoken';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const AUTH_SECRET = process.env.AUTH_SECRET;
const TAG = 'cross-tenant';

function tokenFor(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: 'Cross Tenant' },
    AUTH_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

async function createOrg(name) {
  const org = await prisma.organization.create({ data: { name: `${TAG} ${name}` } });
  const venue = await prisma.venue.create({
    data: { organizationId: org.id, name: `${name} Venue`, address: '1 Test St' },
  });
  const event = await prisma.event.create({
    data: {
      venueId: venue.id,
      name: `${name} Event`,
      date: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      capacity: 100,
      status: 'DRAFT',
    },
  });
  const tier = await prisma.priceTier.create({
    data: { eventId: event.id, name: 'GA', price: 10, quantityTotal: 50 },
  });
  const admin = await prisma.user.create({
    data: {
      email: `admin-${name}@${TAG}.test`,
      role: 'ADMIN',
      memberships: { create: { organizationId: org.id, role: 'ADMIN' } },
    },
  });
  return { org, venue, event, tier, admin };
}

async function cleanup() {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const orgIds = orgs.map((o) => o.id);
  await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: { in: orgIds } } } } });
  await prisma.event.deleteMany({ where: { venue: { organizationId: { in: orgIds } } } });
  await prisma.venue.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
}

let a;
let b;
let tokenA;

beforeAll(async () => {
  await cleanup();
  a = await createOrg('a');
  b = await createOrg('b');
  tokenA = tokenFor(a.admin);
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const auth = (req) => req.set('Authorization', `Bearer ${tokenA}`);

describe("org A staff on org B's event routes", () => {
  const base = () => `/organizations/${b.org.id}/events`;

  it.each([
    ['get', () => `${base()}/summary`],
    ['get', () => base()],
    ['get', () => `${base()}/export.csv`],
    ['get', () => `${base()}/${b.event.id}/analytics`],
  ])('refuses %s %s', async (method, path) => {
    const res = await auth(request(app)[method](path()));
    expect(res.status).toBe(403);
  });

  it('refuses creating an event in org B', async () => {
    const res = await auth(request(app).post(base())).send({
      name: 'Injected',
      venueId: b.venue.id,
      date: new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString(),
      capacity: 10,
    });
    expect(res.status).toBe(403);
  });

  it('refuses editing, publishing, cancelling and logo removal', async () => {
    const id = b.event.id;
    expect((await auth(request(app).patch(`${base()}/${id}`)).send({ name: 'Pwned' })).status).toBe(403);
    expect((await auth(request(app).post(`${base()}/${id}/publish`))).status).toBe(403);
    expect((await auth(request(app).post(`${base()}/${id}/cancel`))).status).toBe(403);
    expect((await auth(request(app).delete(`${base()}/${id}/logo`))).status).toBe(403);
    expect((await auth(request(app).post(`${base()}/${id}/logo`))).status).toBe(403);

    const event = await prisma.event.findUnique({ where: { id } });
    expect(event.name).toBe('b Event');
    expect(event.status).toBe('DRAFT');
  });
});

describe("org A staff on org B's price tiers", () => {
  const base = () => `/organizations/${b.org.id}/events/${b.event.id}/price-tiers`;

  it('refuses every write', async () => {
    const t = b.tier.id;
    expect((await auth(request(app).post(base())).send({ name: 'X', price: 0, quantityTotal: 1 })).status).toBe(403);
    expect((await auth(request(app).patch(`${base()}/${t}`)).send({ price: 0 })).status).toBe(403);
    expect((await auth(request(app).post(`${base()}/${t}/activate`))).status).toBe(403);
    expect((await auth(request(app).post(`${base()}/${t}/deactivate`))).status).toBe(403);
    expect((await auth(request(app).post(`${base()}/reorder`)).send({ tierIds: [t] })).status).toBe(403);

    const tier = await prisma.priceTier.findUnique({ where: { id: t } });
    expect(Number(tier.price)).toBe(10);
  });
});

describe('event orders', () => {
  it("refuses org B's path", async () => {
    const res = await auth(request(app).get(`/organizations/${b.org.id}/events/${b.event.id}/orders`));
    expect(res.status).toBe(403);
  });

  it("refuses org B's event under org A's path", async () => {
    const res = await auth(request(app).get(`/organizations/${a.org.id}/events/${b.event.id}/orders`));
    expect(res.status).toBe(404);
  });

  it('still lists own event orders', async () => {
    const res = await auth(request(app).get(`/organizations/${a.org.id}/events/${a.event.id}/orders`));
    expect(res.status).toBe(200);
  });
});

describe('organization record', () => {
  it("refuses org B's details", async () => {
    const res = await auth(request(app).get(`/organizations/${b.org.id}`));
    expect(res.status).toBe(403);
  });

  it('returns own details', async () => {
    const res = await auth(request(app).get(`/organizations/${a.org.id}`));
    expect(res.status).toBe(200);
  });
});

describe('users (org ADMIN, not SYSTEM_ADMIN)', () => {
  it('lists only members of the active organization', async () => {
    const res = await auth(request(app).get('/users?limit=100'));
    expect(res.status).toBe(200);
    const emails = res.body.users.map((u) => u.email);
    expect(emails).toContain(a.admin.email);
    expect(emails).not.toContain(b.admin.email);
  });

  it("refuses changing org B's admin", async () => {
    const res = await auth(request(app).patch(`/users/${b.admin.id}`)).send({ isActive: false });
    expect(res.status).toBe(403);
    const user = await prisma.user.findUnique({ where: { id: b.admin.id } });
    expect(user.isActive).toBe(true);
  });

  it('refuses moving anyone into another organization', async () => {
    const res = await auth(request(app).patch(`/users/${a.admin.id}`)).send({ organizationId: b.org.id });
    expect(res.status).toBe(403);
    const member = await prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId: a.admin.id, organizationId: b.org.id } },
    });
    expect(member).toBeNull();
  });
});

describe('image cleanup', () => {
  it('is SYSTEM_ADMIN only', async () => {
    const res = await auth(request(app).post('/images/cleanup'));
    expect(res.status).toBe(403);
  });
});
