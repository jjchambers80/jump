'use client';

// Edit one tax region: whether the organization collects there and by which
// source. Saving recalculates the cached rate on upcoming events in the region.

import { FormEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '../SettingsDialog';
import { WarningIcon } from '../icons';
import { describeError, useTaxApi } from './useTaxApi';
import { formatRate, parsePercent, type TaxRegionRow, type TaxServiceStatus, type TaxSource, type UpsertTaxRegionResponse } from './types';

interface EditTaxRegionDialogProps {
  region: TaxRegionRow;
  service: TaxServiceStatus;
  canEdit: boolean;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onSaved: (result: UpsertTaxRegionResponse) => void;
}

const fieldLabel = 'block text-sm font-medium text-gray-900 dark:text-white';
const helpText = 'mt-1 text-sm text-gray-600 dark:text-slate-400';

function formatChecked(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function EditTaxRegionDialog({ region, service, canEdit, returnFocusRef, onClose, onSaved }: EditTaxRegionDialogProps) {
  const taxApi = useTaxApi();
  const initialSource: TaxSource = region.source ?? 'STRIPE';
  const initialRate = region.manualRate != null ? (region.manualRate * 100).toFixed(3).replace(/\.?0+$/, '') : '';

  const [collecting, setCollecting] = useState(region.collecting);
  const [source, setSource] = useState<TaxSource>(initialSource);
  const [rateText, setRateText] = useState(initialRate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggleRef = useRef<HTMLInputElement>(null);

  const parsedRate = parsePercent(rateText);
  const rateInvalid = source === 'MANUAL' && collecting && (parsedRate === null || parsedRate < 0 || parsedRate > 0.5);
  const dirty = collecting !== region.collecting || source !== initialSource || rateText !== initialRate;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || rateInvalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await taxApi.saveRegion(region.country, region.region, {
        collecting,
        source: collecting ? source : 'STRIPE',
        ...(collecting && source === 'MANUAL' ? { manualRate: parsedRate } : {}),
      });
      onSaved(result);
    } catch (err) {
      setError(describeError(err, 'Could not save this tax region'));
      setSaving(false);
    }
  };

  const stripeUnavailable = service.status !== 'active';
  const lastChecked = formatChecked(region.lastCheckedAt);

  return (
    <SettingsDialog
      titleId="edit-tax-region-title"
      title={`Edit tax region — ${region.name}`}
      dirty={dirty}
      saving={saving}
      saveDisabled={!canEdit || rateInvalid}
      initialFocusRef={toggleRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className="space-y-6">
        {!canEdit && (
          <p role="note" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Only organization admins can change tax settings.
          </p>
        )}

        <label className="flex items-start gap-3">
          <input
            ref={toggleRef}
            type="checkbox"
            checked={collecting}
            disabled={!canEdit}
            onChange={(e) => setCollecting(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <span>
            <span className={fieldLabel}>Collect sales tax in {region.name}</span>
            <span className={helpText}>
              Applies to every event at your {region.venueCount === 1 ? 'venue' : `${region.venueCount} venues`} in {region.name}. Leave this off if
              you are not registered to collect and remit here.
            </span>
          </span>
        </label>

        <fieldset disabled={!collecting || !canEdit} className="space-y-3 disabled:opacity-60">
          <legend className={fieldLabel}>Tax service</legend>

          <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
            <input
              type="radio"
              name="tax-source"
              value="STRIPE"
              checked={source === 'STRIPE'}
              onChange={() => setSource('STRIPE')}
              className="mt-0.5 h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-900 dark:text-white">Stripe Tax (automatic)</span>
              <span className={helpText}>Rates are looked up by each venue&apos;s postal code and applied to the ticket base price.</span>
              {stripeUnavailable ? (
                <span className="mt-2 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300">
                  <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  Stripe Tax is {service.status === 'pending' ? 'not activated on the platform account' : 'unavailable'}; this region will calculate 0% until it is.
                </span>
              ) : !region.registrationFound ? (
                <span className="mt-2 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300">
                  <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  No Stripe Tax registration found for {region.name}. Stripe will return 0% here — use a manual rate instead.
                </span>
              ) : null}
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
            <input
              type="radio"
              name="tax-source"
              value="MANUAL"
              checked={source === 'MANUAL'}
              onChange={() => setSource('MANUAL')}
              className="mt-0.5 h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-900 dark:text-white">Manual rate</span>
              <span className={helpText}>One flat rate for every venue in {region.name}, applied to the ticket base price.</span>
              {source === 'MANUAL' && (
                <span className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Manual tax rate for ${region.name}, percent`}
                    aria-invalid={rateInvalid || undefined}
                    value={rateText}
                    onChange={(e) => setRateText(e.target.value)}
                    placeholder="8.25"
                    className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  />
                  <span className="text-sm text-gray-700 dark:text-slate-300">%</span>
                  {rateInvalid && rateText.trim() !== '' && (
                    <span className="text-sm text-red-700 dark:text-red-300">Enter a rate between 0 and 50.</span>
                  )}
                </span>
              )}
            </span>
          </label>
        </fieldset>

        {(region.lastCheckedAt || region.lastError) && (
          <div className="text-sm text-gray-600 dark:text-slate-400">
            {region.lastError ? (
              <span className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
                <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                Last lookup{lastChecked ? ` on ${lastChecked}` : ''}: {region.lastError}
              </span>
            ) : (
              <span>
                Last lookup: {formatRate(region.lastRate)} via {region.lastSource === 'MANUAL' ? 'manual rate' : 'Stripe Tax'}
                {lastChecked ? ` on ${lastChecked}` : ''}
              </span>
            )}
          </div>
        )}

        <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200">
          Saving recalculates the tax rate on upcoming events in {region.name}. Orders already placed are not changed.
        </p>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </SettingsDialog>
  );
}
