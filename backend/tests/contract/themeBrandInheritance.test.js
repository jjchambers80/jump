// Spec 049 card B: the themed render inherits the organization brand where the
// theme leaves a value empty (theme values win), the render organization
// carries the brand fields the editor canvas needs, and /public/meta resolves
// the favicon: theme Logo › Favicon ?? square logo ?? null.

import { createHash } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';

process.env.THEME_EDITOR_ENABLED = 'true';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = `brandinh-${process.pid}`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const BRAND = {
  slogan: 'Play more games',
  shortDescription: 'Retro markets in Raleigh',
  brandSecondaryColor: '#ffcc00',
  squareLogoUrl: '/images/sq1/hash1/square',
  socialLinks: { instagram: 'https://instagram.com/org', twitch: 'https://twitch.tv/org' },
};

describe('theme inherits the organization brand (spec 049)', () => {
  let themed;
  let plain;
  let iconFile;

  beforeAll(async () => {
    themed = await prisma.organization.create({ data: { name: TAG, slug: `${TAG}-themed`, themesEnabled: true, ...BRAND } });
    plain = await prisma.organization.create({ data: { name: TAG, slug: `${TAG}-plain`, ...BRAND } });
    const file = await prisma.file.create({ data: { hash: sha(TAG), mimeType: 'image/png', sizeBytes: 10, width: 64, height: 64 } });
    iconFile = await prisma.storeFile.create({
      data: { organizationId: themed.id, fileId: file.id, name: 'icon', extension: 'png', width: 64, height: 64 },
    });
    await prisma.theme.create({
      data: {
        organizationId: themed.id,
        name: 'Main',
        presetKey: 'eventimus-default',
        presetVersion: '1.0',
        role: 'MAIN',
        settings: {
          brand: { headline: 'Theme headline' },
          social: { instagram: 'https://instagram.com/theme' },
          logo: { favicon: { fileId: iconFile.id, decorative: true } },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [themed.id, plain.id] } } }).catch(() => {});
    await prisma.file.deleteMany({ where: { hash: sha(TAG) } }).catch(() => {});
  });

  it('render fills empty theme values from the organization and keeps theme values', async () => {
    const res = await request(app).get(`/organizations/${themed.slug}/public/storefront/render?page=home`);
    expect(res.status).toBe(200);
    expect(res.body.settings.brand).toMatchObject({ headline: 'Theme headline', description: 'Retro markets in Raleigh' });
    expect(res.body.settings.social).toMatchObject({ instagram: 'https://instagram.com/theme', twitch: 'https://twitch.tv/org' });
    expect(res.body.organization).toMatchObject({ brandSecondaryColor: '#ffcc00', slogan: 'Play more games' });
  });

  it('the stored theme settings stay partial overrides', async () => {
    const theme = await prisma.theme.findFirst({ where: { organizationId: themed.id, role: 'MAIN' } });
    expect(theme.settings.brand).toEqual({ headline: 'Theme headline' });
    expect(theme.settings.social).toEqual({ instagram: 'https://instagram.com/theme' });
  });

  it('/public/meta favicon: theme favicon, else the square logo', async () => {
    const themedMeta = await request(app).get(`/organizations/${themed.slug}/public/meta`);
    expect(themedMeta.status).toBe(200);
    expect(themedMeta.body.faviconUrl).toMatch(new RegExp(`/files/${iconFile.id}/`));
    const plainMeta = await request(app).get(`/organizations/${plain.slug}/public/meta`);
    expect(plainMeta.body.faviconUrl).toBe(BRAND.squareLogoUrl);
  });

  it('/public/meta favicon is null with neither', async () => {
    await prisma.organization.update({ where: { id: plain.id }, data: { squareLogoUrl: null } });
    const res = await request(app).get(`/organizations/${plain.slug}/public/meta`);
    expect(res.body.faviconUrl).toBeNull();
  });
});
