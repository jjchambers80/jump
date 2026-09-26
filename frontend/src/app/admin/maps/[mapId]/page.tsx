'use client';

import React, { useState, useCallback, Suspense, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft,
  AlertTriangle,
  Loader2,
  ExternalLink,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  CircleHelp,
  Eye,
  EyeOff,
  Check,
  CloudOff,
  LayoutGrid,
  Square,
} from 'lucide-react';
import { mapsApi } from '@/services/api';
import type { MapBooth, MapElement } from '@/services/api';
import { formatPrice } from '@/lib/fees';
import { useMapEditor, tempId, type Layout, type SaveStatus } from '@/components/maps/useMapEditor';
import EditorCanvas, { type EditorCanvasHandle } from '@/components/maps/builder/EditorCanvas';
import AddPalette from '@/components/maps/builder/AddPalette';
import InspectorPanel from '@/components/maps/builder/InspectorPanel';
import BoothBlockDialog from '@/components/maps/builder/BoothBlockDialog';
import BuilderDialog, { dialogButton } from '@/components/maps/builder/BuilderDialog';
import {
  CATALOG_BY_KIND,
  defaultSize,
  isBoothKind,
  unitLabel,
  type CatalogKind,
} from '@/components/maps/builder/catalog';
import {
  boothBlock,
  boothBlockSize,
  boothFootprint,
  clampGroupDelta,
  clampToFloor,
  elementFootprint,
  findFreeSpot,
  MAX_ITEM_SIZE,
  nextBoothLabel,
  occupiedExtent,
  type BoothBlockOptions,
  type Box,
} from '@/components/maps/builder/placement';

// Booths a vendor holds (or is holding) can't be deleted — MapService.replaceLayout 409s.
const LOCKED_STATUSES = new Set(['SOLD', 'HELD', 'RESERVED']);

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}

function labelPrefix(label: string): string {
  return label.match(/^(.*?)(\d+)$/)?.[1] ?? '';
}

