'use client';

// Announcements and footer columns as labelled lists (spec 038D). Puck's own
// array field has an unlabelled "add" button in 0.23 (WCAG 4.1.2), so these
// lists are ours: every control has a name, and rows move with buttons.

import { useId } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { LinkFieldControl, DateTimeControl } from './fields';

const input =
  'block w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30';
const iconButton =
  'inline-flex h-7 w-7 items-center justify-center rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

type Row = Record<string, any>;

function move<T>(rows: T[], from: number, to: number) {
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

function RowControls({ noun, index, count, onMove, onRemove }: { noun: string; index: number; count: number; onMove: (to: number) => void; onRemove: () => void }) {
  const n = index + 1;
  return (
    <div className="flex gap-1">
      <button type="button" className={iconButton} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${noun} ${n} up`}>
        <ChevronUp className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" className={iconButton} disabled={index >= count - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${noun} ${n} down`}>
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" className={iconButton} onClick={onRemove} aria-label={`Remove ${noun} ${n}`}>
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function HiddenToggle({ checked, onChange, noun, index }: { checked: boolean; onChange: (v: boolean) => void; noun: string; index: number }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={`Hide ${noun} ${index + 1}`} />
      Hidden
    </label>
  );
}

export function AnnouncementsList({ value, onChange }: { value: Row[] | undefined; onChange: (rows: Row[]) => void }) {
  const rows = value ?? [];
  const base = useId();
  const set = (i: number, patch: Row) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-gray-700">Announcements</legend>
      {rows.map((row, i) => (
        <div key={row.id ?? `new-${i}`} className="space-y-2 rounded-md border border-gray-200 p-2.5" role="group" aria-label={`Announcement ${i + 1}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Announcement {i + 1}</span>
            <RowControls noun="announcement" index={i} count={rows.length} onMove={(to) => onChange(move(rows, i, to))} onRemove={() => onChange(rows.filter((_, j) => j !== i))} />
          </div>
          <label className="block text-sm font-medium text-gray-700" htmlFor={`${base}-text-${i}`}>
            Text
          </label>
          <input id={`${base}-text-${i}`} className={input} maxLength={140} value={row.text ?? ''} onChange={(e) => set(i, { text: e.target.value })} />
          <LinkFieldControl id={`${base}-link-${i}`} label="Link" value={row.link ?? null} onChange={(link) => set(i, { link })} />
          <DateTimeControl id={`${base}-from-${i}`} label="Show from" value={row.startsAt ?? null} onChange={(startsAt) => set(i, { startsAt })} />
          <DateTimeControl id={`${base}-until-${i}`} label="Show until" value={row.endsAt ?? null} onChange={(endsAt) => set(i, { endsAt })} />
          <HiddenToggle noun="announcement" index={i} checked={Boolean(row.hidden)} onChange={(hidden) => set(i, { hidden })} />
        </div>
      ))}
      {rows.length < 5 && (
        <button type="button" onClick={() => onChange([...rows, { text: 'Tickets on sale now' }])} className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline">
          <Plus className="h-4 w-4" aria-hidden /> Add announcement
        </button>
      )}
    </fieldset>
  );
}

const COLUMN_KINDS = [
  { value: 'MenuColumn', label: 'Menu' },
  { value: 'Text', label: 'Text' },
  { value: 'BrandInfo', label: 'Brand information' },
  { value: 'SocialLinks', label: 'Social media' },
];

export function FooterColumnsList({ value, onChange }: { value: Row[] | undefined; onChange: (rows: Row[]) => void }) {
  const rows = value ?? [];
  const base = useId();
  const set = (i: number, patch: Row) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-gray-700">Footer columns</legend>
      {rows.map((row, i) => (
        <div key={row.id ?? `new-${i}`} className="space-y-2 rounded-md border border-gray-200 p-2.5" role="group" aria-label={`Column ${i + 1}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Column {i + 1}</span>
            <RowControls noun="column" index={i} count={rows.length} onMove={(to) => onChange(move(rows, i, to))} onRemove={() => onChange(rows.filter((_, j) => j !== i))} />
          </div>
          <label className="block text-sm font-medium text-gray-700" htmlFor={`${base}-kind-${i}`}>
            Type
          </label>
          <select id={`${base}-kind-${i}`} className={input} value={row.kind ?? 'Text'} onChange={(e) => set(i, { kind: e.target.value })}>
            {COLUMN_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          {(row.kind === 'MenuColumn' || row.kind === 'Text' || !row.kind) && (
            <>
              <label className="block text-sm font-medium text-gray-700" htmlFor={`${base}-heading-${i}`}>
                Heading
              </label>
              <input id={`${base}-heading-${i}`} className={input} maxLength={60} value={row.heading ?? ''} onChange={(e) => set(i, { heading: e.target.value })} />
            </>
          )}
          {(row.kind === 'Text' || !row.kind) && (
            <>
              <label className="block text-sm font-medium text-gray-700" htmlFor={`${base}-body-${i}`}>
                Text
              </label>
              <textarea id={`${base}-body-${i}`} className={input} rows={3} maxLength={2000} value={row.body ?? ''} onChange={(e) => set(i, { body: e.target.value })} />
            </>
          )}
          {row.kind === 'BrandInfo' && <p className="text-xs text-gray-500">Shows your headline and description from Theme settings › Brand information.</p>}
          {row.kind === 'SocialLinks' && <p className="text-xs text-gray-500">Shows the links from Theme settings › Social media.</p>}
          <HiddenToggle noun="column" index={i} checked={Boolean(row.hidden)} onChange={(hidden) => set(i, { hidden })} />
        </div>
      ))}
      {rows.length < 8 && (
        <button type="button" onClick={() => onChange([...rows, { kind: 'Text', heading: '', body: '' }])} className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline">
          <Plus className="h-4 w-4" aria-hidden /> Add column
        </button>
      )}
    </fieldset>
  );
}
