'use client';

// Global organization context for admin pages.
// Fetches orgs once, shares selectedOrgId across all admin routes.

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '@/services/api';

export interface Organization {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
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
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrgs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<Organization[]>('/organizations');
      setOrganizations(data);
      // Auto-select first org if none selected or current selection no longer exists
      if (data.length > 0) {
        setSelectedOrgId((prev) => {
          if (prev && data.some((o) => o.id === prev)) return prev;
          return data[0].id;
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrgs();
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
