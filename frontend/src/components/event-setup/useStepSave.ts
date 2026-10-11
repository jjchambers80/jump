'use client';

// React face of createStepSaver (spec 050 §11.5): autosave on DRAFT, explicit
// save on PUBLISHED, retry, and the indicator state. The step's body is pushed
// with `change` whenever the form changes; `flush` runs on Next / Back / Save.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createStepSaver, type SaveSnapshot } from './stepSaver';

export function useStepSave({
  autosave,
  body,
  invalidCount,
  save,
  delay,
}: {
  autosave: boolean;
  /** The current step's unsaved PATCH body, or null when it matches the server. */
  body: Record<string, unknown> | null;
  invalidCount: number;
  save: (body: Record<string, unknown>) => Promise<unknown>;
  delay?: number;
}) {
  const [snapshot, setSnapshot] = useState<SaveSnapshot>({ status: 'idle', invalidCount: 0, error: null, savedAt: null });
  const saveRef = useRef(save);
  saveRef.current = save;

  const saver = useMemo(
    () => createStepSaver({ autosave, delay, save: (b) => saveRef.current(b), onChange: setSnapshot }),
    [autosave, delay]
  );
  useEffect(() => () => saver.dispose(), [saver]);

  const key = body ? JSON.stringify(body) : '';
  useEffect(() => {
    saver.change(body, invalidCount);
    // `key` is the body's identity; the object itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saver, key, invalidCount]);

  return { ...snapshot, flush: saver.flush, retry: saver.retry };
}
