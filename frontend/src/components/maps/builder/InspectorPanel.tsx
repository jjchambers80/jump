'use client';

import React, { useEffect, useId, useState } from 'react';
import { Check, Copy, RotateCw, Trash2, Keyboard } from 'lucide-react';
import { formatPrice } from '@/lib/fees';
import type { MapBooth, MapElement, MapTier } from '@/services/api';
import BoothPanel from '../BoothPanel';
import MapLegend from '../MapLegend';
import { STATUS_BADGE_COLORS, STATUS_LABELS, tierSwatch } from '../mapTheme';
import { elementName, unitLabel } from './catalog';
import { MAX_ITEM_SIZE } from './placement';
import { fieldClass, labelClass } from './BuilderDialog';

type BoothPatch = Partial<Pick<MapBooth, 'label' | 'kind' | 'w' | 'h' | 'tierId'>>;
type ElementPatch = Partial<Pick<MapElement, 'caption' | 'text' | 'size' | 'w' | 'h' | 'orientation'>>;

interface InspectorPanelProps {
  mapId: string;
  eventId: string;
  status: 'DRAFT' | 'PUBLISHED';
  role: string | undefined;
  name: string;
  width: number;
  height: number;
  unit: string;
  minWidth: number;
  minHeight: number;
  booths: MapBooth[];
  elements: MapElement[];
  tiers: MapTier[];
  tierSwatches: Record<string, number>;
  selectedIds: Set<string>;
  onSettings: (patch: { name?: string; width?: number; height?: number; unit?: string }) => void;
  onBoothChange: (ids: string[], patch: BoothPatch) => void;
  onElementChange: (id: string, patch: ElementPatch) => void;
  onTurn: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onShowShortcuts: () => void;
  // Assignment (spec 014 booth panel)
  onBoothAssign: (boothId: string, applicationId: string, force: boolean) => Promise<void>;
  onBoothUnassign: (boothId: string) => void;
  onBoothStatusChange: (boothId: string, status: 'AVAILABLE' | 'RESERVED' | 'BLOCKED') => void;
  onBoothMoveStart: (boothId: string) => void;
  onBoothMoveCancel: () => void;
  moveMode: string | null;
}

export default function InspectorPanel(props: InspectorPanelProps) {
  const { selectedIds, booths, elements } = props;
  const selectedBooths = booths.filter((b) => selectedIds.has(b.id));
  const selectedElements = elements.filter((e) => selectedIds.has(e.id));
  const count = selectedBooths.length + selectedElements.length;

  return (
    <aside
      aria-label="Details"
      className="flex w-full flex-col overflow-y-auto border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800 lg:w-80 lg:border-l"
    >
      {count === 0 && <FloorSection {...props} />}
      {count === 1 && selectedBooths.length === 1 && <BoothSection {...props} booth={selectedBooths[0]} />}
      {count === 1 && selectedElements.length === 1 && <ElementSection {...props} element={selectedElements[0]} />}
      {count > 1 && <MultiSection {...props} booths={selectedBooths} count={count} />}
    </aside>
  );
}

// ─── Nothing selected: the floor itself + a getting-started list ─────

