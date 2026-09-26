'use client';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTheme } from 'next-themes';
import { Copy, RotateCw, Trash2 } from 'lucide-react';
import type { MapBooth, MapElement as MapElementType } from '@/services/api';
import Booth from '../Booth';
import MapElement from '../MapElement';
import { GRID_LINE_DARK, GRID_LINE_LIGHT, SELECTION_STROKE_DARK, SELECTION_STROKE_LIGHT } from '../mapTheme';
import type { Layout } from '../useMapEditor';
import {
  boothFootprint,
  clampGroupDelta,
  elementFootprint,
  MAX_ITEM_SIZE,
  overlaps,
  type Box,
} from './placement';
import { defaultSize, dragState, unitLabel, type CatalogKind } from './catalog';

export interface EditorCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  /** Centre of the visible floor area, in floor units. */
  viewCenter: () => { x: number; y: number };
  /** Bring an item into view (keyboard focus, newly added items). */
  reveal: (box: Box) => void;
}

interface EditorCanvasProps {
  width: number;
  height: number;
  gridSize: number;
  unit: string;
  booths: MapBooth[];
  elements: MapElementType[];
  tierSwatches: Record<string, number>;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  /** Move-a-vendor mode: the next booth click picks the target instead of selecting. */
  moveMode: string | null;
  onMovePick: (boothId: string) => void;
  checkpoint: () => void;
  commit: (mutate: (layout: Layout) => Layout, opts?: { history?: boolean }) => void;
  onDropItem: (kind: CatalogKind, centerX: number, centerY: number) => void;
  onTurn: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Zoom relative to "whole floor fits" (1 = fit). */
  onZoomChange: (zoom: number) => void;
  /** Items to flash briefly (just added). */
  flashIds: Set<string>;
  onAnnounce: (message: string) => void;
}

type Gesture =
  | { type: 'pan'; startX: number; startY: number; tx: number; ty: number; moved: boolean; additive: boolean }
  | {
      type: 'move';
      startX: number;
      startY: number;
      ids: Set<string>;
      booths: Map<string, MapBooth>;
      elements: Map<string, MapElementType>;
      boxes: Box[];
      started: boolean;
      last: { dx: number; dy: number };
    }
  | { type: 'resize'; id: string; isBooth: boolean; origin: Box; started: boolean }
  | { type: 'marquee'; startX: number; startY: number; x: number; y: number; base: Set<string> };

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const DRAG_THRESHOLD = 4;
const PAD = 48;

