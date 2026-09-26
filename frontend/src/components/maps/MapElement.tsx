'use client';

import React from 'react';
import {
  MicVocal,
  DoorOpen,
  Bath,
  Utensils,
  Info,
  Cross,
  Gamepad2,
  MapPin,
  type LucideIcon,
} from 'lucide-react';
import {
  MARKER_LABELS,
  LABEL_FONT_SIZES,
  WALL_STROKE_LIGHT,
  WALL_STROKE_DARK,
  MARKER_FILL_LIGHT,
  MARKER_FILL_DARK,
  MARKER_STROKE_LIGHT,
  MARKER_STROKE_DARK,
  MARKER_ICON_LIGHT,
  MARKER_ICON_DARK,
  MARKER_CAPTION_LIGHT,
  MARKER_CAPTION_DARK,
  LABEL_TEXT_LIGHT,
  LABEL_TEXT_DARK,
  SELECTION_STROKE_LIGHT,
  SELECTION_STROKE_DARK,
} from './mapTheme';
import type { MapElement as MapElementType } from '@/services/api';

const MARKER_GLYPHS: Record<string, LucideIcon> = {
  stage: MicVocal,
  entrance: DoorOpen,
  restroom: Bath,
  food: Utensils,
  info: Info,
  firstAid: Cross,
  programming: Gamepad2,
};

interface MapElementProps {
  element: MapElementType;
  gridSize: number;
  dark: boolean;
  selected: boolean;
  onSelect?: (id: string, e?: React.MouseEvent | React.KeyboardEvent) => void;
}

/** Accessible name for an element, shared by the renderer and the builder. */
export function mapElementLabel(element: MapElementType): string {
  if (element.kind === 'wall') return 'Wall';
  if (element.kind === 'label') return `Text: ${element.text || 'Text'}`;
  const name = MARKER_LABELS[element.kind] || element.kind;
  return element.caption ? `${name}: ${element.caption}` : name;
}

// Every element is drawn inside its own box (x, y, w, h in floor units), so
// what the builder selects, moves and resizes is exactly what is painted.
export default function MapElement({
  element,
  gridSize,
  dark,
  selected,
  onSelect,
}: MapElementProps) {
  const x = element.x * gridSize;
  const y = element.y * gridSize;
  const w = Math.max(element.w, 0) * gridSize;
  const h = Math.max(element.h, 0) * gridSize;
  const selStroke = dark ? SELECTION_STROKE_DARK : SELECTION_STROKE_LIGHT;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelect) onSelect(element.id, e);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (onSelect) onSelect(element.id, e);
    }
  };

  const interactive = Boolean(onSelect);
  const shared = interactive
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        style: { cursor: 'pointer' },
      }
    : { role: 'img' as const };

  if (element.kind === 'wall') {
    const vertical = element.orientation === 'v';
    const thickness = Math.max(gridSize * 0.6, 3);
    const length = vertical ? Math.max(h, gridSize) : Math.max(w, gridSize);
    return (
      <g {...shared} aria-label={mapElementLabel(element)}>
        <rect
          x={x}
          y={y}
          width={vertical ? thickness : length}
          height={vertical ? length : thickness}
          rx={thickness / 2}
          fill={dark ? WALL_STROKE_DARK : WALL_STROKE_LIGHT}
          stroke={selected ? selStroke : 'none'}
          strokeWidth={selected ? 2 : 0}
        />
      </g>
    );
  }

  if (element.kind === 'label') {
    const fontSize = LABEL_FONT_SIZES[element.size || 'M'] || 14;
    return (
      <g {...shared} aria-label={mapElementLabel(element)}>
        <rect
          x={x}
          y={y}
          width={Math.max(w, gridSize)}
          height={Math.max(h, gridSize)}
          rx={3}
          fill="transparent"
          stroke={selected ? selStroke : 'none'}
          strokeWidth={selected ? 2 : 0}
          strokeDasharray={selected ? '4 3' : undefined}
        />
        <text
          x={x + Math.max(w, gridSize) / 2}
          y={y + Math.max(h, gridSize) / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={dark ? LABEL_TEXT_DARK : LABEL_TEXT_LIGHT}
          fontSize={fontSize * Math.max(1, gridSize / 10)}
          fontWeight={600}
          letterSpacing="0.02em"
          pointerEvents="none"
        >
          {element.text || 'Text'}
        </text>
      </g>
    );
  }

  // Landmarks: a rounded tile with an icon and an optional caption.
  const Glyph = MARKER_GLYPHS[element.kind] || MapPin;
  const bw = Math.max(w, gridSize);
  const bh = Math.max(h, gridSize);
  const iconSize = Math.max(10, Math.min(bw, bh) * (element.caption ? 0.42 : 0.55), 0);
  const captionSize = Math.max(7, Math.min(12, bw / 8));
  const showCaption = Boolean(element.caption) && bh >= iconSize + captionSize + 4;
  const iconY = y + bh / 2 - iconSize / 2 - (showCaption ? captionSize / 2 + 1 : 0);

  return (
    <g {...shared} aria-label={mapElementLabel(element)}>
      <rect
        x={x}
        y={y}
        width={bw}
        height={bh}
        rx={4}
        fill={dark ? MARKER_FILL_DARK : MARKER_FILL_LIGHT}
        stroke={selected ? selStroke : dark ? MARKER_STROKE_DARK : MARKER_STROKE_LIGHT}
        strokeWidth={selected ? 2 : 1}
      />
      <Glyph
        x={x + bw / 2 - iconSize / 2}
        y={iconY}
        width={iconSize}
        height={iconSize}
        color={dark ? MARKER_ICON_DARK : MARKER_ICON_LIGHT}
        strokeWidth={1.75}
        aria-hidden="true"
        pointerEvents="none"
      />
      {showCaption && (
        <text
          x={x + bw / 2}
          y={iconY + iconSize + captionSize / 2 + 3}
          textAnchor="middle"
          dominantBaseline="central"
          fill={dark ? MARKER_CAPTION_DARK : MARKER_CAPTION_LIGHT}
          fontSize={captionSize}
          fontWeight={500}
          pointerEvents="none"
        >
          {element.caption}
        </text>
      )}
    </g>
  );
}
