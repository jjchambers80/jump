'use client';

// Form editor cards (spec 011), shared since spec 019 by the per-event form
// editor (each card saves on its own through the API) and the template
// editor (cards edit local state; the page saves the whole definition).
// `mode="template"` hides what belongs to an event: slug, status, window,
// the fee preview columns, the add-on picker, and the per-card Save button.

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { MAX_PINNED_QUESTIONS, money, QUESTION_TYPE_LABEL, type AdminForm, type AdminTier, type Question, type QuestionType } from '@/lib/applications';

const card = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const btn = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
const primary = 'rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50';
const danger = 'text-sm font-medium text-red-700 hover:underline dark:text-red-300';
const field = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 disabled:opacity-60';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300';

const CHOICE = new Set<QuestionType>(['SINGLE_CHOICE', 'MULTI_CHOICE']);

export type EditorMode = 'form' | 'template';

/** A tier as the cards need it; `AdminTier` satisfies it, a template tier carries only the base fields. */
export type EditorTier = Pick<AdminTier, 'id' | 'name' | 'description' | 'price' | 'quantityTotal' | 'isActive'> & Partial<Pick<AdminTier, 'amounts' | 'quantityApproved' | 'quantityReserved' | 'addOns'>>;

/** What the cards read; `AdminForm` satisfies it, the template editor builds one from a definition. */
export interface EditorForm {
  id: string;
  eventId?: string;
  kind: AdminForm['kind'];
  name: string;
  slug?: string;
  intro: string | null;
  status?: AdminForm['status'];
  opensAt?: string | null;
  closesAt?: string | null;
  chargeTiming: AdminForm['chargeTiming'];
  feeMode: AdminForm['feeMode'];
  taxable: boolean;
  paymentDueDays: number;
  overduePolicy: AdminForm['overduePolicy'];
  paymentsEnabled?: boolean;
  tiers: EditorTier[];
  questions: Question[];
  addOns?: AdminForm['addOns'];
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function SettingsCard({
  form,
  canEdit,
  onSave,
  mode = 'form',
  onChange,
}: {
  form: EditorForm;
  canEdit: boolean;
  /** Form mode: PATCH the form. */
  onSave?: (body: Record<string, unknown>) => Promise<void>;
  mode?: EditorMode;
  /** Template mode: every change is reported as the settings half of a definition. */
  onChange?: (settings: Record<string, unknown>) => void;
}) {
  const template = mode === 'template';
  const [state, setState] = useState({
    name: form.name,
    slug: form.slug ?? '',
    intro: form.intro ?? '',
    status: form.status ?? 'DRAFT',
    opensAt: toLocalInput(form.opensAt),
    closesAt: toLocalInput(form.closesAt),
    chargeTiming: form.chargeTiming,
    feeMode: form.feeMode,
    taxable: form.taxable,
    paymentDueDays: form.paymentDueDays,
    overduePolicy: form.overduePolicy,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setState({
      name: form.name,
      slug: form.slug ?? '',
      intro: form.intro ?? '',
      status: form.status ?? 'DRAFT',
      opensAt: toLocalInput(form.opensAt),
      closesAt: toLocalInput(form.closesAt),
      chargeTiming: form.chargeTiming,
      feeMode: form.feeMode,
      taxable: form.taxable,
      paymentDueDays: form.paymentDueDays,
      overduePolicy: form.overduePolicy,
    });
  }, [form]);

  const paidSettings = (s: typeof state) =>
    form.kind === 'PAID'
      ? { chargeTiming: s.chargeTiming, feeMode: s.feeMode, taxable: s.taxable, paymentDueDays: Number(s.paymentDueDays), overduePolicy: s.overduePolicy }
      : {};
  const update = (patch: Partial<typeof state>) => {
    const next = { ...state, ...patch };
    setState(next);
    if (template) onChange?.({ name: next.name, intro: next.intro || null, ...paidSettings(next) });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || template || !onSave) return;
    setSaving(true);
    const body: Record<string, unknown> = {
      name: state.name,
      slug: state.slug,
      intro: state.intro || null,
      status: state.status,
      opensAt: state.opensAt ? new Date(state.opensAt).toISOString() : null,
      closesAt: state.closesAt ? new Date(state.closesAt).toISOString() : null,
      ...paidSettings(state),
    };
    await onSave(body);
    setSaving(false);
  };

