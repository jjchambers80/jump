'use client';

import React from 'react';
import type { MapBooth } from '@/services/api';
import {
  stateFill,
  stateStroke,
  tierSwatch,
  STATUS_LABELS,
  BOOTH_LABEL_LIGHT,
  BOOTH_LABEL_DARK,
  BOOTH_DIM_LIGHT,
  BOOTH_DIM_DARK,
  BOOTH_VENDOR_LIGHT,
  BOOTH_VENDOR_DARK,
  SELECTION_STROKE_LIGHT,
  SELECTION_STROKE_DARK,
  SELECTION_FILL_LIGHT,
  SELECTION_FILL_DARK,
  HIGHLIGHT_RING_LIGHT,
  HIGHLIGHT_RING_DARK,
} from './mapTheme';

interface BoothProps {
  booth: MapBooth;
  gridSize: number;
  dark: boolean;
  selected: boolean;
  tierSwatchIndex?: number;
  onSelect?: (id: string, e?: React.MouseEvent | React.KeyboardEvent) => void;
  onClick?: (booth: MapBooth) => void;
  highlight?: boolean;
}

export default function Booth({
  booth,
  gridSize,
  dark,
  selected,
  tierSwatchIndex,
  onSelect,
  onClick,
  highlight,
}: BoothProps) {
  // Rotation 90° swaps the footprint in place at (x, y) — the same rule the
  // server bounds check and layoutOps.aabbOverlap use, so what is drawn is
  // exactly what is validated.
  const isRotated = booth.rotation === 90;
  const x = booth.x * gridSize;
  const y = booth.y * gridSize;
  const w = (isRotated ? booth.h : booth.w) * gridSize;
  const h = (isRotated ? booth.w : booth.h) * gridSize;

  const fill = tierSwatchIndex !== undefined
    ? tierSwatch(tierSwatchIndex, dark)
    : stateFill(booth.status, dark);
  const stroke = selected
    ? (dark ? SELECTION_STROKE_DARK : SELECTION_STROKE_LIGHT)
    : stateStroke(booth.status, dark);
  const strokeWidth = selected ? 2 : 1;

  const displayLabel = booth.label;
  const statusText = STATUS_LABELS[booth.status] || booth.status;
  const dimText = `${booth.w}\u00d7${booth.h}`;
  const vendorName = booth.holder?.businessName || undefined;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelect) onSelect(booth.id, e);
    if (onClick) onClick(booth);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (onSelect) onSelect(booth.id, e);
      if (onClick) onClick(booth);
    }
  };

  return (
    <g
      role="button"
      tabIndex={0}
      data-testid={`booth-${booth.label}`}
      aria-label={`Booth ${booth.label}, ${booth.w} by ${booth.h}, ${
        booth.tierId ? 'tier assigned' : 'no tier'
      }, ${statusText}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ cursor: 'pointer' }}
    >
      {highlight && (
        <rect
          x={x - 3}
          y={y - 3}
          width={w + 6}
          height={h + 6}
          rx={2}
          fill="none"
          stroke={dark ? HIGHLIGHT_RING_DARK : HIGHLIGHT_RING_LIGHT}
          strokeWidth={3}
          opacity={0.8}
        >
          <animate
            attributeName="opacity"
            values="0.3;1;0.3"
            dur="1.5s"
            repeatCount="3"
          />
        </rect>
      )}

      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />

      <text
        x={x + w / 2}
        y={y + h / 2 - (booth.status === 'AVAILABLE' ? 0 : 4)}
        textAnchor="middle"
        dominantBaseline="central"
        fill={dark ? BOOTH_LABEL_DARK : BOOTH_LABEL_LIGHT}
        fontSize={Math.min(12, Math.max(7, w / 3))}
        fontWeight={500}
        pointerEvents="none"
      >
        {displayLabel}
      </text>

      {w >= 30 && h >= 20 && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 12}
          textAnchor="middle"
          dominantBaseline="central"
          fill={dark ? BOOTH_DIM_DARK : BOOTH_DIM_LIGHT}
          fontSize={Math.min(9, Math.max(5, w / 5))}
          pointerEvents="none"
        >
          {dimText}
        </text>
      )}

      {vendorName && w >= 35 && (
        <text
          x={x + w / 2}
          y={y + h - 6}
          textAnchor="middle"
          dominantBaseline="central"
          fill={dark ? BOOTH_VENDOR_DARK : BOOTH_VENDOR_LIGHT}
          fontSize={Math.min(8, Math.max(5, w / 5))}
          pointerEvents="none"
          fontStyle="italic"
        >
          {vendorName.slice(0, Math.floor(w / 6))}
        </text>
      )}

      {selected && (
        <>
          {[0, 1, 2, 3].map((i) => {
            const cx = i % 2 === 0 ? x : x + w;
            const cy = i < 2 ? y : y + h;
            return (
              <circle
                key={`handle-${i}`}
                cx={cx}
                cy={cy}
                r={3}
                fill={dark ? SELECTION_FILL_DARK : SELECTION_FILL_LIGHT}
                stroke={dark ? SELECTION_STROKE_DARK : SELECTION_STROKE_LIGHT}
                strokeWidth={1}
                pointerEvents="all"
                style={{ cursor: 'nw-resize' }}
              />
            );
          })}
        </>
      )}
    </g>
  );
}