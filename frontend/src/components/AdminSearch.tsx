'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LoaderCircle, Search, X } from 'lucide-react';
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useOrg } from '@/components/OrgContext';
import {
  GROUP_LABEL,
  SEARCH_GROUP_ORDER,
  viewAllHref,
  type AdminSearchResponse,
  type AdminSearchRow,
  type AdminSearchType,
} from '@/lib/adminSearch';
import api from '@/services/api';

type SearchStatus = 'idle' | 'loading' | 'results' | 'empty' | 'error';

interface AdminSearchProps {
  mobile?: boolean;
  onClose?: (restoreFocus?: boolean) => void;
}

type NavigationItem =
  | { kind: 'row'; key: string; href: string; row: AdminSearchRow }
  | { kind: 'all'; key: string; href: string; type: AdminSearchType };

export default function AdminSearch({ mobile = false, onClose }: AdminSearchProps) {
  const router = useRouter();
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const previousOrgRef = useRef<string | null>(selectedOrgId);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [rows, setRows] = useState<AdminSearchRow[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(mobile);
  const [activeIndex, setActiveIndex] = useState(-1);

  const trimmedQuery = query.trim();

  const search = useCallback(async (value: string) => {
    const term = value.trim();
    if (term.length < 2 || orgLoading) {
      abortRef.current?.abort();
      setRows([]);
      setSubmittedQuery('');
      setStatus('idle');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    setError('');
    setSubmittedQuery(term);
    setOpen(true);
    setActiveIndex(-1);

    try {
      const result = await api.get<AdminSearchResponse>(
        `/admin/search?q=${encodeURIComponent(term)}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      setRows(result.data);
      setSubmittedQuery(result.query || term);
      setStatus(result.data.length ? 'results' : 'empty');
    } catch (requestError: any) {
      if (controller.signal.aborted || requestError?.name === 'AbortError') return;
      setRows([]);
      setError(requestError?.message || 'Unable to search right now.');
      setStatus('error');
    }
  }, [orgLoading]);

  useEffect(() => {
    if (!open || orgLoading || trimmedQuery.length < 2) return;
    debounceRef.current = window.setTimeout(() => search(trimmedQuery), 250);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    };
  }, [open, orgLoading, search, trimmedQuery]);

  useEffect(() => {
    const previous = previousOrgRef.current;
    previousOrgRef.current = selectedOrgId;
    if (!previous || previous === selectedOrgId) return;
    abortRef.current?.abort();
    setRows([]);
    setStatus(trimmedQuery.length >= 2 ? 'loading' : 'idle');
    if (trimmedQuery.length >= 2) search(trimmedQuery);
  }, [search, selectedOrgId, trimmedQuery]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if ((event.target as Element).closest('[data-admin-search-toggle]')) return;
      if (!rootRef.current?.contains(event.target as Node)) {
        abortRef.current?.abort();
        setOpen(false);
        onClose?.();
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [onClose, open]);

  useEffect(() => {
    if (mobile) inputRef.current?.focus();
  }, [mobile]);

  const orderedRows = useMemo(
    () => SEARCH_GROUP_ORDER.flatMap((type) => rows.filter((row) => row.type === type)),
    [rows]
  );

  const grouped = useMemo(() => {
    const groups = new Map<AdminSearchType, AdminSearchRow[]>();
    for (const type of SEARCH_GROUP_ORDER) {
      const matches = orderedRows.filter((row) => row.type === type);
      if (matches.length) groups.set(type, matches);
    }
    return groups;
  }, [orderedRows]);

  const navigationItems = useMemo<NavigationItem[]>(
    () =>
      Array.from(grouped.entries()).flatMap(([type, groupRows]) => [
        ...groupRows.map((row) => ({
          kind: 'row' as const,
          key: `${row.type}:${row.id}`,
          href: row.href,
          row,
        })),
        {
          kind: 'all' as const,
          key: `${type}:all`,
          href: viewAllHref(type, submittedQuery),
          type,
        },
      ]),
    [grouped, submittedQuery]
  );

  const selectRow = (row: AdminSearchRow) => {
    abortRef.current?.abort();
    setOpen(false);
    onClose?.();
    router.push(row.href);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmedQuery.length < 2) {
      setOpen(true);
      setStatus('idle');
      return;
    }
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    search(trimmedQuery);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      abortRef.current?.abort();
      setOpen(false);
      setActiveIndex(-1);
      onClose?.(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      if (navigationItems.length)
        setActiveIndex((index) => (index + 1) % navigationItems.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (navigationItems.length)
        setActiveIndex((index) => (index <= 0 ? navigationItems.length - 1 : index - 1));
      return;
    }
    if (event.key === 'Enter' && open && activeIndex >= 0 && navigationItems[activeIndex]) {
      event.preventDefault();
      const item = navigationItems[activeIndex];
      if (item.kind === 'row') selectRow(item.row);
      else {
        setOpen(false);
        onClose?.();
        router.push(item.href);
      }
    }
  };

  const showPanel = open && (trimmedQuery.length > 0 || status !== 'idle');

  return (
    <div ref={rootRef} className={`relative ${mobile ? 'w-full' : 'w-full max-w-md'}`}>
      <form role="search" onSubmit={submit} className="relative">
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search administration
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-slate-500"
          aria-hidden
        />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-label="Search administration"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showPanel && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
          }
          autoComplete="off"
          maxLength={200}
          value={query}
          placeholder="Search events, orders, customers…"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            const value = event.target.value;
            abortRef.current?.abort();
            setQuery(value);
            setOpen(true);
            setActiveIndex(-1);
            if (value.trim().length < 2) {
              setRows([]);
              setStatus('idle');
              setSubmittedQuery('');
            } else {
              setRows([]);
              setStatus('loading');
            }
          }}
          onKeyDown={handleKeyDown}
          className="h-9 w-full rounded-md border border-gray-300 bg-gray-50 py-2 pl-9 pr-9 text-sm text-gray-900 placeholder:text-gray-500 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-400 dark:focus:border-indigo-400"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear administration search"
            onClick={() => {
              abortRef.current?.abort();
              setQuery('');
              setRows([]);
              setStatus('idle');
              setOpen(false);
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </form>

      {showPanel && (
        <div
          id={listId}
          role={status === 'results' ? 'listbox' : undefined}
          aria-label="Administration search results"
          className={`absolute z-50 mt-2 max-h-[min(28rem,70vh)] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-slate-600 dark:bg-slate-800 ${
            mobile ? 'left-0 right-0' : 'left-0 right-0 min-w-[22rem]'
          }`}
        >
          {trimmedQuery.length < 2 && (
            <div className="px-4 py-3 text-gray-600 dark:text-slate-300" role="status">
              Type at least 2 characters
            </div>
          )}

          {status === 'loading' && (
            <div className="flex items-center gap-2 px-4 py-3 text-gray-600 dark:text-slate-300" role="status">
              <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
              Searching…
            </div>
          )}

          {status === 'empty' && (
            <div className="px-4 py-3" role="status">
              <p className="font-medium text-gray-900 dark:text-white">
                No results for “{submittedQuery}”
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Search by name, email, order number, or barcode.
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="px-4 py-3" role="alert">
              <p className="text-gray-700 dark:text-slate-200">{error}</p>
              <button
                type="button"
                onClick={() => search(trimmedQuery)}
                className="mt-2 font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-indigo-400"
              >
                Try again
              </button>
            </div>
          )}

          {status === 'results' &&
            Array.from(grouped.entries()).map(([type, groupRows]) => (
              <div key={type} role="presentation">
                <div
                  id={`${listId}-${type}-heading`}
                  role="presentation"
                  className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400"
                >
                  {GROUP_LABEL[type]}
                </div>
                <div role="group" aria-labelledby={`${listId}-${type}-heading`}>
                  {groupRows.map((row) => {
                    const itemIndex = navigationItems.findIndex(
                      (item) => item.kind === 'row' && item.key === `${row.type}:${row.id}`
                    );
                    return (
                      <Link
                        key={`${row.type}:${row.id}`}
                        id={`${listId}-option-${itemIndex}`}
                        href={row.href}
                        role="option"
                        aria-selected={itemIndex === activeIndex}
                        onMouseEnter={() => setActiveIndex(itemIndex)}
                        onClick={() => {
                          abortRef.current?.abort();
                          setOpen(false);
                          onClose?.();
                        }}
                        className={`block px-4 py-2 focus:outline-none ${
                          itemIndex === activeIndex
                            ? 'bg-indigo-50 dark:bg-indigo-900/30'
                            : 'hover:bg-gray-50 dark:hover:bg-slate-700/70'
                        }`}
                      >
                        <span className="block truncate font-medium text-gray-900 dark:text-white">
                          {row.title}
                        </span>
                        <span className="block truncate text-xs text-gray-500 dark:text-slate-400">
                          {row.subtitle}
                        </span>
                      </Link>
                    );
                  })}
                  {(() => {
                    const itemIndex = navigationItems.findIndex(
                      (item) => item.kind === 'all' && item.type === type
                    );
                    return (
                      <Link
                        id={`${listId}-option-${itemIndex}`}
                        href={viewAllHref(type, submittedQuery)}
                        role="option"
                        aria-selected={itemIndex === activeIndex}
                        onMouseEnter={() => setActiveIndex(itemIndex)}
                        onClick={() => {
                          setOpen(false);
                          onClose?.();
                        }}
                        className={`block border-b border-gray-100 px-4 py-2 text-xs font-medium text-indigo-600 hover:underline focus:outline-none dark:border-slate-700 dark:text-indigo-400 ${
                          itemIndex === activeIndex
                            ? 'bg-indigo-50 dark:bg-indigo-900/30'
                            : 'hover:bg-gray-50 dark:hover:bg-slate-700/70'
                        }`}
                      >
                        View all {GROUP_LABEL[type].toLowerCase()}
                      </Link>
                    );
                  })()}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
