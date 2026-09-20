'use client';

// Step-up ("Confirm it's you") for security mutations (spec 030 B).
//
// `withReauth(fn)` runs fn; when the backend answers 401 REAUTH_REQUIRED it
// opens ReauthDialog, stores the proof in the api client (X-Jump-Reauth)
// and retries once. The proof lives in memory only and expires server-side
// after 10 minutes.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { setReauthToken } from '@/services/api';
import ReauthDialog from './ReauthDialog';

interface ReauthContextValue {
  withReauth: <T>(fn: () => Promise<T>) => Promise<T>;
}

const ReauthContext = createContext<ReauthContextValue | null>(null);

class ReauthCancelled extends Error {
  constructor() {
    super('Verification cancelled');
    this.name = 'ReauthCancelled';
  }
}

export function isReauthCancelled(error: unknown): boolean {
  return error instanceof ReauthCancelled;
}

export function ReauthProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  const requestProof = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        setOpen(true);
      }),
    []
  );

  const withReauth = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (error: any) {
        if (error?.status !== 401 || error?.code !== 'REAUTH_REQUIRED') throw error;
        await requestProof();
        return fn();
      }
    },
    [requestProof]
  );

  const value = useMemo(() => ({ withReauth }), [withReauth]);

  return (
    <ReauthContext.Provider value={value}>
      {children}
      {open && (
        <ReauthDialog
          onVerified={(token) => {
            setReauthToken(token);
            setOpen(false);
            pending.current?.resolve();
            pending.current = null;
          }}
          onCancel={() => {
            setOpen(false);
            pending.current?.reject(new ReauthCancelled());
            pending.current = null;
          }}
        />
      )}
    </ReauthContext.Provider>
  );
}

export function useReauth(): ReauthContextValue {
  const ctx = useContext(ReauthContext);
  if (!ctx) throw new Error('useReauth must be used inside ReauthProvider');
  return ctx;
}
