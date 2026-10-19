'use client';

// Start of the registration flow (spec 057): whether it charges, when it takes
// registrations, and which opt-ins the form offers (create an account, email
// subscribe; both off for a new form). The form has no name or intro of its
// own: it follows the event's name, and the event description is its intro
// (both on the Name step), so the registration event is one page.
// Every form starts blank: it asks for an email only, the rest is added on the
// Fields step. The wizard footer's Next submits this form (`START_FORM_ID`);
// the flow then moves to the next step.

import { FormEvent, useEffect, useState, type ReactNode } from 'react';
import { BadgeDollarSign, ClipboardCheck, type LucideIcon } from 'lucide-react';
import type { DraftForm } from '../previewMessages';
import type { FormKind } from '@/lib/applications';
import { FormWindowFields, fromLocalInput } from '@/components/applications/FormEditorCards';
import { hintClass, labelClass } from '../ui';

export const START_FORM_ID = 'flow-start-form';

export interface NewFormBody {
  name: string;
  kind: FormKind;
  offerAccount: boolean;
  offerMarketing: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

export type OptInOffers = {
  offerAccount: boolean;
  offerMarketing: boolean;
};

/** The opt-ins a form offers applicants. Start uses it before the form exists, and again once it does. */
export function OptInSettings({ value, onChange, disabled }: { value: OptInOffers; onChange: (next: OptInOffers) => void; disabled?: boolean }) {
  const row = 'flex min-h-11 items-center gap-2 text-sm font-medium text-gray-800 dark:text-slate-200';
  return (
    <fieldset className="space-y-1" disabled={disabled}>
      <legend className={labelClass}>Also offer registrants</legend>
      <p className={hintClass}>Everyone gives their email and agrees to the privacy terms. These add an optional checkbox each.</p>
      <label className={row}>
        <input type="checkbox" checked={value.offerAccount} onChange={(e) => onChange({ ...value, offerAccount: e.target.checked })} className="h-5 w-5 accent-accent-600" data-testid="offer-account" />
        An account, to follow their registration
      </label>
      <label className={row}>
        <input type="checkbox" checked={value.offerMarketing} onChange={(e) => onChange({ ...value, offerMarketing: e.target.checked })} className="h-5 w-5 accent-accent-600" data-testid="offer-marketing" />
        A subscription to your emails
      </label>
    </fieldset>
  );
}

interface Props {
  /** Create in flight (the footer's Next waits). */
  onBusyChange: (busy: boolean) => void;
  /** Every change to name or kind: the live preview shows the form as it is set up. */
  onDraftChange: (draft: DraftForm) => void;
  eventName: string;
  /** The venue's zone: the window is its wall clock (gotcha 28). */
  timeZone: string | null;
  onCreate: (body: NewFormBody) => Promise<void>;
}

const KINDS: { paid: boolean; title: string; detail: string; icon: LucideIcon }[] = [
  { paid: false, title: 'Free', detail: 'People register and you approve them. No payment.', icon: ClipboardCheck },
  { paid: true, title: 'Charge a fee', detail: 'Registering is free. People you approve choose an option and pay.', icon: BadgeDollarSign },
];

/**
 * Free or paid. Start uses it before the form exists; once it does, the
 * choice stays editable until the first application (the backend's 409 then).
 */
export function KindChoice({ paid, onChange, disabled }: { paid: boolean; onChange: (paid: boolean) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="sr-only">Free or paid</legend>
      {KINDS.map(({ paid: value, title, detail, icon: Icon }) => (
        <label
          key={title}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-300 bg-white p-4 hover:border-gray-400 has-[:checked]:border-accent-600 has-[:checked]:bg-accent-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500 has-[:focus-visible]:ring-offset-2 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-slate-500 dark:has-[:checked]:border-accent-400 dark:has-[:checked]:bg-slate-700 dark:has-[:focus-visible]:ring-offset-slate-900"
        >
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gray-700 dark:text-slate-300" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
            <span className="mt-0.5 block text-sm text-gray-600 dark:text-slate-300">{detail}</span>
          </span>
          <input
            type="radio"
            name="add-form-kind"
            checked={paid === value}
            onChange={() => onChange(value)}
            className="mt-1 h-5 w-5 shrink-0 accent-accent-600"
            data-testid={value ? 'add-form-paid' : 'add-form-free'}
          />
        </label>
      ))}
    </fieldset>
  );
}

/** When the form takes registrations; blank = open from publish, no end. */
export function RegistrationWindow({ children }: { children: ReactNode }) {
  return (
    <fieldset className="space-y-1">
      <legend className={labelClass}>When registration is open</legend>
      <p className={hintClass}>Leave both blank to take registrations as soon as the event is published, with no closing time.</p>
      {children}
    </fieldset>
  );
}

/** A paid form has two screens for registrants; say so where the choice is made. */
export function PaidStagesHint() {
  return (
    <p className={hintClass}>
      Registrants then see two screens: first the form, which they submit for free. Once you approve them, a second screen lists the options you set up, to choose one and pay. The preview shows each screen on the step that sets it up.
    </p>
  );
}

/** A form name needs 2 characters; an event name may be shorter. Mirrors the backend's `registrationFormName`. */
const formNameFor = (eventName: string) => (eventName.trim().length >= 2 ? eventName.trim() : `${eventName.trim()} registration`.trim()).slice(0, 80);

export default function StartFormStep({ onBusyChange, onDraftChange, eventName, timeZone, onCreate }: Props) {
  const name = formNameFor(eventName);
  const [paid, setPaid] = useState(false);
  const [offers, setOffers] = useState<OptInOffers>({ offerAccount: false, offerMarketing: false });
  const [openWindow, setOpenWindow] = useState({ opensAt: '', closesAt: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind: FormKind = paid ? 'PAID' : 'FREE';
  useEffect(() => onDraftChange({ name, kind, ...offers }), [name, kind, offers, onDraftChange]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    const opensAt = fromLocalInput(openWindow.opensAt, timeZone);
    const closesAt = fromLocalInput(openWindow.closesAt, timeZone);
    if (opensAt && closesAt && closesAt <= opensAt) {
      setError('Closes must be after Opens');
      setBusy(false);
      onBusyChange(false);
      return;
    }
    try {
      await onCreate({ name, kind, ...offers, opensAt, closesAt });
    } catch (err) {
      setError((err as Error)?.message || "Couldn't create the form");
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <form id={START_FORM_ID} onSubmit={submit} noValidate aria-label="Set up the registration form" aria-busy={busy || undefined} className="space-y-6">
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
      <KindChoice paid={paid} onChange={setPaid} />
      {paid && <PaidStagesHint />}
      <RegistrationWindow>
        <FormWindowFields {...openWindow} timeZone={timeZone} onChange={(patch) => setOpenWindow((w) => ({ ...w, ...patch }))} />
      </RegistrationWindow>
      <OptInSettings value={offers} onChange={setOffers} />
    </form>
  );
}
