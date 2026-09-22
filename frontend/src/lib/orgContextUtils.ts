// Pure utility functions for organization context persistence and resolution.
// Extracted from OrgContext.tsx so they can be tested in a Node vitest environment
// that does not parse JSX.
//
// The corresponding consumer code (OrgContext.tsx) imports these directly.

import type { ThemeMode } from '@/lib/theme';

export const ACTIVE_ORG_STORAGE_PREFIX = 'jump.admin.activeOrg.';

export function activeOrganizationStorageKey(userId: string) {
  return `${ACTIVE_ORG_STORAGE_PREFIX}${userId}`;
}

export function readPersistedOrganizationId(userId: string): string | null {
  try {
    return window.localStorage.getItem(activeOrganizationStorageKey(userId));
  } catch {
    return null;
  }
}

export function persistOrganizationId(userId: string, organizationId: string) {
  try {
    window.localStorage.setItem(activeOrganizationStorageKey(userId), organizationId);
  } catch {
    // Persistence is a convenience; the in-memory selection still works.
  }
}

export function clearPersistedOrganizationId(userId: string) {
  try {
    window.localStorage.removeItem(activeOrganizationStorageKey(userId));
  } catch {
    // ignore unavailable storage
  }
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'INACTIVE';
  logoUrl?: string | null;
  coverUrl?: string | null;
  brandColor?: string | null;
  themeMode?: ThemeMode;
  createdAt: string;
  updatedAt: string;
  onboardingCompletedAt?: string | null;
  _count?: {
    venues: number;
    users: number;
  };
}

/**
 * Resolve which organization to select based on a 5-level precedence:
 *  1. URL/signup one-shot preference (consumed once)
 *  2. Per-user localStorage persistence
 *  3. In-memory (current selection in React state)
 *  4. Session claim (the org the user just signed in to)
 *  5. Fallback: the first org in the list (by createdAt:desc)
 *
 * Returns the resolved org id, or null when the list is empty.
 */
export function resolveSelectedOrgId(
  data: Organization[],
  preferred: string | null,
  persisted: string | null,
  prev: string | null,
  sessionOrgId: string | null,
): string | null {
  if (data.length === 0) return null;
  return (
    (preferred && data.some((o) => o.id === preferred) && preferred) ||
    (persisted && data.some((o) => o.id === persisted) && persisted) ||
    (prev && data.some((o) => o.id === prev) && prev) ||
    (sessionOrgId && data.some((o) => o.id === sessionOrgId) && sessionOrgId) ||
    data[0].id
  );
}