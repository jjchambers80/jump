'use client';

// Form editor cards (spec 011), shared by the setup flows and the
// standing-form page; each card saves on its own through the API.
// A standing form (spec 044, `eventId: null`) adds the storefront button label
// and the thank-you message; it is FREE, so it never shows tiers or money.

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { instantToZonedInput, zonedInputToIso } from '@/lib/eventTime';
import { timeZoneLabel } from '@/lib/timeZones';
// The event setup wizard's floor-map and collect-more steps (spec 050-L).
import { wizardLink } from '@/components/event-setup/applicationSteps';
import { BUSINESS_FIELDS, businessFieldsOf, MAX_PINNED_QUESTIONS, money, QUESTION_TYPE_LABEL, type AdminForm, type BusinessField, type AdminTier, type Question, type QuestionType } from '@/lib/applications';

const card = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const btn = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
const primary = 'rounded-md bg-accent-500 px-3 py-1.5 text-sm font-semibold text-gray-950 hover:bg-accent-hover disabled:opacity-50';
const danger = 'text-sm font-medium text-red-700 hover:underline dark:text-red-300';
const field = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 disabled:opacity-60';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300';

const CHOICE = new Set<QuestionType>(['SINGLE_CHOICE', 'MULTI_CHOICE']);


/** A tier as the cards need it; `AdminTier` satisfies it. */
export type EditorTier = Pick<AdminTier, 'id' | 'name' | 'description' | 'price' | 'quantityTotal' | 'isActive'> & Partial<Pick<AdminTier, 'amounts' | 'quantityApproved' | 'quantityReserved' | 'addOns'>>;

/** What the cards read; `AdminForm` satisfies it. */
export interface EditorForm {
  id: string;
  /** Null on a standing form (spec 044). */
  eventId?: string | null;
  collectBusiness?: boolean;
  businessFields?: AdminForm['businessFields'];
  collectName?: boolean;
  buttonLabel?: string | null;
  successMessage?: string | null;
  kind: AdminForm['kind'];
  name: string;
  slug?: string;
  intro: string | null;
  status?: AdminForm['status'];
  opensAt?: string | null;
  closesAt?: string | null;
  /** The venue's zone (gotcha 28): the open / close window is its wall clock. */
  timezone?: string | null;
  chargeTiming: AdminForm['chargeTiming'];
  feeMode: AdminForm['feeMode'];
  taxable: boolean;
  paymentDueDays: number;
  overduePolicy: AdminForm['overduePolicy'];
  /** Spec 037 D5: approval guarantees a space (takes a slot in the category). */
  reserveOnApproval?: boolean;
  /** Spec 039: vendors choose a tier, or a spot on the floor map. */
  spaceSelection?: 'TIERS' | 'MAP' | null;
  paymentsEnabled?: boolean;
  tiers: EditorTier[];
  questions: Question[];
  addOns?: AdminForm['addOns'];
}

/**
 * The open / close window as `datetime-local` text. Event forms read and write
 * it in the venue's zone (gotcha 28); a standing form has no venue, so it keeps
 * the browser's clock.
 */
function toLocalInput(iso: string | null | undefined, zone?: string | null): string {
  if (zone) return instantToZonedInput(iso, zone);
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string, zone?: string | null): string | null {
  if (!local) return null;
  return zone ? zonedInputToIso(local, zone) : new Date(local).toISOString();
}

