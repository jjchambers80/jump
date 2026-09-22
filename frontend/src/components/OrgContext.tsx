'use client';

// Global organization context for admin pages.
// Fetches orgs once, shares selectedOrgId across all admin routes.

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import api, { setActiveOrganizationId } from '@/services/api';
import { onOrganizationCreated } from '@/lib/orgChannel';
import {
  readPersistedOrganizationId,
  persistOrganizationId,
  clearPersistedOrganizationId,
  resolveSelectedOrgId,
} from '@/lib/orgContextUtils';
import type { Organization } from '@/lib/orgContextUtils';

// Re-export types consumed by sibling modules.
export type { Organization } from '@/lib/orgContextUtils';
export {
  ACTIVE_ORG_STORAGE_PREFIX,
  activeOrganizationStorageKey,
  readPersistedOrganizationId,
  persistOrganizationId,
  clearPersistedOrganizationId,
  resolveSelectedOrgId,
} from '@/lib/orgContextUtils';

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
      const preferred = preferredOrgIdRef.current;
      preferredOrgIdRef.current = null;
      const persisted = readPersistedOrganizationId(requestedUserId);
      const prev = selectedOrgIdRef.current;
      const next = resolveSelectedOrgId(data, preferred, persisted, prev, sessionOrgId);
      if (next) {
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