function FloorSection(props: InspectorPanelProps) {
  const { name, width, height, unit, minWidth, minHeight, booths, tiers, tierSwatches, status, onSettings, onShowShortcuts } = props;
  const priced = booths.filter((b) => b.tierId).length;
  const steps = [
    { done: width > 0 && height > 0 && (width !== 50 || height !== 40 || booths.length > 0), label: 'Set the size of your floor' },
    { done: booths.length > 0, label: 'Add booths or tables' },
    { done: booths.length > 0 && priced === booths.length, label: 'Give every booth a price tier' },
    { done: status === 'PUBLISHED', label: 'Publish so vendors can pick a booth' },
  ];
  const legendTiers = tiers.map((t) => ({ id: t.id, name: t.name, price: t.price, swatch: tierSwatches[t.id] ?? 0 }));

  return (
    <div className="divide-y divide-gray-100 dark:divide-slate-700/70">
      <section className="p-4" aria-labelledby="floor-heading">
        <h2 id="floor-heading" className="text-sm font-semibold text-gray-900 dark:text-white">
          Floor
        </h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
          Click anything on the map to edit it.
        </p>
        <div className="mt-4 space-y-3">
          <CommitField
            id="floor-name"
            label="Map name"
            value={name}
            onCommit={(v) => v.trim().length >= 1 && onSettings({ name: v.trim() })}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              id="floor-width"
              label={`Width (${unitLabel(unit)})`}
              value={width}
              min={Math.max(1, minWidth)}
              max={200}
              onCommit={(v) => onSettings({ width: v })}
            />
            <NumberField
              id="floor-height"
              label={`Depth (${unitLabel(unit)})`}
              value={height}
              min={Math.max(1, minHeight)}
              max={200}
              onCommit={(v) => onSettings({ height: v })}
            />
          </div>
          {(minWidth > 1 || minHeight > 1) && (
            <p className="text-xs text-gray-500 dark:text-slate-400">
              Things on the map reach {minWidth} × {minHeight} {unitLabel(unit)}. Move them in first to shrink the floor.
            </p>
          )}
          <fieldset>
            <legend className={labelClass}>Measure in</legend>
            <Segmented
              name="floor-unit"
              value={unit}
              options={[
                { value: 'ft', label: 'Feet' },
                { value: 'm', label: 'Meters' },
              ]}
              onChange={(v) => onSettings({ unit: v })}
            />
          </fieldset>
        </div>
      </section>

      <section className="p-4" aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="text-sm font-semibold text-gray-900 dark:text-white">
          Getting started
        </h2>
        <ol className="mt-3 space-y-2">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-start gap-2.5 text-sm">
              <span
                className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  s.done
                    ? 'bg-emerald-600 text-white dark:bg-emerald-500'
                    : 'border border-gray-300 text-gray-500 dark:border-slate-600 dark:text-slate-400'
                }`}
                aria-hidden="true"
              >
                {s.done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className={s.done ? 'text-gray-500 line-through decoration-gray-300 dark:text-slate-500 dark:decoration-slate-600' : 'text-gray-800 dark:text-slate-200'}>
                {s.label}
                <span className="sr-only">{s.done ? ' (done)' : ' (to do)'}</span>
              </span>
            </li>
          ))}
        </ol>
        {booths.length > 0 && priced < booths.length && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            {booths.length - priced} booth{booths.length - priced === 1 ? '' : 's'} without a price tier. Select them
            (Shift-drag across the map picks many at once) and choose a tier.
          </p>
        )}
        {tiers.length === 0 && (
          <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-slate-900/60 dark:text-slate-400">
            Price tiers come from this event&apos;s paid vendor application form. Add one there to sell booths.
          </p>
        )}
      </section>

      {tiers.length > 0 && (
        <section className="p-4" aria-labelledby="legend-heading">
          <h2 id="legend-heading" className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
            Colors
          </h2>
          <MapLegend tiers={legendTiers} showStates />
        </section>
      )}

      <div className="p-4">
        <button
          type="button"
          onClick={onShowShortcuts}
          className="inline-flex items-center gap-2 rounded-md text-sm font-medium text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"
        >
          <Keyboard className="h-4 w-4" aria-hidden="true" />
          Mouse and keyboard tips
        </button>
      </div>
    </div>
  );
}

// ─── One booth ───────────────────────────────────────────────────────

function BoothSection(props: InspectorPanelProps & { booth: MapBooth }) {
  const { booth, booths, tiers, tierSwatches, unit, width, height, onBoothChange } = props;
  const others = booths.filter((b) => b.id !== booth.id).map((b) => b.label);
  const saved = !booth.id.startsWith('new-');
  const kindName = booth.kind === 'TABLE' ? 'Table' : 'Booth';

  return (
    <div className="divide-y divide-gray-100 dark:divide-slate-700/70">
      <section className="p-4" aria-labelledby="item-heading">
        <div className="flex items-center justify-between gap-2">
          <h2 id="item-heading" className="text-sm font-semibold text-gray-900 dark:text-white">
            {kindName} {booth.label}
          </h2>
          <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE_COLORS[booth.status] || ''}`}>
            {STATUS_LABELS[booth.status] || booth.status}
          </span>
        </div>
        <div className="mt-4 space-y-3">
          <LabelField booth={booth} others={others} onCommit={(label) => onBoothChange([booth.id], { label })} />
          <fieldset>
            <legend className={labelClass}>Type</legend>
            <Segmented
              name="booth-kind"
              value={booth.kind}
              options={[
                { value: 'BOOTH', label: 'Booth' },
                { value: 'TABLE', label: 'Table' },
              ]}
              onChange={(v) => onBoothChange([booth.id], { kind: v as 'BOOTH' | 'TABLE' })}
            />
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              id="booth-w"
              label={`Width (${unitLabel(unit)})`}
              value={booth.w}
              min={1}
              max={Math.min(MAX_ITEM_SIZE, width - booth.x)}
              onCommit={(w) => onBoothChange([booth.id], { w })}
            />
            <NumberField
              id="booth-h"
              label={`Depth (${unitLabel(unit)})`}
              value={booth.h}
              min={1}
              max={Math.min(MAX_ITEM_SIZE, height - booth.y)}
              onCommit={(h) => onBoothChange([booth.id], { h })}
            />
          </div>
          <TierSelect
            id="booth-tier"
            tiers={tiers}
            tierSwatches={tierSwatches}
            value={booth.tierId}
            onChange={(tierId) => onBoothChange([booth.id], { tierId })}
          />
          <ItemActions {...props} canTurn />
        </div>
      </section>
      <section className="p-4" aria-labelledby="vendor-heading">
        <h2 id="vendor-heading" className="text-sm font-semibold text-gray-900 dark:text-white">
          Vendor
        </h2>
        {saved ? (
          <BoothPanel
            booth={booth}
            mapId={props.mapId}
            eventId={props.eventId}
            mapStatus={props.status}
            role={props.role}
            onStatusChange={props.onBoothStatusChange}
            onAssign={props.onBoothAssign}
            onUnassign={props.onBoothUnassign}
            onMoveStart={props.onBoothMoveStart}
            onMoveCancel={props.onBoothMoveCancel}
            moveMode={props.moveMode}
          />
        ) : (
          <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Saving… vendor options appear in a moment.</p>
        )}
      </section>
    </div>
  );
}