/** A radio group as stacked choices with a title and one line each (spec 051): fieldset + legend, native radios. */
function ChoiceGroup<V extends string>({
  legend,
  name,
  value,
  disabled,
  onChange,
  options,
}: {
  legend: string;
  name: string;
  value: V;
  disabled: boolean;
  onChange: (value: V) => void;
  options: { value: V; title: string; detail: string; testId: string }[];
}) {
  return (
    <fieldset className="sm:col-span-2">
      <legend className={labelClass}>{legend}</legend>
      <div className="mt-1 space-y-2">
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 px-3 py-2.5 text-sm has-[:checked]:border-accent-500 has-[:checked]:bg-accent-50/40 dark:border-slate-700 dark:has-[:checked]:bg-slate-800">
            <input type="radio" name={name} checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} data-testid={o.testId} className="mt-0.5 h-4 w-4 accent-accent-600" />
            <span className="min-w-0">
              <span className="block font-medium text-gray-900 dark:text-white">{o.title}</span>
              <span className="block text-gray-600 dark:text-slate-400">{o.detail}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function SettingsCard({
  form,
  canEdit,
  onSave,
  onChange,
  section,
  formId,
  hideSubmit = false,
}: {
  form: EditorForm;
  canEdit: boolean;
  onSave?: (body: Record<string, unknown>) => Promise<void>;
  /** Every change, for the setup flows' live preview. */
  onChange?: (settings: Record<string, unknown>) => void;
  /**
   * Spec 051 setup flows: one step's part of the card (details = name,
   * intro and window; payment = how a PAID form sells; status). Absent = all.
   * Every save still sends the whole card, unchanged parts included.
   */
  section?: 'details' | 'payment' | 'status';
  /** id of the <form>, so a wizard footer button can submit it. */
  formId?: string;
  /** The wizard's Next saves it instead. */
  hideSubmit?: boolean;
}) {
  const show = (part: 'details' | 'payment' | 'status') => !section || section === part;
  const standing = form.eventId === null;
  const [state, setState] = useState({
    name: form.name,
    buttonLabel: form.buttonLabel ?? '',
    successMessage: form.successMessage ?? '',
        intro: form.intro ?? '',
    status: form.status ?? 'DRAFT',
    opensAt: toLocalInput(form.opensAt, form.timezone),
    closesAt: toLocalInput(form.closesAt, form.timezone),
    chargeTiming: form.chargeTiming,
    feeMode: form.feeMode,
    taxable: form.taxable,
    paymentDueDays: form.paymentDueDays,
    overduePolicy: form.overduePolicy,
    reserveOnApproval: form.reserveOnApproval !== false,
    spaceSelection: (form.spaceSelection === 'MAP' ? 'MAP' : 'TIERS') as 'TIERS' | 'MAP',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setState({
      name: form.name,
      buttonLabel: form.buttonLabel ?? '',
      successMessage: form.successMessage ?? '',
            intro: form.intro ?? '',
      status: form.status ?? 'DRAFT',
      opensAt: toLocalInput(form.opensAt, form.timezone),
      closesAt: toLocalInput(form.closesAt, form.timezone),
      chargeTiming: form.chargeTiming,
      feeMode: form.feeMode,
      taxable: form.taxable,
      paymentDueDays: form.paymentDueDays,
      overduePolicy: form.overduePolicy,
      reserveOnApproval: form.reserveOnApproval !== false,
      spaceSelection: form.spaceSelection === 'MAP' ? 'MAP' : 'TIERS',
    });
  }, [form]);

  const paidSettings = (s: typeof state) =>
    form.kind === 'PAID'
      ? // chargeTiming is legacy (spec 037 phase 5): not shown, sent back unchanged.
        // spaceSelection is no longer chosen here (TIERS for new forms): sent back unchanged.
        { chargeTiming: s.chargeTiming, feeMode: s.feeMode, taxable: s.taxable, paymentDueDays: Number(s.paymentDueDays), overduePolicy: s.overduePolicy, reserveOnApproval: s.reserveOnApproval, spaceSelection: s.spaceSelection }
      : {};
  const update = (patch: Partial<typeof state>) => {
    const next = { ...state, ...patch };
    setState(next);
    // The setup flows (spec 051) feed the live preview.
    onChange?.({ name: next.name, intro: next.intro || null, buttonLabel: next.buttonLabel.trim() || null, ...paidSettings(next) });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || !onSave) return;
    setSaving(true);
    const body: Record<string, unknown> = {
      name: state.name,
      intro: state.intro || null,
      status: state.status,
      opensAt: fromLocalInput(state.opensAt, form.timezone),
      closesAt: fromLocalInput(state.closesAt, form.timezone),
      ...paidSettings(state),
      buttonLabel: state.buttonLabel.trim() || null,
      ...(standing && { successMessage: state.successMessage.trim() || null }),
    };
    await onSave(body);
    setSaving(false);
  };

  const paidBlocked = form.kind === 'PAID' && !form.paymentsEnabled;

  return (
    <form id={formId} onSubmit={submit} className={section ? undefined : card} data-testid="form-settings">
      <h2 className={section ? 'sr-only' : 'text-base font-semibold text-gray-900 dark:text-white'}>Settings</h2>
      {paidBlocked && section !== 'details' && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Paid forms cannot open until application payments are enabled on this platform. You can set everything up now.
        </p>
      )}
      <div className={`${section ? '' : 'mt-3 '}grid gap-4 sm:grid-cols-2`}>
        {show('details') && (
        <>
        <div>
          <label htmlFor="f-name" className={labelClass}>Name</label>
          <input id="f-name" value={state.name} disabled={!canEdit} onChange={(e) => update({ name: e.target.value })} className={field} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="f-intro" className={labelClass}>Intro shown to applicants</label>
          <textarea id="f-intro" rows={3} value={state.intro} disabled={!canEdit} onChange={(e) => update({ intro: e.target.value })} className={field} />
        </div>
        </>
        )}
        <>
        {show('status') && (
        <div className={section === 'status' ? 'sm:col-span-2' : undefined}>
          <label htmlFor="f-status" className={labelClass}>Status</label>
          <select id="f-status" value={state.status} disabled={!canEdit} onChange={(e) => update({ status: e.target.value as AdminForm['status'] })} className={field}>
            <option value="DRAFT">Draft (hidden)</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed (visible, not accepting)</option>
          </select>
        </div>
        )}
        {show('details') && (
        <div className={section ? 'grid gap-3 sm:col-span-2 sm:grid-cols-2' : 'grid grid-cols-2 gap-3'}>
          <div>
            <label htmlFor="f-opens" className={labelClass}>Opens</label>
            <input id="f-opens" type="datetime-local" aria-describedby={form.timezone ? "f-window-zone" : undefined} value={state.opensAt} disabled={!canEdit} onChange={(e) => update({ opensAt: e.target.value })} className={field} />
          </div>
          <div>
            <label htmlFor="f-closes" className={labelClass}>Closes</label>
            <input id="f-closes" type="datetime-local" aria-describedby={form.timezone ? "f-window-zone" : undefined} value={state.closesAt} disabled={!canEdit} onChange={(e) => update({ closesAt: e.target.value })} className={field} />
          </div>
          {form.timezone && (
            <p id="f-window-zone" className="col-span-2 text-xs text-gray-600 dark:text-slate-400">
              Times are the venue&apos;s clock: {timeZoneLabel(form.timezone)}.
            </p>
          )}
        </div>
        )}
        </>
        {show('details') && (
          <div>
            <label htmlFor="f-button" className={labelClass}>Button label</label>
            <input id="f-button" value={state.buttonLabel} maxLength={80} placeholder={standing ? 'Apply' : state.name} disabled={!canEdit} onChange={(e) => update({ buttonLabel: e.target.value })} aria-describedby="f-button-hint" className={field} />
            <p id="f-button-hint" className="mt-1 text-xs text-gray-500 dark:text-slate-400">{standing ? 'The call to action on the pages that show this form.' : 'The button on the event page. Empty: the form name.'}</p>
          </div>
        )}
        {standing && show('details') && (
          <>
            <div className="sm:col-span-2">
              <label htmlFor="f-success" className={labelClass}>Thank-you message</label>
              <textarea id="f-success" rows={3} value={state.successMessage} maxLength={2000} placeholder="Thanks — we'll review your application and email you." disabled={!canEdit} onChange={(e) => update({ successMessage: e.target.value })} className={field} />
            </div>
          </>
        )}
        {form.kind === 'PAID' && show('payment') && (
          <>
            {/* Spec 037 phase 5: vendors apply for free; after approval they choose a space and pay. Spec 051 trimmed the copy. */}
            {!section && (
              <p className="text-sm text-gray-600 dark:text-slate-400 sm:col-span-2">
                Vendors apply without paying. After you approve one, they choose their space and pay.
              </p>
            )}
            <ChoiceGroup
              legend="When you approve a vendor"
              name="f-reserve"
              value={state.reserveOnApproval ? 'on' : 'off'}
              disabled={!canEdit}
              onChange={(value) => update({ reserveOnApproval: value === 'on' })}
              options={[
                { value: 'on', title: 'Hold a space for them', detail: 'Approval is refused when the category is full.', testId: 'form-reserve-on' },
                { value: 'off', title: 'First come, first served', detail: 'Approved vendors take spaces in the order they pay.', testId: 'form-reserve-off' },
              ]}
            />
            <div className="sm:col-span-2">
              <label htmlFor="f-fee" className={labelClass}>Fees</label>
              <select id="f-fee" value={state.feeMode} disabled={!canEdit} onChange={(e) => update({ feeMode: e.target.value as AdminForm['feeMode'] })} className={field}>
                <option value="PASS">Vendor pays the fees on top of the price</option>
                <option value="ABSORB">I pay the fees; vendors pay the listed price</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="f-due" className={labelClass}>Days to pay after approval</label>
              <input id="f-due" type="number" inputMode="numeric" min={1} max={30} value={state.paymentDueDays} disabled={!canEdit} onChange={(e) => update({ paymentDueDays: Number(e.target.value) })} className={`${field} max-w-[8rem]`} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="f-overdue" className={labelClass}>If they don&apos;t pay in time</label>
              <select id="f-overdue" value={state.overduePolicy} disabled={!canEdit} onChange={(e) => update({ overduePolicy: e.target.value as AdminForm['overduePolicy'] })} className={field}>
                <option value="WITHDRAW">Withdraw them and free the space</option>
                <option value="HOLD">Keep the space and flag it</option>
              </select>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm text-gray-800 dark:text-slate-200 sm:col-span-2">
              <input type="checkbox" checked={state.taxable} disabled={!canEdit} onChange={(e) => update({ taxable: e.target.checked })} className="h-5 w-5" />
              Charge sales tax at the event&apos;s rate
            </label>
          </>
        )}
      </div>
      {canEdit && !hideSubmit && (
        <button type="submit" disabled={saving} className={`${primary} mt-4`}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      )}
    </form>
  );
}

