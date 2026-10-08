'use client';

// Saved ticket tiers (TierPreset) live inside the tier "Add from preset" menu
// (spec 037 D2): pick one to add a tier, or edit / delete it in place. There
// is no presets page. Editing a preset never changes tiers already created
// from it — a tier is a copy.

import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import api from '@/services/api';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';

export interface TierPreset {
  id: string;
  name: string;
  description: string | null;
  price: number;
  minPerOrder: number | null;
  maxPerOrder: number | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
}

interface PresetForm {
  name: string;
  description: string;
  price: string;
  minPerOrder: string;
  maxPerOrder: string;
  visibility: TierPreset['visibility'];
  isRefundable: boolean;
}

const EMPTY: PresetForm = { name: '', description: '', price: '', minPerOrder: '1', maxPerOrder: '10', visibility: 'PUBLIC', isRefundable: false };

const toForm = (p: TierPreset): PresetForm => ({
  name: p.name,
  description: p.description ?? '',
  price: String(p.price),
  minPerOrder: p.minPerOrder != null ? String(p.minPerOrder) : '',
  maxPerOrder: p.maxPerOrder != null ? String(p.maxPerOrder) : '',
  visibility: p.visibility,
  isRefundable: p.isRefundable,
});

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500';
const input =
  'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const label = 'mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300';
const iconBtn = `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white ${focusRing}`;

