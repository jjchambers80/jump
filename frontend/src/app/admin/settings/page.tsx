'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import BusinessDetailsDialog from './BusinessDetailsDialog';
import { BusinessDetails, businessTypeLabel } from './types';

const valueClass = 'mt-1 text-sm text-gray-900 dark:text-slate-100';
const labelClass = 'text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400';

function display(value: string | null | undefined) {
  return value || 'Not provided';
}

function formatPhone(phone: string | null) {
  if (!phone || phone.length !== 10) return display(phone);
  return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
}

export default function SettingsPage() {
  const [details, setDetails] = useState<BusinessDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noOrganization, setNoOrganization] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const editButtonRef = useRef<HTMLButtonElement>(null);

  const loadBusinessDetails = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setNoOrganization(false);
      const data = await api.get<BusinessDetails>('/admin/settings/business-details');
      setDetails(data);
    } catch (requestError: any) {
      if (requestError.status === 404) {
        setNoOrganization(true);
        setDetails(null);
      } else {
        setError(requestError.message || 'Unable to load business settings.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBusinessDetails();
  }, [loadBusinessDetails]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Manage your organization and business information.
      </p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <nav aria-label="Settings sections" className="w-full shrink-0 md:w-56">
          <button
            type="button"
            aria-current="page"
            className="w-full rounded-md bg-indigo-50 px-3 py-2 text-left text-sm font-semibold text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-300"
          >
            General
          </button>
        </nav>

        <section aria-labelledby="general-settings-heading" className="min-w-0 flex-1">
          <h2 id="general-settings-heading" className="sr-only">General settings</h2>

          {loading && (
            <div aria-label="Loading business details" className="animate-pulse rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
              <div className="h-6 w-56 rounded bg-gray-200 dark:bg-slate-700" />
              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                {[1, 2, 3, 4, 5, 6].map((item) => <div key={item} className="h-12 rounded bg-gray-100 dark:bg-slate-700/70" />)}
              </div>
            </div>
          )}

          {!loading && error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
              <h3 className="font-semibold text-red-800 dark:text-red-300">Business details could not be loaded</h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>
              <button type="button" onClick={loadBusinessDetails} className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500">
                Retry
              </button>
            </div>
          )}

          {!loading && noOrganization && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-900/20">
              <h3 className="font-semibold text-amber-900 dark:text-amber-200">No organization assigned</h3>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                Ask an administrator to assign your account to an organization before editing business settings.
              </p>
            </div>
          )}

          {!loading && details && (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="flex flex-col gap-4 border-b border-gray-200 px-5 py-5 sm:flex-row sm:items-start sm:justify-between dark:border-slate-700">
                <div className="min-w-0">
                  <h2 className="break-words text-xl font-semibold text-gray-900 dark:text-white">{details.name}</h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Business details</p>
                </div>
                <button
                  ref={editButtonRef}
                  type="button"
                  onClick={() => { setSavedMessage(''); setEditing(true); }}
                  className="shrink-0 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
                  aria-label="Edit business details"
                >
                  Edit
                </button>
              </div>

              <dl className="grid gap-x-8 gap-y-6 px-5 py-6 sm:grid-cols-2">
                <div><dt className={labelClass}>Type of business</dt><dd className={valueClass}>{businessTypeLabel(details.businessType)}</dd></div>
                <div><dt className={labelClass}>Nickname</dt><dd className={valueClass}>{display(details.nickname)}</dd></div>
                <div><dt className={labelClass}>Business address</dt><dd className={valueClass}>{display(details.addressLine1)}</dd></div>
                <div><dt className={labelClass}>Apartment, suite, etc.</dt><dd className={valueClass}>{display(details.addressLine2)}</dd></div>
                <div><dt className={labelClass}>City</dt><dd className={valueClass}>{display(details.city)}</dd></div>
                <div><dt className={labelClass}>State and ZIP</dt><dd className={valueClass}>{details.state || details.postalCode ? `${details.state || ''} ${details.postalCode || ''}`.trim() : 'Not provided'}</dd></div>
                <div><dt className={labelClass}>Phone number</dt><dd className={valueClass}>{formatPhone(details.phoneNumber)}</dd></div>
                <div><dt className={labelClass}>Employer Identification Number (EIN)</dt><dd className={valueClass}>{display(details.einMasked)}</dd></div>
              </dl>
            </div>
          )}
        </section>
      </div>

      <div aria-live="polite" className="sr-only">{savedMessage}</div>

      {editing && details && (
        <BusinessDetailsDialog
          details={details}
          returnFocusRef={editButtonRef}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setDetails(saved);
            setEditing(false);
            setSavedMessage('Business details saved.');
          }}
        />
      )}
    </div>
  );
}