// ─── Tiers ───────────────────────────────────────────────────────────────────

export function TiersCard({
  form,
  canEdit,
  onAdd,
  onUpdate,
  onDelete,
  onSetAddOns,
  embedded = false,
}: {
  form: EditorForm;
  canEdit: boolean;
  /** A wizard step of its own (spec 051): the step's h1 names it, so no card and no visible heading. */
  embedded?: boolean;
  onAdd: (body: Record<string, unknown>) => Promise<void>;
  onUpdate: (tierId: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (tierId: string) => Promise<void>;
  /** Omitted: the add-on picker is hidden. */
  onSetAddOns?: (tierId: string, addOnIds: string[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState({ name: '', price: '', quantityTotal: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', description: '', price: '', quantityTotal: '', isActive: true });
  const [editAddOnIds, setEditAddOnIds] = useState<string[]>([]);

  // Spec 012: add-ons an organizer can toggle per tier are the restricted
  // (non-allTiers) application add-ons; allTiers ones are shown as included.
  const eventAddOns = onSetAddOns ? form.addOns ?? [] : [];
  const restricted = eventAddOns.filter((a) => !a.allTiers);
  const everywhere = eventAddOns.filter((a) => a.allTiers && a.isActive);

  const startEdit = (t: EditorTier) => {
    setEditing(t.id);
    setEdit({ name: t.name, description: t.description ?? '', price: String(t.price), quantityTotal: String(t.quantityTotal), isActive: t.isActive });
    setEditAddOnIds((t.addOns ?? []).filter((a) => !a.allTiers).map((a) => a.id));
  };

  return (
    <div className={embedded ? undefined : card} data-testid="form-tiers">
      <h2 className={embedded ? 'sr-only' : 'text-base font-semibold text-gray-900 dark:text-white'}>Options and pricing</h2>
      <p className={`${embedded ? '' : 'mt-1 '}text-sm text-gray-600 dark:text-slate-400`}>
        Applicants pick one. Capacity is taken when you approve, so more people can apply than there are spots.
        {eventAddOns.length === 0 && (
          <>
            {' '}Add-ons (power, badges, tables) are created on the{' '}
            <Link href={wizardLink(form.eventId!, 'add-ons').href} className="text-accent-600 underline dark:text-accent-300">{wizardLink(form.eventId!, 'add-ons').label}</Link>.
          </>
        )}
      </p>
      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400">
          <tr>
            <th className="py-1 pr-3">Name</th>
            <th className="py-1 pr-3">Price</th>
            <th className="py-1 pr-3">Applicant pays</th>
            <th className="py-1 pr-3">You receive</th>
            <th className="py-1 pr-3">Spots</th>
            <th className="py-1">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {form.tiers.map((t) =>
            editing === t.id ? (
              <tr key={t.id}>
                <td colSpan={6} className="py-2">
                  <form
                    className="grid gap-2 sm:grid-cols-5 sm:items-end"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await onUpdate(t.id, { name: edit.name, description: edit.description || null, price: Number(edit.price), quantityTotal: Number(edit.quantityTotal), isActive: edit.isActive });
                      const before = (t.addOns ?? []).filter((a) => !a.allTiers).map((a) => a.id).sort().join(',');
                      if (onSetAddOns && restricted.length > 0 && before !== [...editAddOnIds].sort().join(',')) await onSetAddOns(t.id, editAddOnIds);
                      setEditing(null);
                    }}
                  >
                    <input aria-label="Tier name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={field} />
                    <input aria-label="Tier description" value={edit.description} placeholder="Description" onChange={(e) => setEdit({ ...edit, description: e.target.value })} className={field} />
                    <input aria-label="Tier price" type="number" min={0} step="0.01" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} className={field} />
                    <input aria-label="Tier spots" type="number" min={0} value={edit.quantityTotal} onChange={(e) => setEdit({ ...edit, quantityTotal: e.target.value })} className={field} />
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-slate-300">
                        <input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} /> Active
                      </label>
                      <button type="submit" className={primary}>Save</button>
                      <button type="button" className={btn} onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                    {eventAddOns.length > 0 && (
                      <fieldset className="sm:col-span-5" data-testid={`tier-add-ons-${t.id}`}>
                        <legend className={labelClass}>Add-ons offered</legend>
                        {everywhere.length > 0 && (
                          <p className="text-xs text-gray-600 dark:text-slate-400">Included on every option: {everywhere.map((a) => a.name).join(', ')}</p>
                        )}
                        {restricted.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                            {restricted.map((a) => (
                              <label key={a.id} className={`flex items-center gap-1 text-xs text-gray-700 dark:text-slate-300 ${a.isActive ? '' : 'opacity-60'}`}>
                                <input
                                  type="checkbox"
                                  checked={editAddOnIds.includes(a.id)}
                                  onChange={(e) => setEditAddOnIds(e.target.checked ? [...editAddOnIds, a.id] : editAddOnIds.filter((id) => id !== a.id))}
                                />
                                {a.name} ({money(a.price)}){!a.isActive && ' · inactive'}
                              </label>
                            ))}
                          </div>
                        )}
                      </fieldset>
                    )}
                  </form>
                </td>
              </tr>
            ) : (
              // An inactive option says so in words; fading the row would drop its text below 4.5:1 (WCAG 1.4.3).
              <tr key={t.id} className={t.isActive ? '' : 'bg-gray-50 dark:bg-slate-900/40'} data-testid={`tier-row-${t.id}`}>
                <td className="py-2 pr-3 font-medium text-gray-900 dark:text-white">
                  {t.name}
                  {!t.isActive && <span className="ml-2 text-xs text-gray-600 dark:text-slate-400">inactive</span>}
                  {t.description && <div className="text-xs font-normal text-gray-600 dark:text-slate-400">{t.description}</div>}
                  {(t.addOns ?? []).length > 0 && (
                    <div className="text-xs font-normal text-gray-500 dark:text-slate-400" data-testid={`tier-add-ons-summary-${t.id}`}>
                      Add-ons: {(t.addOns ?? []).map((a) => a.name).join(', ')}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{money(t.price)}</td>
                <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{t.amounts ? money(t.amounts.applicantPays) : '—'}</td>
                <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{t.amounts ? money(t.amounts.orgReceives) : '—'}</td>
                <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">
                  {`${(t.quantityApproved ?? 0) + (t.quantityReserved ?? 0)} / ${t.quantityTotal}`}
                </td>
                <td className="py-2 text-right">
                  {canEdit && (
                    <span className="flex justify-end gap-3">
                      <button type="button" className="text-sm font-medium text-accent-600 hover:underline dark:text-accent-300" onClick={() => startEdit(t)}>Edit</button>
                      <button type="button" className={danger} onClick={() => window.confirm(`Delete tier "${t.name}"?`) && onDelete(t.id)}>Delete</button>
                    </span>
                  )}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
      {canEdit && (
        <form
          className="mt-3 grid gap-2 sm:grid-cols-4 sm:items-end"
          data-testid="tier-add"
          onSubmit={async (e) => {
            e.preventDefault();
            await onAdd({ name: draft.name, price: Number(draft.price), quantityTotal: Number(draft.quantityTotal) });
            setDraft({ name: '', price: '', quantityTotal: '' });
          }}
        >
          <div>
            <label htmlFor="t-name" className={labelClass}>New option</label>
            <input id="t-name" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} placeholder="10x10 booth" />
          </div>
          <div>
            <label htmlFor="t-price" className={labelClass}>Price</label>
            <input id="t-price" required type="number" min={0} step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className={field} />
          </div>
          <div>
            <label htmlFor="t-qty" className={labelClass}>Spots</label>
            <input id="t-qty" required type="number" min={0} value={draft.quantityTotal} onChange={(e) => setDraft({ ...draft, quantityTotal: e.target.value })} className={field} />
          </div>
          <button type="submit" className={btn}>Add option</button>
        </form>
      )}
    </div>
  );
}

// ─── Questions ───────────────────────────────────────────────────────────────

interface QuestionDraft {
  label: string;
  helpText: string;
  type: QuestionType;
  required: boolean;
  options: string;
  pinned: boolean;
}

const emptyQuestion: QuestionDraft = { label: '', helpText: '', type: 'SHORT_TEXT', required: false, options: '', pinned: false };

function questionBody(d: QuestionDraft) {
  return {
    label: d.label,
    helpText: d.helpText || null,
    type: d.type,
    required: d.required,
    pinned: d.pinned,
    ...(CHOICE.has(d.type) && { options: d.options.split('\n').map((o) => o.trim()).filter(Boolean) }),
  };
}

type BuiltInKey = 'collectName' | BusinessField;
export type BuiltInPatch = { collectName?: boolean; businessFields?: BusinessField[] };

/** Fields every form can add with one click; Email is always asked. */
const BUILT_IN_FIELDS: { key: BuiltInKey; label: string; detail: string }[] = [
  { key: 'collectName', label: 'Name', detail: 'First and last name' },
  { key: 'businessName', label: 'Business name', detail: 'Business or outlet name' },
  { key: 'description', label: 'Business description', detail: 'A few lines about what they do' },
  { key: 'website', label: 'Website', detail: 'Their website address' },
  { key: 'socials', label: 'Social links', detail: 'Instagram, TikTok, Facebook, X, YouTube' },
  { key: 'photos', label: 'Photos', detail: 'Photos of their work or products' },
];

export function QuestionsCard({
  form,
  canEdit,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
  onToggleBuiltIn,
}: {
  form: EditorForm;
  canEdit: boolean;
  onAdd: (body: Record<string, unknown>) => Promise<void>;
  onUpdate: (id: string, body: Record<string, unknown>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onReorder: (ids: string[]) => Promise<void>;
  /** Adds or removes the built-in fields (Name, business fields); without it they are read-only. */
  onToggleBuiltIn?: (patch: BuiltInPatch) => Promise<void>;
}) {
  // A change shows at once; it settles on the saved value when the save resolves.
  const [pending, setPending] = useState<BuiltInPatch | null>(null);
  const business = pending?.businessFields ?? businessFieldsOf(form);
  const asks = (key: BuiltInKey) => (key === 'collectName' ? pending?.collectName ?? form.collectName !== false : business.includes(key));
  const toggle = async (key: BuiltInKey, value: boolean) => {
    if (!onToggleBuiltIn || pending !== null) return;
    const patch: BuiltInPatch =
      key === 'collectName'
        ? { collectName: value }
        : { businessFields: BUSINESS_FIELDS.filter((f) => (f === key ? value : business.includes(f))) };
    setPending(patch);
    try {
      await onToggleBuiltIn(patch);
    } finally {
      setPending(null);
    }
  };
  // The add panel stays closed until asked for, so the card shows only the fields in use.
  const [adding, setAdding] = useState(false);
  const editBuiltIns = canEdit && !!onToggleBuiltIn;
  const [draft, setDraft] = useState<QuestionDraft>(emptyQuestion);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<QuestionDraft>(emptyQuestion);

  const startEdit = (q: Question) => {
    setEditing(q.id);
    setEdit({ label: q.label, helpText: q.helpText ?? '', type: q.type, required: q.required, options: q.options.join('\n'), pinned: q.pinned ?? false });
  };
  // Pinned answer columns (spec 019): at most MAX_PINNED_QUESTIONS per form.
  const pinnedCount = form.questions.filter((x) => x.pinned).length;
  const pinFull = (self: Question | null) => pinnedCount - (self?.pinned ? 1 : 0) >= MAX_PINNED_QUESTIONS;

  const move = (index: number, delta: number) => {
    const ids = form.questions.map((q) => q.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onReorder(ids);
  };

  const editor = (value: QuestionDraft, set: (v: QuestionDraft) => void, idPrefix: string, self: Question | null = null) => (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-label`} className={labelClass}>Question</label>
        <input id={`${idPrefix}-label`} required value={value.label} onChange={(e) => set({ ...value, label: e.target.value })} className={field} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-type`} className={labelClass}>Type</label>
        <select id={`${idPrefix}-type`} value={value.type} onChange={(e) => set({ ...value, type: e.target.value as QuestionType })} className={field}>
          {Object.entries(QUESTION_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-help`} className={labelClass}>Help text</label>
        <input id={`${idPrefix}-help`} value={value.helpText} onChange={(e) => set({ ...value, helpText: e.target.value })} className={field} />
      </div>
      {CHOICE.has(value.type) && (
        <div className="sm:col-span-2">
          <label htmlFor={`${idPrefix}-options`} className={labelClass}>Options (one per line)</label>
          <textarea id={`${idPrefix}-options`} rows={3} value={value.options} onChange={(e) => set({ ...value, options: e.target.value })} className={field} />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
        <input type="checkbox" checked={value.required} onChange={(e) => set({ ...value, required: e.target.checked })} /> Required
      </label>
      <label className={`flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200 ${!value.pinned && pinFull(self) ? 'opacity-60' : ''}`} title={!value.pinned && pinFull(self) ? `At most ${MAX_PINNED_QUESTIONS} questions can be pinned` : undefined}>
        <input type="checkbox" checked={value.pinned} disabled={!value.pinned && pinFull(self)} onChange={(e) => set({ ...value, pinned: e.target.checked })} data-testid={`${idPrefix}-pinned`} /> Show as a column on the submissions list
      </label>
    </div>
  );

  return (
    <div className={card} data-testid="form-questions">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white">Fields</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Email is always asked. Add any other fields you need.</p>
      <ol className="mt-3 divide-y divide-gray-200 dark:divide-slate-700" data-testid="form-builtin-fields">
        <li className="flex items-center justify-between gap-3 py-3">
          <span className="font-medium text-gray-900 dark:text-white">Email</span>
          <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-slate-400">
            <Lock className="h-3 w-3" aria-hidden />
            Always asked
          </span>
        </li>
        {BUILT_IN_FIELDS.filter((b) => asks(b.key)).map((b) => (
          <li key={b.key} className="flex items-start justify-between gap-3 py-3" data-testid={`builtin-${b.key}`}>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">{b.label}</p>
              <p className="text-xs text-gray-600 dark:text-slate-400">{b.detail}</p>
            </div>
            {editBuiltIns && (
              <button type="button" className={danger} disabled={pending !== null} onClick={() => void toggle(b.key, false)} aria-label={`Remove ${b.label}`}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ol>
      <ol className="mt-3 divide-y divide-gray-200 dark:divide-slate-700">
        {form.questions.map((q, i) => (
          <li key={q.id} className="py-3" data-testid={`question-row-${q.id}`}>
            {editing === q.id ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await onUpdate(q.id, questionBody(edit));
                  setEditing(null);
                }}
                className="space-y-2"
              >
                {editor(edit, setEdit, `qe-${q.id}`, q)}
                <div className="flex gap-2">
                  <button type="submit" className={primary}>Save</button>
                  <button type="button" className={btn} onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {q.label}
                    {q.required && <span className="text-red-600"> *</span>}
                    {q.pinned && (
                      <span className="ml-2 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300" data-testid={`question-pinned-${q.id}`}>
                        List column
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-slate-400">
                    {QUESTION_TYPE_LABEL[q.type]}
                    {q.options.length ? ` · ${q.options.join(' / ')}` : ''}
                    {q.helpText ? ` · ${q.helpText}` : ''}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-2 text-sm">
                    <button type="button" aria-label="Move up" className={btn} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" aria-label="Move down" className={btn} disabled={i === form.questions.length - 1} onClick={() => move(i, 1)}>↓</button>
                    <button type="button" className="font-medium text-accent-600 hover:underline dark:text-accent-300" onClick={() => startEdit(q)}>Edit</button>
                    <button type="button" className={danger} onClick={() => window.confirm(`Remove "${q.label}"? Existing answers are kept.`) && onRemove(q.id)}>Remove</button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {canEdit && !adding && (
        <button type="button" className={`${btn} mt-4`} onClick={() => setAdding(true)} data-testid="question-add-open">
          + Add field
        </button>
      )}
      {canEdit && adding && (
        <form
          className="mt-4 space-y-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-slate-600"
          data-testid="question-add"
          onSubmit={async (e) => {
            e.preventDefault();
            await onAdd(questionBody(draft));
            setDraft(emptyQuestion);
            setAdding(false);
          }}
        >
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Add a field</p>
          {editBuiltIns && BUILT_IN_FIELDS.some((b) => !asks(b.key)) && (
            <div className="flex flex-wrap gap-2" data-testid="builtin-add">
              {BUILT_IN_FIELDS.filter((b) => !asks(b.key)).map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className={btn}
                  disabled={pending !== null}
                  onClick={async () => {
                    await toggle(b.key, true);
                    setAdding(false);
                  }}
                >
                  + {b.label}
                </button>
              ))}
            </div>
          )}
          {editBuiltIns && BUILT_IN_FIELDS.some((b) => !asks(b.key)) && <p className="pt-1 text-xs text-gray-600 dark:text-slate-400">Or ask your own question:</p>}
          {editor(draft, setDraft, 'qn')}
          <div className="flex gap-2">
            <button type="submit" className={primary}>Add field</button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                setDraft(emptyQuestion);
                setAdding(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