const EditorCanvas = forwardRef<EditorCanvasHandle, EditorCanvasProps>(function EditorCanvas(
  {
    width,
    height,
    gridSize,
    unit,
    booths,
    elements,
    tierSwatches,
    selectedIds,
    onSelectionChange,
    moveMode,
    onMovePick,
    checkpoint,
    commit,
    onDropItem,
    onTurn,
    onDuplicate,
    onDelete,
    onZoomChange,
    flashIds,
    onAnnounce,
  },
  ref
) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const fitted = useRef(false);
  const fitScale = useRef(1);
  const gesture = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [busy, setBusy] = useState(false);
  const [ghost, setGhost] = useState<Box | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const floorW = width * gridSize;
  const floorH = height * gridSize;

  const applyView = useCallback(
    (next: { scale: number; tx: number; ty: number }) => {
      setView(next);
      onZoomChange(next.scale / fitScale.current);
    },
    [onZoomChange]
  );

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (cw === 0 || ch === 0) return;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((cw - PAD * 2) / floorW, (ch - PAD * 2) / floorH)));
    fitScale.current = scale;
    applyView({ scale, tx: (cw - floorW * scale) / 2, ty: (ch - floorH * scale) / 2 });
  }, [floorW, floorH, applyView]);

  const zoomAt = useCallback(
    (factor: number, sx?: number, sy?: number) => {
      const el = containerRef.current;
      if (!el) return;
      const v = viewRef.current;
      const px = sx ?? el.clientWidth / 2;
      const py = sy ?? el.clientHeight / 2;
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
      const k = scale / v.scale;
      applyView({ scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k });
    },
    [applyView]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit once the container has a size, and again when the floor is resized.
  useEffect(() => {
    if (size.w === 0) return;
    if (!fitted.current) {
      fitted.current = true;
      fit();
    }
  }, [size.w, fit]);
  useEffect(() => {
    if (fitted.current) fit();
  }, [width, height, gridSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel / trackpad pinch zooms around the pointer (non-passive to stop page scroll).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const intensity = e.ctrlKey ? 0.01 : 0.0015;
      zoomAt(Math.exp(-e.deltaY * intensity), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Hold Space to pan from anywhere, like most drawing tools.
  useEffect(() => {
    const isField = (t: EventTarget | null) =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isField(e.target) && !(e.target instanceof HTMLButtonElement)) {
        const onItem = e.target instanceof Element && e.target.closest('[data-item-id]');
        if (!onItem) {
          e.preventDefault();
          setSpaceHeld(true);
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toUnits = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current!.getBoundingClientRect();
      const v = viewRef.current;
      return {
        x: (clientX - rect.left - v.tx) / v.scale / gridSize,
        y: (clientY - rect.top - v.ty) / v.scale / gridSize,
      };
    },
    [gridSize]
  );

  const reveal = useCallback(
    (box: Box) => {
      const el = containerRef.current;
      if (!el) return;
      const v = viewRef.current;
      const left = v.tx + box.x * gridSize * v.scale;
      const top = v.ty + box.y * gridSize * v.scale;
      const right = left + box.w * gridSize * v.scale;
      const bottom = top + box.h * gridSize * v.scale;
      let { tx, ty } = v;
      if (left < 24) tx += 24 - left;
      else if (right > el.clientWidth - 24) tx -= right - (el.clientWidth - 24);
      if (top < 24) ty += 24 - top;
      else if (bottom > el.clientHeight - 24) ty -= bottom - (el.clientHeight - 24);
      if (tx !== v.tx || ty !== v.ty) applyView({ ...v, tx, ty });
    },
    [gridSize, applyView]
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomAt(1.25),
      zoomOut: () => zoomAt(0.8),
      fit,
      viewCenter: () => {
        const el = containerRef.current;
        if (!el) return { x: width / 2, y: height / 2 };
        const rect = el.getBoundingClientRect();
        const c = toUnits(rect.left + el.clientWidth / 2, rect.top + el.clientHeight / 2);
        return {
          x: Math.max(0, Math.min(width, c.x)),
          y: Math.max(0, Math.min(height, c.y)),
        };
      },
      reveal,
    }),
    [zoomAt, fit, toUnits, width, height, reveal]
  );

  const footprints = useMemo(() => {
    const m = new Map<string, Box>();
    for (const b of booths) m.set(b.id, boothFootprint(b));
    for (const e of elements) m.set(e.id, elementFootprint(e));
    return m;
  }, [booths, elements]);

  // ─── Pointer gestures ────────────────────────────────────────────

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const svg = e.currentTarget;

    const startPan = () => {
      const v = viewRef.current;
      gesture.current = { type: 'pan', startX: e.clientX, startY: e.clientY, tx: v.tx, ty: v.ty, moved: false, additive };
      svg.setPointerCapture(e.pointerId);
    };

    if (e.button === 1 || spaceHeld) {
      e.preventDefault();
      startPan();
      return;
    }

    const handle = target.closest('[data-resize-handle]');
    if (handle && selectedIds.size === 1) {
      const id = [...selectedIds][0];
      const booth = booths.find((b) => b.id === id);
      const el = elements.find((x) => x.id === id);
      const origin = booth ? { x: booth.x, y: booth.y, w: booth.w, h: booth.h } : el ? { x: el.x, y: el.y, w: el.w, h: el.h } : null;
      if (origin) {
        gesture.current = { type: 'resize', id, isBooth: Boolean(booth), origin, started: false };
        svg.setPointerCapture(e.pointerId);
        return;
      }
    }

    const itemNode = target.closest('[data-item-id]');
    if (itemNode) {
      const id = itemNode.getAttribute('data-item-id')!;
      if (moveMode) {
        if (booths.some((b) => b.id === id)) onMovePick(id);
        return;
      }
      let selection = selectedIds;
      if (additive) {
        selection = new Set(selectedIds);
        if (selection.has(id)) selection.delete(id);
        else selection.add(id);
        onSelectionChange(selection);
        if (!selection.has(id)) return;
      } else if (!selectedIds.has(id)) {
        selection = new Set([id]);
        onSelectionChange(selection);
      }
      const start = toUnits(e.clientX, e.clientY);
      gesture.current = {
        type: 'move',
        startX: start.x,
        startY: start.y,
        ids: selection,
        booths: new Map(booths.filter((b) => selection.has(b.id)).map((b) => [b.id, b])),
        elements: new Map(elements.filter((x) => selection.has(x.id)).map((x) => [x.id, x])),
        boxes: [...selection].map((sid) => footprints.get(sid)).filter(Boolean) as Box[],
        started: false,
        last: { dx: 0, dy: 0 },
      };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    if (additive) {
      const p = toUnits(e.clientX, e.clientY);
      gesture.current = { type: 'marquee', startX: p.x, startY: p.y, x: p.x, y: p.y, base: new Set(selectedIds) };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    startPan();
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'pan') {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      g.moved = true;
      setBusy(true);
      applyView({ ...viewRef.current, tx: g.tx + dx, ty: g.ty + dy });
      return;
    }
    const p = toUnits(e.clientX, e.clientY);
    if (g.type === 'move') {
      const rawDx = p.x - g.startX;
      const rawDy = p.y - g.startY;
      if (!g.started) {
        const px = Math.hypot(rawDx, rawDy) * gridSize * viewRef.current.scale;
        if (px < DRAG_THRESHOLD) return;
        g.started = true;
        setBusy(true);
        checkpoint();
      }
      const { dx, dy } = clampGroupDelta(g.boxes, Math.round(rawDx), Math.round(rawDy), width, height);
      if (dx === g.last.dx && dy === g.last.dy) return;
      g.last = { dx, dy };
      commit(
        (l) => ({
          booths: l.booths.map((b) => {
            const o = g.booths.get(b.id);
            return o ? { ...b, x: o.x + dx, y: o.y + dy } : b;
          }),
          elements: l.elements.map((x) => {
            const o = g.elements.get(x.id);
            return o ? { ...x, x: o.x + dx, y: o.y + dy } : x;
          }),
        }),
        { history: false }
      );
      return;
    }
    if (g.type === 'resize') {
      if (!g.started) {
        g.started = true;
        setBusy(true);
        checkpoint();
      }
      const o = g.origin;
      const el = g.isBooth ? null : elements.find((x) => x.id === g.id);
      let w = Math.max(1, Math.min(MAX_ITEM_SIZE, width - o.x, Math.round(p.x - o.x)));
      let h = Math.max(1, Math.min(MAX_ITEM_SIZE, height - o.y, Math.round(p.y - o.y)));
      if (el?.kind === 'wall') {
        // Walls stretch along their own direction only.
        if (el.orientation === 'v') w = o.w;
        else h = o.h;
      }
      commit(
        (l) =>
          g.isBooth
            ? { ...l, booths: l.booths.map((b) => (b.id === g.id ? { ...b, w, h } : b)) }
            : { ...l, elements: l.elements.map((x) => (x.id === g.id ? { ...x, w, h } : x)) },
        { history: false }
      );
      return;
    }
    if (g.type === 'marquee') {
      g.x = p.x;
      g.y = p.y;
      setMarquee({
        x: Math.min(g.startX, p.x),
        y: Math.min(g.startY, p.y),
        w: Math.abs(p.x - g.startX),
        h: Math.abs(p.y - g.startY),
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    setBusy(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!g) return;
    if (g.type === 'pan' && !g.moved && !g.additive) {
      if (selectedIds.size > 0) onSelectionChange(new Set());
    }
    if (g.type === 'move' && g.started && (g.last.dx !== 0 || g.last.dy !== 0)) {
      const n = g.ids.size;
      onAnnounce(`Moved ${n === 1 ? 'item' : `${n} items`} ${describeDelta(g.last.dx, g.last.dy, unit)}`);
    }
    if (g.type === 'resize' && g.started) {
      const b = booths.find((x) => x.id === g.id);
      const el = elements.find((x) => x.id === g.id);
      const s = b ?? el;
      if (s) onAnnounce(`Resized to ${s.w} by ${s.h} ${unitLabel(unit, true)}`);
    }
    if (g.type === 'marquee') {
      const box = {
        x: Math.min(g.startX, g.x),
        y: Math.min(g.startY, g.y),
        w: Math.abs(g.x - g.startX),
        h: Math.abs(g.y - g.startY),
      };
      const next = new Set(g.base);
      footprints.forEach((fp, id) => {
        if (overlaps(box, { ...fp, w: Math.max(fp.w, 0.01), h: Math.max(fp.h, 0.01) })) next.add(id);
      });
      setMarquee(null);
      onSelectionChange(next);
      if (next.size !== g.base.size) onAnnounce(`${next.size} selected`);
    }
  };

  // Keyboard activation (Enter / Space on a focused item); mouse clicks are handled on pointer down.
  const onItemKey = useCallback(
    (id: string, e?: React.MouseEvent | React.KeyboardEvent) => {
      if (!e || !('key' in e)) return;
      if (moveMode) {
        if (booths.some((b) => b.id === id)) onMovePick(id);
        return;
      }
      if (e.shiftKey) {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onSelectionChange(next);
      } else {
        onSelectionChange(selectedIds.has(id) && selectedIds.size === 1 ? new Set() : new Set([id]));
      }
    },
    [moveMode, booths, onMovePick, selectedIds, onSelectionChange]
  );

  const onItemFocus = (e: React.FocusEvent<SVGSVGElement>) => {
    const node = (e.target as Element).closest?.('[data-item-id]');
    if (!node) return;
    const fp = footprints.get(node.getAttribute('data-item-id')!);
    if (fp) reveal(fp);
  };

  // ─── Palette drag and drop ───────────────────────────────────────

  const onDragOver = (e: React.DragEvent) => {
    const kind = dragState.kind;
    if (!kind) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const p = toUnits(e.clientX, e.clientY);
    const s = kind === 'BLOCK' ? defaultSize('BOOTH', unit) : defaultSize(kind, unit);
    setGhost({ x: Math.round(p.x - s.w / 2), y: Math.round(p.y - s.h / 2), w: s.w, h: s.h });
  };

  const onDrop = (e: React.DragEvent) => {
    const kind = dragState.kind;
    setGhost(null);
    if (!kind) return;
    e.preventDefault();
    dragState.kind = null;
    const p = toUnits(e.clientX, e.clientY);
    onDropItem(kind, p.x, p.y);
  };

  // ─── Render ──────────────────────────────────────────────────────

  const sel = dark ? SELECTION_STROKE_DARK : SELECTION_STROKE_LIGHT;
  const px = 1 / view.scale; // one screen pixel in floor-pixel space
  const minorVisible = gridSize * view.scale >= 6;
  const majorStep = 10 * gridSize;

  const selectedBoxes = [...selectedIds].map((id) => footprints.get(id)).filter(Boolean) as Box[];
  const selectionBounds = selectedBoxes.length
    ? selectedBoxes.reduce(
        (acc, b) => {
          const x1 = Math.min(acc.x, b.x);
          const y1 = Math.min(acc.y, b.y);
          const x2 = Math.max(acc.x + acc.w, b.x + b.w);
          const y2 = Math.max(acc.y + acc.h, b.y + b.h);
          return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        },
        selectedBoxes[0]
      )
    : null;

  const singleId = selectedIds.size === 1 ? [...selectedIds][0] : null;
  const singleBooth = singleId ? booths.find((b) => b.id === singleId) : undefined;
  const singleElement = singleId ? elements.find((x) => x.id === singleId) : undefined;
  const handleAt = (() => {
    if (singleBooth && singleBooth.rotation !== 90) {
      return { x: (singleBooth.x + singleBooth.w) * gridSize, y: (singleBooth.y + singleBooth.h) * gridSize };
    }
    if (singleElement) {
      const fp = elementFootprint(singleElement);
      if (singleElement.kind === 'wall') {
        return singleElement.orientation === 'v'
          ? { x: fp.x * gridSize, y: (fp.y + fp.h) * gridSize }
          : { x: (fp.x + fp.w) * gridSize, y: fp.y * gridSize };
      }
      return { x: (fp.x + fp.w) * gridSize, y: (fp.y + fp.h) * gridSize };
    }
    return null;
  })();

  const barPos =
    selectionBounds && !busy && !moveMode
      ? {
          left: view.tx + (selectionBounds.x + selectionBounds.w / 2) * gridSize * view.scale,
          top: view.ty + selectionBounds.y * gridSize * view.scale,
        }
      : null;

  const rulerStep = width > 120 ? 20 : 10;
  const rulerFont = 11 * px;

  return (
    <div
      ref={containerRef}
      className="map-builder-canvas absolute inset-0 overflow-hidden select-none touch-none"
      onDragOver={onDragOver}
      onDragLeave={() => setGhost(null)}
      onDrop={onDrop}
      style={{ cursor: spaceHeld ? 'grab' : moveMode ? 'crosshair' : 'default' }}
    >
      <svg
        width="100%"
        height="100%"
        role="application"
        aria-roledescription="floor map editor"
        aria-label={`Floor, ${width} by ${height} ${unitLabel(unit, true)}. ${booths.length} booths.`}
        aria-describedby="map-builder-help"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onFocus={onItemFocus}
        className="block"
      >
        <defs>
          <pattern id="mb-grid-minor" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
            <path
              d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
              fill="none"
              stroke={dark ? GRID_LINE_DARK : GRID_LINE_LIGHT}
              strokeWidth={px}
              opacity={0.55}
            />
          </pattern>
          <pattern id="mb-grid-major" width={majorStep} height={majorStep} patternUnits="userSpaceOnUse">
            {minorVisible && <rect width={majorStep} height={majorStep} fill="url(#mb-grid-minor)" />}
            <path
              d={`M ${majorStep} 0 L 0 0 0 ${majorStep}`}
              fill="none"
              stroke={dark ? '#475569' : '#cbd5e1'}
              strokeWidth={px}
            />
          </pattern>
          <filter id="mb-floor-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy={6 * px} stdDeviation={10 * px} floodColor="#000" floodOpacity={dark ? 0.55 : 0.12} />
          </filter>
        </defs>

        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {/* Floor sheet */}
          <rect
            x={0}
            y={0}
            width={floorW}
            height={floorH}
            fill={dark ? '#1e293b' : '#ffffff'}
            filter="url(#mb-floor-shadow)"
          />
          <rect x={0} y={0} width={floorW} height={floorH} fill="url(#mb-grid-major)" pointerEvents="none" />
          <rect
            x={0}
            y={0}
            width={floorW}
            height={floorH}
            fill="none"
            stroke={dark ? '#64748b' : '#94a3b8'}
            strokeWidth={1.5 * px}
            pointerEvents="none"
          />

          {/* Rulers: tick labels along the top and left edges */}
          <g
            pointerEvents="none"
            fill={dark ? '#94a3b8' : '#64748b'}
            fontSize={rulerFont}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            aria-hidden="true"
          >
            {Array.from({ length: Math.floor(width / rulerStep) + 1 }, (_, i) => i * rulerStep).map((v) => (
              <text key={`rx${v}`} x={v * gridSize} y={-8 * px} textAnchor="middle">
                {v}
              </text>
            ))}
            {Array.from({ length: Math.floor(height / rulerStep) + 1 }, (_, i) => i * rulerStep).map((v) => (
              <text key={`ry${v}`} x={-8 * px} y={v * gridSize} textAnchor="end" dominantBaseline="central">
                {v}
              </text>
            ))}
            <text x={floorW} y={floorH + 18 * px} textAnchor="end" fontWeight={600}>
              {width} × {height} {unitLabel(unit)}
            </text>
          </g>

          {elements.map((el) => (
            <g key={el.id} data-item-id={el.id} className="mb-item">
              <MapElement
                element={el}
                gridSize={gridSize}
                dark={dark}
                selected={selectedIds.has(el.id)}
                onSelect={onItemKey}
              />
            </g>
          ))}

          {booths.map((booth) => (
            <g key={booth.id} data-item-id={booth.id} className="mb-item">
              <Booth
                booth={booth}
                gridSize={gridSize}
                dark={dark}
                selected={selectedIds.has(booth.id)}
                tierSwatchIndex={booth.tierId ? tierSwatches[booth.tierId] : undefined}
                onSelect={onItemKey}
                handles={false}
                checkmark={false}
              />
            </g>
          ))}

          {/* Just-added flash */}
          {[...flashIds].map((id) => {
            const fp = footprints.get(id);
            if (!fp) return null;
            return (
              <rect
                key={`flash-${id}`}
                className="mb-flash"
                x={fp.x * gridSize - 4 * px}
                y={fp.y * gridSize - 4 * px}
                width={Math.max(fp.w * gridSize, 2) + 8 * px}
                height={Math.max(fp.h * gridSize, 2) + 8 * px}
                rx={4 * px}
                fill="none"
                stroke={sel}
                strokeWidth={3 * px}
                pointerEvents="none"
              />
            );
          })}

          {/* Selection outline + resize handle */}
          {selectedBoxes.map((b, i) => (
            <rect
              key={`sel-${i}`}
              x={b.x * gridSize - 3 * px}
              y={b.y * gridSize - 3 * px}
              width={Math.max(b.w * gridSize, 1) + 6 * px}
              height={Math.max(b.h * gridSize, 1) + 6 * px}
              fill="none"
              stroke={sel}
              strokeWidth={2 * px}
              strokeDasharray={`${6 * px} ${4 * px}`}
              pointerEvents="none"
            />
          ))}
          {handleAt && !moveMode && (
            <g data-resize-handle style={{ cursor: 'nwse-resize' }} aria-hidden="true">
              <circle cx={handleAt.x} cy={handleAt.y} r={14 * px} fill="transparent" />
              <rect
                x={handleAt.x - 6 * px}
                y={handleAt.y - 6 * px}
                width={12 * px}
                height={12 * px}
                rx={3 * px}
                fill={dark ? '#0f172a' : '#ffffff'}
                stroke={sel}
                strokeWidth={2 * px}
              />
            </g>
          )}

          {ghost && (
            <rect
              x={ghost.x * gridSize}
              y={ghost.y * gridSize}
              width={ghost.w * gridSize}
              height={ghost.h * gridSize}
              rx={2}
              fill={sel}
              fillOpacity={0.15}
              stroke={sel}
              strokeWidth={2 * px}
              strokeDasharray={`${6 * px} ${4 * px}`}
              pointerEvents="none"
            />
          )}

          {marquee && (
            <rect
              x={marquee.x * gridSize}
              y={marquee.y * gridSize}
              width={marquee.w * gridSize}
              height={marquee.h * gridSize}
              fill={sel}
              fillOpacity={0.08}
              stroke={sel}
              strokeWidth={px}
              pointerEvents="none"
            />
          )}
        </g>
      </svg>

      {/* Floating actions over the selection */}
      {barPos && (
        <div
          role="toolbar"
          aria-label="Selected item actions"
          className="absolute z-10 flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5 shadow-lg dark:border-slate-600 dark:bg-slate-800"
          style={{
            left: Math.max(8, Math.min(barPos.left, size.w - 8)),
            top: Math.max(8, barPos.top - 10),
            transform: `translate(-50%, ${barPos.top - 10 < 52 ? '0' : '-100%'})`,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(singleBooth || (singleElement && singleElement.kind !== 'label')) && (
            <BarButton label="Turn" onClick={onTurn}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
            </BarButton>
          )}
          <BarButton label="Copy" onClick={onDuplicate}>
            <Copy className="h-4 w-4" aria-hidden="true" />
          </BarButton>
          <BarButton label="Delete" onClick={onDelete} danger>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </BarButton>
        </div>
      )}
    </div>
  );
});

function BarButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[32px] items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30'
          : 'text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-700'
      }`}
    >
      {children}
      {label}
    </button>
  );
}

function describeDelta(dx: number, dy: number, unit: string): string {
  const u = unitLabel(unit);
  const parts: string[] = [];
  if (dx) parts.push(`${Math.abs(dx)} ${u} ${dx > 0 ? 'right' : 'left'}`);
  if (dy) parts.push(`${Math.abs(dy)} ${u} ${dy > 0 ? 'down' : 'up'}`);
  return parts.join(', ');
}

export default EditorCanvas;
