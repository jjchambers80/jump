import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';

const AUTH_SECRET = process.env.AUTH_SECRET;
const emails = [
  'people-admin@test.com',
  'people-organizer@test.com',
  'people-customer@test.com',
  'people-no-org@test.com',
];

function tokenFor(user, role = user.role) {
  return jwt.sign(
    { sub: user.id, email: user.email, role, name: 'People Test User' },
    AUTH_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

const validPerson = {
  firstName: '  Betty  ',
  lastName: '  Roman  ',
  dateOfBirth: '1985-06-15',
  isAccountRepresentative: false,
};

describe('Organization people contract', () => {
  let organization;
  let otherOrganization;
  let admin;
  let organizer;
  let customer;
  let noOrgAdmin;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    organization = await prisma.organization.create({ data: { name: 'People Contract Org' } });
    otherOrganization = await prisma.organization.create({ data: { name: 'Other People Org' } });
    [admin, organizer, customer, noOrgAdmin] = await Promise.all([
      prisma.user.create({
        data: { email: emails[0], role: 'ADMIN', organizationId: organization.id },
      }),
      prisma.user.create({
        data: { email: emails[1], role: 'ORGANIZER', organizationId: organization.id },
      }),
      prisma.user.create({
        data: { email: emails[2], role: 'CUSTOMER', organizationId: organization.id },
      }),
      prisma.user.create({ data: { email: emails[3], role: 'ADMIN' } }),
    ]);
  });

  beforeEach(async () => {
    await prisma.organizationPerson.deleteMany({
      where: { organizationId: { in: [organization.id, otherOrganization.id] } },
    });
  });

  afterAll(async () => {
    await prisma.organizationPerson?.deleteMany({
      where: { organizationId: { in: [organization?.id, otherOrganization?.id].filter(Boolean) } },
    }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: emails } } }).catch(() => {});
    await prisma.organization.deleteMany({
      where: { id: { in: [organization?.id, otherOrganization?.id].filter(Boolean) } },
    }).catch(() => {});
  });

  it.each([
    ['ADMIN', () => admin],
    ['ORGANIZER', () => organizer],
  ])('allows %s users to create, list, and delete people', async (role, getUser) => {
    const auth = tokenFor(getUser(), role);
    const create = await request(app)
      .post('/admin/settings/people')
      .set('Authorization', `Bearer ${auth}`)
      .send(validPerson);

    expect(create.status).toBe(201);
    expect(create.body).toEqual({
      id: expect.any(String),
      firstName: 'Betty',
      lastName: 'Roman',
      isAccountRepresentative: false,
    });
    expect(create.body).not.toHaveProperty('dateOfBirth');
    expect(create.body).not.toHaveProperty('organizationId');

    const list = await request(app)
      .get('/admin/settings/people')
      .set('Authorization', `Bearer ${auth}`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ people: [create.body] });

    const remove = await request(app)
      .delete(`/admin/settings/people/${create.body.id}`)
      .set('Authorization', `Bearer ${auth}`);
    expect(remove.status).toBe(204);
    expect(remove.text).toBe('');
  });

  it('rejects customers and unauthenticated requests', async () => {
    const customerResponse = await request(app)
      .get('/admin/settings/people')
      .set('Authorization', `Bearer ${tokenFor(customer)}`);
    const anonymousResponse = await request(app).get('/admin/settings/people');

    expect(customerResponse.status).toBe(403);
    expect(anonymousResponse.status).toBe(401);
  });

  it.each(['get', 'post', 'delete'])(
    'returns 404 for %s when the authenticated user has no organization',
    async (method) => {
      const auth = tokenFor(noOrgAdmin);
      const path = method === 'delete' ? '/admin/settings/people/missing' : '/admin/settings/people';
      const call = request(app)[method](path).set('Authorization', `Bearer ${auth}`);
      if (method === 'post') call.send(validPerson);

      const response = await call;
      expect(response.status).toBe(404);
    }
  );

  it.each([
    [{ ...validPerson, organizationId: 'client-supplied-org' }, /unknown field/i],
    [{ ...validPerson, roles: ['OWNER'] }, /unknown field/i],
    [{ ...validPerson, dateOfBirth: '2025-02-29' }, /calendar date/i],
    [{ ...validPerson, isAccountRepresentative: 'false' }, /boolean/i],
  ])('returns 400 for invalid or extra fields', async (payload, message) => {
    const response = await request(app)
      .post('/admin/settings/people')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send(payload);

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(message);
  });

  it('allows multiple ordinary people and returns privacy-safe summaries', async () => {
    const auth = tokenFor(admin);
    await request(app)
      .post('/admin/settings/people')
      .set('Authorization', `Bearer ${auth}`)
      .send(validPerson)
      .expect(201);
    await request(app)
      .post('/admin/settings/people')
      .set('Authorization', `Bearer ${auth}`)
      .send({ ...validPerson, firstName: 'Alice', lastName: 'Ng' })
      .expect(201);

    const response = await request(app)
      .get('/admin/settings/people')
      .set('Authorization', `Bearer ${auth}`);

    expect(response.status).toBe(200);
    expect(response.body.people).toHaveLength(2);
    for (const person of response.body.people) {
      expect(Object.keys(person).sort()).toEqual(
        ['firstName', 'id', 'isAccountRepresentative', 'lastName'].sort()
      );
    }
  });

  it('atomically replaces and persists the single account representative', async () => {
    const auth = tokenFor(admin);
    const first = await request(app)
      .post('/admin/settings/people')
      .set('Authorization', `Bearer ${auth}`)
      .send({ ...validPerson, isAccountRepresentative: true });
    const second = await request(app)
      .post('/admin/settings/people')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        ...validPerson,
        firstName: 'New',
        lastName: 'Representative',
        isAccountRepresentative: true,
      });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const stored = await prisma.organizationPerson.findMany({
      where: { organizationId: organization.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(stored.filter((person) => person.isAccountRepresentative)).toHaveLength(1);
    expect(stored.find((person) => person.id === first.body.id).isAccountRepresentative).toBe(false);
    expect(stored.find((person) => person.id === second.body.id).isAccountRepresentative).toBe(true);
  });

  it('returns indistinguishable 404s for missing and cross-tenant IDs without deleting either tenant', async () => {
    const otherPerson = await prisma.organizationPerson.create({
      data: {
        organizationId: otherOrganization.id,
        firstName: 'Other',
        lastName: 'Tenant',
        dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      },
    });
    const auth = tokenFor(admin);

    const missing = await request(app)
      .delete('/admin/settings/people/missing-person')
      .set('Authorization', `Bearer ${auth}`);
    const crossTenant = await request(app)
      .delete(`/admin/settings/people/${otherPerson.id}`)
      .set('Authorization', `Bearer ${auth}`);

    expect(missing.status).toBe(404);
    expect(crossTenant.status).toBe(404);
    await expect(
      prisma.organizationPerson.findUnique({ where: { id: otherPerson.id } })
    ).resolves.not.toBeNull();
  });
});
