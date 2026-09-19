'use client';

// Password page for a private storefront (Online store › Preferences › Store
// access). Shows the organization's branding and message, exchanges the
// password for an access token, stores it, and lets the parent refetch.

import React, { FormEvent, useState } from 'react';
import { api } from '../services/api';
import { resolveAssetUrl } from '../lib/assets';
import { writeStorefrontAccess } from '../lib/storefrontAccess';
import BrandScope from './BrandScope';
import LogoBox from './LogoBox';
import type { ThemeMode } from '@/lib/theme';

interface GateOrganization {
  id: string;
  name: string;
  logoUrl: string | null;
  brandColor?: string | null;
  themeMode?: ThemeMode | null;
}

interface StorefrontPasswordGateProps {
  organization: GateOrganization;
  message: string | null;
  onUnlocked: () => void | Promise<void>;
}

export default function StorefrontPasswordGate({ organization, message, onUnlocked }: StorefrontPasswordGateProps) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoSrc = resolveAssetUrl(organization.logoUrl);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      const { token } = await api.post<{ token: string }>(`/organizations/${organization.id}/storefront-access`, {
        password,
      });
      writeStorefrontAccess(organization.id, token);
      await onUnlocked();
    } catch (err: any) {
      setError(err.status === 401 ? 'Incorrect password. Try again.' : err.message || 'Something went wrong');
      setSubmitting(false);
    }
  };

  return (
    <BrandScope
      color={organization.brandColor}
      themeMode={organization.themeMode}
      className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4"
    >
      <div
        data-testid="storefront-password-gate"
        className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-md dark:bg-slate-800"
      >
        {logoSrc && (
          <LogoBox src={logoSrc} alt={`${organization.name} logo`} className="mx-auto mb-4 w-20 rounded-lg shadow-sm" />
        )}
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{organization.name}</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400" data-testid="storefront-message">
          {message || 'This store is private. Enter the password to continue.'}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3 text-left">
          <label htmlFor="storefront-password" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
            Password
          </label>
          <input
            id="storefront-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-link focus:outline-none focus:ring-2 focus:ring-brand-link/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || !password}
            className="w-full rounded-md bg-brand-link px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Checking…' : 'Enter store'}
          </button>
        </form>
      </div>
    </BrandScope>
  );
}
