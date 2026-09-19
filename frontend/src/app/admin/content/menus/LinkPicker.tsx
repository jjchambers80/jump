'use client';

// Grouped link picker for a menu item: type to search events, venues, pages,
// blogs and blog posts; fixed entries for Home, All events, Buyer account;
// anything that looks like a URL becomes an External link.

import {
  Calendar,
  ExternalLink,
  FileText,
  Home,
  MapPin,
  Newspaper,
  PenLine,
  Search,
  Ticket,
  UserRound,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { LINK_TYPE_LABELS, looksLikeUrl, type LinkTargets, type MenuLinkType } from '@/lib/menus';
import { useMenusApi } from './useMenusApi';

export interface LinkChoice {
  linkType: MenuLinkType;
  targetId: string | null;
  url: string | null;
  title: string | null;
}

interface Option extends LinkChoice {
  key: string;
  group: string;
  hint?: string;
  icon: ReactNode;
}

interface LinkPickerProps {
  value: LinkChoice | null;
  onChange: (choice: LinkChoice) => void;
  inputId: string;
}

const FIXED: Option[] = [
  {
    key: 'HOME',
    group: 'Storefront',
    linkType: 'HOME',
    targetId: null,
    url: null,
    title: 'Home page',
    icon: <Home className="h-4 w-4" aria-hidden />,
  },
  {
    key: 'EVENTS',
    group: 'Storefront',
    linkType: 'EVENTS',
    targetId: null,
    url: null,
    title: 'All events',
    icon: <Ticket className="h-4 w-4" aria-hidden />,
  },
  {
    key: 'ACCOUNT',
    group: 'Account',
    linkType: 'ACCOUNT',
    targetId: null,
    url: null,
    title: 'Buyer account',
    icon: <UserRound className="h-4 w-4" aria-hidden />,
  },
];

function summarize(value: LinkChoice | null) {
  if (!value) return '';
  if (value.linkType === 'EXTERNAL') return value.url ?? '';
  return value.title ?? LINK_TYPE_LABELS[value.linkType];
}

export default function LinkPicker({ value, onChange, inputId }: LinkPickerProps) {
  const menusApi = useMenusApi();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(summarize(value));
  const [targets, setTargets] = useState<LinkTargets | null>(null);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(summarize(value));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      menusApi
        .linkTargets(looksLikeUrl(query) ? '' : query)
        .then((result) => {
          if (!cancelled) setTargets(result);
        })
        .catch(() => {
          if (!cancelled)
            setTargets({ events: [], venues: [], pages: [], blogs: [], blogPosts: [] });
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, menusApi]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const options: Option[] = [];
  if (looksLikeUrl(query)) {
    const url = /^[a-z]+:/i.test(query.trim()) ? query.trim() : `https://${query.trim()}`;
    options.push({
      key: 'EXTERNAL',
      group: 'Other',
      linkType: 'EXTERNAL',
      targetId: null,
      url,
      title: url,
      hint: 'External link',
      icon: <ExternalLink className="h-4 w-4" aria-hidden />,
    });
  }
  options.push(...FIXED.filter((option) => !q || option.title!.toLowerCase().includes(q)));
  const groups: {
    group: string;
    type: MenuLinkType;
    list: LinkTargets[keyof LinkTargets];
    icon: ReactNode;
  }[] = [
    {
      group: 'Events',
      type: 'EVENT',
      list: targets?.events ?? [],
      icon: <Calendar className="h-4 w-4" aria-hidden />,
    },
    {
      group: 'Venues',
      type: 'VENUE',
      list: targets?.venues ?? [],
      icon: <MapPin className="h-4 w-4" aria-hidden />,
    },
    {
      group: 'Pages',
      type: 'PAGE',
      list: targets?.pages ?? [],
      icon: <FileText className="h-4 w-4" aria-hidden />,
    },
    {
      group: 'Blogs',
      type: 'BLOG',
      list: targets?.blogs ?? [],
      icon: <Newspaper className="h-4 w-4" aria-hidden />,
    },
    {
      group: 'Blog posts',
      type: 'BLOG_POST',
      list: targets?.blogPosts ?? [],
      icon: <PenLine className="h-4 w-4" aria-hidden />,
    },
  ];
  for (const group of groups) {
    for (const entry of group.list) {
      options.push({
        key: `${group.type}:${entry.id}`,
        group: group.group,
        linkType: group.type,
        targetId: entry.id,
        url: null,
        title: entry.title,
        hint: entry.hint,
        icon: group.icon,
      });
    }
  }
  if (!looksLikeUrl(query) && q) {
    options.push({
      key: 'EXTERNAL-hint',
      group: 'Other',
      linkType: 'EXTERNAL',
      targetId: null,
      url: `https://${query.trim()}`,
      title: `Link to https://${query.trim()}`,
      hint: 'External link',
      icon: <ExternalLink className="h-4 w-4" aria-hidden />,
    });
  }

  const choose = (option: Option) => {
    onChange({
      linkType: option.linkType,
      targetId: option.targetId,
      url: option.url,
      title: option.linkType === 'EXTERNAL' ? null : option.title,
    });
    setOpen(false);
  };

  let lastGroup = '';

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden
        />
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          value={query}
          placeholder="Search or paste a link"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (event.key === 'Enter' && open && options[active]) {
              event.preventDefault();
              choose(options[active]);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              setOpen(false);
              setQuery(summarize(value));
            }
          }}
          className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Link targets"
          className="absolute left-0 top-full z-30 mt-1 max-h-72 w-full min-w-[18rem] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-slate-600 dark:bg-slate-800"
        >
          {options.length === 0 && (
            <li className="px-3 py-2 text-gray-500 dark:text-slate-400">
              {targets ? 'Nothing matches' : 'Loading…'}
            </li>
          )}
          {options.map((option, index) => {
            const header = option.group !== lastGroup ? option.group : null;
            lastGroup = option.group;
            return (
              <li key={option.key} role="presentation">
                {header && (
                  <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    {header}
                  </div>
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-gray-800 dark:text-slate-200 ${index === active ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''}`}
                >
                  <span className="text-gray-400">{option.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{option.title}</span>
                  {option.hint && (
                    <span className="text-xs text-gray-500 dark:text-slate-400">{option.hint}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
