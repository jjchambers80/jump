'use client';

// Client fetch for public storefront content (blog listing / post / page).
// services/api.ts attaches any stored X-Storefront-Access tokens, so a
// private store's visitor sees the password gate and refetches after unlock.

import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import { storefrontLockFrom, type StorefrontLock } from '@/lib/storefrontAccess';

export interface StorefrontContentState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  lock: StorefrontLock | null;
  retry: () => void;
}

export function useStorefrontContent<T>(path: string): StorefrontContentState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [lock, setLock] = useState<StorefrontLock | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setLock(null);
    api
      .get<T>(path)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: any) => {
        if (cancelled) return;
        const locked = storefrontLockFrom(err);
        if (locked) setLock(locked);
        else if (err?.status === 404) setNotFound(true);
        else setError(err?.message || 'Something went wrong');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, loading, error, notFound, lock, retry };
}
