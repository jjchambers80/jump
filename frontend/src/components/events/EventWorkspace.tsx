'use client';

// The event workspace (spec 037 phase 2): every admin page of one event —
// Overview, Applications, Map, Attendees / Guest list, Analytics, Door
// check-in, History (admins) — shares one breadcrumb, title row and tab bar, so the event reads
// as one place instead of six disconnected pages. Facts come from
// GET /organizations/:orgId/events/:eventId/workspace.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import api from '@/services/api';
import { useSession } from 'next-auth/react';
import { useOrg } from '@/components/OrgContext';
import { formatEventDateTime } from '@/lib/eventTime';
import { EventStatusPill } from '@/components/events/EventEditSummary';

export interface EventWorkspaceFacts {
  id: string;
  name: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  date: string;
  admissionMode: 'TICKETED' | 'RSVP';
  venue: { name: string; timezone?: string | null } | null;
  mapId: string | null;
  formCount: number;
  toReview: number;
}

export type WorkspaceTab = 'overview' | 'applications' | 'map' | 'attendees' | 'rsvps' | 'analytics' | 'check-in' | 'history';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900';

/** Loads the workspace facts once the org selection has settled. */
export function useEventWorkspace(eventId: string) {
  const { selectedOrgId, loading } = useOrg();
  const [facts, setFacts] = useState<EventWorkspaceFacts | null>(null);
  useEffect(() => {
    if (loading || !selectedOrgId || !eventId) return;
    let live = true;
    api
      .get<EventWorkspaceFacts>(`/organizations/${selectedOrgId}/events/${eventId}/workspace`)
      .then((f) => live && setFacts(f))
      .catch(() => live && setFacts(null));
    return () => {
      live = false;
    };
  }, [selectedOrgId, loading, eventId]);
  return { facts, orgId: selectedOrgId };
}

/** The tab list for an event; tabs that do not apply are left out. */
export function workspaceTabs(eventId: string, facts: Pick<EventWorkspaceFacts, 'admissionMode' | 'formCount' | 'toReview'> | null, orgId?: string | null) {
  const base = `/admin/events/${eventId}`;
  const ticketed = facts?.admissionMode !== 'RSVP';
  const tabs: { key: WorkspaceTab; label: string; href: string; count?: number }[] = [
    { key: 'overview', label: 'Overview', href: `${base}${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''}` },
    { key: 'applications', label: 'Applications', href: `${base}/applications`, count: facts?.toReview || undefined },
    { key: 'map', label: 'Map', href: `${base}/map` },
    ticketed
      ? { key: 'attendees', label: 'Attendees', href: `${base}/attendees` }
      : { key: 'rsvps', label: 'Guest list', href: `${base}/rsvps` },
    ...(ticketed ? [{ key: 'analytics' as const, label: 'Analytics', href: `${base}/analytics` }] : []),
    ...(facts && facts.formCount > 0 ? [{ key: 'check-in' as const, label: 'Door check-in', href: `${base}/check-in` }] : []),
  ];
  return tabs;
}

export function WorkspaceTabs({
  tabs,
  current,
}: {
  tabs: ReturnType<typeof workspaceTabs>;
  current: WorkspaceTab;
}) {
  // History (spec 048-D) reads the audit trail: store admins only, like
  // Settings › Activity log. Added here so every page's tab bar has it.
  const { data: session } = useSession();
  if (['ADMIN', 'SYSTEM_ADMIN'].includes((session?.user as any)?.role)) {
    const base = tabs[0].href.split('?')[0];
    tabs = [...tabs, { key: 'history', label: 'History', href: `${base}/history` }];
  }
  return (
    <nav aria-label="Event pages" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-gray-200 dark:border-slate-700">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`relative -mb-px inline-flex min-h-10 items-center gap-2 rounded-t border-b-2 px-3 text-sm font-medium transition-colors motion-reduce:transition-none ${
                  active
                    ? 'border-accent-600 text-accent-700 dark:border-accent-400 dark:text-accent-200'
                    : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-white'
                } ${focusRing}`}
              >
                {tab.label}
                {tab.count ? (
                  <span className="rounded-full bg-sky-100 px-1.5 text-[0.7rem] font-semibold tabular-nums text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
                    {tab.count}
                    <span className="sr-only"> to review</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Breadcrumb, event name and tabs for the event's sub-pages. The page keeps
 * its own <h1> (what the page is); the event name sits above it as context.
 */
export default function EventWorkspaceHeader({
  eventId,
  current,
  title,
  subtitle,
  actions,
}: {
  eventId: string;
  current: WorkspaceTab;
  /** The page's own heading, e.g. "Attendees". */
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { facts, orgId } = useEventWorkspace(eventId);
  const tabs = workspaceTabs(eventId, facts, orgId);
  const overviewHref = tabs[0].href;

  return (
    <div className="mb-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex min-w-0 items-center gap-1 text-gray-500 dark:text-slate-400">
          <li>
            <Link href="/admin/events" className={`rounded font-medium hover:text-gray-900 dark:hover:text-white ${focusRing}`}>
              Events
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li className="min-w-0 truncate">
            <Link href={overviewHref} className={`rounded font-medium hover:text-gray-900 dark:hover:text-white ${focusRing}`}>
              {facts?.name ?? 'Event'}
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li aria-current="page" className="shrink-0 text-gray-900 dark:text-slate-200">
            {title}
          </li>
        </ol>
      </nav>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-slate-400">
            {facts && <EventStatusPill status={facts.status} />}
            {facts && (
              <span className="min-w-0 truncate">
                <span className="font-medium text-gray-800 dark:text-slate-200">{facts.name}</span>
                {' · '}
                <span className="tabular-nums">{formatEventDateTime(facts.date, facts.venue?.timezone)}</span>
              </span>
            )}
            {subtitle}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      <div className="mt-4">
        <WorkspaceTabs tabs={tabs} current={current} />
      </div>
    </div>
  );
}
