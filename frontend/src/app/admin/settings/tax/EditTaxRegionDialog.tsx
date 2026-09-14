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
  /** Recalculate now succeeded; the dialog stays open with the fresh row. */
  onRecalculated: (result: UpsertTaxRegionResponse) => void;
}

const fieldLabel = 'block text-sm font-medium text-gray-900 dark:text-white';
const helpText = 'mt-1 text-sm text-gray-600 dark:text-slate-400';

function formatChecked(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const secondaryBtn =
  'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

export default function EditTaxRegionDialog({ region, service, canEdit, returnFocusRef, onClose, onSaved, onRecalculated }: EditTaxRegionDialogProps) {
  const taxApi = useTaxApi();
  const initialSource: TaxSource = region.source ?? 'STRIPE';
  const initialRate = region.manualRate != null ? (region.manualRate * 100).toFixed(3).replace(/\.?0+$/, '') : '';

  const [collecting, setCollecting] = useState(region.collecting);
  const [source, setSource] = useState<TaxSource>(initialSource);
  const [rateText, setRateText] = useState(initialRate);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);
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

  // Re-run the lookup with the saved setting (not the unsaved form state).
  const handleRecalculate = async () => {
    if (!canEdit || recalculating || saving) return;
    setRecalculating(true);
    setError(null);
    setRecalcMessage(null);
    try {
      const result = await taxApi.recalculateRegion(region.country, region.region);
      onRecalculated(result);
      const events = result.recalculatedEvents === 1 ? '1 upcoming event' : `${result.recalculatedEvents} upcoming events`;
      const kept = result.keptEvents ?? 0;
      setRecalcMessage(
        result.region.lastError
          ? `Lookup failed${kept > 0 ? `; kept the current rate on ${kept === 1 ? '1 event' : `${kept} events`}` : ''}: ${result.region.lastError}`
          : `Recalculated ${events} at ${formatRate(result.region.lastRate)}.`
      );
    } catch (err) {
      setError(describeError(err, 'Could not recalculate this region'));
    } finally {
      setRecalculating(false);
    }
  };

  const stripeUnavailable = service.status !== 'active';
  const lastChecked = formatChecked(region.lastCheckedAt);
  const canRecalculate = canEdit && region.configured && region.collecting && !dirty;
  const upcoming = region.upcomingEventCount === 1 ? '1 upcoming event uses' : `${region.upcomingEventCount} upcoming events use`;

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

        <div className="flex flex-wrap items-start justify-between gap-3 text-sm text-gray-600 dark:text-slate-400" data-testid="tax-region-lookup">
          <div className="min-w-0 space-y-1">
            {region.lastError ? (
              <span className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
                <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                Last lookup{lastChecked ? ` on ${lastChecked}` : ''}: {region.lastError}
              </span>
            ) : region.lastCheckedAt ? (
              <span className="block">
                Last lookup: {formatRate(region.lastRate)} via {region.lastSource === 'MANUAL' ? 'manual rate' : 'Stripe Tax'}
                {lastChecked ? ` on ${lastChecked}` : ''}
              </span>
            ) : null}
            <span className="block">{upcoming} this region.</span>
            {recalcMessage && (
              <span role="status" className="block text-gray-900 dark:text-white">
                {recalcMessage}
              </span>
            )}
          </div>
          {region.configured && region.collecting && (
            <button
              type="button"
              className={secondaryBtn}
              onClick={handleRecalculate}
              disabled={!canRecalculate || recalculating}
              title={dirty ? 'Save your changes first' : undefined}
            >
              {recalculating ? 'Recalculating…' : 'Recalculate now'}
            </button>
          )}
        </div>

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
