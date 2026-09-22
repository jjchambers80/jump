'use client';

// Global organization context for admin pages.
// Fetches orgs once, shares selectedOrgId across all admin routes.

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import api, { setActiveOrganizationId } from '@/services/api';
import type { ThemeMode } from '@/lib/theme';
import { onOrganizationCreated } from '@/lib/orgChannel';

export const ACTIVE_ORG_STORAGE_PREFIX = 'jump.admin.activeOrg.';

export function activeOrganizationStorageKey(userId: string) {
  return `${ACTIVE_ORG_STORAGE_PREFIX}${userId}`;
}

function readPersistedOrganizationId(userId: string): string | null {
  try {
    return window.localStorage.getItem(activeOrganizationStorageKey(userId));
  } catch {
    return null;
  }
}

function persistOrganizationId(userId: string, organizationId: string) {
  try {
    window.localStorage.setItem(activeOrganizationStorageKey(userId), organizationId);
  } catch {
    // Persistence is a convenience; the in-memory selection still works.
  }
}

function clearPersistedOrganizationId(userId: string) {
  try {
    window.localStorage.removeItem(activeOrganizationStorageKey(userId));
  } catch {
    // ignore unavailable storage
  }
}

export interface Organization {
  id: string;
  name: string;
  /** URL-safe store handle; generated from the name, stable across renames. */
  slug: string;
  status: 'ACTIVE' | 'INACTIVE';
  logoUrl?: string | null;
  coverUrl?: string | null;
  brandColor?: string | null;
  themeMode?: ThemeMode;
  createdAt: string;
  updatedAt: string;
  /** null while the organization is still in the /signup flow (spec 022) */
  onboardingCompletedAt?: string | null;
  _count?: {
    venues: number;
    users: number;
  };
}

interface OrgContextValue {
  organizations: Organization[];
  selectedOrgId: string | null;
  selectedOrg: Organization | null;
  setSelectedOrgId: (id: string) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Patch one org in memory (e.g. after Settings saves a new name) without refetching. */
  updateOrganization: (id: string, patch: Partial<Organization>) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const sessionOrgId = session?.user?.organizationId ?? null;
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgIdState] = useState<string | null>(null);
  const selectedOrgIdRef = useRef<string | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Publish the selection to the api client *before* React commits it. Child
  // effects run before this provider's effects, so a page that fetches as soon
  // as it sees the new selectedOrgId would otherwise send no X-Jump-Org header.
  const setSelectedOrgId = useCallback((id: string | null) => {
    selectedOrgIdRef.current = id;
    setActiveOrganizationId(id);
    setSelectedOrgIdState(id);
    if (id && userId) persistOrganizationId(userId, id);
  }, [userId]);

  // An organization to prefer once the list arrives: `?org=<id>` on the URL
  // (the signup flow lands on /admin/dashboard?org=…) or a cross-tab
  // "org-created" announcement (spec 022).
  const preferredOrgIdRef = useRef<string | null>(null);

  const fetchOrgs = useCallback(async () => {
    const requestedUserId = userId;
    if (!requestedUserId) {
      setOrganizations([]);
      setSelectedOrgId(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await api.get<Organization[]>('/organizations');
      // Ignore a response started for a session that has since signed out or
      // changed users. It must not publish that user's organization globally.
      if (activeUserIdRef.current !== requestedUserId) return;
      setOrganizations(data);
      // Resolve one-shot preferences first, then the user's saved choice. A
      // valid in-memory choice wins over session/default fallbacks on refresh.
      if (data.length > 0) {
        const preferred = preferredOrgIdRef.current;
        preferredOrgIdRef.current = null;
        const persisted = readPersistedOrganizationId(requestedUserId);
        const prev = selectedOrgIdRef.current;
        const next =
          (preferred && data.some((o) => o.id === preferred) && preferred) ||
          (persisted && data.some((o) => o.id === persisted) && persisted) ||
          (prev && data.some((o) => o.id === prev) && prev) ||
          (sessionOrgId && data.some((o) => o.id === sessionOrgId) && sessionOrgId) ||
          data[0].id;
        setSelectedOrgId(next);
      } else {
        preferredOrgIdRef.current = null;
        clearPersistedOrganizationId(requestedUserId);
        setSelectedOrgId(null);
      }
    } catch (err: any) {
      if (activeUserIdRef.current === requestedUserId) {
        setError(err.message || 'Failed to load organizations');
      }
    } finally {
      if (activeUserIdRef.current === requestedUserId) setLoading(false);
    }
  }, [sessionOrgId, setSelectedOrgId, userId]);

  useEffect(() => {
    // A provider can outlive an Auth.js session update. Reset module/context
    // state before loading the next user's scoped persisted selection.
    if (activeUserIdRef.current !== userId) {
      activeUserIdRef.current = userId;
      setOrganizations([]);
      setSelectedOrgId(null);
    }

    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      const url = new URL(window.location.href);
      const fromUrl = url.searchParams.get('org');
      if (fromUrl) {
        preferredOrgIdRef.current = fromUrl;
        url.searchParams.delete('org');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
    } catch {
      // ignore
    }
    fetchOrgs();
  }, [fetchOrgs, setSelectedOrgId, userId]);

  // The org switcher opens /signup in another tab; when it finishes, pick up
  // the new organization here without a reload.
  useEffect(() => {
    return onOrganizationCreated((id) => {
      preferredOrgIdRef.current = id;
      fetchOrgs();
    });
  }, [fetchOrgs]);

  const updateOrganization = useCallback((id: string, patch: Partial<Organization>) => {
    setOrganizations((current) =>
      current.map((org) => (org.id === id ? { ...org, ...patch } : org))
    );
  }, []);

  const selectedOrg = organizations.find((o) => o.id === selectedOrgId) ?? null;

  return (
    <OrgContext.Provider
      value={{
        organizations,
        selectedOrgId,
        selectedOrg,
        setSelectedOrgId,
        loading,
        error,
        refresh: fetchOrgs,
        updateOrganization,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}