  const paidBlocked = !template && form.kind === 'PAID' && !form.paymentsEnabled;

  return (
    <form onSubmit={submit} className={card} data-testid="form-settings">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white">Settings</h2>
      {paidBlocked && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Paid forms cannot open until application payments are enabled on this platform. You can set everything up now.
        </p>
      )}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="f-name" className={labelClass}>Name</label>
          <input id="f-name" value={state.name} disabled={!canEdit} onChange={(e) => update({ name: e.target.value })} className={field} />
        </div>
        {!template && (
        <div>
          <label htmlFor="f-slug" className={labelClass}>URL slug</label>
          <input id="f-slug" value={state.slug} disabled={!canEdit} onChange={(e) => update({ slug: e.target.value })} className={field} />
        </div>
        )}
        <div className="sm:col-span-2">
          <label htmlFor="f-intro" className={labelClass}>Intro shown to applicants</label>
          <textarea id="f-intro" rows={3} value={state.intro} disabled={!canEdit} onChange={(e) => update({ intro: e.target.value })} className={field} />
        </div>
        {!template && (
        <>
        <div>
          <label htmlFor="f-status" className={labelClass}>Status</label>
          <select id="f-status" value={state.status} disabled={!canEdit} onChange={(e) => update({ status: e.target.value as AdminForm['status'] })} className={field}>
            <option value="DRAFT">Draft (hidden)</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed (visible, not accepting)</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="f-opens" className={labelClass}>Opens</label>
            <input id="f-opens" type="datetime-local" value={state.opensAt} disabled={!canEdit} onChange={(e) => update({ opensAt: e.target.value })} className={field} />
          </div>
          <div>
            <label htmlFor="f-closes" className={labelClass}>Closes</label>
            <input id="f-closes" type="datetime-local" value={state.closesAt} disabled={!canEdit} onChange={(e) => update({ closesAt: e.target.value })} className={field} />
          </div>
        </div>
        </>
        )}
        {form.kind === 'PAID' && (
          <>
            <div>
              <label htmlFor="f-timing" className={labelClass}>Charge the card</label>
              <select id="f-timing" value={state.chargeTiming} disabled={!canEdit} onChange={(e) => update({ chargeTiming: e.target.value as AdminForm['chargeTiming'] })} className={field}>
                <option value="APPROVAL">When I approve (card saved at submission)</option>
                <option value="SUBMIT">When they submit</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-fee" className={labelClass}>Fees</label>
              <select id="f-fee" value={state.feeMode} disabled={!canEdit} onChange={(e) => update({ feeMode: e.target.value as AdminForm['feeMode'] })} className={field}>
                <option value="PASS">Applicant pays fees on top of the price</option>
                <option value="ABSORB">I absorb fees — applicant pays the listed price</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-due" className={labelClass}>Payment due (days after a failed charge)</label>
              <input id="f-due" type="number" min={1} max={30} value={state.paymentDueDays} disabled={!canEdit} onChange={(e) => update({ paymentDueDays: Number(e.target.value) })} className={field} />
            </div>
            <div>
              <label htmlFor="f-overdue" className={labelClass}>When payment is overdue</label>
              <select id="f-overdue" value={state.overduePolicy} disabled={!canEdit} onChange={(e) => update({ overduePolicy: e.target.value as AdminForm['overduePolicy'] })} className={field}>
                <option value="WITHDRAW">Withdraw and release the spot</option>
                <option value="HOLD">Keep the spot and flag it</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200 sm:col-span-2">
              <input type="checkbox" checked={state.taxable} disabled={!canEdit} onChange={(e) => update({ taxable: e.target.checked })} />
              Charge sales tax on these options (uses the event&apos;s tax rate)
            </label>
          </>
        )}
      </div>
      {canEdit && !template && (
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
  mode = 'form',
}: {
  form: EditorForm;
  canEdit: boolean;
  onAdd: (body: Record<string, unknown>) => Promise<void>;
  onUpdate: (tierId: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (tierId: string) => Promise<void>;
  /** Omitted (template mode): the add-on picker is hidden. */
  onSetAddOns?: (tierId: string, addOnIds: string[]) => Promise<void>;
  mode?: EditorMode;
}) {
  const template = mode === 'template';
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
    <div className={card} data-testid="form-tiers">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white">Options and pricing</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Applicants pick one. Capacity is taken when you approve, so more people can apply than there are spots.
        {!template && eventAddOns.length === 0 && (
          <>
            {' '}Add-ons (power, badges, tables) are created on the{' '}
            <Link href={`/admin/events/${form.eventId}/edit`} className="text-indigo-600 hover:underline dark:text-indigo-300">event page</Link>.
          </>
        )}
      </p>
      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400">
          <tr>
            <th className="py-1 pr-3">Name</th>
            <th className="py-1 pr-3">Price</th>
            {!template && <th className="py-1 pr-3">Applicant pays</th>}
            {!template && <th className="py-1 pr-3">You receive</th>}
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
                <td colSpan={template ? 4 : 6} className="py-2">
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
              <tr key={t.id} className={t.isActive ? '' : 'opacity-60'} data-testid={`tier-row-${t.id}`}>
                <td className="py-2 pr-3 font-medium text-gray-900 dark:text-white">
                  {t.name}
                  {!t.isActive && <span className="ml-2 text-xs text-gray-500">inactive</span>}
                  {t.description && <div className="text-xs font-normal text-gray-600 dark:text-slate-400">{t.description}</div>}
                  {(t.addOns ?? []).length > 0 && (
                    <div className="text-xs font-normal text-gray-500 dark:text-slate-400" data-testid={`tier-add-ons-summary-${t.id}`}>
                      Add-ons: {(t.addOns ?? []).map((a) => a.name).join(', ')}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{money(t.price)}</td>
                {!template && <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{t.amounts ? money(t.amounts.applicantPays) : '—'}</td>}
                {!template && <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{t.amounts ? money(t.amounts.orgReceives) : '—'}</td>}
                <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">
                  {template ? t.quantityTotal : `${(t.quantityApproved ?? 0) + (t.quantityReserved ?? 0)} / ${t.quantityTotal}`}
                </td>
                <td className="py-2 text-right">
                  {canEdit && (
                    <span className="flex justify-end gap-3">
                      <button type="button" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => startEdit(t)}>Edit</button>
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

export function QuestionsCard({
  form,
  canEdit,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
  mode = 'form',
}: {
  form: EditorForm;
  canEdit: boolean;
  onAdd: (body: Record<string, unknown>) => Promise<void>;
  onUpdate: (id: string, body: Record<string, unknown>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onReorder: (ids: string[]) => Promise<void>;
  mode?: EditorMode;
}) {
  const template = mode === 'template';
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
      <h2 className="text-base font-semibold text-gray-900 dark:text-white">Questions</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Name, email and business profile are always asked. Add anything else you need to decide.</p>
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
                      <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" data-testid={`question-pinned-${q.id}`}>
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
                    <button type="button" className="font-medium text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => startEdit(q)}>Edit</button>
                    <button type="button" className={danger} onClick={() => window.confirm(template ? `Remove "${q.label}"?` : `Remove "${q.label}"? Existing answers are kept.`) && onRemove(q.id)}>Remove</button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <form
          className="mt-4 space-y-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-slate-600"
          data-testid="question-add"
          onSubmit={async (e) => {
            e.preventDefault();
            await onAdd(questionBody(draft));
            setDraft(emptyQuestion);
          }}
        >
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Add a question</p>
          {editor(draft, setDraft, 'qn')}
          <button type="submit" className={btn}>Add question</button>
        </form>
      )}
    </div>
  );
}
