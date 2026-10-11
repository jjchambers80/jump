// Save state machine behind useStepSave (spec 050 §11.5), kept free of React
// so the timing rules are unit-tested with fake timers.
//
// - autosave (DRAFT): a valid change is sent `delay` ms after the last one.
// - explicit (PUBLISHED): changes wait for flush() (Next, Save, Save & exit);
//   edits go live, so half-typed copy must never reach the public page.
// - invalid changes are never sent; the indicator says how many fields to fix.
// - a failed save keeps the change; retry() sends it again.

export type SaveStatus = 'idle' | 'dirty' | 'invalid' | 'saving' | 'saved' | 'error';

export interface SaveSnapshot {
  status: SaveStatus;
  /** Fields to fix while `invalid`. */
  invalidCount: number;
  /** The failed save's error while `error`. */
  error: { status?: number; message?: string } | null;
  savedAt: Date | null;
}

export interface StepSaverOptions {
  autosave: boolean;
  delay?: number;
  save: (body: Record<string, unknown>) => Promise<unknown>;
  onChange: (snapshot: SaveSnapshot) => void;
}

export function createStepSaver({ autosave, delay = 800, save, onChange }: StepSaverOptions) {
  let snapshot: SaveSnapshot = { status: 'idle', invalidCount: 0, error: null, savedAt: null };
  let pending: Record<string, unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<boolean> | null = null;

  const set = (patch: Partial<SaveSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    onChange(snapshot);
  };
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  async function run(): Promise<boolean> {
    clearTimer();
    if (inFlight) await inFlight;
    const body = pending;
    if (!body) return snapshot.status !== 'error' && snapshot.status !== 'invalid';
    set({ status: 'saving', error: null });
    inFlight = save(body).then(
      () => {
        // A newer change typed during the save stays pending.
        if (pending === body) {
          pending = null;
          set({ status: 'saved', savedAt: new Date() });
        } else if (autosave) {
          set({ status: 'dirty' });
          timer = setTimeout(() => void run(), delay);
        } else set({ status: 'dirty' });
        return true;
      },
      (error) => {
        set({ status: 'error', error: { status: error?.status, message: error?.message } });
        return false;
      }
    );
    const ok = await inFlight;
    inFlight = null;
    return ok;
  }

  /** Saves until nothing is pending, including changes typed during a save. */
  async function flush(): Promise<boolean> {
    let ok = await run();
    while (ok && pending) ok = await run();
    return ok;
  }

  return {
    get snapshot() {
      return snapshot;
    },
    /** The current step's unsaved body (null = nothing to save) and its error count. */
    change(body: Record<string, unknown> | null, invalidCount = 0) {
      clearTimer();
      if (invalidCount > 0) {
        pending = null;
        set({ status: 'invalid', invalidCount });
        return;
      }
      pending = body;
      if (!body) {
        if (snapshot.status !== 'saving') set({ status: snapshot.savedAt ? 'saved' : 'idle', invalidCount: 0, error: null });
        return;
      }
      set({ status: 'dirty', invalidCount: 0, error: null });
      if (autosave) timer = setTimeout(() => void run(), delay);
    },
    /** Save now. Resolves true when nothing is left unsaved. */
    flush,
    retry: flush,
    /**
     * Unmount. A DRAFT change still waiting for its debounce is sent now
     * (leaving within 800 ms of typing must not lose it); explicit mode keeps
     * nothing to send, a live event saves only when asked.
     */
    dispose() {
      clearTimer();
      if (autosave && pending) void run();
    },
  };
}

export type StepSaver = ReturnType<typeof createStepSaver>;
