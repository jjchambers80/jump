'use client';

// Flyout editors opened from the Event Details page (spec 037 D10): each
// PATCHes only the fields it shows and hands the page a reload. Admission,
// Listing, a single ticket tier and an application form's settings. The full
// pages (/edit/details, /edit/sales) stay for everything else.

import React, { FormEvent, useMemo, useState } from 'react';
import api from '@/services/api';
import Flyout from '@/components/Flyout';
import SlugField from '@/components/SlugField';
import { AdmissionModeField, RsvpSettingsFields, hintClass, inputClass, labelClass, type AdmissionMode } from '@/components/events/EventFormLayout';
import { formatEventTime, instantToZonedInput, zonedInputToInstant, zonedInputToIso } from '@/lib/eventTime';
import type { OverviewEvent, OverviewForm, OverviewTier } from '@/lib/eventOverview';

const errorMessage = (err: any, fallback: string) => err?.message || fallback;

// ── Admission ──────────────────────────────────────────────────────────────

export function AdmissionFlyout({
  orgId,
  event,
  hasSales,
  onClose,
  onSaved,
}: {
  orgId: string;
  event: OverviewEvent;
  /** Orders or RSVPs exist, so the mode is locked (spec 034 D11). */
  hasSales: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = useMemo(
    () => ({
      mode: event.admissionMode as AdmissionMode,
      capacity: String(event.capacity || ''),
      limitEnabled: event.rsvpLimit != null && event.rsvpLimit > 0,
      limit: event.rsvpLimit ? String(event.rsvpLimit) : '',
      party: String(event.rsvpMaxPartySize || 1),
    }),
    [event]
  );
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const allocated = event.priceTiers.reduce((s, t) => s + t.quantityTotal, 0);
  const capacityNum = parseInt(state.capacity) || 0;
  const capacityShort = state.mode === 'TICKETED' && capacityNum > 0 && allocated > capacityNum;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {};
    if (state.mode !== event.admissionMode) body.admissionMode = state.mode;
    if (state.mode === 'TICKETED') {
      if (capacityNum !== event.capacity) body.capacity = capacityNum;
    } else {
      const limit = state.limitEnabled && state.limit ? parseInt(state.limit) : null;
      if (limit !== event.rsvpLimit) body.rsvpLimit = limit;
      body.capacity = limit ?? 0;
      const party = parseInt(state.party) || 1;
      if (party !== event.rsvpMaxPartySize) body.rsvpMaxPartySize = party;
    }
    try {
      await api.patch(`/organizations/${orgId}/events/${event.id}`, body);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save admission'));
      setSaving(false);
    }
  };

  return (
    <Flyout
      title="Admission"
      description="How people get in, and how many."
      dirty={dirty}
      saving={saving}
      saveDisabled={capacityShort || (state.mode === 'TICKETED' && capacityNum < 1)}
      error={error}
      onClose={onClose}
      onSubmit={submit}
    >
      <AdmissionModeField
        value={state.mode}
        onChange={(mode) => setState((s) => ({ ...s, mode }))}
        isDisabled={(mode) => hasSales && mode !== event.admissionMode}
        describedBy={hasSales ? 'flyout-admission-lock' : undefined}
      />
      {hasSales && (
        <p id="flyout-admission-lock" className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          This event already has {event.admissionMode === 'RSVP' ? 'RSVPs' : 'orders'}, so its admission mode is locked.
        </p>
      )}
      {state.mode === 'TICKETED' ? (
        <div className="mt-5">
          <label htmlFor="flyout-capacity" className={labelClass}>Capacity</label>
          <input
            id="flyout-capacity"
            type="number"
            min={1}
            max={100000}
            required
            value={state.capacity}
            onChange={(e) => setState((s) => ({ ...s, capacity: e.target.value }))}
            className={inputClass}
            aria-describedby="flyout-capacity-hint"
          />
          <p id="flyout-capacity-hint" className={capacityShort ? 'mt-1 text-xs text-red-700 dark:text-red-400' : hintClass}>
            {capacityShort
              ? `Tiers already hold ${allocated.toLocaleString()} tickets; capacity cannot be lower.`
              : `The ceiling for the whole event. Tiers hold ${allocated.toLocaleString()} today.`}
          </p>
        </div>
      ) : (
        <RsvpSettingsFields
          limitEnabled={state.limitEnabled}
          onLimitEnabledChange={(limitEnabled) => setState((s) => ({ ...s, limitEnabled }))}
          limit={state.limit}
          onLimitChange={(limit) => setState((s) => ({ ...s, limit }))}
          maxPartySize={state.party}
          onMaxPartySizeChange={(party) => setState((s) => ({ ...s, party }))}
        />
      )}
    </Flyout>
  );
}

