// Spec 049: the data step of 20261031100000_org_brand_identity copies each
// organization's MAIN theme brand text and social links into the empty
// organization columns. Runs the migration's own UPDATE against the migrated
// test database; nothing mocked.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '@jump/db';

const sqlFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/prisma/migrations/20261031100000_org_brand_identity/migration.sql'
);
const sql = fs.readFileSync(sqlFile, 'utf8');
const copyStep = sql.slice(sql.indexOf('WITH main AS'));

const PREFIX = `brand-mig-${Date.now()}`;

async function orgWithTheme(key, settings, { role = 'MAIN', org = {} } = {}) {
  const organization = await prisma.organization.create({ data: { name: `${PREFIX}-${key}`, ...org } });
  await prisma.theme.create({
    data: { organizationId: organization.id, name: 'Theme', presetKey: 'eventimus-default', presetVersion: '1.0', role, settings },
  });
  return organization.id;
}

const brandOf = (id) =>
  prisma.organization.findUnique({ where: { id }, select: { slogan: true, shortDescription: true, socialLinks: true } });

describe('org brand identity migration copy (spec 049)', () => {
  const ids = {};

  beforeAll(async () => {
    ids.full = await orgWithTheme('full', {
      brand: { headline: ' Retro games, every month ', description: 'A monthly market.' },
      social: { instagram: 'https://instagram.com/rrg', youtube: '', website: 'https://rrg.example' },
    });
    ids.kept = await orgWithTheme(
      'kept',
      { brand: { headline: 'Theme slogan' }, social: { x: 'https://x.com/rrg' } },
      { org: { slogan: 'Org slogan' } }
    );
    ids.draft = await orgWithTheme('draft', { brand: { headline: 'Draft only' } }, { role: 'UNPUBLISHED' });
    ids.empty = await orgWithTheme('empty', { brand: { headline: '  ' }, social: { instagram: '' } });
    expect(copyStep).toMatch(/^WITH main AS/);
    await prisma.$executeRawUnsafe(copyStep);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: PREFIX } } });
  });

  it('copies the MAIN theme headline, description and https social links', async () => {
    expect(await brandOf(ids.full)).toEqual({
      slogan: 'Retro games, every month',
      shortDescription: 'A monthly market.',
      socialLinks: { instagram: 'https://instagram.com/rrg', website: 'https://rrg.example' },
    });
  });

  it('never overwrites a value the organization already has', async () => {
    expect(await brandOf(ids.kept)).toEqual({ slogan: 'Org slogan', shortDescription: null, socialLinks: { x: 'https://x.com/rrg' } });
  });

  it('ignores unpublished themes and blank theme values', async () => {
    expect(await brandOf(ids.draft)).toEqual({ slogan: null, shortDescription: null, socialLinks: null });
    expect(await brandOf(ids.empty)).toEqual({ slogan: null, shortDescription: null, socialLinks: null });
  });

  it('leaves the theme settings in place', async () => {
    const theme = await prisma.theme.findFirst({ where: { organizationId: ids.full } });
    expect(theme.settings.brand.headline).toBe(' Retro games, every month ');
  });
});
