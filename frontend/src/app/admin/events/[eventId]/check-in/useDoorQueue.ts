'use client';

// Door check-in queue (spec 036)
//
// Offline-hostile-environments lens. Staff work a loading dock on venue wifi:
// a tap can hang for twenty seconds, fail, and succeed on the third try. The
// queue makes that survivable without ever risking a second arrival record —
// the backend's check-in is idempotent (a conditional update on
// `checkedInAt IS NULL`), so a blind retry is always safe and always returns
// the first stamp.
//
// What the queue guarantees:
//   - one in-flight request per vendor, so a double-tap cannot stack
//   - automatic retry with backoff, and an immediate retry when the browser
//     reports it is back online
//   - a per-vendor state staff can read at arm's length, so nobody is left
//     wondering whether a check-in landed

import { useCallback, useEffect, useRef, useState } from 'react';
import { checkInApi, type DoorVendor } from '@/services/api';

export type DoorState =
  | { kind: 'idle' }
  | { kind: 'sending'; attempt: number }
  | { kind: 'failed'; message: string };

/** Backoff between retries; the last value repeats until it succeeds or staff give up. */
const BACKOFF_MS = [1000, 3000, 8000];
const MAX_ATTEMPTS = 4;

export interface DoorQueue {
  /** Per-vendor request state, keyed by application id. */
  states: Record<string, DoorState>;
  /** Check a vendor in. Safe to call repeatedly — extra calls while in flight are dropped. */
  enqueue: (applicationId: string, via?: 'SEARCH' | 'SCAN') => void;
  /** Undo a mis-scan. Not retried automatically: staff are standing there and can tap again. */
  undo: (applicationId: string) => void;
  /** Vendors whose last attempt failed and is still waiting to go out. */
  pendingCount: number;
  online: boolean;
}

export function useDoorQueue(
  eventId: string,
  onVendor: (vendor: DoorVendor) => void,
  onError?: (message: string) => void
): DoorQueue {
  const [states, setStates] = useState<Record<string, DoorState>>({});
  const [online, setOnline] = useState(true);
  // Refs, not state: the retry loop must see the latest values without
  // re-subscribing, and an in-flight marker must update synchronously so two
  // taps in the same tick cannot both pass the check.
  const inFlight = useRef<Set<string>>(new Set());
  const waiting = useRef<Map<string, { via: 'SEARCH' | 'SCAN'; attempt: number; timer: ReturnType<typeof setTimeout> | null }>>(new Map());
  const onVendorRef = useRef(onVendor);
  const onErrorRef = useRef(onError);
  onVendorRef.current = onVendor;
  onErrorRef.current = onError;

  const setState = useCallback((id: string, state: DoorState) => {
    setStates((prev) => ({ ...prev, [id]: state }));
  }, []);

  const send = useCallback(
    async (applicationId: string, via: 'SEARCH' | 'SCAN', attempt: number) => {
      if (inFlight.current.has(applicationId)) return;
      inFlight.current.add(applicationId);
      setState(applicationId, { kind: 'sending', attempt });
      try {
        const result = await checkInApi.checkIn(eventId, applicationId, via);
        waiting.current.delete(applicationId);
        setState(applicationId, { kind: 'idle' });
        // `alreadyCheckedIn` is not an error: it is the same answer the first
        // attempt would have given, which is exactly why retrying is safe.
        onVendorRef.current(result.vendor);
      } catch (err: any) {
        const status = err?.status ?? err?.details?.status;
        // 404 / 409 are verdicts, not transport failures — retrying cannot
        // change them, so surface them and stop.
        const permanent = status === 404 || status === 409 || status === 400 || status === 403;
        const message = err?.message || 'Check-in did not send';
        if (permanent || attempt >= MAX_ATTEMPTS) {
          waiting.current.delete(applicationId);
          setState(applicationId, { kind: 'failed', message });
          onErrorRef.current?.(message);
        } else {
          const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
          const timer = setTimeout(() => {
            const entry = waiting.current.get(applicationId);
            if (entry) void send(applicationId, entry.via, entry.attempt + 1);
          }, delay);
          waiting.current.set(applicationId, { via, attempt, timer });
          setState(applicationId, { kind: 'failed', message: 'Not sent — retrying' });
        }
      } finally {
        inFlight.current.delete(applicationId);
      }
    },
    [eventId, setState]
  );

  const enqueue = useCallback(
    (applicationId: string, via: 'SEARCH' | 'SCAN' = 'SEARCH') => {
      const pending = waiting.current.get(applicationId);
      if (pending?.timer) clearTimeout(pending.timer);
      waiting.current.set(applicationId, { via, attempt: 1, timer: null });
      void send(applicationId, via, 1);
    },
    [send]
  );

  const undo = useCallback(
    async (applicationId: string) => {
      const pending = waiting.current.get(applicationId);
      if (pending?.timer) clearTimeout(pending.timer);
      waiting.current.delete(applicationId);
      if (inFlight.current.has(applicationId)) return;
      inFlight.current.add(applicationId);
      setState(applicationId, { kind: 'sending', attempt: 1 });
      try {
        const result = await checkInApi.undo(eventId, applicationId);
        setState(applicationId, { kind: 'idle' });
        onVendorRef.current(result.vendor);
      } catch (err: any) {
        const message = err?.message || 'Undo did not send';
        setState(applicationId, { kind: 'failed', message });
        onErrorRef.current?.(message);
      } finally {
        inFlight.current.delete(applicationId);
      }
    },
    [eventId, setState]
  );

  // Coming back online is the moment a queued check-in is most likely to
  // succeed, so flush immediately instead of waiting out the backoff.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOnline(navigator.onLine);
    const flush = () => {
      setOnline(true);
      for (const [id, entry] of waiting.current.entries()) {
        if (entry.timer) clearTimeout(entry.timer);
        waiting.current.set(id, { ...entry, timer: null });
        void send(id, entry.via, entry.attempt);
      }
    };
    const drop = () => setOnline(false);
    window.addEventListener('online', flush);
    window.addEventListener('offline', drop);
    return () => {
      window.removeEventListener('online', flush);
      window.removeEventListener('offline', drop);
    };
  }, [send]);

  // Clear any outstanding timers when the door page unmounts.
  useEffect(() => {
    const timers = waiting.current;
    return () => {
      for (const entry of timers.values()) if (entry.timer) clearTimeout(entry.timer);
      timers.clear();
    };
  }, []);

  const pendingCount = Object.values(states).filter((s) => s.kind === 'failed' || s.kind === 'sending').length;
  return { states, enqueue, undo, pendingCount, online };
}
