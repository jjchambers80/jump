'use client';

// Organizations dashboard page — admin-only per FR-038
// Lists all organizations with create form

import React, { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';

interface Organization {
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

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchOrganizations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<Organization[]>('/organizations');
      setOrganizations(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      setCreating(true);
      setError(null);
      await api.post('/organizations', { name: newName.trim() });
      setNewName('');
      await fetchOrganizations();
    } catch (err: any) {
      setError(err.message || 'Failed to create organization');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Organizations</h1>

      {/* Create Form */}
      <form onSubmit={handleCreate} className="mb-8 flex items-end gap-3">
        <div className="flex-1">
          <label
            htmlFor="org-name"
            className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1"
          >
            New Organization
          </label>
          <input
            id="org-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Organization name"
            className="block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            required
          />
        </div>
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-16 bg-gray-200 dark:bg-slate-700 rounded-lg" />
          ))}
        </div>
      )}

      {/* Organization List */}
      {!loading && organizations.length === 0 && (
        <p className="text-gray-500 dark:text-slate-400 text-center py-8">
          No organizations yet. Create one above to get started.
        </p>
      )}

      {!loading && organizations.length > 0 && (
        <div className="space-y-3">
          {organizations.map((org) => (
            <div
              key={org.id}
              className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex items-center justify-between"
            >
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                  {org.name}
                </h3>
                <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 dark:text-slate-400">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      org.status === 'ACTIVE'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400'
                    }`}
                  >
                    {org.status}
                  </span>
                  {org._count && (
                    <>
                      <span>
                        {org._count.venues} venue{org._count.venues !== 1 ? 's' : ''}
                      </span>
                      <span>
                        {org._count.users} user{org._count.users !== 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-xs text-gray-400 dark:text-slate-500">
                Created {new Date(org.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
