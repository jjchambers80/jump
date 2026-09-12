'use client';

import React, { useEffect, useId, useState } from 'react';
import ContrastBadge from '@/components/ContrastBadge';
import { BRAND_DEFAULTS, BRAND_PRESETS, evaluateBrandColor, normalizeHex } from '@/lib/color';

interface BrandColorPickerProps {
  /** Current normalized hex, or null for the platform default. */
  value: string | null;
  onChange: (hex: string | null) => void;
}

/**
 * Preset swatches + custom hex input with a live WCAG AA contrast badge.
 * Reports every valid change through `onChange`; invalid text never propagates.
 */
export default function BrandColorPicker({ value, onChange }: BrandColorPickerProps) {
  const inputId = useId();
  const [text, setText] = useState(value ?? '');
  const [textError, setTextError] = useState<string | null>(null);

  // Keep the text field in sync when the parent value changes (preset click, reset, reload).
  useEffect(() => {
    setText(value ?? '');
    setTextError(null);
  }, [value]);

  // Debounce free-typed hex so we don't re-evaluate on every keystroke.
  useEffect(() => {
    if (text === (value ?? '')) return;
    const handle = setTimeout(() => {
      if (text.trim() === '') {
        setTextError(null);
        onChange(null);
        return;
      }
      const normalized = normalizeHex(text);
      if (!normalized) {
        setTextError('Enter a hex color like #1d4ed8');
        return;
      }
      setTextError(null);
      onChange(normalized);
    }, 250);
    return () => clearTimeout(handle);
  }, [text, value, onChange]);

  const evaluation = evaluateBrandColor(value ?? BRAND_DEFAULTS.brand);
  const colorInputValue = value ?? BRAND_DEFAULTS.brand;

  return (
    <div data-testid="brand-color-picker">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Preset brand colors">
        {BRAND_PRESETS.map((preset) => {
          const selected = value === preset.hex;
          return (
            <button
              key={preset.hex}
              type="button"
              aria-label={preset.name}
              aria-pressed={selected}
              title={`${preset.name} ${preset.hex}`}
              data-testid={`brand-preset-${preset.name.toLowerCase()}`}
              onClick={() => onChange(preset.hex)}
              className={`h-8 w-8 rounded-full border-2 transition-transform focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-slate-800 ${
                selected
                  ? 'border-gray-900 dark:border-white scale-110'
                  : 'border-transparent hover:scale-105'
              }`}
              style={{ backgroundColor: preset.hex }}
            />
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="text-sm font-medium text-gray-600 dark:text-slate-400">
          Custom
        </label>
        <input
          type="color"
          aria-label="Pick a custom brand color"
          value={colorInputValue}
          onChange={(e) => onChange(normalizeHex(e.target.value))}
          className="h-8 w-10 cursor-pointer rounded border border-gray-300 dark:border-slate-600 bg-transparent p-0.5"
        />
        <input
          id={inputId}
          type="text"
          inputMode="text"
          spellCheck={false}
          placeholder="#1d4ed8"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={textError ? true : undefined}
          aria-describedby={textError ? `${inputId}-error` : undefined}
          data-testid="brand-color-hex"
          className="w-28 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 font-mono text-sm text-gray-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            data-testid="brand-color-reset"
            className="text-xs font-medium text-gray-500 underline hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Use platform default
          </button>
        )}
      </div>
      {textError && (
        <p id={`${inputId}-error`} className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
          {textError}
        </p>
      )}

      <ContrastBadge evaluation={evaluation} />
    </div>
  );
}
