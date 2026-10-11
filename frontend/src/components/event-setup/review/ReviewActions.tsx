// Review's actions (spec 050 §5.1, §11.1): Publish is the one primary action.
// Create mode adds Save as draft; an event that is already live shows its
// status as text instead. Never disabled for readiness: a refused publish
// shows the error summary (§11.6).

import Link from 'next/link';
import { Ban, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { primaryButton, secondaryButton } from '../ui';
import type { PreviewLink } from './useReviewData';

interface Props {
  status: string;
  createMode: boolean;
  busy: 'publish' | 'draft' | null;
  onPublish: () => void;
  onSaveDraft: () => void;
  preview: PreviewLink;
  onRetryPreview: () => void;
  eventId: string;
}

export default function ReviewActions({ status, createMode, busy, onPublish, onSaveDraft, preview, onRetryPreview, eventId }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      {status === 'DRAFT' ? (
        <>
          <button type="button" onClick={onPublish} disabled={!!busy} aria-busy={busy === 'publish' || undefined} className={primaryButton}>
            {busy === 'publish' && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />}
            {busy === 'publish' ? 'Publishing…' : 'Publish'}
          </button>
          {createMode && (
            <button type="button" onClick={onSaveDraft} disabled={!!busy} aria-busy={busy === 'draft' || undefined} className={secondaryButton}>
              {busy === 'draft' ? 'Saving…' : 'Save as draft'}
            </button>
          )}
        </>
      ) : (
        <p className="flex min-h-11 items-center gap-2 text-sm font-medium text-gray-900 dark:text-white" data-testid="review-status">
          {status === 'PUBLISHED' ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> : <Ban className="h-4 w-4 shrink-0" aria-hidden />}
          {status === 'PUBLISHED' ? 'This event is published.' : `This event is ${status.toLowerCase()}.`}
          <Link href={`/admin/events/${eventId}`} className="underline underline-offset-2">
            Go to event
          </Link>
        </p>
      )}
      {preview.status === 'ready' ? (
        <a href={preview.url} target="_blank" rel="noopener noreferrer" className={`${secondaryButton} sm:ml-auto`}>
          Open full preview
          <ExternalLink className="h-4 w-4" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : preview.status === 'error' ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-slate-300 sm:ml-auto">
          Couldn&apos;t make a preview link.
          <button type="button" onClick={onRetryPreview} className={secondaryButton}>
            Try again
          </button>
        </p>
      ) : (
        <span className="text-sm text-gray-600 dark:text-slate-400 sm:ml-auto" aria-live="polite">
          Preparing preview…
        </span>
      )}
    </div>
  );
}
