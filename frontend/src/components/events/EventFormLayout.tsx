'use client';

// Shared layout pieces for the admin event create and edit pages.
// Content (name, description, tiers, add-ons) sits in the wide left column;
// configuration (venue, date, admission, category) in the right-hand <aside>.
// Fields in the aside are outside the <form> element, so they point back at it
// with the `form` attribute: native `required` checks and Enter-to-submit still work.

import React from 'react';

export const EVENT_FORM_ID = 'event-form';

export const inputClass =
  'block w-full min-h-11 sm:min-h-10 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500';
export const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';
export const hintClass = 'mt-1 text-xs text-gray-500 dark:text-slate-400';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900';

/** Full-width page shell: header, alerts, then the 8/4 grid. */
export function EventFormShell({
  header,
  alerts,
  main,
  aside,
  mobileActions,
  children,
}: {
  header: React.ReactNode;
  alerts?: React.ReactNode;
  main: React.ReactNode;
  aside: React.ReactNode;
  /** Sticky save bar shown below `xl`, where the aside stacks under the content. */
  mobileActions: React.ReactNode;
  /** Dialogs and flyouts rendered outside the grid. */
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 py-6 sm:py-8">
      {header}
      {alerts}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="min-w-0 space-y-6 xl:col-span-8">{main}</div>
        <aside aria-label="Event settings" className="min-w-0 space-y-6 xl:col-span-4">
          {aside}
        </aside>
      </div>
      <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:-mx-6 sm:px-6 xl:hidden">
        {mobileActions}
      </div>
      {children}
    </div>
  );
}

