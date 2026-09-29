// The store unlock limiter counts per visitor. Themed storefronts unlock
// through the Next route handler (spec 038), so every request reaches the
// backend from the frontend server; the signed X-Jump-Client-Ip is the key.

import { createHmac } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: storefrontPreferencesService } = await import('../../src/services/StorefrontPreferencesService.js');

const TAG = 'unlock-limit-ct';
const signed = (ip) => ({
  'X-Jump-Client-Ip': ip,
  'X-Jump-Client-Ip-Sig': createHmac('sha256', process.env.AUTH_SECRET).update(ip).digest('hex'),
});

describe('storefront unlock limiter', () => {
  let organization;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: `${TAG} Store` } }).catch(() => {});
    organization = await prisma.organization.create({ data: { name: `${TAG} Store` } });
    await storefrontPreferencesService.update(organization.id, { storefrontPrivate: true, password: 'limit-1985' });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => {});
  });

  const attempt = (ip, password = 'wrong') =>
    request(app).post(`/organizations/${organization.id}/storefront-access`).set(signed(ip)).send({ password });

  it('one visitor exhausting the limit does not lock out another behind the same proxy', async () => {
    for (let i = 0; i < 10; i += 1) expect((await attempt('203.0.113.7')).status).toBe(401);
    expect((await attempt('203.0.113.7')).status).toBe(429);
    const other = await attempt('198.51.100.9', 'limit-1985');
    expect(other.status).toBe(200);
    expect(other.body.token).toEqual(expect.any(String));
  });
});