// ── Listing ────────────────────────────────────────────────────────────────

export function ListingFlyout({
  orgId,
  event,
  onClose,
  onSaved,
}: {
  orgId: string;
  event: OverviewEvent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState(event.category ?? '');
  const [slug, setSlug] = useState(event.slug ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const dirty = category !== (event.category ?? '') || slug !== (event.slug ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSlugError(null);
    const body: Record<string, unknown> = {};
    if (category !== (event.category ?? '')) body.category = category.trim() || null;
    if (slug !== (event.slug ?? '')) body.slug = slug;
    try {
      await api.patch(`/organizations/${orgId}/events/${event.id}`, body);
      onSaved();
    } catch (err: any) {
      if (err?.status === 409) setSlugError(errorMessage(err, 'This address is taken'));
      else setError(errorMessage(err, 'Could not save the listing'));
      setSaving(false);
    }
  };

  return (
    <Flyout title="Listing" description="How the event is found and linked." dirty={dirty} saving={saving} error={error} onClose={onClose} onSubmit={submit}>
      <div className="space-y-5">
        <div>
          <label htmlFor="flyout-category" className={labelClass}>Category</label>
          <input
            id="flyout-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Music, Sports, Conference"
            className={inputClass}
          />
        </div>
        <SlugField
          id="flyout-slug"
          value={slug}
          onChange={setSlug}
          source={event.name}
          prefix="/events/"
          baseUrl={typeof window !== 'undefined' ? window.location.origin : undefined}
          error={slugError}
        />
        {event.status === 'PUBLISHED' && slug !== event.slug && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            The event is live. Links already shared with the old address stop working.
          </p>
        )}
      </div>
    </Flyout>
  );
}

// ── One ticket tier ────────────────────────────────────────────────────────

interface TierDraft {
  name: string;
  description: string;
  price: string;
  quantityTotal: string;
  minPerOrder: string;
  maxPerOrder: string;
  saleStartDate: string;
  saleEndDate: string;
  visibility: OverviewTier['visibility'];
  isRefundable: boolean;
  isActive: boolean;
}

function tierDraft(tier: OverviewTier | null, zone: string | null | undefined): TierDraft {
  return {
    name: tier?.name ?? '',
    description: tier?.description ?? '',
    price: tier ? String(tier.price) : '',
    quantityTotal: tier ? String(tier.quantityTotal) : '',
    minPerOrder: tier?.minPerOrder != null ? String(tier.minPerOrder) : '1',
    maxPerOrder: tier?.maxPerOrder != null ? String(tier.maxPerOrder) : '10',
    saleStartDate: tier?.saleStartDate ? instantToZonedInput(tier.saleStartDate, zone) : '',
    saleEndDate: tier?.saleEndDate ? instantToZonedInput(tier.saleEndDate, zone) : '',
    visibility: tier?.visibility ?? 'PUBLIC',
    isRefundable: tier?.isRefundable ?? false,
    isActive: tier?.isActive ?? true,
  };
}

export function TierFlyout({
  orgId,
  event,
  tier,
  onClose,
  onSaved,
}: {
  orgId: string;
  event: OverviewEvent;
  /** null = a new tier. */
  tier: OverviewTier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const zone = event.venue?.timezone;
  const initial = useMemo(() => tierDraft(tier, zone), [tier, zone]);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const set = <K extends keyof TierDraft>(key: K, value: TierDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const sold = tier?.quantitySold ?? 0;
  const qty = parseInt(draft.quantityTotal) || 0;
  const valid = draft.name.trim() && draft.price !== '' && Number(draft.price) >= 0 && qty >= Math.max(1, sold);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      price: parseFloat(draft.price),
      quantityTotal: qty,
      minPerOrder: draft.minPerOrder ? parseInt(draft.minPerOrder) : null,
      maxPerOrder: draft.maxPerOrder ? parseInt(draft.maxPerOrder) : null,
      saleStartDate: zonedInputToIso(draft.saleStartDate, zone),
      saleEndDate: zonedInputToIso(draft.saleEndDate, zone),
      visibility: draft.visibility,
      isRefundable: draft.isRefundable,
      ...(tier ? { isActive: draft.isActive } : {}),
    };
    const base = `/organizations/${orgId}/events/${event.id}/price-tiers`;
    try {
      if (tier) await api.patch(`${base}/${tier.id}`, body);
      else await api.post(base, { ...body, description: body.description ?? undefined });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the tier'));
      setSaving(false);
    }
  };

  const windowHint = (value: string) => {
    const at = zonedInputToInstant(value, zone);
    return at ? `${formatEventTime(at, zone)} at the venue` : 'Leave empty for no limit';
  };

  return (
    <Flyout
      title={tier ? `Edit ${tier.name}` : 'New ticket tier'}
      description={tier && sold > 0 ? `${sold.toLocaleString()} sold. Quantity cannot go below that.` : 'Priced per ticket, before fees.'}
      dirty={dirty || !tier}
      saving={saving}
      saveDisabled={!valid}
      submitLabel={tier ? 'Save tier' : 'Add tier'}
      error={error}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="tier-name" className={labelClass}>Name</label>
          <input id="tier-name" data-autofocus required value={draft.name} onChange={(e) => set('name', e.target.value)} className={inputClass} placeholder="General Admission" />
        </div>
        <div>
          <label htmlFor="tier-description" className={labelClass}>Description</label>
          <textarea id="tier-description" rows={2} maxLength={500} value={draft.description} onChange={(e) => set('description', e.target.value)} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tier-price" className={labelClass}>Price ($)</label>
            <input id="tier-price" type="number" min="0" step="0.01" required value={draft.price} onChange={(e) => set('price', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="tier-quantity" className={labelClass}>Quantity</label>
            <input id="tier-quantity" type="number" min={Math.max(1, sold)} required value={draft.quantityTotal} onChange={(e) => set('quantityTotal', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="tier-min" className={labelClass}>Min per order</label>
            <input id="tier-min" type="number" min="1" value={draft.minPerOrder} onChange={(e) => set('minPerOrder', e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="tier-max" className={labelClass}>Max per order</label>
            <input id="tier-max" type="number" min="1" value={draft.maxPerOrder} onChange={(e) => set('maxPerOrder', e.target.value)} className={inputClass} />
          </div>
        </div>
        <fieldset className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
          <legend className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-slate-400">Sale window</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="tier-start" className={labelClass}>Starts</label>
              <input id="tier-start" type="datetime-local" value={draft.saleStartDate} onChange={(e) => set('saleStartDate', e.target.value)} className={inputClass} />
              <p className={hintClass}>{windowHint(draft.saleStartDate)}</p>
            </div>
            <div>
              <label htmlFor="tier-end" className={labelClass}>Ends</label>
              <input id="tier-end" type="datetime-local" value={draft.saleEndDate} onChange={(e) => set('saleEndDate', e.target.value)} className={inputClass} />
              <p className={hintClass}>{windowHint(draft.saleEndDate)}</p>
            </div>
          </div>
        </fieldset>
        <div className="grid grid-cols-2 items-end gap-3">
          <div>
            <label htmlFor="tier-visibility" className={labelClass}>Visibility</label>
            <select id="tier-visibility" value={draft.visibility} onChange={(e) => set('visibility', e.target.value as TierDraft['visibility'])} className={inputClass}>
              <option value="PUBLIC">Public</option>
              <option value="PRIVATE">Private link</option>
              <option value="HIDDEN">Hidden</option>
            </select>
          </div>
          <div className="space-y-1.5 pb-1">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
              <input type="checkbox" checked={draft.isRefundable} onChange={(e) => set('isRefundable', e.target.checked)} className="h-4 w-4 accent-indigo-600" />
              Refundable
            </label>
            {tier && (
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => set('isActive', e.target.checked)} className="h-4 w-4 accent-indigo-600" />
                On sale
              </label>
            )}
          </div>
        </div>
      </div>
    </Flyout>
  );
}

// ── Application form settings ──────────────────────────────────────────────

const FORM_STATUSES: OverviewForm['status'][] = ['DRAFT', 'OPEN', 'CLOSED'];

export function FormSettingsFlyout({
  event,
  form,
  onClose,
  onSaved,
}: {
  event: OverviewEvent;
  form: OverviewForm;
  onClose: () => void;
  onSaved: () => void;
}) {
  const zone = event.venue?.timezone;
  const initial = useMemo(
    () => ({
      name: form.name,
      status: form.status,
      opensAt: form.opensAt ? instantToZonedInput(form.opensAt, zone) : '',
      closesAt: form.closesAt ? instantToZonedInput(form.closesAt, zone) : '',
    }),
    [form, zone]
  );
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {};
    if (state.name !== initial.name) body.name = state.name.trim();
    if (state.status !== initial.status) body.status = state.status;
    if (state.opensAt !== initial.opensAt) body.opensAt = zonedInputToIso(state.opensAt, zone);
    if (state.closesAt !== initial.closesAt) body.closesAt = zonedInputToIso(state.closesAt, zone);
    try {
      await api.patch(`/admin/events/${event.id}/application-forms/${form.id}`, body);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the form settings'));
      setSaving(false);
    }
  };

  return (
    <Flyout
      title={`${form.name} settings`}
      description="Name, status and when it accepts applications. Options and questions are on the form page."
      dirty={dirty}
      saving={saving}
      saveDisabled={state.name.trim().length < 2}
      error={error}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="form-flyout-name" className={labelClass}>Name</label>
          <input id="form-flyout-name" required minLength={2} value={state.name} onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))} className={inputClass} />
        </div>
        <fieldset>
          <legend className={labelClass}>Status</legend>
          <div className="grid grid-cols-3 gap-2">
            {FORM_STATUSES.map((status) => (
              <label
                key={status}
                className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500 ${
                  state.status === status
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-800 dark:border-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-200'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="form-flyout-status"
                  value={status}
                  checked={state.status === status}
                  onChange={() => setState((s) => ({ ...s, status }))}
                  className="sr-only"
                />
                {status.charAt(0) + status.slice(1).toLowerCase()}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="form-flyout-opens" className={labelClass}>Opens</label>
            <input id="form-flyout-opens" type="datetime-local" value={state.opensAt} onChange={(e) => setState((s) => ({ ...s, opensAt: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label htmlFor="form-flyout-closes" className={labelClass}>Closes</label>
            <input id="form-flyout-closes" type="datetime-local" value={state.closesAt} onChange={(e) => setState((s) => ({ ...s, closesAt: e.target.value }))} className={inputClass} />
          </div>
        </div>
        <p className={hintClass}>Times are the venue&apos;s clock. Leave empty to accept applications while the form is open.</p>
      </div>
    </Flyout>
  );
}
