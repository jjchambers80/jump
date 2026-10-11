// Permission catalog + PermissionService (System › Roles & permissions).
//
// Defaults: every feature for both member roles, every action for ADMIN, and
// for ORGANIZER only the event-configuration actions (spec 050-E). The guard-coverage checks
// keep routes on catalog keys instead of role strings.

import { jest } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const platformSetting = { findUnique: jest.fn(), upsert: jest.fn() };
jest.unstable_mockModule('@jump/db', () => ({ prisma: { platformSetting } }));

const { FEATURES, FEATURE_KEYS, ACTION_KEYS, SWITCHABLE_FEATURES } = await import('../../src/permissions/catalog.js');
const { default: permissionService } = await import('../../src/services/PermissionService.js');

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const routesDir = path.join(srcDir, 'api/routes');
const routeSources = readdirSync(routesDir).map((f) => readFileSync(path.join(routesDir, f), 'utf8'));
const allRoutes = routeSources.join('\n');

function stored(value) {
  permissionService.clearCache();
  platformSetting.findUnique.mockResolvedValue(value === undefined ? null : { key: 'roles', value });
}

describe('permission defaults', () => {
  beforeEach(() => stored(undefined));

  test('ADMIN has every feature and every action', async () => {
    const { granted } = await permissionService.effective('ADMIN');
    expect([...granted].sort()).toEqual([...FEATURE_KEYS, ...ACTION_KEYS].sort());
  });

  test('ORGANIZER has every feature and only the event-configuration actions (050-E)', async () => {
    const { granted } = await permissionService.effective('ORGANIZER');
    expect([...granted].sort()).toEqual([...FEATURE_KEYS, 'addOns.manage', 'applications.forms'].sort());
  });

  test('a non-member gets nothing; SYSTEM_ADMIN gets everything', async () => {
    expect((await permissionService.effective(null)).granted.size).toBe(0);
    expect((await permissionService.effective('SYSTEM_ADMIN')).granted.size).toBe(FEATURE_KEYS.size + ACTION_KEYS.size);
  });
});

describe('overrides', () => {
  test('stored overrides apply; locked keys ignore them', async () => {
    stored({ ORGANIZER: { 'orders.refund': true, 'settings.users': true, maps: false, events: false }, ADMIN: { 'settings.users': false } });
    const organizer = (await permissionService.effective('ORGANIZER')).granted;
    expect(organizer.has('orders.refund')).toBe(true);
    expect(organizer.has('maps')).toBe(false);
    expect(organizer.has('settings.users')).toBe(false);
    expect(organizer.has('events')).toBe(true);
    expect((await permissionService.effective('ADMIN')).granted.has('settings.users')).toBe(true);
  });

  test('an applications.forms override saved before the split carries to applications.standingForms (050-E)', async () => {
    stored({ ORGANIZER: { 'applications.forms': true } });
    expect((await permissionService.effective('ORGANIZER')).granted.has('applications.standingForms')).toBe(true);
    stored({ ADMIN: { 'applications.forms': false } });
    const admin = (await permissionService.effective('ADMIN')).granted;
    expect(admin.has('applications.forms')).toBe(false);
    expect(admin.has('applications.standingForms')).toBe(false);
  });

  test('a saved applications.standingForms value wins over the carried one', async () => {
    stored({ ORGANIZER: { 'applications.forms': true, 'applications.standingForms': false } });
    const organizer = (await permissionService.effective('ORGANIZER')).granted;
    expect(organizer.has('applications.forms')).toBe(true);
    expect(organizer.has('applications.standingForms')).toBe(false);
    stored({ ORGANIZER: { 'applications.forms': false } });
    expect((await permissionService.effective('ORGANIZER')).granted.has('applications.standingForms')).toBe(false);
  });

  test('a platform-disabled feature is gone for every role, SYSTEM_ADMIN included', async () => {
    stored({ disabled: ['maps', 'events'] });
    for (const role of ['ADMIN', 'ORGANIZER', 'SYSTEM_ADMIN']) {
      const { granted, disabled } = await permissionService.effective(role);
      expect(granted.has('maps')).toBe(false);
      expect(granted.has('events')).toBe(true);
      expect([...disabled]).toEqual(['maps']);
    }
  });

  test('save stores only the differences from the defaults', async () => {
    stored(undefined);
    platformSetting.upsert.mockResolvedValue({});
    await permissionService.save(
      { roles: { ORGANIZER: { 'orders.refund': true, maps: true }, ADMIN: { 'settings.tax': true } }, disabled: ['finance'] },
      'user-1'
    );
    expect(platformSetting.upsert.mock.calls[0][0].update.value).toEqual({
      ADMIN: {},
      ORGANIZER: { 'orders.refund': true },
      disabled: ['finance'],
    });
  });

  test('save refuses unknown keys, locked changes and switching off a locked feature', async () => {
    await expect(permissionService.save({ roles: { ORGANIZER: { nope: true } } })).rejects.toThrow(/Unknown permission/);
    await expect(permissionService.save({ roles: { ORGANIZER: { 'settings.users': true } } })).rejects.toThrow(/cannot be changed/);
    await expect(permissionService.save({ roles: { ADMIN: { events: false } } })).rejects.toThrow(/cannot be changed/);
    await expect(permissionService.save({ roles: { SYSTEM_ADMIN: {} } })).rejects.toThrow(/Unknown role/);
    await expect(permissionService.save({ disabled: ['orders'] })).rejects.toThrow(/cannot be turned off/);
  });
});

describe('guard coverage', () => {
  test('no route guards on the account-wide ADMIN role', () => {
    expect(allRoutes).not.toMatch(/\brequireAdmin\b/);
    expect(allRoutes).not.toMatch(/canEdit: \['ADMIN'/);
  });

  test('every action key is enforced somewhere', () => {
    for (const key of ACTION_KEYS) {
      expect({ key, used: allRoutes.includes(`'${key}'`) }).toEqual({ key, used: true });
    }
  });

  test('every hideable feature is gated somewhere', () => {
    for (const key of SWITCHABLE_FEATURES) {
      expect({ key, used: allRoutes.includes(`requireFeature('${key}')`) }).toEqual({ key, used: true });
    }
  });

  test('catalog keys are unique', () => {
    const keys = FEATURES.flatMap((f) => [f.key, ...f.actions.map((a) => a.key)]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
