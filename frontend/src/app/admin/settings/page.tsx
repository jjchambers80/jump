'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import BusinessDetailsDialog from './BusinessDetailsDialog';
import StoreAddressDialog from './StoreAddressDialog';
import StoreContactDialog from './StoreContactDialog';
import SummaryRow from './SummaryRow';
import { MapPinIcon, StoreIcon } from './icons';
import { formatAddress, formatPhone } from './formShared';
import { BusinessDetails, businessTypeLabel } from './types';

type Editor = 'contact' | 'address' | 'business' | null;

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const listClass = 'mt-4 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700';

function contactSummary(details: BusinessDetails) {
  const parts = [details.email, formatPhone(details.phoneNumber)].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Add an email and phone number';
}

function businessSummary(details: BusinessDetails) {
  const parts = [
    details.businessType ? businessTypeLabel(details.businessType) : null,
    details.einMasked ? `EIN ${details.einMasked}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Add your business type and EIN';
}

export default function SettingsPage() {
  const { selectedOrgId, selectedOrg, updateOrganization, refresh } = useOrg();
  const [details, setDetails] = useState<BusinessDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noOrganization, setNoOrganization] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [savedMessage, setSavedMessage] = useState('');
  const contactRowRef = useRef<HTMLButtonElement>(null);
  const addressRowRef = useRef<HTMLButtonElement>(null);
  const businessRowRef = useRef<HTMLButtonElement>(null);

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

  // Settings edits the signed-in user's assigned org; the header switcher can
  // point at a different org for ADMIN users. Flag that so a renamed store
  // showing up unchanged in the header is not a surprise.
  const editingOtherOrg = Boolean(details && selectedOrgId && selectedOrgId !== details.id);

  const openEditor = (next: Exclude<Editor, null>) => {
    setSavedMessage('');
    setEditor(next);
  };

  const closeEditor = () => setEditor(null);

  const finishSave = (saved: BusinessDetails, message: string) => {
    setDetails(saved);
    setEditor(null);
    setSavedMessage(message);
  };

  const handleContactSaved = (saved: BusinessDetails) => {
    finishSave(saved, 'Store contact details saved.');
    // Optimistically patch the switcher so the new name shows immediately,
    // then refetch in the background so the list stays authoritative.
    updateOrganization(saved.id, { name: saved.name });
    void refresh();
  };

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
          <h2 id="general-settings-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <StoreIcon className="h-5 w-5 text-gray-700 dark:text-slate-300" />
            General
          </h2>

          {loading && (
            <div aria-label="Loading business details" className="mt-4 space-y-4">
              {[1, 2].map((item) => (
                <div key={item} className={`${cardClass} animate-pulse`}>
                  <div className="h-4 w-40 rounded bg-gray-200 dark:bg-slate-700" />
                  <div className="mt-4 h-16 rounded-lg bg-gray-100 dark:bg-slate-700/70" />
                </div>
              ))}
            </div>
          )}

          {!loading && error && (
            <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
              <h3 className="font-semibold text-red-800 dark:text-red-300">Business details could not be loaded</h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>
              <button type="button" onClick={loadBusinessDetails} className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500">
                Retry
              </button>
            </div>
          )}

          {!loading && noOrganization && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-900/20">
              <h3 className="font-semibold text-amber-900 dark:text-amber-200">No organization assigned</h3>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                Ask an administrator to assign your account to an organization before editing business settings.
              </p>
            </div>
          )}

          {!loading && details && (
            <div className="mt-4 space-y-4">
              {editingOtherOrg && (
                <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                  You are editing <strong>{details.name}</strong>, but <strong>{selectedOrg?.name}</strong> is selected in the header. Changes here apply to {details.name}.
                </div>
              )}

              <div className={cardClass}>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Business details</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                  Business entity used for payouts, taxes, and legal notices for this store.
                </p>
                <div className={listClass}>
                  <SummaryRow
                    label="Edit business details"
                    leading={<span aria-hidden="true" className="text-2xl leading-none">🇺🇸</span>}
                    primary={details.companyName || details.name}
                    secondary={businessSummary(details)}
                    trailing="ellipsis"
                    buttonRef={businessRowRef}
                    onClick={() => openEditor('business')}
                  />
                </div>
              </div>

              <div className={cardClass}>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Store contact details</h3>
                <div className={listClass}>
                  <SummaryRow
                    label="Edit store contact details"
                    leading={<StoreIcon />}
                    primary={details.name}
                    secondary={contactSummary(details)}
                    buttonRef={contactRowRef}
                    onClick={() => openEditor('contact')}
                  />
                  <SummaryRow
                    label="Edit store address"
                    leading={<MapPinIcon />}
                    primary="Store address"
                    secondary={formatAddress(details) || 'Add your store address'}
                    buttonRef={addressRowRef}
                    onClick={() => openEditor('address')}
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <div role="status" aria-live="polite" className="sr-only">{savedMessage}</div>

      {editor === 'contact' && details && (
        <StoreContactDialog
          details={details}
          returnFocusRef={contactRowRef}
          onClose={closeEditor}
          onSaved={handleContactSaved}
        />
      )}

      {editor === 'address' && details && (
        <StoreAddressDialog
          details={details}
          returnFocusRef={addressRowRef}
          onClose={closeEditor}
          onSaved={(saved) => finishSave(saved, 'Store address saved.')}
        />
      )}

      {editor === 'business' && details && (
        <BusinessDetailsDialog
          details={details}
          returnFocusRef={businessRowRef}
          onClose={closeEditor}
          onSaved={(saved) => finishSave(saved, 'Business details saved.')}
        />
      )}
    </div>
  );
}
