'use client';

// Shared IANA time-zone dropdown for venue forms. Options come from
// `lib/timeZones` (the runtime's own zone list, with a short fallback on older
// engines) and are grouped by region so the list stays navigable. A value the
// runtime does not know — a legacy row, say — is kept selectable so editing a
// venue never silently rewrites its zone.

import React, { useMemo } from 'react';
import { timeZoneOptions } from '@/lib/timeZones';

interface TimeZoneSelectProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  label?: string;
  required?: boolean;
  className?: string;
  labelClassName?: string;
}

const defaultInputClass =
  'block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

const defaultLabelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';

export default function TimeZoneSelect({
  value,
  onChange,
  id,
  label = 'Timezone',
  required = false,
  className,
  labelClassName,
}: TimeZoneSelectProps) {
  const groups = useMemo(() => {
    const byRegion = new Map<string, { id: string; label: string }[]>();
    for (const option of timeZoneOptions()) {
      const entries = byRegion.get(option.region) ?? [];
      entries.push({ id: option.id, label: `${option.city} (${option.offset})` });
      byRegion.set(option.region, entries);
    }
    return Array.from(byRegion.entries())
      .map(([region, entries]) => ({
        region,
        entries: entries.sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.region.localeCompare(b.region));
  }, []);

  const known = useMemo(
    () => groups.some((group) => group.entries.some((entry) => entry.id === value)),
    [groups, value]
  );

  return (
    <div>
      {label && (
        <label htmlFor={id} className={labelClassName ?? defaultLabelClass}>
          {label}
          {required && ' *'}
        </label>
      )}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={className ?? defaultInputClass}
      >
        {!value && <option value="">Select a timezone</option>}
        {value && !known && <option value={value}>{value.replace(/_/g, ' ')}</option>}
        {groups.map((group) => (
          <optgroup key={group.region} label={group.region}>
            {group.entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
