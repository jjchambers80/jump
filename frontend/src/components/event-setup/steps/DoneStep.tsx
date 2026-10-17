'use client';

// The Done screen (spec 050 §5.1 `done`, create mode only): after Review
// publishes or saves as draft. Cards: view the page (a DRAFT opens the signed
// 050-F preview link, minted on arrival so the click opens a tab without a
// popup block), copy the share link (published only, on the storefront host),
// and Review applications or Set up door check-in; then the primary Go to
// event. No confetti, no survey (§11.6). The h1 is the step-change focus target.

import { forwardRef, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ChevronRight, ClipboardList, ExternalLink, Link2, ScanLine, Sparkles } from 'lucide-react';
import api from '@/services/api';
import { eventPath } from '@/lib/publicPaths';
import type { EventOverview } from '@/lib/eventOverview';
import type { SavedEvent } from '../steps';
import { clearSetupFinished } from '../doneMarker';
import FormResults from '../review/FormResults';
import { useCan } from '@/components/OrgContext';
import { primaryButton, textButton } from '../ui';

const row =
  'flex min-h-14 w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left text-sm font-medium text-gray-900 hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900';
const tile = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-50 text-accent-800 dark:bg-slate-700 dark:text-accent-300';
// slate-300: still 4.5:1 on the dark row's hover background (slate-700).
const sub = 'block text-xs font-normal text-gray-600 dark:text-slate-300';
const alertBox = 'flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200';

type Load<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error' };

