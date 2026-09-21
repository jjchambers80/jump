'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { mapsApi } from '@/services/api';
import type { AdminMapDetail, MapBooth, MapElement, MapTier, LayoutBoothInput } from '@/services/api';

export type EditorTool =
  | 'select'
  | 'booth'
  | 'table'
  | 'row'
  | 'marker'
  | 'label'
  | 'wall'
  | 'stage'
  | 'entrance'
  | 'restroom'
  | 'food'
  | 'info'
  | 'firstAid'
  | 'programming';

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

interface Snapshot {
  elements: MapElement[];
  booths: MapBooth[];
}

const MAX_UNDO = 100;
const AUTOSAVE_MS = 2000;

export function useMapEditor(mapId: string) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [state, setState] = useState<EditorState | null>(null);
  const [tiers, setTiers] = useState<MapTier[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [dirty, setDirty] = useState(false);
  const [zoom, setZoom] = useState(1);
  // Mirrors versionRef so the autosave effect re-runs on every edit.
  const [editVersion, setEditVersion] = useState(0);

  // Undo stack
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);

  // Autosave timer
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every edit bumps the version; a save only clears `dirty` when nothing was
  // edited while it was in flight, so no edit is silently dropped.
  const stateRef = useRef<EditorState | null>(null);
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const failedVersionRef = useRef(-1);
  const doSaveRef = useRef<() => Promise<boolean>>(async () => false);
  stateRef.current = state;

  const pushUndo = useCallback((elements: MapElement[], booths: MapBooth[]) => {
    undoStack.current.push({ elements: JSON.parse(JSON.stringify(elements)), booths: JSON.parse(JSON.stringify(booths)) });
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
  }, []);

  // Load map data
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
    return () => { cancelled = true; };
  }, [mapId]);

  // Autosave: 2 s after the last edit, never while a save is in flight, and
  // not again after a failed save until the organizer edits something else.
  useEffect(() => {
    if (!dirty || saving) return;
    if (failedVersionRef.current === versionRef.current) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void doSaveRef.current();
    }, AUTOSAVE_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [dirty, saving, editVersion]);

  // beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const doSave = useCallback(async (): Promise<boolean> => {
    const state = stateRef.current;
    if (!state) return false;
    const version = versionRef.current;
    setSaving(true);
    setSaveError(null);
    try {
      const mapSettings = {
        name: state.name,
        width: state.width,
        height: state.height,
        unit: state.unit,
        gridSize: state.gridSize,
        underlayFileId: state.underlayFileId,
        underlayOpacity: state.underlayOpacity,
      };
      await mapsApi.update(mapId, mapSettings);

      const layoutData = {
        elements: state.elements,
        booths: state.booths.map((b) => ({
          label: b.label,
          kind: b.kind,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          rotation: b.rotation,
          tierId: b.tierId,
        })) as LayoutBoothInput[],
      };
      const saved = await mapsApi.replaceLayout(mapId, layoutData);
      savedVersionRef.current = version;
      if (versionRef.current !== version) return false; // edited meanwhile: keep dirty, save again
      // Adopt the server rows: newly placed booths get their real ids (labels are unique per map).
      const byLabel = new Map(saved.booths.map((b) => [b.label, b]));
      const idMap = new Map<string, string>();
      setState((s) => {
        if (!s) return s;
        const booths = s.booths.map((b) => {
          const row = byLabel.get(b.label);
          if (row && row.id !== b.id) idMap.set(b.id, row.id);
          return row ? { ...b, ...row } : b;
        });
        return { ...s, booths };
      });
      if (idMap.size > 0) {
        setSelectedIds((ids) => new Set([...ids].map((id) => idMap.get(id) ?? id)));
      }
      setDirty(false);
      return true;
    } catch (err: any) {
      failedVersionRef.current = versionRef.current;
      const message = String(err?.message || '');
      if (err?.code === 'BOOTH_IN_USE' || /BOOTH_IN_USE/.test(message)) {
        // Re-fetch to get the server state back
        setSaveError(message || 'Some booths are in use and cannot be removed');
        try {
          const fresh = await mapsApi.get(mapId);
          setState((s) =>
            s
              ? {
                  ...s,
                  booths: fresh.booths,
                  elements: fresh.layout?.elements || [],
                }
              : null
          );
        } catch { /* ignore */ }
      } else {
        setSaveError(message || 'Save failed');
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [mapId]);
  doSaveRef.current = doSave;

  // Derived from setBooths/setElements to update dirty state
  const updateBooths = useCallback(
    (booths: MapBooth[], recordUndo = true) => {
      if (!state) return;
      if (recordUndo) pushUndo(state.elements, state.booths);
      setState((s) => (s ? { ...s, booths } : null));
      versionRef.current += 1;
      setEditVersion(versionRef.current);
      setDirty(true);
    },
    [state, pushUndo]
  );

  const updateElements = useCallback(
    (elements: MapElement[], recordUndo = true) => {
      if (!state) return;
      if (recordUndo) pushUndo(state.elements, state.booths);
      setState((s) => (s ? { ...s, elements } : null));
      versionRef.current += 1;
      setEditVersion(versionRef.current);
      setDirty(true);
    },
    [state, pushUndo]
  );

  const updateState = useCallback(
    (patch: Partial<EditorState>) => {
      if (!state) return;
      setState((s) => (s ? { ...s, ...patch } : null));
      versionRef.current += 1;
      setEditVersion(versionRef.current);
      setDirty(true);
    },
    [state]
  );

  const undo = useCallback(() => {
    if (!state || undoStack.current.length === 0) return;
    const current = { elements: state.elements, booths: state.booths };
    redoStack.current.push(current);
    const prev = undoStack.current.pop()!;
    setState((s) => (s ? { ...s, elements: prev.elements, booths: prev.booths } : null));
    versionRef.current += 1;
    setEditVersion(versionRef.current);
    setDirty(true);
  }, [state]);

  const redo = useCallback(() => {
    if (!state || redoStack.current.length === 0) return;
    const current = { elements: state.elements, booths: state.booths };
    undoStack.current.push(current);
    const next = redoStack.current.pop()!;
    setState((s) => (s ? { ...s, elements: next.elements, booths: next.booths } : null));
    versionRef.current += 1;
    setEditVersion(versionRef.current);
    setDirty(true);
  }, [state]);

  const publish = useCallback(async () => {
    if (!stateRef.current) return false;
    // Publish what the server has: a failed save must not publish stale booths.
    // An edit that lands during the save makes doSave report false; one more
    // pass catches it, anything beyond that is the organizer still editing.
    let saved = await doSave();
    if (!saved && failedVersionRef.current !== versionRef.current) saved = await doSave();
    if (!saved) throw new Error('Save the map before publishing');
    const result = await mapsApi.publish(mapId);
    setState((s) =>
      s ? { ...s, status: 'PUBLISHED' as const, booths: result.booths ?? s.booths } : null
    );
    setTiers(result.tiers ?? []);
    return true;
  }, [mapId, doSave]);

  const unpublish = useCallback(async () => {
    await mapsApi.unpublish(mapId);
    setState((s) => (s ? { ...s, status: 'DRAFT' as const } : null));
    return true;
  }, [mapId]);

  const addBooth = useCallback(
    (booth: MapBooth) => {
      if (!state) return;
      pushUndo(state.elements, state.booths);
      setState((s) => (s ? { ...s, booths: [...s.booths, booth] } : null));
      versionRef.current += 1;
      setEditVersion(versionRef.current);
      setDirty(true);
    },
    [state, pushUndo]
  );

  const removeSelected = useCallback(() => {
    if (!state) return;
    pushUndo(state.elements, state.booths);
    const newBooths = state.booths.filter((b) => !selectedIds.has(b.id));
    const newElements = state.elements.filter((e) => !selectedIds.has(e.id));
    setState({ ...state, booths: newBooths, elements: newElements });
    setSelectedIds(new Set());
    versionRef.current += 1;
    setEditVersion(versionRef.current);
    setDirty(true);
  }, [state, selectedIds, pushUndo]);

  const duplicateSelected = useCallback(() => {
    if (!state || selectedIds.size === 0) return;
    pushUndo(state.elements, state.booths);
    const selectedBooths = state.booths.filter((b) => selectedIds.has(b.id));
    const existingLabels = state.booths.map((b) => b.label);
    const maxLabelNum = Math.max(
      ...state.booths
        .map((b) => parseInt(b.label.match(/\d+/)?.[0] || '0', 10))
        .filter((n) => !isNaN(n)),
      0
    );
    const newBooths = selectedBooths.map((b, i) => ({
      ...JSON.parse(JSON.stringify(b)),
      id: `${Date.now()}_${i}`,
      x: b.x + b.w + 2,
      y: b.y + 2,
      label: `${b.label.replace(/\d+/g, '')}${maxLabelNum + 1 + i}`,
    }));
    setState({ ...state, booths: [...state.booths, ...newBooths] });
    versionRef.current += 1;
    setEditVersion(versionRef.current);
    setDirty(true);
  }, [state, selectedIds, pushUndo]);

  return {
    state,
    tiers,
    loading,
    error,
    saving,
    saveError,
    dirty,
    selectedIds,
    activeTool,
    zoom,
    setSelectedIds,
    setActiveTool,
    setZoom,
    updateState,
    updateBooths,
    updateElements,
    addBooth,
    removeSelected,
    duplicateSelected,
    undo,
    redo,
    doSave,
    publish,
    unpublish,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}