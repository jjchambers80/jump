// What each member role may see and do (System › Roles & permissions).
//
// One PlatformSetting row, key `roles`, stores only the overrides:
//   { ADMIN: { key: bool }, ORGANIZER: { key: bool }, disabled: [featureKey] }
// so a key added to the catalog later gets its default automatically.

import { prisma } from '@jump/db';
import { ValidationError } from '../middleware/errorHandler.js';
import {
  ACTION_KEYS,
  FEATURE_KEYS,
  FEATURES,
  MEMBER_ROLES,
  SWITCHABLE_FEATURES,
  defaultFor,
  lockedValue,
} from '../permissions/catalog.js';

const SETTING_KEY = 'roles';
const CACHE_MS = 30_000;
const ALL_KEYS = [...FEATURE_KEYS, ...ACTION_KEYS];

class PermissionService {
  // ponytail: per-instance cache, other instances see a change up to 30 s late;
  // compare PlatformSetting.updatedAt per read if instant propagation matters.
  _cache = null;

  async _settings() {
    if (this._cache && Date.now() - this._cache.at < CACHE_MS) return this._cache.value;
    const row = await prisma.platformSetting.findUnique({ where: { key: SETTING_KEY } });
    const value = normalize(row?.value);
    this._cache = { at: Date.now(), value };
    return value;
  }

  clearCache() {
    this._cache = null;
  }

  /**
   * Keys granted to a role. SYSTEM_ADMIN gets every key; a platform-disabled
   * feature is missing for every role, SYSTEM_ADMIN included.
   *
   * @param {'ADMIN'|'ORGANIZER'|'SYSTEM_ADMIN'|null} role
   * @returns {Promise<{ granted: Set<string>, disabled: Set<string> }>}
   */
  async effective(role) {
    const settings = await this._settings();
    const disabled = new Set(settings.disabled);
    const granted = new Set();
    if (role === 'SYSTEM_ADMIN' || MEMBER_ROLES.includes(role)) {
      for (const key of ALL_KEYS) {
        if (disabled.has(key)) continue;
        if (role === 'SYSTEM_ADMIN' || valueFor(settings, role, key)) granted.add(key);
      }
    }
    return { granted, disabled };
  }

  /** The full matrix for System › Roles. */
  async matrix() {
    const settings = await this._settings();
    const roles = {};
    for (const role of MEMBER_ROLES) {
      roles[role] = Object.fromEntries(ALL_KEYS.map((key) => [key, valueFor(settings, role, key)]));
    }
    return {
      features: FEATURES.map((f) => ({
        key: f.key,
        label: f.label,
        locked: !!f.locked,
        switchable: SWITCHABLE_FEATURES.has(f.key),
        actions: f.actions.map((a) => ({
          key: a.key,
          label: a.label,
          locked: a.locked ? Object.fromEntries(MEMBER_ROLES.map((r) => [r, a.locked[r] !== undefined])) : null,
        })),
      })),
      roles,
      defaults: Object.fromEntries(
        MEMBER_ROLES.map((role) => [role, Object.fromEntries(ALL_KEYS.map((key) => [key, defaultFor(role, key)]))])
      ),
      disabled: settings.disabled,
    };
  }

  /**
   * Saves a full matrix: `roles` maps role → key → bool, `disabled` lists
   * features off platform-wide. Unknown keys are refused, locked keys must keep
   * their value; only values that differ from the default are stored.
   */
  async save({ roles = {}, disabled = [] }, userId) {
    const value = { disabled: [] };
    for (const role of Object.keys(roles)) {
      if (!MEMBER_ROLES.includes(role)) throw new ValidationError(`Unknown role: ${role}`);
    }
    for (const role of MEMBER_ROLES) {
      const overrides = {};
      for (const [key, granted] of Object.entries(roles[role] ?? {})) {
        if (!ALL_KEYS.includes(key)) throw new ValidationError(`Unknown permission: ${key}`);
        if (typeof granted !== 'boolean') throw new ValidationError(`${role} ${key} must be true or false`);
        const locked = lockedValue(role, key);
        if (locked !== undefined && granted !== locked) throw new ValidationError(`${key} cannot be changed for ${role}`);
        if (granted !== defaultFor(role, key)) overrides[key] = granted;
      }
      value[role] = overrides;
    }
    for (const key of new Set(disabled)) {
      if (!SWITCHABLE_FEATURES.has(key)) throw new ValidationError(`${key} cannot be turned off`);
      value.disabled.push(key);
    }
    await prisma.platformSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value, updatedBy: userId },
      update: { value, updatedBy: userId },
    });
    this.clearCache();
    return this.matrix();
  }
}

function normalize(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    ADMIN: v.ADMIN && typeof v.ADMIN === 'object' ? v.ADMIN : {},
    ORGANIZER: v.ORGANIZER && typeof v.ORGANIZER === 'object' ? v.ORGANIZER : {},
    disabled: Array.isArray(v.disabled) ? v.disabled.filter((k) => SWITCHABLE_FEATURES.has(k)) : [],
  };
}

function valueFor(settings, role, key) {
  const locked = lockedValue(role, key);
  if (locked !== undefined) return locked;
  const override = settings[role][key];
  return typeof override === 'boolean' ? override : defaultFor(role, key);
}

export default new PermissionService();
