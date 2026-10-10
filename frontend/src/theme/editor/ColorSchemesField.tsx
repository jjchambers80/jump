'use client';

// Colors group of the theme settings panel (spec 049 card C): the scheme
// list with add / duplicate / rename / remove and one control per slot.
// Contrast is a warning only; the backend validates the values.

import { useId } from 'react';
import { COLOR_SCHEMES_MAX, SCHEME_COLORS } from '@jump/theme';
import { WCAG_AA_NORMAL, contrastRatio, normalizeHex } from '@/lib/color';
import type { ThemeScheme } from '../types';
import { button, input, small } from './fields';
import { newScheme, nextSchemeId, slotSpecials } from './settingsDraft';

const SLOT_LABELS: Record<string, string> = {
  background: 'Background',
  foreground: 'Text',
  accent: 'Accent (buttons and links)',
};
const SPECIAL_LABELS: Record<string, string> = { auto: 'Automatic (follows light/dark mode)', brand: 'Brand color', 'brand-secondary': 'Secondary brand color' };
const HEX = /^#[0-9a-f]{6}$/i;

const CONTRAST_PAIRS: [string, string, string][] = [
  ['foreground', 'background', 'Text on the background'],
  ['accent', 'background', 'Accent links on the background'],
];

function contrastWarnings(scheme: ThemeScheme, brandColor: string | null) {
  const color = (value: string) => (HEX.test(value) ? value : value === 'brand' ? normalizeHex(brandColor) : null);
  return CONTRAST_PAIRS.flatMap(([fg, bg, label]) => {
    const a = color((scheme as any)[fg]);
    const b = color((scheme as any)[bg]);
    if (!a || !b) return [];
    const ratio = contrastRatio(a, b);
    return ratio < WCAG_AA_NORMAL ? [`${label}: contrast ${ratio.toFixed(1)}:1, below ${WCAG_AA_NORMAL}:1. Some visitors may not be able to read it.`] : [];
  });
}

function SlotControl({ slot, value, brandColor, onChange }: { slot: string; value: string; brandColor: string | null; onChange: (v: string) => void }) {
  const id = useId();
  const specials = slotSpecials(slot);
  const custom = HEX.test(value);
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">
        {SLOT_LABELS[slot] ?? slot}
      </label>
      <div className="flex items-center gap-2">
        <select
          id={id}
          className={input}
          value={custom ? 'custom' : value}
          onChange={(e) => onChange(e.target.value === 'custom' ? (normalizeHex(brandColor) ?? '#000000') : e.target.value)}
        >
          {specials.map((s) => (
            <option key={s} value={s}>
              {SPECIAL_LABELS[s] ?? s}
            </option>
          ))}
          <option value="custom">Custom color</option>
        </select>
        {custom && (
          <input
            type="color"
            aria-label={`${SLOT_LABELS[slot] ?? slot} color`}
            value={value}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
            className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
          />
        )}
      </div>
    </div>
  );
}

export default function ColorSchemesField({
  schemes,
  usedBy,
  brandColor,
  onChange,
}: {
  schemes: ThemeScheme[];
  /** Scheme id → names of the pages whose sections use it. */
  usedBy: Record<string, string[]>;
  brandColor: string | null;
  onChange: (schemes: ThemeScheme[]) => void;
}) {
  const baseId = useId();
  const freeId = nextSchemeId(schemes);
  const update = (i: number, next: ThemeScheme) => onChange(schemes.map((s, j) => (j === i ? next : s)));
  return (
    <div className="space-y-3">
      <p className={small}>Sections pick a scheme in their own settings. Automatic colors follow the visitor&apos;s light or dark mode.</p>
      <ul className="space-y-2">
        {schemes.map((scheme, i) => {
          const used = usedBy[scheme.id] ?? [];
          const warnings = contrastWarnings(scheme, brandColor);
          const nameId = `${baseId}-${scheme.id}`;
          return (
            <li key={scheme.id}>
              <details className="rounded-md border border-gray-200">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-800">
                  {scheme.name || 'Untitled scheme'}
                  {warnings.length > 0 && <span className="ml-2 text-xs font-normal text-amber-800">Low contrast</span>}
                </summary>
                <div className="space-y-3 border-t border-gray-200 p-3">
                  <div className="space-y-1">
                    <label htmlFor={nameId} className="block text-xs font-medium text-gray-700">
                      Scheme name
                    </label>
                    <input id={nameId} className={input} maxLength={30} value={scheme.name} onChange={(e) => update(i, { ...scheme, name: e.target.value })} />
                    {!scheme.name.trim() && <p className="text-xs text-amber-800">Give the scheme a name.</p>}
                  </div>
                  {SCHEME_COLORS.map((slot: string) => (
                    <SlotControl key={slot} slot={slot} value={(scheme as any)[slot]} brandColor={brandColor} onChange={(v) => update(i, { ...scheme, [slot]: v })} />
                  ))}
                  {warnings.map((w) => (
                    <p key={w} className="text-xs text-amber-800">
                      {w}
                    </p>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={button} disabled={!freeId} onClick={() => freeId && onChange([...schemes, newScheme(freeId, scheme)])}>
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className={button}
                      disabled={used.length > 0 || schemes.length === 1}
                      onClick={() => onChange(schemes.filter((s) => s.id !== scheme.id))}
                    >
                      Remove
                    </button>
                  </div>
                  {used.length > 0 && <p className={small}>Used by {used.join(', ')}. Change those sections to another scheme to remove it.</p>}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      <button type="button" className={button} disabled={!freeId} onClick={() => freeId && onChange([...schemes, newScheme(freeId)])}>
        Add color scheme
      </button>
      {!freeId && <p className={small}>A theme can have up to {COLOR_SCHEMES_MAX} color schemes.</p>}
    </div>
  );
}
