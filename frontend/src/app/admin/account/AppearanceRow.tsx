'use client';

// Account › General › Preferences: light / dark / system theme for the admin.
// next-themes keeps the choice in this browser, so it applies on the spot
// with no save step.

import { Contrast } from 'lucide-react';
import { useTheme } from 'next-themes';

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

export default function AppearanceRow() {
  const { theme, setTheme } = useTheme();
  const current = theme ?? 'system';

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-gray-500 dark:text-slate-400">
        <Contrast aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
      </span>
      <span className="min-w-[10rem] flex-1">
        <span id="account-theme-label" className="block text-sm font-medium text-gray-900 dark:text-white">Theme</span>
        <span className="block text-sm text-gray-600 dark:text-slate-400">Saved on this device</span>
      </span>
      <div role="radiogroup" aria-labelledby="account-theme-label" data-testid="account-theme" className="ml-11 inline-flex sm:ml-0 rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-slate-700 dark:bg-slate-900">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors has-[:checked]:bg-white has-[:checked]:text-gray-900 has-[:checked]:shadow-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500 dark:text-slate-400 dark:has-[:checked]:bg-slate-700 dark:has-[:checked]:text-white"
          >
            <input
              type="radio"
              name="account-theme"
              value={option.value}
              checked={current === option.value}
              onChange={() => setTheme(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}