/** GET/POST once on arrival, with Try again. */
function useLoad<T>(run: (() => Promise<T>) | null) {
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    setState({ status: 'loading' });
    run()
      .then((value) => !cancelled && setState({ status: 'ready', value }))
      .catch(() => !cancelled && setState({ status: 'error' }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, attempt]);
  return { state, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}

function CardLink({ href, icon, title, detail, external }: { href: string; icon: React.ReactNode; title: string; detail?: string; external?: boolean }) {
  const body = (
    <>
      <span className={tile}>{icon}</span>
      <span className="flex-1">
        {title}
        {external && <span className="sr-only"> (opens in a new tab)</span>}
        {detail && <span className={sub}>{detail}</span>}
      </span>
      <ChevronRight className="h-4 w-4 text-gray-500" aria-hidden />
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={row}>{body}</a>
  ) : (
    <Link href={href} className={row}>{body}</Link>
  );
}

function Pending({ label, onRetry, failed }: { label: string; onRetry: () => void; failed: boolean }) {
  return failed ? (
    <div role="alert" className={alertBox}>
      Couldn&apos;t load {label}.
      <button type="button" onClick={onRetry} className={`${textButton} text-red-800 dark:text-red-200`}>Try again</button>
    </div>
  ) : (
    <div aria-busy="true" aria-label={`Loading ${label}`} className="h-14 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
  );
}

const DoneStep = forwardRef<HTMLHeadingElement, { event: SavedEvent; orgId: string }>(function DoneStep({ event, orgId }, headingRef) {
  const live = event.status === 'PUBLISHED';
  const id = encodeURIComponent(event.id);
  const base = `/organizations/${orgId}/events/${id}`;
  // The overview again, not the wizard's copy: forms may have been added since it loaded.
  const overview = useLoad(useCallback(() => api.get<EventOverview>(`${base}/overview`), [base]));
  const mint = useCallback(() => api.post<{ url: string }>(`${base}/preview-link`, {}), [base]);
  const preview = useLoad(live ? null : mint);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  const ov = overview.state.status === 'ready' ? overview.state.value : null;
  // The storefront host (custom domain, store subdomain or platform) from the server; the current slug.
  const shareUrl = ov?.publicUrl ? `${new URL(ov.publicUrl).origin}${eventPath(event.slug || event.id)}` : null;
  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  };

  const viewHref = live ? shareUrl : preview.state.status === 'ready' ? preview.state.value.url : null;
  const viewState = live ? overview : preview;
  const hasForms = (ov?.applications.forms.length ?? 0) > 0;
  // A registration event is already a form (spec 057): nothing to add to it.
  const canAdd = useCan('applications.forms') && event.type !== 'REGISTRATION';

  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-6 motion-safe:animate-fade-in sm:px-6 sm:py-8">
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-gray-900 focus:outline-none dark:text-white">
        {live ? 'Your event is live' : 'Saved as draft'}
      </h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        {live
          ? event.type === 'REGISTRATION'
            ? `${event.name} is live. Share the link so people can register.`
            : `${event.name} is on sale. Share the link to start selling.`
          : `${event.name} is saved and only staff can see it. Publish it from the event page when you are ready.`}
      </p>
      {/* What Publish did with each form ticked on Review (050-N). */}
      <FormResults eventId={event.id} />

      <ul className="mt-6 space-y-3">
        <li>
          {viewHref ? (
            <CardLink
              href={viewHref}
              external
              icon={<ExternalLink className="h-4 w-4" aria-hidden />}
              title={live ? 'View the event page' : 'Preview the event page'}
              detail={live ? undefined : 'Private link for staff, valid for one hour'}
            />
          ) : (
            <Pending label={live ? 'the event page link' : 'a preview link'} failed={viewState.state.status === 'error'} onRetry={viewState.retry} />
          )}
        </li>
        {live && shareUrl && (
          <li>
            <button type="button" onClick={() => void copy()} className={row}>
              <span className={tile}>{copied === 'done' ? <Check className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}</span>
              <span className="flex-1">{copied === 'done' ? 'Link copied' : 'Copy the share link'}</span>
            </button>
          </li>
        )}
        <li>
          {ov ? (
            hasForms ? (
              <CardLink href={`/admin/events/${id}/applications`} icon={<ClipboardList className="h-4 w-4" aria-hidden />} title="Review applications" detail="Approve vendors, guests and volunteers as they apply" />
            ) : (
              <CardLink href={`/admin/events/${id}/check-in`} icon={<ScanLine className="h-4 w-4" aria-hidden />} title="Set up door check-in" detail="Scan tickets at the door from a phone" />
            )
          ) : (
            overview.state.status === 'error' && <Pending label="the event" failed onRetry={overview.retry} />
          )}
        </li>
      </ul>
      {canAdd && (
        <section aria-labelledby="done-whats-next" className="mt-8">
          <h2 id="done-whats-next" className="text-base font-semibold text-gray-900 dark:text-white">What&apos;s next</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Vendors, sponsors and volunteers register through a registration event for this one. You can also do this later from the event page.</p>
          <ul className="mt-3 space-y-3">
            <li>
              <CardLink
                href={`/admin/events/new?type=registration&linked=${encodeURIComponent(event.id)}`}
                icon={<ClipboardList className="h-4 w-4" aria-hidden />}
                title="Create a registration event"
                detail="A form people register through, free or with a fee"
              />
            </li>
            <li>
              <CardLink
                href={`/admin/events/${encodeURIComponent(event.id)}/setup/special-guests?step=lineup${orgId ? `&org=${encodeURIComponent(orgId)}` : ''}`}
                icon={<Sparkles className="h-4 w-4" aria-hidden />}
                title="Add special guests"
                detail="Your lineup, shown on the event page"
              />
            </li>
          </ul>
        </section>
      )}
      <p role="status" className="mt-2 text-sm text-gray-700 dark:text-slate-300">
        {copied === 'done' && 'Link copied to the clipboard.'}
      </p>
      {copied === 'failed' && (
        <p role="alert" className={`${alertBox} mt-2 [overflow-wrap:anywhere]`}>
          Couldn&apos;t copy the link. Copy it from here: {shareUrl}
        </p>
      )}

      <Link href={`/admin/events/${id}`} onClick={() => clearSetupFinished(event.id)} className={`${primaryButton} mt-6 w-full sm:w-auto`}>
        Go to event
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
});

export default DoneStep;
