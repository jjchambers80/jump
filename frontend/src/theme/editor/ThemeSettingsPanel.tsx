'use client';

// Theme settings panel (spec 038 §6.3 / D19, spec 049 card C): the gear in
// the editor's left rail. Edits live in Puck's root.props.themeSettings so
// undo/redo covers them (spike item 6); ThemeEditor saves them with the
// documents. Only Logo, Colors and Typography for now.

import { createContext, useContext, useId, useState } from 'react';
import { SETTINGS_GROUPS, resolveSettings } from '@jump/theme';
import type { ThemeSettings } from '../types';
import ColorSchemesField from './ColorSchemesField';
import { ImageFieldControl, button, input, optionLabel, small, type FieldSpec } from './fields';
import { usePuck } from './puck';
import { PANEL_GROUPS, resetGroup, schemesOf, setSchemes, setSetting, type StoredSettings } from './settingsDraft';

export interface ThemeSettingsInfo {
  presetSettings: ThemeSettings | undefined;
  /** Scheme id → names of the loaded pages that use it. */
  usedSchemes: Record<string, string[]>;
  brandColor: string | null;
}

export const ThemeSettingsInfoContext = createContext<ThemeSettingsInfo>({ presetSettings: undefined, usedSchemes: {}, brandColor: null });

const FONT_LABELS: Record<string, string> = { system: 'System (fastest)', 'dm-serif-display': 'DM Serif Display' };

/** Shown under an empty field: what the store uses instead. */
const EMPTY_HINTS: Record<string, JSX.Element> = {
  'logo.image': (
    <>
      Using your brand logo.{' '}
      <a href="/admin/settings/brand" target="_blank" rel="noopener" className="font-medium text-accent-700 underline">
        Change it in Settings › Brand<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </>
  ),
};

function SettingField({ name, spec, value, onChange }: { name: string; spec: FieldSpec; value: any; onChange: (v: unknown) => void }) {
  const id = useId();
  switch (spec.kind) {
    case 'image':
      return (
        <div>
          <ImageFieldControl label={spec.label} value={value ?? null} onChange={onChange} />
          {!value?.fileId && EMPTY_HINTS[name] && <p className={small}>{EMPTY_HINTS[name]}</p>}
        </div>
      );
    case 'range': {
      const set = (raw: string) => {
        const n = Number(raw);
        if (raw !== '' && Number.isFinite(n)) onChange(Math.min(spec.max!, Math.max(spec.min!, n)));
      };
      return (
        <div className="space-y-1">
          <label htmlFor={id} className="block text-sm font-medium text-gray-700">
            {spec.label}
            {spec.unit ? ` (${spec.unit})` : ''}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              aria-label={`${spec.label} slider`}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={value}
              onChange={(e) => set(e.target.value)}
              className="min-w-0 flex-1 accent-accent-500"
            />
            <input id={id} type="number" className={`${input} w-20`} min={spec.min} max={spec.max} step={spec.step} value={value} onChange={(e) => set(e.target.value)} />
          </div>
        </div>
      );
    }
    case 'select':
      return (
        <div className="space-y-1">
          <label htmlFor={id} className="block text-sm font-medium text-gray-700">
            {spec.label}
          </label>
          <select id={id} className={input} value={value} onChange={(e) => onChange(e.target.value)}>
            {(spec.options ?? []).map((option) => (
              <option key={String(option)} value={String(option)}>
                {FONT_LABELS[String(option)] ?? optionLabel(option)}
              </option>
            ))}
          </select>
          {name.endsWith('Font') && <p className={small}>Selecting a different font can affect the speed of your store.</p>}
        </div>
      );
    default:
      return null;
  }
}

// The open group survives the panel remounting (switching panels, undo).
let lastOpen = 'logo';

export default function ThemeSettingsPanel() {
  const { appState, dispatch } = usePuck();
  const info = useContext(ThemeSettingsInfoContext);
  const [open, setOpenState] = useState<string>(lastOpen);
  const setOpen = (group: string) => setOpenState((lastOpen = group));
  const baseId = useId();
  const root = appState.data.root;
  const stored: StoredSettings = (root.props as any)?.themeSettings ?? {};
  const resolved = resolveSettings(stored, info.presetSettings) as Record<string, Record<string, any>>;
  const write = (next: StoredSettings) => dispatch({ type: 'replaceRoot', root: { ...root, props: { ...(root.props ?? {}), themeSettings: next } } as any });

  return (
    <div className="p-3" data-testid="theme-settings">
      <h2 className="mb-2 text-sm font-semibold text-gray-900">Theme settings</h2>
      <div className="divide-y divide-gray-200 rounded-md border border-gray-200">
        {PANEL_GROUPS.map((group) => {
          const def = (SETTINGS_GROUPS as Record<string, { label: string; fields: Record<string, FieldSpec> }>)[group];
          const expanded = open === group;
          const bodyId = `${baseId}-${group}`;
          return (
            <section key={group}>
              <h3>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={bodyId}
                  onClick={() => setOpen(expanded ? '' : group)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-gray-900 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500"
                >
                  {def.label}
                  <span aria-hidden>{expanded ? '−' : '+'}</span>
                </button>
              </h3>
              {expanded && (
                <div id={bodyId} className="space-y-4 px-3 pb-3 pt-1">
                  {group === 'colors' ? (
                    <ColorSchemesField
                      schemes={schemesOf(stored, info.presetSettings)}
                      usedBy={info.usedSchemes}
                      brandColor={info.brandColor}
                      onChange={(schemes) => write(setSchemes(stored, schemes))}
                    />
                  ) : (
                    Object.entries(def.fields).map(([key, spec]) => (
                      <SettingField
                        key={key}
                        name={`${group}.${key}`}
                        spec={spec}
                        value={resolved[group]?.[key]}
                        onChange={(v) => write(setSetting(stored, group, key, v))}
                      />
                    ))
                  )}
                  <button type="button" className={button} disabled={stored[group] === undefined} onClick={() => write(resetGroup(stored, group))}>
                    Reset to theme defaults
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