// ─── One landmark, text or wall ──────────────────────────────────────

function ElementSection(props: InspectorPanelProps & { element: MapElement }) {
  const { element, unit, width, height, onElementChange } = props;
  const u = unitLabel(unit);
  const isWall = element.kind === 'wall';
  const isText = element.kind === 'label';

  return (
    <section className="p-4" aria-labelledby="item-heading">
      <h2 id="item-heading" className="text-sm font-semibold text-gray-900 dark:text-white">
        {elementName(element.kind)}
      </h2>
      <div className="mt-4 space-y-3">
        {isText && (
          <>
            <CommitField
              id="el-text"
              label="Text"
              value={element.text || ''}
              maxLength={40}
              onCommit={(text) => onElementChange(element.id, { text: text || 'Text' })}
            />
            <fieldset>
              <legend className={labelClass}>Text size</legend>
              <Segmented
                name="el-size"
                value={element.size || 'M'}
                options={[
                  { value: 'S', label: 'Small' },
                  { value: 'M', label: 'Medium' },
                  { value: 'L', label: 'Large' },
                ]}
                onChange={(v) => onElementChange(element.id, { size: v as 'S' | 'M' | 'L' })}
              />
            </fieldset>
          </>
        )}
        {!isWall && !isText && (
          <CommitField
            id="el-caption"
            label="Caption (optional)"
            value={element.caption || ''}
            maxLength={30}
            placeholder={`e.g. ${element.kind === 'stage' ? 'Main Stage' : element.kind === 'entrance' ? 'North doors' : 'Hall A'}`}
            onCommit={(caption) => onElementChange(element.id, { caption: caption || undefined })}
          />
        )}
        {isWall ? (
          <>
            <NumberField
              id="el-length"
              label={`Length (${u})`}
              value={element.orientation === 'v' ? element.h : element.w}
              min={1}
              max={element.orientation === 'v' ? height - element.y : width - element.x}
              onCommit={(len) =>
                onElementChange(element.id, element.orientation === 'v' ? { h: len } : { w: len })
              }
            />
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              id="el-w"
              label={`Width (${u})`}
              value={element.w}
              min={1}
              max={Math.min(MAX_ITEM_SIZE, width - element.x)}
              onCommit={(w) => onElementChange(element.id, { w })}
            />
            <NumberField
              id="el-h"
              label={`Depth (${u})`}
              value={element.h}
              min={1}
              max={Math.min(MAX_ITEM_SIZE, height - element.y)}
              onCommit={(h) => onElementChange(element.id, { h })}
            />
          </div>
        )}
        <ItemActions {...props} canTurn={!isText} />
      </div>
    </section>
  );
}

// ─── Several things ──────────────────────────────────────────────────

