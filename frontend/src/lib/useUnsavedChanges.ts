'use client';

// Warn before the tab closes with unsaved edits, and expose a guard for
// in-app navigation (Next's App Router has no route-change event, so links
// that leave an edit page call `confirmLeave()` first).

import { useCallback, useEffect } from 'react';

export function useUnsavedChanges(dirty: boolean, message = 'You have unsaved changes. Leave without saving?') {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  return useCallback(() => (dirty ? window.confirm(message) : true), [dirty, message]);
}
