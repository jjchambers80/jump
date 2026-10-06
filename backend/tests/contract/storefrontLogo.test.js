// Pages outside the theme frame (checkout, confirmation, apply, map, account)
// get the theme's Logo settings in their payloads, so their header matches
// the themed pages: GET /events/:id, the order detail and GET /organizations/:id/public.

import { createHash } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';

process.env.THEME_EDITOR_ENABLED = 'true';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: orderService } = await import('../../src/services/OrderService.js');

const TAG = `sflogo-${process.pid}`;
const sha = (s) => createHash('sha256').update(s).digest('hex');

describe('storefront logo in payloads', () => {
  let themed;
  let plain;
  let themedEvent;
  let plainEvent;
  let logoFile;

  async function orgWithEvent(slug, themesEnabled) {
    const organization = await prisma.organization.create({ data: { name: slug, slug, themesEnabled } });
    const venue = await prisma.venue.create({
      data: { organizationId: organization.id, name: 'Hall', slug: `${slug}-hall`, address: '1 Main St', timezone: 'America/New_York' },
    });
    const event = await prisma.event.create({
      data: { venueId: venue.id, name: `${slug} show`, slug: `${slug}-show`, date: new Date('2031-06-01T23:00:00Z'), capacity: 10, status: 'PUBLISHED' },
    });
    return { organization, event };
  }

  beforeAll(async () => {
    ({ organization: themed, event: themedEvent } = await orgWithEvent(`${TAG}-themed`, true));
    ({ organization: plain, event: plainEvent } = await orgWithEvent(`${TAG}-plain`, false));
    const file = await prisma.file.create({
      data: { hash: sha(TAG), mimeType: 'image/png', sizeBytes: 10, width: 300, height: 100 },
    });
    logoFile = await prisma.storeFile.create({
      data: { organizationId: themed.id, fileId: file.id, name: 'wordmark', extension: 'png', width: 300, height: 100 },
    });
    await prisma.theme.create({
      data: {
        organizationId: themed.id,
        name: 'Main',
        presetKey: 'eventimus-default',
        presetVersion: '1.0',
        role: 'MAIN',
        settings: { logo: { desktopWidth: 180, mobileWidth: 110, image: { fileId: logoFile.id } }, buttons: { shape: 'pill' } },
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [themed.id, plain.id] } } }).catch(() => {});
    await prisma.file.deleteMany({ where: { hash: sha(TAG) } }).catch(() => {});
  });

  it('GET /events/:id carries the theme logo image, widths and button radius', async () => {
    const res = await request(app).get(`/events/${themedEvent.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.organizationStorefrontLogo).toEqual({
      url: expect.stringMatching(/\?w=300&h=100$/),
      desktopWidth: 180,
      mobileWidth: 110,
      buttonRadius: 9999,
    });
  });

  it('is null for an organization outside the theme rollout', async () => {
    const res = await request(app).get(`/events/${plainEvent.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.organizationStorefrontLogo).toBeNull();
  });

  it('GET /organizations/:id/public carries it for account pages', async () => {
    const res = await request(app).get(`/organizations/${themed.slug}/public`);
    expect(res.status).toBe(200);
    expect(res.body.organization.storefrontLogo).toMatchObject({ desktopWidth: 180, mobileWidth: 110 });
  });

  it('the order detail carries it for the confirmation page', async () => {
    const contact = await prisma.contact.create({ data: { organizationId: themed.id, email: `${TAG}@example.test`, firstName: 'Ada', lastName: 'Lovelace' } });
    const order = await prisma.order.create({
      data: { contactId: contact.id, eventId: themedEvent.id, quantity: 0, totalAmount: 0, orderRef: `${TAG}`.slice(0, 20) },
    });
    const detail = await orderService.getOrderById(order.id);
    expect(detail.event.organizationStorefrontLogo).toMatchObject({ desktopWidth: 180, mobileWidth: 110 });
  });
});
