'use client';

// Organization selector component for organizer/admin dashboard navigation
// Allows switching between organizations in multi-org context per FR-038

import React, { useEffect, useState } from 'react';

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

interface OrganizationSelectorProps {
  organizations: Organization[];
  selectedOrgId: string | null;
  onSelect: (orgId: string) => void;
  loading?: boolean;
}

export default function OrganizationSelector({
  organizations,
  selectedOrgId,
  onSelect,
  loading = false,
}: OrganizationSelectorProps) {
  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-10 bg-gray-200 dark:bg-slate-700 rounded w-64" />
      </div>
    );
  }

  if (organizations.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-slate-400">No organizations available</p>;
  }

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="org-selector"
        className="text-sm font-medium text-gray-700 dark:text-slate-300"
      >
        Organization:
      </label>
      <select
        id="org-selector"
        value={selectedOrgId || ''}
        onChange={(e) => onSelect(e.target.value)}
        className="block w-64 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="" disabled>
          Select organization…
        </option>
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
            {org.status === 'INACTIVE' ? ' (Inactive)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