function MultiSection(props: InspectorPanelProps & { booths: MapBooth[]; count: number }) {
  const { booths, count, tiers, tierSwatches, onBoothChange } = props;
  const ids = booths.map((b) => b.id);
  const tierValues = new Set(booths.map((b) => b.tierId));
  const sharedTier = tierValues.size === 1 ? [...tierValues][0] : undefined;
  const kinds = new Set(booths.map((b) => b.kind));

  return (
    <section className="p-4" aria-labelledby="item-heading">
      <h2 id="item-heading" className="text-sm font-semibold text-gray-900 dark:text-white">
        {count} selected
      </h2>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
        Drag any of them to move them together. Shift-click adds or removes one.
      </p>
      {booths.length > 0 && (
        <div className="mt-4 space-y-3">
          <TierSelect
            id="multi-tier"
            label={`Price tier for ${booths.length} booth${booths.length === 1 ? '' : 's'}`}
            tiers={tiers}
            tierSwatches={tierSwatches}
            value={sharedTier === undefined ? '__mixed' : sharedTier}
            onChange={(tierId) => onBoothChange(ids, { tierId })}
          />
          <fieldset>
            <legend className={labelClass}>Type</legend>
            <Segmented
              name="multi-kind"
              value={kinds.size === 1 ? [...kinds][0] : ''}
              options={[
                { value: 'BOOTH', label: 'Booths' },
                { value: 'TABLE', label: 'Tables' },
              ]}
              onChange={(v) => onBoothChange(ids, { kind: v as 'BOOTH' | 'TABLE' })}
            />
          </fieldset>
        </div>
      )}
      <div className="mt-4">
        <ItemActions {...props} canTurn={false} />
      </div>
    </section>
  );
}

// ─── Small controls ──────────────────────────────────────────────────

function ItemActions({ onTurn, onDuplicate, onDelete, canTurn }: InspectorPanelProps & { canTurn: boolean }) {
  const btn =
    'inline-flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
  return (
    <div className="flex gap-1.5 pt-1">
      {canTurn && (
        <button type="button" onClick={onTurn} className={`${btn} border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700`}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Turn
        </button>
      )}
      <button type="button" onClick={onDuplicate} className={`${btn} border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700`}>
        <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
      </button>
      <button type="button" onClick={onDelete} className={`${btn} border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10`}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
      </button>
    </div>
  );
}

function TierSelect({
  id,
  label = 'Price tier',
  tiers,
  tierSwatches,
  value,
  onChange,
}: {
  id: string;
  label?: string;
  tiers: MapTier[];
  tierSwatches: Record<string, number>;
  value: string | null;
  onChange: (tierId: string | null) => void;
}) {
  const hintId = `${id}-hint`;
  const swatch = value && value !== '__mixed' ? tierSwatches[value] : undefined;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="relative">
        {swatch !== undefined && (
          <span
            className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-sm"
            style={{ background: tierSwatch(swatch, false) }}
            aria-hidden="true"
          />
        )}
        <select
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          aria-describedby={hintId}
          className={`${fieldClass} ${swatch !== undefined ? 'pl-7' : ''}`}
        >
          {value === '__mixed' && (
            <option value="__mixed" disabled>
              Mixed
            </option>
          )}
          <option value="">No tier (not for sale)</option>
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {formatPrice(t.price)}
            </option>
          ))}
        </select>
      </div>
      <p id={hintId} className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        Vendors who applied on this tier can pick this spot.
      </p>
    </div>
  );
}

function LabelField({
  booth,
  others,
  onCommit,
}: {
  booth: MapBooth;
  others: string[];
  onCommit: (label: string) => void;
}) {
  const [draft, setDraft] = useState(booth.label);
  useEffect(() => setDraft(booth.label), [booth.id, booth.label]);
  const trimmed = draft.trim();
  const error = !trimmed
    ? 'Give it a number or name.'
    : others.includes(trimmed)
    ? `${trimmed} is already used by another booth.`
    : '';
  const commit = () => {
    if (!error && trimmed !== booth.label) onCommit(trimmed);
    if (error) setDraft(booth.label);
  };
  return (
    <div>
      <label htmlFor="booth-label" className={labelClass}>
        Booth number
      </label>
      <input
        id="booth-label"
        type="text"
        value={draft}
        maxLength={12}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') setDraft(booth.label);
        }}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? 'booth-label-error' : undefined}
        className={`${fieldClass} ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/40' : ''}`}
      />
      {error && (
        <p id="booth-label-error" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** Text input that commits on blur or Enter, so every keystroke is not an undo step. */
function CommitField({
  id,
  label,
  value,
  onCommit,
  maxLength,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onCommit: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className={fieldClass}
      />
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || draft.trim() === '') {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, n));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className={fieldClass}
      />
    </div>
  );
}

function Segmented({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const groupId = useId();
  return (
    <div role="radiogroup" className="inline-flex w-full rounded-md border border-gray-300 p-0.5 dark:border-slate-600">
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <label
            key={o.value}
            className={`relative flex flex-1 cursor-pointer items-center justify-center rounded px-2 py-1.5 text-xs font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500 ${
              checked
                ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                : 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            <input
              type="radio"
              name={`${name}-${groupId}`}
              value={o.value}
              checked={checked}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
