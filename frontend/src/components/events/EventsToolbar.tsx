'use client';

// Filter toolbar for the admin events list (spec 035 F4–F7, D2, D7).
// Status radiogroup with counts, search (300ms debounce), category select, sort select.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';

export interface EventsSummaryData {
  counts: { all: number; DRAFT: number; PUBLISHED: number; CANCELLED: number };
  categories: string[];
}

export type StatusFilter = '' | 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
export type SortOption = 'upcoming' | 'date_desc' | 'created_desc' | 'name_asc';

interface EventsToolbarProps {
  /** Status counts from the summary API {all, DRAFT, PUBLISHED, CANCELLED} */
  summaryCounts: { all: number; DRAFT: number; PUBLISHED: number; CANCELLED: number } | null;
  /** Full distinct category list (never filtered). */
  categories: string[];
  loading: boolean;
  currentStatus: StatusFilter;
  currentQ: string;
  currentCategory: string;
  currentSort: SortOption;
  onStatusChange: (status: StatusFilter) => void;
  onQChange: (q: string) => void;
  onCategoryChange: (category: string) => void;
  onSortChange: (sort: SortOption) => void;
}

const STATUS_LABELS: Record<StatusFilter, string> = {
  '': 'All',
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  CANCELLED: 'Cancelled',
};

const STATUS_KEYS: StatusFilter[] = ['', 'DRAFT', 'PUBLISHED', 'CANCELLED'];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'date_desc', label: 'Date (newest)' },
  { value: 'created_desc', label: 'Recently created' },
  { value: 'name_asc', label: 'Name A–Z' },
];

export default function EventsToolbar({
  summaryCounts,
  categories,
  loading,
  currentStatus,
  currentQ,
  currentCategory,
  currentSort,
  onStatusChange,
  onQChange,
  onCategoryChange,
  onSortChange,
}: EventsToolbarProps) {
  // Local search input state with debounce. Sync from prop when URL changes externally.
  const [inputValue, setInputValue] = useState(currentQ);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync input when currentQ changes externally (browser back/forward).
  useEffect(() => {
    setInputValue(currentQ);
  }, [currentQ]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputValue(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onQChange(val);
      }, 300);
    },
    [onQChange]
  );

  const handleClearSearch = useCallback(() => {
    setInputValue('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onQChange('');
    inputRef.current?.focus();
  }, [onQChange]);

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const statusCount = (status: StatusFilter) => {
    if (!summaryCounts) return null;
    if (status === '') return summaryCounts.all;
    return summaryCounts[status];
  };

  const statusAccessibleName = (status: StatusFilter) => {
    const label = STATUS_LABELS[status];
    const count = statusCount(status);
    return count !== null ? `${label}, ${count} event${count === 1 ? '' : 's'}` : label;
  };

  return (
    <div className="mb-6 space-y-4">
      {/* Status radiogroup */}
      <div
        role="radiogroup"
        aria-label="Filter by status"
        className="flex flex-wrap gap-2"
      >
        {STATUS_KEYS.map((s) => {
          const count = statusCount(s);
          const isActive = currentStatus === s;
          return (
            <button
              key={s}
              role="radio"
              aria-checked={isActive}
              aria-label={statusAccessibleName(s)}
              onClick={() => onStatusChange(s)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
              } ${loading ? 'opacity-60' : ''}`}
            >
              {STATUS_LABELS[s]}
              {count !== null && !loading && (
                <span className={`tabular-nums ${isActive ? 'text-indigo-200' : 'text-gray-400 dark:text-slate-500'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search + category + sort */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={inputValue}
            onChange={handleInputChange}
            placeholder="Filter by title, venue…"
            aria-label="Search events"
            className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 py-2 pl-9 pr-9 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {inputValue && (
            <button
              type="button"
              onClick={handleClearSearch}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Category */}
        <div>
          <select
            value={currentCategory}
            onChange={(e) => onCategoryChange(e.target.value)}
            aria-label="Filter by category"
            className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 py-2 pl-3 pr-8 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%239ca3af%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem_1.25rem] bg-[right_0.5rem_center] bg-no-repeat"
          >
            <option value="">All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Sort */}
        <div>
          <select
            value={currentSort}
            onChange={(e) => onSortChange(e.target.value as SortOption)}
            aria-label="Sort events"
            className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 py-2 pl-3 pr-8 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%239ca3af%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem_1.25rem] bg-[right_0.5rem_center] bg-no-repeat"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}