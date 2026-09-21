'use client';

import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import {
  TransformWrapper,
  TransformComponent,
  ReactZoomPanPinchRef,
  ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import { useTheme } from 'next-themes';
import type { MapBooth, MapElement as MapElementType } from '@/services/api';
import {
  GRID_LINE_LIGHT,
  GRID_LINE_DARK,
  GUIDE_COLOR,
} from './mapTheme';
import Booth from './Booth';
import MapElement from './MapElement';

interface MapCanvasProps {
  width: number;
  height: number;
  gridSize: number;
  unit: string;
  underlayUrl?: string | null;
  underlayOpacity?: number;
  elements: MapElementType[];
  booths: MapBooth[];
  interactive?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (id: string, e?: React.MouseEvent | React.KeyboardEvent) => void;
  onBoothClick?: (booth: MapBooth) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onZoomChange?: (scale: number) => void;
  reducedMotion?: boolean;
  showGrid?: boolean;
  highlightBooth?: string;
  transformRef?: React.RefObject<ReactZoomPanPinchRef | null>;
  guides?: { axis: 'x' | 'y'; pos: number }[];
}

export default function MapCanvas({
  width,
  height,
  gridSize,
  unit,
  underlayUrl,
  underlayOpacity = 40,
  elements,
  booths,
  interactive = true,
  selectedIds = new Set<string>(),
  onSelect,
  onBoothClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onZoomChange,
  reducedMotion = false,
  showGrid = false,
  highlightBooth,
  transformRef: externalTransformRef,
  guides,
}: MapCanvasProps) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const internalRef = useRef<ReactZoomPanPinchRef>(null);
  const actualRef = externalTransformRef || internalRef;
  const svgWidth = width * gridSize;
  const svgHeight = height * gridSize;

  const handleTransform = useCallback(
    (ref: ReactZoomPanPinchRef) => {
      if (onZoomChange) {
        onZoomChange(ref.state.scale);
      }
    },
    [onZoomChange]
  );

  const sortedBooths = useMemo(() => {
    return [...booths].sort((a, b) => {
      const aSel = selectedIds.has(a.id) ? 1 : 0;
      const bSel = selectedIds.has(b.id) ? 1 : 0;
      if (aSel !== bSel) return aSel - bSel;
      return 0;
    });
  }, [booths, selectedIds]);

  const svgContent = (
    <svg
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      width={svgWidth}
      height={svgHeight}
      style={{ minWidth: svgWidth, minHeight: svgHeight }}
      role={interactive ? 'application' : 'img'}
      aria-label={interactive ? 'Floor map editor' : 'Floor map'}
    >
      {underlayUrl && (
        <image
          href={underlayUrl}
          x={0}
          y={0}
          width={svgWidth}
          height={svgHeight}
          opacity={underlayOpacity / 100}
          preserveAspectRatio="xMidYMid slice"
        />
      )}

      {showGrid && (
        <g stroke={dark ? GRID_LINE_DARK : GRID_LINE_LIGHT} strokeWidth={0.5} opacity={0.5}>
          {Array.from({ length: width + 1 }, (_, i) => (
            <line key={`gx-${i}`} x1={i * gridSize} y1={0} x2={i * gridSize} y2={svgHeight} />
          ))}
          {Array.from({ length: height + 1 }, (_, i) => (
            <line key={`gy-${i}`} x1={0} y1={i * gridSize} x2={svgWidth} y2={i * gridSize} />
          ))}
        </g>
      )}

      {elements.map((el) => (
        <MapElement
          key={el.id}
          element={el}
          gridSize={gridSize}
          dark={dark}
          selected={selectedIds.has(el.id)}
          onSelect={onSelect}
        />
      ))}

      {sortedBooths.map((booth) => {
        const tierIdx = booth.tierId
          ? booths.findIndex((b) => b.tierId === booth.tierId) % 6
          : -1;
        return (
          <Booth
            key={booth.id}
            booth={booth}
            gridSize={gridSize}
            dark={dark}
            selected={selectedIds.has(booth.id)}
            tierSwatchIndex={tierIdx >= 0 ? tierIdx : undefined}
            onSelect={onSelect}
            onClick={onBoothClick}
            highlight={booth.id === highlightBooth}
          />
        );
      })}

      {guides?.map((g, i) => (
        <line
          key={`guide-${i}`}
          x1={g.axis === 'y' ? 0 : g.pos}
          y1={g.axis === 'x' ? 0 : g.pos}
          x2={g.axis === 'y' ? svgWidth : g.pos}
          y2={g.axis === 'x' ? svgHeight : g.pos}
          stroke={GUIDE_COLOR}
          strokeWidth={1}
          strokeDasharray="4 2"
          pointerEvents="none"
        />
      ))}
    </svg>
  );

  if (!interactive) {
    return (
      <div style={{ width: '100%', overflow: 'auto', maxWidth: '100%' }}>
        {svgContent}
      </div>
    );
  }

  return (
    <TransformWrapper
      ref={actualRef as React.Ref<ReactZoomPanPinchContentRef>}
      initialScale={1}
      minScale={0.1}
      maxScale={5}
      limitToBounds={false}
      centerOnInit={false}
      fitOnInit
      panning={{ disabled: false }}
      pinch={{ disabled: false }}
      wheel={{ disabled: false, step: 0.1 }}
      doubleClick={{ disabled: true }}
      onTransform={handleTransform}
    >
      <div
        style={{ width: '100%', height: '100%', overflow: 'hidden', cursor: 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
          {svgContent}
        </TransformComponent>
      </div>
    </TransformWrapper>
  );
}