export default function TierPresetMenu({
  orgId,
  presets,
  onPresetsChange,
  onPick,
}: {
  orgId: string | null;
  presets: TierPreset[];
  onPresetsChange: (next: TierPreset[]) => void;
  onPick: (preset: TierPreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TierPreset | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const remove = async (preset: TierPreset) => {
    if (!orgId || !window.confirm(`Delete the saved tier "${preset.name}"? Tiers already added to events are kept.`)) return;
    try {
      await api.delete(`/organizations/${orgId}/tier-presets/${preset.id}`);
      onPresetsChange(presets.filter((p) => p.id !== preset.id));
    } catch (err: any) {
      setError(err?.message || 'Could not delete the saved tier');
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="tier-preset-menu"
        className={`inline-flex min-h-9 items-center gap-1 rounded-md border border-accent-300 px-3 py-1.5 text-xs font-medium text-accent-700 hover:bg-accent-50 dark:border-accent-700 dark:text-accent-300 dark:hover:bg-accent-900/20 ${focusRing}`}
      >
        Saved tiers
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          id="tier-preset-menu"
          className="absolute right-0 z-20 mt-1 w-80 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800"
        >
          {presets.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">
              No saved tiers yet. Save one you reuse across events, like General Admission.
            </p>
          ) : (
            <ul aria-label="Saved tiers" className="max-h-72 divide-y divide-gray-100 overflow-y-auto dark:divide-slate-700">
              {presets.map((preset) => (
                <li key={preset.id} className="flex items-center gap-1 pr-2">
                  <button
                    type="button"
                    onClick={() => {
                      onPick(preset);
                      setOpen(false);
                    }}
                    className={`min-w-0 flex-1 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-slate-700/60 ${focusRing}`}
                  >
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{preset.name}</span>
                    <span className="block text-xs tabular-nums text-gray-500 dark:text-slate-400">
                      {preset.price === 0 ? 'Free' : `$${Number(preset.price).toFixed(2)}`}
                      {preset.isRefundable ? ' · refundable' : ''}
                      {preset.visibility !== 'PUBLIC' ? ` · ${preset.visibility.toLowerCase()}` : ''}
                    </span>
                  </button>
                  <button type="button" className={iconBtn} aria-label={`Edit saved tier ${preset.name}`} onClick={() => setEditing(preset)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button type="button" className={`${iconBtn} hover:text-red-600 dark:hover:text-red-400`} aria-label={`Delete saved tier ${preset.name}`} onClick={() => remove(preset)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p role="alert" className="border-t border-gray-100 px-4 py-2 text-xs text-red-700 dark:border-slate-700 dark:text-red-300">{error}</p>}
          <button
            type="button"
            onClick={() => setEditing('new')}
            className={`flex w-full items-center gap-2 border-t border-gray-100 px-4 py-2.5 text-sm font-medium text-accent-700 hover:bg-accent-50 dark:border-slate-700 dark:text-accent-300 dark:hover:bg-accent-900/20 ${focusRing}`}
          >
            <Plus className="h-4 w-4" aria-hidden />
            New saved tier
          </button>
        </div>
      )}
      {editing && orgId && (
        <PresetDialog
          orgId={orgId}
          preset={editing === 'new' ? null : editing}
          returnFocusRef={buttonRef}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            onPresetsChange(
              editing === 'new' ? [...presets, saved] : presets.map((p) => (p.id === saved.id ? saved : p))
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PresetDialog({
  orgId,
  preset,
  returnFocusRef,
  onClose,
  onSaved,
}: {
  orgId: string;
  preset: TierPreset | null;
  returnFocusRef: React.RefObject<HTMLElement>;
  onClose: () => void;
  onSaved: (preset: TierPreset) => void;
}) {
  const initial = preset ? toForm(preset) : EMPTY;
  const [form, setForm] = useState<PresetForm>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof PresetForm>(key: K, value: PresetForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const valid = form.name.trim().length > 0 && form.price !== '' && Number(form.price) >= 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: parseFloat(form.price),
      minPerOrder: form.minPerOrder ? parseInt(form.minPerOrder) : null,
      maxPerOrder: form.maxPerOrder ? parseInt(form.maxPerOrder) : null,
      visibility: form.visibility,
      isRefundable: form.isRefundable,
    };
    try {
      const saved = preset
        ? await api.patch<TierPreset>(`/organizations/${orgId}/tier-presets/${preset.id}`, payload)
        : await api.post<TierPreset>(`/organizations/${orgId}/tier-presets`, payload);
      onSaved({ ...saved, price: Number(saved.price) });
    } catch (err: any) {
      setError(err?.message || 'Could not save the tier');
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="tier-preset-dialog-title"
      title={preset ? 'Edit saved tier' : 'New saved tier'}
      dirty={dirty}
      saving={saving}
      saveDisabled={!valid}
      initialFocusRef={nameRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">{error}</p>}
        <p className="text-xs text-gray-500 dark:text-slate-400">Changes apply to tiers you add from now on, not to events that already have this tier.</p>
        <div>
          <label htmlFor="preset-name" className={label}>Name</label>
          <input id="preset-name" ref={nameRef} required value={form.name} onChange={(e) => set('name', e.target.value)} className={input} placeholder="General Admission" />
        </div>
        <div>
          <label htmlFor="preset-description" className={label}>Description</label>
          <input id="preset-description" value={form.description} onChange={(e) => set('description', e.target.value)} className={input} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="preset-price" className={label}>Price ($)</label>
            <input id="preset-price" type="number" min="0" step="0.01" required value={form.price} onChange={(e) => set('price', e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="preset-min" className={label}>Min / order</label>
            <input id="preset-min" type="number" min="1" value={form.minPerOrder} onChange={(e) => set('minPerOrder', e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="preset-max" className={label}>Max / order</label>
            <input id="preset-max" type="number" min="1" value={form.maxPerOrder} onChange={(e) => set('maxPerOrder', e.target.value)} className={input} />
          </div>
        </div>
        <div className="grid grid-cols-2 items-end gap-3">
          <div>
            <label htmlFor="preset-visibility" className={label}>Visibility</label>
            <select id="preset-visibility" value={form.visibility} onChange={(e) => set('visibility', e.target.value as PresetForm['visibility'])} className={input}>
              <option value="PUBLIC">Public</option>
              <option value="PRIVATE">Private link</option>
              <option value="HIDDEN">Hidden</option>
            </select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-gray-700 dark:text-slate-300">
            <input type="checkbox" checked={form.isRefundable} onChange={(e) => set('isRefundable', e.target.checked)} className="h-4 w-4 accent-accent-600" />
            Refundable
          </label>
        </div>
      </div>
    </SettingsDialog>
  );
}
