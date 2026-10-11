'use client';

// What the Review step reads (spec 050 §5.1 `review`): readiness from
// GET …/readiness (the only source of blockers and warnings, §7.2), the
// overview for the forms and the resolved tax rate, and a signed full-preview
// link (050-F) minted up front so the link opens synchronously (no popup block).

import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import type { EventReadiness } from '@/lib/eventReadiness';
import type { EventOverview } from '@/lib/eventOverview';

export type ReviewLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; readiness: EventReadiness; overview: EventOverview };

export type PreviewLink = { status: 'loading' } | { status: 'error' } | { status: 'ready'; url: string };

/** Re-mint this long before the link expires, so a click never opens a dead token. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MIN_REFRESH_MS = 60 * 1000;

export function useReviewData(orgId: string, eventId: string) {
  const [load, setLoad] = useState<ReviewLoad>({ status: 'loading' });
  const [preview, setPreview] = useState<PreviewLink>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const base = `/organizations/${orgId}/events/${encodeURIComponent(eventId)}`;

  useEffect(() => {
    let cancelled = false;
    // A reload after a refused publish keeps the page up while it refetches.
    setLoad((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    Promise.all([api.get<EventReadiness>(`${base}/readiness`), api.get<EventOverview>(`${base}/overview`)])
      .then(([readiness, overview]) => !cancelled && setLoad({ status: 'ready', readiness, overview }))
      .catch((err) => !cancelled && setLoad({ status: 'error', message: err?.message || 'Request failed' }));
    return () => {
      cancelled = true;
    };
  }, [base, attempt]);

  useEffect(() => {
    let cancelled = false;
    let expiresAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mint = () => {
      clearTimeout(timer);
      api
        .post<{ url: string; expiresAt: string }>(`${base}/preview-link`, {})
        .then(({ url, expiresAt: at }) => {
          if (cancelled) return;
          expiresAt = new Date(at).getTime();
          setPreview({ status: 'ready', url });
          // Timers stall in background tabs; the focus check below covers that.
          // At least a minute apart, so a skewed clock never turns this into a request loop.
          timer = setTimeout(mint, Math.max(MIN_REFRESH_MS, expiresAt - Date.now() - REFRESH_MARGIN_MS));
        })
        .catch(() => !cancelled && setPreview({ status: 'error' }));
    };
    // Back in the tab with the link (nearly) expired: mint a fresh one first.
    const onFocus = () => {
      if (document.visibilityState === 'visible' && expiresAt && Date.now() > expiresAt - REFRESH_MARGIN_MS) mint();
    };
    setPreview({ status: 'loading' });
    mint();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [base, previewAttempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const reloadPreview = useCallback(() => setPreviewAttempt((n) => n + 1), []);
  return { load, preview, reload, reloadPreview };
}
