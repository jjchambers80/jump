'use client';

// Browser Back while a change cannot be saved silently (spec 050 §11.5): a
// live event's pending edits, or a failed or invalid save. `beforeunload`
// (useUnsavedChanges) covers closing the tab; this covers history, which in
// the App Router is a soft navigation with no unload event.
//
// While armed, a guard entry with the same URL sits on top of history. Back
// lands on the real entry under it (same URL, so the router shows the same
// page), and we ask: stay → forward onto the guard again; leave → back again.
// A DRAFT's ordinary pending change needs no guard: unmount flushes it.

import { useEffect } from 'react';

const GUARD = '__jumpSetupGuard';

export function useHistoryGuard(armed: boolean, message: string) {
  useEffect(() => {
    if (!armed) return;
    if (!(window.history.state as Record<string, unknown> | null)?.[GUARD]) {
      window.history.pushState({ ...(window.history.state ?? {}), [GUARD]: true }, '', window.location.href);
    }
    const guardedHref = window.location.href;
    let leaving = false;
    const onPopState = (event: PopStateEvent) => {
      // Only the step from the guard onto the entry under it asks; moving
      // between wizard steps keeps every field, so it never does.
      const onGuard = (event.state as Record<string, unknown> | null)?.[GUARD];
      if (leaving || onGuard || window.location.href !== guardedHref) return;
      if (window.confirm(message)) {
        leaving = true;
        window.history.back();
      } else {
        window.history.forward();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [armed, message]);
}
