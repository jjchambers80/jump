'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { mapsApi } from '@/services/api';
import type { MapBooth, MapElement, MapTier, LayoutBoothInput } from '@/services/api';

export interface EditorState {
  elements: MapElement[];
  booths: MapBooth[];
  name: string;
  width: number;
  height: number;
  unit: string;
  gridSize: number;
  underlayFileId: string | null;
  underlayOpacity: number;
  status: 'DRAFT' | 'PUBLISHED';
  eventId: string;
}

export interface Layout {
  elements: MapElement[];
  booths: MapBooth[];
}

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

const MAX_UNDO = 100;
const AUTOSAVE_MS = 1200;

let tempCounter = 0;
/** Client id for an item not yet saved; the server assigns booth ids by label on save. */
export function tempId(prefix: string): string {
  tempCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${tempCounter}`;
}

/**
 * Builder state for one floor map: layout + settings, undo/redo, and a
 * debounced autosave that always writes the *latest* state (read through a
 * ref, so edits made while a save is in flight are saved next, never lost).
 */
export function useMapEditor(mapId: string) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<EditorState | null>(null);
  const [tiers, setTiers] = useState<MapTier[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });

  const stateRef = useRef<EditorState | null>(null);
  stateRef.current = state;
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const saving = useRef(false);
  const undoStack = useRef<Layout[]>([]);
  const redoStack = useRef<Layout[]>([]);
  const [revisionTick, setRevisionTick] = useState(0);
  const [retryTick, setRetryTick] = useState(0);

  const syncHistory = () =>
    setHistorySize({ undo: undoStack.current.length, redo: redoStack.current.length });

  const markChanged = useCallback(() => {
    revision.current += 1;
    setRevisionTick(revision.current);
    setSaveStatus('dirty');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    mapsApi
      .get(mapId)
      .then((data) => {
        if (cancelled) return;
        setState({
          elements: data.layout?.elements || [],
          booths: data.booths || [],
          name: data.name,
          width: data.width,
          height: data.height,
          unit: data.unit,
          gridSize: data.gridSize,
          underlayFileId: data.underlayFileId,
          underlayOpacity: data.underlayOpacity,
          status: data.status,
          eventId: data.eventId,
        });
        setTiers(data.tiers || []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Failed to load map');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  const save = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    if (!current || saving.current) return false;
    const rev = revision.current;
    saving.current = true;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await mapsApi.update(mapId, {
        name: current.name,
        width: current.width,
        height: current.height,
        unit: current.unit,
        gridSize: current.gridSize,
        underlayFileId: current.underlayFileId,
        underlayOpacity: current.underlayOpacity,
      });
      const full = await mapsApi.replaceLayout(mapId, {
        elements: current.elements,
        booths: current.booths.map((b) => ({
          label: b.label,
          kind: b.kind,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          rotation: b.rotation,
          tierId: b.tierId,
        })) as LayoutBoothInput[],
      });
      // The server keys booths by label: adopt its ids and states so the
      // assignment panel talks about real booths, keep local geometry.
      const serverBooths: MapBooth[] = Array.isArray(full?.booths) ? full.booths : [];
      if (serverBooths.length > 0 && stateRef.current) {
        const byLabel = new Map(serverBooths.map((b) => [b.label, b]));
        const idMap = new Map<string, string>();
        for (const b of stateRef.current.booths) {
          const srv = byLabel.get(b.label);
          if (srv && srv.id !== b.id) idMap.set(b.id, srv.id);
        }
        setState((s) => {
          if (!s) return s;
          const booths = s.booths.map((b) => {
            const srv = byLabel.get(b.label);
            if (!srv) return b;
            return { ...b, id: srv.id, mapId: srv.mapId, status: srv.status, applicationId: srv.applicationId };
          });
          return { ...s, booths };
        });
        if (idMap.size > 0) {
          setSelectedIds((sel) => new Set([...sel].map((id) => idMap.get(id) ?? id)));
          const remap = (layouts: Layout[]) =>
            layouts.forEach((l) => {
              l.booths = l.booths.map((b) => (idMap.has(b.id) ? { ...b, id: idMap.get(b.id)! } : b));
            });
          remap(undoStack.current);
          remap(redoStack.current);
        }
      }
      savedRevision.current = rev;
      setSaveStatus(revision.current === rev ? 'saved' : 'dirty');
      return true;
    } catch (err: any) {
      const message: string = err?.message || 'Could not save';
      if (/BOOTH_IN_USE/.test(message) || err?.code === 'BOOTH_IN_USE') {
        setSaveError(
          'A booth that is sold, held or reserved can’t be removed. It has been put back — unassign it first.'
        );
        try {
          const fresh = await mapsApi.get(mapId);
          setState((s) => (s ? { ...s, booths: fresh.booths, elements: fresh.layout?.elements || [] } : s));
          savedRevision.current = revision.current;
          setSaveStatus('saved');
          return false;
        } catch {
          /* fall through to error */
        }
      } else {
        setSaveError(message);
      }
      setSaveStatus('error');
      return false;
    } finally {
      saving.current = false;
      // Edits made while this save was in flight: go again.
      if (revision.current !== savedRevision.current) setRetryTick((n) => n + 1);
    }
  }, [mapId]);

  // Debounced autosave; re-arms after a save that finished with newer edits pending.
  useEffect(() => {
    if (saveStatus !== 'dirty') return;
    const t = setTimeout(() => {
      if (revision.current !== savedRevision.current) void save();
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [revisionTick, retryTick, saveStatus, save]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (revision.current !== savedRevision.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  /** Snapshot the current layout onto the undo stack (once per user action or drag). */
  const checkpoint = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    undoStack.current.push({ elements: s.elements, booths: s.booths });
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
    syncHistory();
  }, []);

  /**
   * Change the layout. `history: false` is for the in-between steps of a drag
   * (call `checkpoint()` once when the drag starts).
   */
  const commit = useCallback(
    (mutate: (layout: Layout) => Layout, opts: { history?: boolean } = {}) => {
      if (!stateRef.current) return;
      if (opts.history !== false) checkpoint();
      setState((s) => {
        if (!s) return s;
        const next = mutate({ elements: s.elements, booths: s.booths });
        const updated = { ...s, elements: next.elements, booths: next.booths };
        stateRef.current = updated;
        return updated;
      });
      markChanged();
    },
    [checkpoint, markChanged]
  );

  const updateSettings = useCallback(
    (patch: Partial<Pick<EditorState, 'name' | 'width' | 'height' | 'unit' | 'gridSize' | 'underlayOpacity'>>) => {
      setState((s) => {
        if (!s) return s;
        const updated = { ...s, ...patch };
        stateRef.current = updated;
        return updated;
      });
      markChanged();
    },
    [markChanged]
  );

  /**
   * Pull booth sale state from the server (after assign / status / move calls).
   * Only status and holder change; local geometry and unsaved edits stay.
   */
  const refreshBooths = useCallback(async () => {
    const fresh = await mapsApi.get(mapId);
    const byId = new Map(fresh.booths.map((b) => [b.id, b]));
    setState((s) =>
      s
        ? {
            ...s,
            status: fresh.status,
            booths: s.booths.map((b) => {
              const srv = byId.get(b.id);
              return srv
                ? { ...b, status: srv.status, applicationId: srv.applicationId, assignedById: srv.assignedById, holder: srv.holder }
                : b;
            }),
          }
        : s
    );
    return fresh;
  }, [mapId]);

  const restore = (from: Layout[], to: Layout[]) => {
    const s = stateRef.current;
    if (!s || from.length === 0) return;
    to.push({ elements: s.elements, booths: s.booths });
    const layout = from.pop()!;
    setState((prev) => (prev ? { ...prev, elements: layout.elements, booths: layout.booths } : prev));
    const ids = new Set([...layout.booths.map((b) => b.id), ...layout.elements.map((e) => e.id)]);
    setSelectedIds((sel) => new Set([...sel].filter((id) => ids.has(id))));
    syncHistory();
    markChanged();
  };

  const undo = useCallback(() => restore(undoStack.current, redoStack.current), [markChanged]); // eslint-disable-line react-hooks/exhaustive-deps
  const redo = useCallback(() => restore(redoStack.current, undoStack.current), [markChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  const publish = useCallback(async () => {
    if (revision.current !== savedRevision.current) {
      const ok = await save();
      if (!ok) throw new Error('Save your changes before publishing');
    }
    await mapsApi.publish(mapId);
    setState((s) => (s ? { ...s, status: 'PUBLISHED' as const } : s));
    await refreshBooths().catch(() => undefined);
  }, [mapId, save, refreshBooths]);

  const unpublish = useCallback(async () => {
    await mapsApi.unpublish(mapId);
    setState((s) => (s ? { ...s, status: 'DRAFT' as const } : s));
  }, [mapId]);

  return {
    state,
    tiers,
    loading,
    error,
    saveStatus,
    saveError,
    selectedIds,
    setSelectedIds,
    commit,
    checkpoint,
    updateSettings,
    refreshBooths,
    undo,
    redo,
    canUndo: historySize.undo > 0,
    canRedo: historySize.redo > 0,
    save,
    publish,
    unpublish,
  };
}
