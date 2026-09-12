'use client';

import React, { useId } from 'react';
import { THEME_MODES, type ThemeMode } from '@/lib/theme';

interface ThemeModePickerProps {
  value: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

const ICONS: Record<ThemeMode, React.ReactNode> = {
  LIGHT: (
    /* Sun */
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  ),
  DARK: (
    /* Moon */
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
      />
    </svg>
  ),
  SYSTEM: (
    /* Monitor */
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  ),
};

/**
 * Radio-card group for the organization theme mode. Native radios keep arrow-key navigation
 * and screen-reader semantics; the card styling is purely visual.
 */
export default function ThemeModePicker({ value, onChange }: ThemeModePickerProps) {
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-label="Theme mode"
      data-testid="theme-mode-picker"
      className="grid grid-cols-1 sm:grid-cols-3 gap-3"
    >
      {THEME_MODES.map((option) => {
        const selected = value === option.value;
        const id = `${name}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            data-testid={`theme-mode-${option.value.toLowerCase()}`}
            data-selected={selected ? 'true' : undefined}
            className={`relative flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-indigo-500 ${
              selected
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
                : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-gray-400 dark:hover:border-slate-500'
            }`}
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span
              className={`mt-0.5 flex-shrink-0 ${
                selected ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-slate-400'
              }`}
            >
              {ICONS[option.value]}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-900 dark:text-slate-100">
                {option.label}
              </span>
              <span className="block text-xs text-gray-500 dark:text-slate-400">{option.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
