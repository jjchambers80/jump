'use client';

// The Done screen (spec 050 §5.1 `done`, create mode only): after Review
// publishes or saves as draft. View the page (a DRAFT opens the signed 050-F
// preview link, minted on arrival so the click opens a tab without a popup
// block), copy the share link (published only) and the primary Go to event.
// No confetti, no survey (§11.6). The h1 is the step-change focus target.

import { forwardRef, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ChevronRight, ExternalLink, Link2 } from 'lucide-react';
import api from '@/services/api';
import type { SavedEvent } from '../steps';
import { primaryButton, textButton } from '../ui';

const row =
  'flex min-h-14 w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left text-sm font-medium text-gray-900 hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900';
const tile = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-50 text-accent-800 dark:bg-slate-700 dark:text-accent-300';

type Preview = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error' };

const DoneStep = forwardRef<HTMLHeadingElement, { event: SavedEvent; orgId: string }>(function DoneStep({ event, orgId }, headingRef) {
  const live = event.status === 'PUBLISHED';
  const publicPath = `/events/${encodeURIComponent(event.slug || event.id)}`;
  const [preview, setPreview] = useState<Preview>({ status: 'loading' });
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  const mint = useCallback(() => {
    setPreview({ status: 'loading' });
    api
      .post<{ url: string }>(`/organizations/${orgId}/events/${encodeURIComponent(event.id)}/preview-link`, {})
      .then(({ url }) => setPreview({ status: 'ready', url }))
      .catch(() => setPreview({ status: 'error' }));
  }, [orgId, event.id]);
  useEffect(() => {
    if (!live && orgId) mint();
  }, [live, orgId, mint]);

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}${publicPath}` : publicPath;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  };

  const viewHref = live ? publicPath : preview.status === 'ready' ? preview.url : null;

  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-6 motion-safe:animate-fade-in sm:px-6 sm:py-8">
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-gray-900 focus:outline-none dark:text-white">
        {live ? 'Your event is live' : 'Saved as draft'}
      </h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        {live
          ? `${event.name} is on sale. Share the link to start selling.`
          : `${event.name} is saved and only staff can see it. Publish it from the event page when you are ready.`}
      </p>

      <ul className="mt-6 space-y-3">
        <li>
          {viewHref ? (
            <a href={viewHref} target="_blank" rel="noreferrer" className={row}>
              <span className={tile}><ExternalLink className="h-4 w-4" aria-hidden /></span>
              <span className="flex-1">
                {live ? 'View the event page' : 'Preview the event page'}
                <span className="sr-only"> (opens in a new tab)</span>
                {!live && <span className="block text-xs font-normal text-gray-600 dark:text-slate-400">Private link for staff, valid for one hour</span>}
              </span>
              <ChevronRight className="h-4 w-4 text-gray-500" aria-hidden />
            </a>
          ) : preview.status === 'error' ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              Couldn&apos;t make a preview link.
              <button type="button" onClick={mint} className={`${textButton} text-red-800 dark:text-red-200`}>Try again</button>
            </div>
          ) : (
            <button type="button" disabled aria-busy="true" className={row}>
              <span className={tile}><ExternalLink className="h-4 w-4" aria-hidden /></span>
              <span className="flex-1">Preparing a preview link…</span>
            </button>
          )}
        </li>
        {live && (
          <li>
            <button type="button" onClick={() => void copy()} className={row}>
              <span className={tile}>{copied === 'done' ? <Check className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}</span>
              <span className="flex-1">{copied === 'done' ? 'Link copied' : 'Copy the share link'}</span>
            </button>
          </li>
        )}
      </ul>
      <p role="status" className="mt-2 text-sm text-gray-700 dark:text-slate-300 [overflow-wrap:anywhere]">
        {copied === 'done' && 'Link copied to the clipboard.'}
        {copied === 'failed' && <>Couldn&apos;t copy. The link is {shareUrl}</>}
      </p>

      <Link href={`/admin/events/${encodeURIComponent(event.id)}`} className={`${primaryButton} mt-6 w-full sm:w-auto`}>
        Go to event
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
});

export default DoneStep;
