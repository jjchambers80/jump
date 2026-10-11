'use client';

// Leaving the map builder (Back, and Done when opened from the setup wizard,
// spec 050-M): wait for an autosave in flight, save what is still unsaved,
// then navigate. A failed save keeps the organizer here (the save error banner
// says why) instead of dropping their edits.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SaveStatus } from './useMapEditor';

export function useLeaveAfterSave(saveStatus: SaveStatus, save: () => Promise<boolean>, go: (href: string) => void) {
  const [target, setTarget] = useState<string | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (!target || saveStatus === 'saving') return;
    if (saveStatus === 'saved') return go(target);
    if (saveStatus === 'error' && tried.current) return setTarget(null);
    tried.current = true;
    void save();
  }, [target, saveStatus, save, go]);

  const leave = useCallback((href: string) => {
    tried.current = false;
    setTarget(href);
  }, []);

  return { leaving: target !== null, leave };
}
