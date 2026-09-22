import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  ACTIVE_ORG_STORAGE_PREFIX,
  activeOrganizationStorageKey,
  clearPersistedOrganizationId,
  persistOrganizationId,
  readPersistedOrganizationId,
  resolveSelectedOrgId,
} from '@/lib/orgContextUtils';
import type { Organization } from '@/lib/orgContextUtils';

// --------------- helpers ---------------

const orgA: Organization = { id: 'org-a', name: 'Alpha', slug: 'alpha', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const orgB: Organization = { id: 'org-b', name: 'Beta', slug: 'beta', status: 'ACTIVE', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' };
const orgC: Organization = { id: 'org-c', name: 'Gamma', slug: 'gamma', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };

const ORGS = [orgA, orgB, orgC];

/** Mock localStorage that is available inside the Node test environment. */
function setupLocalStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
  (globalThis as any).window = { localStorage: storage };
  return { store, storage };
}

function teardownLocalStorage() {
  delete (globalThis as any).window;
}

// ========================================
// activeOrganizationStorageKey
// ========================================

describe('activeOrganizationStorageKey', () => {
  it('prefixes the user id with the active-org prefix', () => {
    expect(activeOrganizationStorageKey('user-1')).toBe(`${ACTIVE_ORG_STORAGE_PREFIX}user-1`);
  });

  it('produces different keys for different users', () => {
    const key1 = activeOrganizationStorageKey('user-1');
    const key2 = activeOrganizationStorageKey('user-2');
    expect(key1).not.toBe(key2);
  });

  it('includes the full prefix constant', () => {
    expect(activeOrganizationStorageKey('abc')).toMatch(/^jump\.admin\.activeOrg\./);
  });
});

// ========================================
// localStorage persistence helpers
// ========================================

describe('readPersistedOrganizationId / persistOrganizationId / clearPersistedOrganizationId', () => {
  beforeEach(() => {
    setupLocalStorage();
  });

  afterEach(() => {
    teardownLocalStorage();
  });

  it('persists and reads back an organization id for a user', () => {
    persistOrganizationId('user-1', 'org-a');
    expect(readPersistedOrganizationId('user-1')).toBe('org-a');
  });

  it('scopes storage per user — user-1 and user-2 do not interfere', () => {
    persistOrganizationId('user-1', 'org-a');
    persistOrganizationId('user-2', 'org-b');
    expect(readPersistedOrganizationId('user-1')).toBe('org-a');
    expect(readPersistedOrganizationId('user-2')).toBe('org-b');
  });

  it('returns null when nothing has been persisted for the user', () => {
    expect(readPersistedOrganizationId('unknown-user')).toBeNull();
  });

  it('overwrites a previous value', () => {
    persistOrganizationId('user-1', 'org-a');
    persistOrganizationId('user-1', 'org-b');
    expect(readPersistedOrganizationId('user-1')).toBe('org-b');
  });

  it('clears the persisted value', () => {
    persistOrganizationId('user-1', 'org-a');
    clearPersistedOrganizationId('user-1');
    expect(readPersistedOrganizationId('user-1')).toBeNull();
  });

  it('clear only removes the target user\'s key', () => {
    persistOrganizationId('user-1', 'org-a');
    persistOrganizationId('user-2', 'org-b');
    clearPersistedOrganizationId('user-1');
    expect(readPersistedOrganizationId('user-1')).toBeNull();
    expect(readPersistedOrganizationId('user-2')).toBe('org-b');
  });

  it('uses the correct localStorage key under the hood', () => {
    persistOrganizationId('user-x', 'org-c');
    const expectedKey = activeOrganizationStorageKey('user-x');
    expect((globalThis as any).window.localStorage.getItem(expectedKey)).toBe('org-c');
  });
});

// ========================================
// resolveSelectedOrgId — 5-level precedence
// ========================================

describe('resolveSelectedOrgId', () => {
  // --- Level 1: preferred (one-shot from URL / cross-tab) ---
  it('preferred org wins when it is in the list', () => {
    expect(resolveSelectedOrgId(ORGS, 'org-b', null, null, null)).toBe('org-b');
  });

  it('preferred org is skipped when it is not in the list (falls through)', () => {
    // No org-d in the list; no fallback values → returns data[0].id
    expect(resolveSelectedOrgId(ORGS, 'org-d', null, null, null)).toBe('org-a');
  });

  // --- Level 2: persisted (localStorage) ---
  it('persisted org wins when preferred is absent', () => {
    expect(resolveSelectedOrgId(ORGS, null, 'org-b', null, null)).toBe('org-b');
  });

  it('persisted org is skipped when preferred is present (preferred wins)', () => {
    expect(resolveSelectedOrgId(ORGS, 'org-a', 'org-b', null, null)).toBe('org-a');
  });

  it('persisted org falls through when not in the list', () => {
    expect(resolveSelectedOrgId(ORGS, null, 'org-z', null, null)).toBe('org-a');
  });

  // --- Level 3: prev (in-memory / current selection) ---
  it('prev wins when preferred and persisted are absent', () => {
    expect(resolveSelectedOrgId(ORGS, null, null, 'org-c', null)).toBe('org-c');
  });

  it('prev is overridden by persisted', () => {
    expect(resolveSelectedOrgId(ORGS, null, 'org-b', 'org-c', null)).toBe('org-b');
  });

  it('prev is overridden by preferred', () => {
    expect(resolveSelectedOrgId(ORGS, 'org-c', null, 'org-b', null)).toBe('org-c');
  });

  // --- Level 4: sessionOrgId (session claim) ---
  it('sessionOrgId wins when higher levels are absent', () => {
    expect(resolveSelectedOrgId(ORGS, null, null, null, 'org-b')).toBe('org-b');
  });

  it('sessionOrgId is overridden by prev', () => {
    expect(resolveSelectedOrgId(ORGS, null, null, 'org-c', 'org-a')).toBe('org-c');
  });

  it('sessionOrgId is overridden by persisted', () => {
    expect(resolveSelectedOrgId(ORGS, null, 'org-b', null, 'org-a')).toBe('org-b');
  });

  it('sessionOrgId is overridden by preferred', () => {
    expect(resolveSelectedOrgId(ORGS, 'org-c', null, null, 'org-b')).toBe('org-c');
  });

  it('sessionOrgId falls through when not in the list', () => {
    expect(resolveSelectedOrgId(ORGS, null, null, null, 'org-z')).toBe('org-a');
  });

  // --- Level 5: fallback to data[0] ---
  it('falls back to the first org when no higher level resolves', () => {
    expect(resolveSelectedOrgId(ORGS, null, null, null, null)).toBe('org-a');
  });

  // --- Empty list ---
  it('returns null for an empty list', () => {
    expect(resolveSelectedOrgId([], null, null, null, null)).toBeNull();
  });

  it('returns null for empty list even with matching values', () => {
    expect(resolveSelectedOrgId([], 'org-a', 'org-a', 'org-a', 'org-a')).toBeNull();
  });

  // --- Full 5-level chain ---
  it('full chain: preferred wins over everything else', () => {
    expect(resolveSelectedOrgId(ORGS, 'org-c', 'org-b', 'org-a', 'org-a')).toBe('org-c');
  });

  it('full chain: persisted wins when preferred absent', () => {
    expect(resolveSelectedOrgId(ORGS, null, 'org-c', 'org-a', 'org-a')).toBe('org-c');
  });

  it('full chain: prev wins when preferred and persisted absent', () => {
    expect(resolveSelectedOrgId(ORGS, null, null, 'org-c', 'org-a')).toBe('org-c');
  });

  it('full chain: sessionOrgId wins when everything else absent', () => {
    expect(resolveSelectedOrgId(ORGS, null, null, null, 'org-c')).toBe('org-c');
  });

  it('each fallback only matches orgs actually in the list', () => {
    const subset = [orgA, orgB];
    expect(resolveSelectedOrgId(subset, 'org-z', 'org-y', 'org-x', 'org-w')).toBe('org-a');
  });
});