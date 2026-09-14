// Settings › Tax (spec 009)
// Shopify-style tax configuration for an organization: which engine computes
// rates (Stripe Tax on the platform account), and per US state whether the
// organization collects sales tax and by which source. Regions derive from the
// organization's venues — tax is venue-based, not customer-based.
'use client';

import { createRef, RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import SettingsNav from '../SettingsNav';
import { BoltIcon, ExternalLinkIcon, TaxIcon, WarningIcon } from '../icons';
import EditTaxRegionDialog from './EditTaxRegionDialog';
import TaxRegionsTable from './TaxRegionsTable';
import { describeError, useTaxApi } from './useTaxApi';
import { SERVICE_LABEL, SERVICE_STYLE, type TaxRegionRow, type TaxSettingsResponse, type UpsertTaxRegionResponse } from './types';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const secondaryBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

export default function TaxSettingsPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const taxApi = useTaxApi();
  const [data, setData] = useState<TaxSettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaxRegionRow | null>(null);
  const [savedMessage, setSavedMessage] = useState('');
  const rowRefs = useRef(new Map<string, RefObject<HTMLButtonElement>>());

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await taxApi.get());
    } catch (err) {
      setData(null);
      setError(describeError(err, 'Could not load tax settings'));
    }
  }, [taxApi]);

  // Wait for the org switcher before the first fetch; refetch on org change
  // (same gate as Settings › General).
  const loadedForOrg = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (orgLoading && !selectedOrgId) return;
    if (loadedForOrg.current === selectedOrgId) return;
    loadedForOrg.current = selectedOrgId;
    load();
  }, [orgLoading, selectedOrgId, load]);

  // One stable ref per region row so the dialog can return focus to it.
  const refsFor = useMemo(() => {
    const map = rowRefs.current;
    for (const r of data?.regions ?? []) {
      const key = `${r.country}/${r.region}`;
      if (!map.has(key)) map.set(key, createRef<HTMLButtonElement>());
    }
    return map;
  }, [data]);

  const editingRef = editing ? refsFor.get(`${editing.country}/${editing.region}`) : undefined;
  const unset = data?.regions.filter((r) => !r.configured && r.venueCount > 0) ?? [];

  const handleSaved = ({ region, recalculatedEvents }: UpsertTaxRegionResponse) => {
    setData((prev) =>
      prev
        ? { ...prev, regions: prev.regions.map((r) => (r.region === region.region && r.country === region.country ? region : r)) }
        : prev
    );
    setEditing(null);
    const events = recalculatedEvents === 1 ? '1 upcoming event' : `${recalculatedEvents} upcoming events`;
    setSavedMessage(`${region.name} saved. Tax rate recalculated on ${events}.`);
  };

  const service = data?.service;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="tax-heading" className="min-w-0 flex-1 space-y-6">
          <h2 id="tax-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <TaxIcon className="h-5 w-5 text-gray-500 dark:text-slate-400" />
            Tax
          </h2>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
          {savedMessage && (
            <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
              {savedMessage}
            </p>
          )}

          {/* Tax service */}
          <div className={cardClass} data-testid="tax-service-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Tax service</h3>
              {service?.manageUrl && (
                <a href={service.manageUrl} target="_blank" rel="noreferrer" className={secondaryBtn}>
                  Manage
                  <ExternalLinkIcon />
                </a>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 dark:border-slate-700">
              <BoltIcon className="h-5 w-5 text-indigo-500" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">Stripe Tax</span>
              {service ? (
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${SERVICE_STYLE[service.status]}`}>
                  {SERVICE_LABEL[service.status]}
                </span>
              ) : (
                <span className="text-xs text-gray-500 dark:text-slate-400">Checking…</span>
              )}
              {service?.status === 'active' && (
                <span className="text-sm text-gray-600 dark:text-slate-400">
                  {service.registrations.length === 1 ? '1 active registration' : `${service.registrations.length} active registrations`}
                </span>
              )}
            </div>
            {service && service.status !== 'active' && (
              <p className="mt-3 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300">
                <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                {service.status === 'pending'
                  ? 'Stripe Tax is not activated on the platform account. Regions set to Stripe Tax calculate 0% until it is; use a manual rate in the meantime.'
                  : 'Stripe Tax could not be reached. Regions set to Stripe Tax keep their last rate; manual rates are unaffected.'}
              </p>
            )}
          </div>

          {/* Tax regions */}
          <div className={cardClass} data-testid="tax-regions-card">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Tax regions</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              States where your venues are located and where you collect and remit sales tax. Add a venue in a new state to add a region.
              If you&apos;re unsure about your tax liability, check with a tax professional.
            </p>

            {unset.length > 0 && (
              <div
                role="status"
                data-testid="tax-action-needed"
                className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200"
              >
                <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {unset.map((r) => r.name).join(', ')} {unset.length === 1 ? 'has' : 'have'} venues but no tax setting. Events there collect no
                  tax until you choose one.
                </span>
              </div>
            )}

            <div className="mt-4">
              {data === null && !error ? (
                <p className="text-sm text-gray-600 dark:text-slate-400">Loading regions…</p>
              ) : data ? (
                <TaxRegionsTable regions={data.regions} needsAddress={data.needsAddress} service={data.service} rowRefs={refsFor} onEdit={(r) => { setSavedMessage(''); setEditing(r); }} />
              ) : null}
            </div>
          </div>
        </section>
      </div>

      {editing && data && editingRef && (
        <EditTaxRegionDialog
          region={editing}
          service={data.service}
          canEdit={data.canEdit}
          returnFocusRef={editingRef}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
