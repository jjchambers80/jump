'use client';

// The event's application forms for the wizard context (spec 050 §5.1 ctx.forms):
// step visibility (floor map on a MAP form), the application steps and their
// progress all read this one list. Loads once the row exists; `reload` after
// any form save.

import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import type { AdminForm } from '@/lib/applications';
import type { LoadState } from './useSetupData';

export function useSetupForms(eventId: string | null) {
  const [forms, setForms] = useState<AdminForm[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    api
      .get<{ data: AdminForm[] }>(`/admin/events/${encodeURIComponent(eventId)}/application-forms`)
      .then((res) => {
        if (cancelled) return;
        setForms(res.data);
        setLoad({ status: 'ready' });
      })
      .catch((err) => {
        if (!cancelled) setLoad({ status: 'error', code: err?.status ?? 0, message: err?.message || 'Request failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  /** Retry after a failed load shows the skeleton again. */
  const retry = useCallback(() => {
    setLoad({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return { forms, load, reload, retry };
}

export type SetupForms = ReturnType<typeof useSetupForms>;