function BuilderContent() {
  const params = useParams();
  const router = useRouter();
  const mapId = params.mapId as string;
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const {
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
    canUndo,
    canRedo,
    save,
    publish,
    unpublish,
  } = useMapEditor(mapId);

  const canvasRef = useRef<EditorCanvasHandle>(null);
  const [zoom, setZoom] = useState(1);
  const [moveMode, setMoveMode] = useState<string | null>(null);
  const [blockAt, setBlockAt] = useState<{ x: number; y: number } | null | undefined>(undefined);
  const [showPublish, setShowPublish] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const announce = useCallback((message: string) => {
    // Clear first so repeating the same sentence is still read out.
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  const flash = useCallback((ids: string[]) => {
    setFlashIds(new Set(ids));
    window.setTimeout(() => setFlashIds(new Set()), 950);
  }, []);

  const tierSwatches = useMemo(
    () => Object.fromEntries(tiers.map((t, i) => [t.id, i % 6])) as Record<string, number>,
    [tiers]
  );

  const extent = useMemo(
    () =>
      state
        ? occupiedExtent(state.booths.map(boothFootprint), state.elements.map(elementFootprint))
        : { w: 1, h: 1 },
    [state]
  );

  const takenBoxes = useCallback(
    (layout: Layout, except: Set<string> = new Set()): Box[] => [
      ...layout.booths.filter((b) => !except.has(b.id)).map(boothFootprint),
      ...layout.elements
        .filter((e) => !except.has(e.id) && e.kind !== 'label' && e.kind !== 'wall')
        .map(elementFootprint),
    ],
    []
  );

  // ─── Adding things ───────────────────────────────────────────────

  const addItem = useCallback(
    (kind: CatalogKind, at?: { x: number; y: number }) => {
      if (!state) return;
      if (kind === 'BLOCK') {
        setBlockAt(at ?? null);
        return;
      }
      const center = at ?? canvasRef.current?.viewCenter() ?? { x: state.width / 2, y: state.height / 2 };
      const size = defaultSize(kind, state.unit);
      const box = clampToFloor(
        { x: Math.round(center.x - size.w / 2), y: Math.round(center.y - size.h / 2), ...size },
        state.width,
        state.height
      );
      const layout = { booths: state.booths, elements: state.elements };
      const spot = findFreeSpot(box.x, box.y, box.w, box.h, takenBoxes(layout), state.width, state.height);
      let id: string;
      let spoken: string;
      if (isBoothKind(kind)) {
        const last = state.booths[state.booths.length - 1];
        const label = nextBoothLabel(
          state.booths.map((b) => b.label),
          last ? labelPrefix(last.label) : ''
        );
        id = tempId('new-booth');
        const booth: MapBooth = {
          id,
          mapId,
          label,
          kind,
          x: spot.x,
          y: spot.y,
          w: box.w,
          h: box.h,
          rotation: 0,
          tierId: tiers.length === 1 ? tiers[0].id : null,
          status: 'AVAILABLE',
          applicationId: null,
          assignedById: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        commit((l) => ({ ...l, booths: [...l.booths, booth] }));
        spoken = `Added ${kind === 'TABLE' ? 'table' : 'booth'} ${label}`;
      } else {
        id = tempId('el');
        const element: MapElement = {
          id,
          kind: kind as MapElement['kind'],
          x: spot.x,
          y: spot.y,
          w: box.w,
          h: box.h,
          ...(kind === 'label' ? { text: 'Area name', size: 'M' as const } : {}),
          ...(kind === 'wall' ? { orientation: 'h' as const } : {}),
        };
        commit((l) => ({ ...l, elements: [...l.elements, element] }));
        spoken = `Added ${CATALOG_BY_KIND[kind].name.toLowerCase()}`;
      }
      setSelectedIds(new Set([id]));
      flash([id]);
      canvasRef.current?.reveal({ x: spot.x, y: spot.y, w: box.w, h: box.h });
      announce(`${spoken}. Drag it into place, or use the arrow keys.`);
    },
    [state, mapId, tiers, commit, setSelectedIds, flash, announce, takenBoxes]
  );

  const addBlock = useCallback(
    (opts: BoothBlockOptions) => {
      if (!state) return;
      const size = boothBlockSize(opts);
      const center = blockAt ?? canvasRef.current?.viewCenter() ?? { x: state.width / 2, y: state.height / 2 };
      const box = clampToFloor(
        { x: Math.round(center.x - size.w / 2), y: Math.round(center.y - size.h / 2), ...size },
        state.width,
        state.height
      );
      const layout = { booths: state.booths, elements: state.elements };
      const spot = findFreeSpot(box.x, box.y, box.w, box.h, takenBoxes(layout), state.width, state.height);
      const now = new Date().toISOString();
      const created: MapBooth[] = boothBlock(spot.x, spot.y, opts).map((c) => ({
        id: tempId('new-booth'),
        mapId,
        label: c.label,
        kind: 'BOOTH',
        x: c.x,
        y: c.y,
        w: opts.boothW,
        h: opts.boothH,
        rotation: 0,
        tierId: tiers.length === 1 ? tiers[0].id : null,
        status: 'AVAILABLE',
        applicationId: null,
        assignedById: null,
        createdAt: now,
        updatedAt: now,
      }));
      commit((l) => ({ ...l, booths: [...l.booths, ...created] }));
      const ids = created.map((b) => b.id);
      setSelectedIds(new Set(ids));
      flash(ids);
      setBlockAt(undefined);
      canvasRef.current?.reveal({ x: spot.x, y: spot.y, w: size.w, h: size.h });
      announce(
        `Added ${created.length} booths, ${created[0]?.label} to ${created[created.length - 1]?.label}. They are selected — pick a price tier for all of them on the right.`
      );
    },
    [state, blockAt, mapId, tiers, commit, setSelectedIds, flash, announce, takenBoxes]
  );

  // ─── Changing the selection ──────────────────────────────────────

  const turnSelected = useCallback(() => {
    if (!state || selectedIds.size === 0) return;
    const W = state.width;
    const H = state.height;
    commit((l) => ({
      booths: l.booths.map((b) => {
        if (!selectedIds.has(b.id)) return b;
        if (b.rotation === 90) return { ...b, rotation: 0 };
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const box = clampToFloor({ x: Math.round(cx - b.h / 2), y: Math.round(cy - b.w / 2), w: b.h, h: b.w }, W, H);
        return { ...b, ...box, rotation: 0 };
      }),
      elements: l.elements.map((e) => {
        if (!selectedIds.has(e.id) || e.kind === 'label') return e;
        if (e.kind === 'wall') {
          const vertical = e.orientation === 'v';
          const length = vertical ? e.h : e.w;
          const next = vertical
            ? { orientation: 'h' as const, w: Math.min(length, W - e.x), h: 1 }
            : { orientation: 'v' as const, w: 1, h: Math.min(length, H - e.y) };
          return { ...e, ...next };
        }
        const box = clampToFloor({ x: e.x, y: e.y, w: e.h, h: e.w }, W, H);
        return { ...e, ...box };
      }),
    }));
    announce('Turned 90 degrees');
  }, [state, selectedIds, commit, announce]);

  const duplicateSelected = useCallback(() => {
    if (!state || selectedIds.size === 0) return;
    const labels = state.booths.map((b) => b.label);
    const selBooths = state.booths.filter((b) => selectedIds.has(b.id));
    const selEls = state.elements.filter((e) => selectedIds.has(e.id));
    const boxes = [...selBooths.map(boothFootprint), ...selEls.map(elementFootprint)];
    const minX = Math.min(...boxes.map((b) => b.x));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const groupW = maxX - minX;
    const groupH = maxY - minY;
    // Prefer right beside the originals, else below, else the nearest free spot.
    const taken = takenBoxes({ booths: state.booths, elements: state.elements });
    const spot = findFreeSpot(Math.round(maxX + 1), Math.round(minY), Math.ceil(groupW), Math.ceil(groupH), taken, state.width, state.height);
    const dx = spot.x - Math.round(minX);
    const dy = spot.y - Math.round(minY);
    const now = new Date().toISOString();
    const newBooths = selBooths.map((b) => {
      const label = nextBoothLabel(labels, labelPrefix(b.label));
      labels.push(label);
      return {
        ...b,
        id: tempId('new-booth'),
        label,
        x: b.x + dx,
        y: b.y + dy,
        status: 'AVAILABLE' as const,
        applicationId: null,
        assignedById: null,
        holder: null,
        createdAt: now,
        updatedAt: now,
      };
    });
    const newEls = selEls.map((e) => ({ ...e, id: tempId('el'), x: e.x + dx, y: e.y + dy }));
    commit((l) => ({ booths: [...l.booths, ...newBooths], elements: [...l.elements, ...newEls] }));
    const ids = [...newBooths.map((b) => b.id), ...newEls.map((e) => e.id)];
    setSelectedIds(new Set(ids));
    flash(ids);
    announce(`Copied ${ids.length === 1 ? 'item' : `${ids.length} items`}`);
  }, [state, selectedIds, commit, setSelectedIds, flash, announce, takenBoxes]);

  const deleteSelected = useCallback(() => {
    if (!state || selectedIds.size === 0) return;
    const locked = state.booths.filter((b) => selectedIds.has(b.id) && LOCKED_STATUSES.has(b.status));
    const lockedIds = new Set(locked.map((b) => b.id));
    const removable = [...selectedIds].filter((id) => !lockedIds.has(id));
    if (removable.length > 0) {
      const gone = new Set(removable);
      commit((l) => ({
        booths: l.booths.filter((b) => !gone.has(b.id)),
        elements: l.elements.filter((e) => !gone.has(e.id)),
      }));
    }
    setSelectedIds(lockedIds);
    if (locked.length > 0) {
      const msg = `${locked.map((b) => b.label).join(', ')} ${locked.length === 1 ? 'has' : 'have'} a vendor or reservation, so ${locked.length === 1 ? 'it was' : 'they were'} kept. Unassign or make available first.`;
      setActionError(msg);
      announce(removable.length > 0 ? `Deleted ${removable.length}. ${msg}` : msg);
    } else {
      setActionError(null);
      announce(`Deleted ${removable.length === 1 ? 'item' : `${removable.length} items`}. Press Control Z to undo.`);
    }
  }, [state, selectedIds, commit, setSelectedIds, announce]);

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (!state || selectedIds.size === 0) return;
      const boxes = [
        ...state.booths.filter((b) => selectedIds.has(b.id)).map(boothFootprint),
        ...state.elements.filter((e) => selectedIds.has(e.id)).map(elementFootprint),
      ];
      const d = clampGroupDelta(boxes, dx, dy, state.width, state.height);
      if (d.dx === 0 && d.dy === 0) {
        announce('At the edge of the floor');
        return;
      }
      commit((l) => ({
        booths: l.booths.map((b) => (selectedIds.has(b.id) ? { ...b, x: b.x + d.dx, y: b.y + d.dy } : b)),
        elements: l.elements.map((e) => (selectedIds.has(e.id) ? { ...e, x: e.x + d.dx, y: e.y + d.dy } : e)),
      }));
      const first = state.booths.find((b) => selectedIds.has(b.id)) ?? state.elements.find((e) => selectedIds.has(e.id));
      if (first) announce(`Position ${first.x + d.dx}, ${first.y + d.dy}`);
    },
    [state, selectedIds, commit, announce]
  );

  const changeBooths = useCallback(
    (ids: string[], patch: Partial<Pick<MapBooth, 'label' | 'kind' | 'w' | 'h' | 'tierId'>>) => {
      if (!state) return;
      const set = new Set(ids);
      commit((l) => ({
        ...l,
        booths: l.booths.map((b) => {
          if (!set.has(b.id)) return b;
          const next = { ...b, ...patch };
          if (patch.w !== undefined || patch.h !== undefined) {
            next.w = Math.max(1, Math.min(MAX_ITEM_SIZE, state.width - next.x, next.w));
            next.h = Math.max(1, Math.min(MAX_ITEM_SIZE, state.height - next.y, next.h));
          }
          return next;
        }),
      }));
      if (patch.tierId !== undefined) {
        const tier = tiers.find((t) => t.id === patch.tierId);
        announce(`${ids.length === 1 ? 'Booth' : `${ids.length} booths`} set to ${tier ? tier.name : 'no tier'}`);
      }
    },
    [state, tiers, commit, announce]
  );

  const changeElement = useCallback(
    (id: string, patch: Partial<Pick<MapElement, 'caption' | 'text' | 'size' | 'w' | 'h' | 'orientation'>>) => {
      commit((l) => ({ ...l, elements: l.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    },
    [commit]
  );

  // ─── Booth assignment (server calls; the layout is untouched) ─────

  const runBoothAction = useCallback(
    async (fn: () => Promise<unknown>, fallback: string) => {
      setActionError(null);
      try {
        await fn();
        await refreshBooths();
      } catch (err: any) {
        setActionError(err?.message || fallback);
        throw err;
      }
    },
    [refreshBooths]
  );

  const doAssign = useCallback(
    (boothId: string, applicationId: string, force: boolean) =>
      runBoothAction(() => mapsApi.assignBooth(mapId, boothId, applicationId, force), 'Could not assign'),
    [mapId, runBoothAction]
  );
  const doUnassign = useCallback(
    (boothId: string) => {
      runBoothAction(() => mapsApi.unassignBooth(mapId, boothId), 'Could not unassign').catch(() => undefined);
    },
    [mapId, runBoothAction]
  );
  const doStatusChange = useCallback(
    (boothId: string, status: 'AVAILABLE' | 'RESERVED' | 'BLOCKED') => {
      runBoothAction(() => mapsApi.setBoothStatus(mapId, boothId, status), 'Could not change status').catch(() => undefined);
    },
    [mapId, runBoothAction]
  );
  const doMove = useCallback(
    (toBoothId: string) => {
      const from = moveMode;
      if (!from || from === toBoothId) return;
      setMoveMode(null);
      runBoothAction(() => mapsApi.moveBooth(mapId, from, toBoothId), 'Could not move the vendor')
        .then(() => {
          setSelectedIds(new Set([toBoothId]));
          const label = state?.booths.find((b) => b.id === toBoothId)?.label;
          announce(`Vendor moved to booth ${label ?? ''}`);
        })
        .catch(() => undefined);
    },
    [moveMode, mapId, runBoothAction, setSelectedIds, state, announce]
  );

  // ─── Keyboard ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;
      if (mod && key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && key.toLowerCase() === 'a' && state) {
        e.preventDefault();
        setSelectedIds(new Set([...state.booths.map((b) => b.id), ...state.elements.map((x) => x.id)]));
        return;
      }
      if (mod && key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if (mod || e.altKey) return;
      if (key === 'Escape') {
        if (moveMode) setMoveMode(null);
        else setSelectedIds(new Set());
        return;
      }
      if ((key === 'Delete' || key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (key.startsWith('Arrow') && selectedIds.size > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        if (key === 'ArrowLeft') nudge(-step, 0);
        if (key === 'ArrowRight') nudge(step, 0);
        if (key === 'ArrowUp') nudge(0, -step);
        if (key === 'ArrowDown') nudge(0, step);
        return;
      }
      if ((key === 'r' || key === 'R') && selectedIds.size > 0) {
        turnSelected();
        return;
      }
      if (key === '+' || key === '=') canvasRef.current?.zoomIn();
      if (key === '-' || key === '_') canvasRef.current?.zoomOut();
      if (key === '0') canvasRef.current?.fit();
      if (key === '?') setShowShortcuts(true);
      if (key === 'b' || key === 'B') addItem('BOOTH');
      if (key === 't' || key === 'T') addItem('TABLE');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, duplicateSelected, deleteSelected, nudge, turnSelected, addItem, save, moveMode, selectedIds, setSelectedIds, state]);

  // ─── Publish ─────────────────────────────────────────────────────

  const handlePublish = useCallback(async () => {
    setPublishError(null);
    setPublishing(true);
    try {
      await publish();
      setShowPublish(false);
      announce('Map published');
    } catch (err: any) {
      setPublishError(err?.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }, [publish, announce]);

  const handleUnpublish = useCallback(async () => {
    setActionError(null);
    try {
      await unpublish();
      announce('Map unpublished. Vendors can no longer see it.');
    } catch (err: any) {
      setActionError(err?.message || 'Unpublish failed');
    }
  }, [unpublish, announce]);

  // ─── Render ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" aria-hidden="true" />
        <span className="ml-2 text-gray-500 dark:text-slate-400">Loading map…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center" role="alert">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-red-500" aria-hidden="true" />
          <p className="font-medium text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={() => router.push('/admin/maps')}
            className="mt-4 text-sm text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Back to maps
          </button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  const empty = state.booths.length === 0 && state.elements.length === 0;
  const unpriced = state.booths.filter((b) => !b.tierId).length;
  const selectionHint = moveMode
    ? 'Click the booth to move this vendor to. Esc cancels.'
    : selectedIds.size > 0
    ? 'Drag to move · corner handle resizes · arrow keys nudge · Delete removes'
    : 'Drag empty space to look around · scroll to zoom · Shift-drag selects many';

  return (
    <div className="flex h-full min-h-[640px] flex-col">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-200 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800">
        <Link
          href="/admin/maps"
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:bg-slate-700"
          aria-label="Back to maps"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-lg font-semibold text-gray-900 dark:text-white">{state.name}</h1>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              state.status === 'PUBLISHED'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
            }`}
          >
            {state.status === 'PUBLISHED' ? 'Published' : 'Draft'}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <SaveIndicator status={saveStatus} onRetry={() => void save()} />
          <div className="mx-1 h-6 w-px bg-gray-200 dark:bg-slate-700" aria-hidden="true" />
          <div role="group" aria-label="History" className="flex">
            <IconButton label="Undo" shortcut="Ctrl+Z" onClick={undo} disabled={!canUndo}>
              <Undo2 className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton label="Redo" shortcut="Ctrl+Shift+Z" onClick={redo} disabled={!canRedo}>
              <Redo2 className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
          <div role="group" aria-label="Zoom" className="flex items-center">
            <IconButton label="Zoom out" shortcut="−" onClick={() => canvasRef.current?.zoomOut()}>
              <ZoomOut className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <span className="w-11 text-center text-xs tabular-nums text-gray-600 dark:text-slate-300" aria-live="off">
              {Math.round(zoom * 100)}%
            </span>
            <IconButton label="Zoom in" shortcut="+" onClick={() => canvasRef.current?.zoomIn()}>
              <ZoomIn className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton label="Fit floor to screen" shortcut="0" onClick={() => canvasRef.current?.fit()}>
              <Maximize className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
          <IconButton label="Mouse and keyboard tips" shortcut="?" onClick={() => setShowShortcuts(true)}>
            <CircleHelp className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <div className="mx-1 h-6 w-px bg-gray-200 dark:bg-slate-700" aria-hidden="true" />
          {state.status === 'PUBLISHED' ? (
            <>
              <a
                href={`/events/${state.eventId}/map`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                View map
                <span className="sr-only">(opens in a new tab)</span>
              </a>
              <button
                type="button"
                onClick={handleUnpublish}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <EyeOff className="h-4 w-4" aria-hidden="true" />
                Unpublish
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setPublishError(null);
                setShowPublish(true);
              }}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-sm font-semibold text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Publish
            </button>
          )}
        </div>
      </header>

      {(saveError || actionError) && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{actionError || saveError}</span>
          {saveError && !actionError && saveStatus === 'error' && (
            <button type="button" onClick={() => void save()} className="text-xs font-medium underline">
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-xs font-medium underline"
            hidden={!actionError}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Workspace: palette | canvas | details */}
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="max-h-56 shrink-0 overflow-y-auto border-b border-gray-200 bg-gray-50/80 dark:border-slate-700 dark:bg-slate-900/60 lg:max-h-none lg:border-b-0 lg:border-r">
          <AddPalette onAdd={(kind) => addItem(kind)} />
        </div>

        <div className="relative min-h-[420px] flex-1">
          <EditorCanvas
            ref={canvasRef}
            width={state.width}
            height={state.height}
            gridSize={state.gridSize}
            unit={state.unit}
            booths={state.booths}
            elements={state.elements}
            tierSwatches={tierSwatches}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            moveMode={moveMode}
            onMovePick={doMove}
            checkpoint={checkpoint}
            commit={commit}
            onDropItem={(kind, x, y) => addItem(kind, { x, y })}
            onTurn={turnSelected}
            onDuplicate={duplicateSelected}
            onDelete={deleteSelected}
            onZoomChange={setZoom}
            flashIds={flashIds}
            onAnnounce={announce}
          />

          {empty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-sm rounded-2xl border border-gray-200 bg-white/95 p-6 text-center shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Start with your booths</h2>
                <p className="mt-1.5 text-sm text-gray-600 dark:text-slate-400">
                  Add a whole block of numbered booths at once, or one at a time. You can drag anything from the left
                  onto the floor too.
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <button type="button" onClick={() => addItem('BLOCK')} className={`${dialogButton.primary} inline-flex items-center justify-center gap-2`}>
                    <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                    Add rows of booths
                  </button>
                  <button
                    type="button"
                    onClick={() => addItem('BOOTH')}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Square className="h-4 w-4" aria-hidden="true" />
                    One booth
                  </button>
                </div>
              </div>
            </div>
          )}

          {moveMode && (
            <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full bg-indigo-600 py-1.5 pl-4 pr-1.5 text-sm font-medium text-white shadow-lg">
              Click the booth to move the vendor to
              <button
                type="button"
                onClick={() => setMoveMode(null)}
                className="rounded-full bg-white/15 px-3 py-1 text-xs hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Cancel
              </button>
            </div>
          )}

          <p
            className="pointer-events-none absolute bottom-3 left-3 right-3 hidden truncate text-xs text-gray-600 dark:text-slate-400 sm:block"
            aria-hidden="true"
          >
            <span className="rounded-md bg-white/85 px-2 py-1 shadow-sm dark:bg-slate-800/85">{selectionHint}</span>
          </p>
          <p id="map-builder-help" className="sr-only">
            Tab moves between items on the map. Enter selects an item, Shift and Enter adds it to the selection.
            Arrow keys move the selection one {unitLabel(state.unit, true).replace(/s$/, '')} at a time, Shift and arrow keys move five.
            R turns it, Delete removes it, Control D copies it, Escape clears the selection. Press question mark for all shortcuts.
          </p>
        </div>

        <InspectorPanel
          mapId={mapId}
          eventId={state.eventId}
          status={state.status}
          role={role}
          name={state.name}
          width={state.width}
          height={state.height}
          unit={state.unit}
          minWidth={extent.w}
          minHeight={extent.h}
          booths={state.booths}
          elements={state.elements}
          tiers={tiers}
          tierSwatches={tierSwatches}
          selectedIds={selectedIds}
          onSettings={updateSettings}
          onBoothChange={changeBooths}
          onElementChange={changeElement}
          onTurn={turnSelected}
          onDuplicate={duplicateSelected}
          onDelete={deleteSelected}
          onShowShortcuts={() => setShowShortcuts(true)}
          onBoothAssign={doAssign}
          onBoothUnassign={doUnassign}
          onBoothStatusChange={doStatusChange}
          onBoothMoveStart={(id) => {
            setMoveMode(id);
            announce('Choose the booth to move this vendor to. Escape cancels.');
          }}
          onBoothMoveCancel={() => setMoveMode(null)}
          moveMode={moveMode}
        />
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {blockAt !== undefined && (
        <BoothBlockDialog
          unit={state.unit}
          floorW={state.width}
          floorH={state.height}
          existingLabels={state.booths.map((b) => b.label)}
          onClose={() => setBlockAt(undefined)}
          onAdd={addBlock}
        />
      )}

      {showPublish && (
        <BuilderDialog
          titleId="publish-title"
          title="Publish this map?"
          description="Vendors will see it on the event page and approved vendors can pick their booth."
          onClose={() => setShowPublish(false)}
          footer={
            <>
              <button type="button" className={dialogButton.secondary} onClick={() => setShowPublish(false)}>
                Not yet
              </button>
              <button
                type="button"
                className={dialogButton.success}
                onClick={handlePublish}
                disabled={publishing || state.booths.length === 0}
                data-autofocus
              >
                {publishing ? 'Publishing…' : 'Publish map'}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-sm text-gray-700 dark:text-slate-300">
            {state.booths.length === 0 ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                Add at least one booth before publishing.
              </p>
            ) : (
              <>
                <p>Each price tier will be limited to the number of booths it has on the map:</p>
                <ul className="space-y-1.5">
                  {tiers
                    .filter((t) => state.booths.some((b) => b.tierId === t.id))
                    .map((tier) => {
                      const n = state.booths.filter((b) => b.tierId === tier.id).length;
                      return (
                        <li
                          key={tier.id}
                          className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 dark:bg-slate-800"
                        >
                          <span className="font-medium text-gray-900 dark:text-white">
                            {tier.name} <span className="font-normal text-gray-500 dark:text-slate-400">· {formatPrice(tier.price)}</span>
                          </span>
                          <span>
                            {n} booth{n === 1 ? '' : 's'}
                          </span>
                        </li>
                      );
                    })}
                </ul>
                {unpriced > 0 && (
                  <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {unpriced} booth{unpriced === 1 ? ' has' : 's have'} no price tier, so vendors can&apos;t pick{' '}
                    {unpriced === 1 ? 'it' : 'them'}. You can still publish and fix this later.
                  </p>
                )}
              </>
            )}
            {publishError && (
              <p role="alert" className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-red-700 dark:bg-red-900/20 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {publishError}
              </p>
            )}
          </div>
        </BuilderDialog>
      )}

      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

function IconButton({
  label,
  shortcut,
  onClick,
  disabled,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
      className="flex h-9 w-9 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-slate-700"
    >
      {children}
    </button>
  );
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs">
      {status === 'saving' && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" aria-hidden="true" />
          <span className="text-gray-600 dark:text-slate-400">Saving…</span>
        </>
      )}
      {status === 'dirty' && <span className="text-gray-600 dark:text-slate-400">Unsaved changes</span>}
      {status === 'saved' && (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <span className="text-gray-600 dark:text-slate-400">All changes saved</span>
        </>
      )}
      {status === 'error' && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 font-medium text-red-600 hover:underline dark:text-red-400"
        >
          <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
          Not saved — try again
        </button>
      )}
    </div>
  );
}

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ['Click'], action: 'Select an item' },
  { keys: ['Shift', 'Click'], action: 'Add to or remove from the selection' },
  { keys: ['Shift', 'Drag'], action: 'Select everything in a box' },
  { keys: ['Drag'], action: 'Move items (on an item) or look around (on empty space)' },
  { keys: ['Scroll'], action: 'Zoom in and out' },
  { keys: ['Space', 'Drag'], action: 'Look around from anywhere' },
  { keys: ['Arrow keys'], action: 'Nudge the selection (Shift for 5 at a time)' },
  { keys: ['R'], action: 'Turn 90°' },
  { keys: ['Ctrl', 'D'], action: 'Copy' },
  { keys: ['Delete'], action: 'Delete' },
  { keys: ['Ctrl', 'Z'], action: 'Undo' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo' },
  { keys: ['Ctrl', 'A'], action: 'Select everything' },
  { keys: ['B'], action: 'Add a booth' },
  { keys: ['T'], action: 'Add a table' },
  { keys: ['0'], action: 'Fit the floor to the screen' },
  { keys: ['Esc'], action: 'Clear the selection' },
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <BuilderDialog
      titleId="shortcuts-title"
      title="Mouse and keyboard tips"
      description="On a Mac, use ⌘ instead of Ctrl. Everything is saved automatically."
      onClose={onClose}
      footer={
        <button type="button" className={dialogButton.primary} onClick={onClose} data-autofocus>
          Got it
        </button>
      }
    >
      <table className="w-full text-sm">
        <caption className="sr-only">Shortcuts</caption>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
          {SHORTCUTS.map((s) => (
            <tr key={s.action}>
              <th scope="row" className="whitespace-nowrap py-2 pr-4 text-left font-normal">
                {s.keys.map((k, i) => (
                  <React.Fragment key={k}>
                    {i > 0 && <span className="mx-1 text-gray-400" aria-hidden="true">+</span>}
                    <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                      {k}
                    </kbd>
                  </React.Fragment>
                ))}
              </th>
              <td className="py-2 text-gray-700 dark:text-slate-300">{s.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </BuilderDialog>
  );
}

export default function MapBuilderPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" aria-hidden="true" />
        </div>
      }
    >
      <BuilderContent />
    </Suspense>
  );
}