export function EventFormHeader({
  title,
  notice,
  actions,
}: {
  title: string;
  notice?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
        {notice}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

export function FormAlert({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  const styles =
    tone === 'error'
      ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
      : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`mb-6 rounded-md border p-4 ${styles}`}>
      <p className="text-sm">{children}</p>
    </div>
  );
}

/** A titled card; the heading labels the region for screen readers. */
export function FormCard({
  id,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Plain card for sections that render their own heading (Add-ons). */
export function FormPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 sm:p-6">
      {children}
    </div>
  );
}

export function EventFormActions({
  submitLabel,
  savingLabel,
  saving,
  disabled,
  onCancel,
  layout,
}: {
  submitLabel: string;
  savingLabel: string;
  saving: boolean;
  disabled: boolean;
  onCancel: () => void;
  /** `stack` for the aside card, `row` for the mobile bar. */
  layout: 'stack' | 'row';
}) {
  const wrap = layout === 'stack' ? 'flex flex-col gap-2' : 'flex gap-3';
  const size = layout === 'stack' ? 'w-full' : 'flex-1 sm:flex-none';
  return (
    <div className={wrap}>
      <button
        type="submit"
        form={EVENT_FORM_ID}
        disabled={disabled}
        aria-busy={saving}
        className={`${size} min-h-11 rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed ${focusRing}`}
      >
        {saving ? savingLabel : submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className={`${size} min-h-11 rounded-md border border-gray-300 dark:border-slate-600 px-6 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 ${focusRing}`}
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * Save card at the top of the aside, pinned while the content column scrolls.
 * Hidden below `xl`, where the sticky bottom bar takes over.
 */
export function EventFormActionsCard(props: Omit<React.ComponentProps<typeof EventFormActions>, 'layout'> & {
  children?: React.ReactNode;
}) {
  const { children, ...actions } = props;
  return (
    <div className="hidden xl:block xl:sticky xl:top-6 xl:z-10 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 sm:p-6">
      {children}
      <EventFormActions {...actions} layout="stack" />
    </div>
  );
}

export type AdmissionMode = 'TICKETED' | 'RSVP';

const ADMISSION_OPTIONS: { value: AdmissionMode; label: string }[] = [
  { value: 'TICKETED', label: 'Ticketed' },
  { value: 'RSVP', label: 'RSVP' },
];

/** Ticketed / RSVP segmented control built on native radios (arrow keys, one tab stop). */
export function AdmissionModeField({
  value,
  onChange,
  isDisabled,
  describedBy,
}: {
  value: AdmissionMode;
  onChange: (mode: AdmissionMode) => void;
  isDisabled?: (mode: AdmissionMode) => boolean;
  describedBy?: string;
}) {
  return (
    <fieldset aria-describedby={describedBy}>
      <legend className="sr-only">Admission mode</legend>
      <div className="grid grid-cols-2 rounded-lg border border-gray-300 dark:border-slate-600 overflow-hidden">
        {ADMISSION_OPTIONS.map((option) => {
          const disabled = isDisabled?.(option.value) ?? false;
          return (
            <label key={option.value} className={disabled ? 'cursor-not-allowed' : 'cursor-pointer'}>
              <input
                type="radio"
                name="admissionMode"
                value={option.value}
                checked={value === option.value}
                disabled={disabled}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <span className="flex min-h-11 items-center justify-center px-4 py-2.5 text-sm font-medium transition-colors bg-white text-gray-700 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 peer-checked:bg-indigo-600 peer-checked:text-white peer-checked:hover:bg-indigo-600 peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-indigo-300">
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** RSVP-only settings: optional headcount cap and party size. */
export function RsvpSettingsFields({
  limitEnabled,
  onLimitEnabledChange,
  limit,
  onLimitChange,
  maxPartySize,
  onMaxPartySizeChange,
}: {
  limitEnabled: boolean;
  onLimitEnabledChange: (enabled: boolean) => void;
  limit: string;
  onLimitChange: (value: string) => void;
  maxPartySize: string;
  onMaxPartySizeChange: (value: string) => void;
}) {
  return (
    <div className="mt-4 space-y-4">
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          role="switch"
          form={EVENT_FORM_ID}
          checked={limitEnabled}
          onChange={(e) => onLimitEnabledChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="relative h-5 w-9 shrink-0 rounded-full bg-gray-200 transition-colors dark:bg-gray-700 after:absolute after:start-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] dark:after:border-gray-600 peer-checked:bg-indigo-600 peer-checked:after:translate-x-full peer-checked:after:border-white rtl:peer-checked:after:-translate-x-full peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-slate-800"
        />
        <span className="text-sm text-gray-700 dark:text-slate-300">Limit RSVPs</span>
      </label>

      {limitEnabled && (
        <div>
          <label htmlFor="event-rsvp-limit" className={labelClass}>
            RSVP Limit
          </label>
          <input
            id="event-rsvp-limit"
            type="number"
            form={EVENT_FORM_ID}
            value={limit}
            onChange={(e) => onLimitChange(e.target.value)}
            placeholder="Max headcount"
            min={1}
            max={100000}
            className={inputClass}
          />
        </div>
      )}

      <div>
        <label htmlFor="event-rsvp-party-size" className={labelClass}>
          Guests per RSVP
        </label>
        <input
          id="event-rsvp-party-size"
          type="number"
          form={EVENT_FORM_ID}
          value={maxPartySize}
          onChange={(e) => onMaxPartySizeChange(e.target.value)}
          placeholder="1–10"
          min={1}
          max={10}
          aria-describedby="event-rsvp-party-size-hint"
          className={inputClass}
        />
        <p id="event-rsvp-party-size-hint" className={hintClass}>
          How many guests each attendee may bring (including themselves)
        </p>
      </div>
    </div>
  );
}

/** "Add from Preset" menu + "+ Add Tier" button for the Price Tiers card header. */
export function TierHeaderActions<P extends { id: string; name: string; price: number }>({
  presets,
  open,
  onToggle,
  onPick,
  onAdd,
}: {
  presets: P[];
  open: boolean;
  onToggle: () => void;
  onPick: (preset: P) => void;
  onAdd: () => void;
}) {
  return (
    <>
      {presets.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls="tier-preset-menu"
            className={`min-h-9 rounded-md border border-indigo-300 dark:border-indigo-700 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 ${focusRing}`}
          >
            Add from Preset
          </button>
          {open && (
            <ul
              id="tier-preset-menu"
              className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg"
            >
              {presets.map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    onClick={() => onPick(preset)}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 focus-visible:bg-gray-100 dark:focus-visible:bg-slate-700 focus-visible:outline-none"
                  >
                    <span className="font-medium">{preset.name}</span>
                    <span className="ml-2 text-gray-500 dark:text-slate-400">
                      {preset.price === 0 ? 'Free' : `$${preset.price.toFixed(2)}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onAdd}
        className={`min-h-9 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 ${focusRing}`}
      >
        + Add Tier
      </button>
    </>
  );
}
