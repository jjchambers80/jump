'use client';

// Header shared by the admin applications pages of one event (spec 011): the
// event workspace header (spec 037). A registration event (spec 057) is its
// one form: "Registrations" and Edit form. A live event creates registration
// events; "Add a form" (the four spec 051 flows) stays only for forms it
// already has. Door check-in is a workspace tab of its own.

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Pencil, Plus } from 'lucide-react';
import EventWorkspaceHeader from '@/components/events/EventWorkspace';
import { useCan, useOrg } from '@/components/OrgContext';
import { ADD_TO_EVENT } from '@/components/events/AddToEvent';
import { formFlowHref } from '@/components/event-setup/formFlows';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500';

/** Disclosure (button + list of links), not an ARIA menu: Tab moves through the links, Escape closes. */
function AddFormMenu({ eventId, orgId }: { eventId: string; orgId: string | null }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 ${focusRing}`}
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add a form
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
      <ul
        id={listId}
        hidden={!open}
        className="absolute right-0 z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-gray-200 bg-white py-1 shadow-sm dark:border-slate-700 dark:bg-slate-800"
      >
        {ADD_TO_EVENT.map(({ flow, title }) => (
          <li key={flow}>
            <Link
              href={formFlowHref(eventId, flow, { org: orgId, step: flow === 'special-guests' ? 'lineup' : undefined })}
              className={`flex min-h-11 items-center px-3 text-sm text-gray-800 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-700 ${focusRing}`}
            >
              {title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ApplicationsHeader({ eventId, title, subtitle }: { eventId: string; title?: string; subtitle?: string }) {
  const { selectedOrgId } = useOrg();
  const canEdit = useCan('applications.forms');
  const button = `inline-flex min-h-11 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 ${focusRing}`;
  return (
    <EventWorkspaceHeader
      eventId={eventId}
      current="applications"
      // Spec 057: a registration event's one form takes registrations.
      title={(facts) => title ?? (facts?.type === 'REGISTRATION' ? 'Registrations' : 'Applications')}
      subtitle={subtitle ? <span>{subtitle}</span> : undefined}
      actions={(facts) => {
        if (!canEdit || !facts) return undefined;
        if (facts.type === 'REGISTRATION')
          return (
            <Link href={formFlowHref(eventId, 'registration', { org: selectedOrgId })} className={button}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit form
            </Link>
          );
        // A live event takes new forms as registration events; the old menu stays for its existing forms.
        return (
          <>
            <Link href={`/admin/events/new?type=registration&linked=${encodeURIComponent(eventId)}`} className={button}>
              <Plus className="h-4 w-4" aria-hidden />
              Create registration event
            </Link>
            {facts.formCount > 0 && <AddFormMenu eventId={eventId} orgId={selectedOrgId} />}
          </>
        );
      }}
    />
  );
}
