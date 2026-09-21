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
  CHECKMARK_LIGHT,
  CHECKMARK_DARK,
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
  /** Faded out: another tier than the viewer's (spec 014 phase 2 picker). */
  dimmed?: boolean;
  /** Not selectable: `aria-disabled`, no click / key handling. */
  disabled?: boolean;
  /** Editor resize handles on the selected booth; the picker shows a checkmark instead. */
  handles?: boolean;
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
  dimmed = false,
  disabled = false,
  handles = true,
}: BoothProps) {
  const x = booth.x * gridSize;
  const y = booth.y * gridSize;
  const w = booth.w * gridSize;
  const h = booth.h * gridSize;
  const isRotated = booth.rotation === 90;

  // Spec 014 §3.3: the tier swatch is the available look; SOLD / BLOCKED go
  // neutral, HELD keeps the swatch at 40 %, RESERVED is the swatch outlined.
  const swatch = tierSwatchIndex !== undefined ? tierSwatch(tierSwatchIndex, dark) : null;
  const neutral = booth.status === 'SOLD' || booth.status === 'BLOCKED';
  const fill = swatch && !neutral ? swatch : stateFill(booth.status, dark);
  const fillOpacity = booth.status === 'HELD' && swatch ? 0.4 : dimmed ? 0.35 : 1;
  const stroke = selected
    ? (dark ? SELECTION_STROKE_DARK : SELECTION_STROKE_LIGHT)
    : stateStroke(booth.status, dark);
  const strokeWidth = selected ? 2 : 1;
  const strokeDasharray = booth.status === 'RESERVED' && !selected ? '4 2' : undefined;

  const displayLabel = booth.label;
  const statusText = STATUS_LABELS[booth.status] || booth.status;
  const dimText = `${booth.w}\u00d7${booth.h}`;
  const vendorName = booth.holder?.businessName || undefined;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    if (onSelect) onSelect(booth.id, e);
    if (onClick) onClick(booth);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (disabled) return;
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
      aria-disabled={disabled || undefined}
      aria-pressed={!handles && selected ? true : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
      opacity={dimmed ? 0.45 : 1}
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

      {isRotated ? (
        <g transform={`translate(${x + w / 2}, ${y + h / 2}) rotate(90) translate(${-w / 2}, ${-h / 2})`}>
          <rect
            x={0}
            y={0}
            width={w}
            height={h}
            rx={2}
            fill={fill}
            fillOpacity={fillOpacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
          />
        </g>
      ) : (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={2}
          fill={fill}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
        />
      )}

      {booth.status === 'BLOCKED' && w >= 16 && h >= 16 && (
        <g stroke={dark ? BOOTH_DIM_DARK : BOOTH_DIM_LIGHT} strokeWidth={1} pointerEvents="none" opacity={0.7}>
          <line x1={x + 3} y1={y + 3} x2={x + w - 3} y2={y + h - 3} />
          <line x1={x + w - 3} y1={y + 3} x2={x + 3} y2={y + h - 3} />
        </g>
      )}

      {booth.status === 'HELD' && w >= 24 && h >= 16 && (
        <g pointerEvents="none" stroke={dark ? BOOTH_LABEL_DARK : BOOTH_LABEL_LIGHT} strokeWidth={1} fill="none">
          <circle cx={x + w - 7} cy={y + 7} r={4} />
          <path d={`M ${x + w - 7} ${y + 4.5} v 2.5 h 2`} />
        </g>
      )}

      {selected && !handles && (
        <g pointerEvents="none">
          <circle cx={x + w - 7} cy={y + 7} r={5} fill={dark ? SELECTION_STROKE_DARK : SELECTION_STROKE_LIGHT} />
          <path d={`M ${x + w - 9.5} ${y + 7} l 1.8 1.8 l 3.2 -3.6`} stroke={dark ? CHECKMARK_DARK : CHECKMARK_LIGHT} strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}

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

      {selected && handles && (
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