'use client';

import React from 'react';
import {
  MARKER_LABELS,
  LABEL_FONT_SIZES,
  WALL_STROKE_LIGHT,
  WALL_STROKE_DARK,
  MARKER_FILL_LIGHT,
  MARKER_FILL_DARK,
  MARKER_STROKE_LIGHT,
  MARKER_STROKE_DARK,
  MARKER_CAPTION_LIGHT,
  MARKER_CAPTION_DARK,
  LABEL_TEXT_LIGHT,
  LABEL_TEXT_DARK,
  SELECTION_STROKE_LIGHT,
  SELECTION_STROKE_DARK,
  SELECTION_FILL_LIGHT,
  SELECTION_FILL_DARK,
} from './mapTheme';
import type { MapElement as MapElementType } from '@/services/api';

interface MapElementProps {
  element: MapElementType;
  gridSize: number;
  dark: boolean;
  selected: boolean;
  onSelect?: (id: string, e?: React.MouseEvent | React.KeyboardEvent) => void;
}

export default function MapElement({
  element,
  gridSize,
  dark,
  selected,
  onSelect,
}: MapElementProps) {
  const x = element.x * gridSize;
  const y = element.y * gridSize;
  const w = Math.max(element.w * gridSize, 10);
  const h = Math.max(element.h * gridSize, 10);
  const isMarker = !['wall', 'aisle', 'label'].includes(element.kind);
  const isWall = element.kind === 'wall';

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

  if (isWall) {
    const orientation = element.orientation || 'h';
    const isH = orientation === 'h';
    const length = isH ? w : h;
    return (
      <g
        role="button"
        tabIndex={0}
        aria-label={`Wall ${element.id}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{ cursor: 'pointer' }}
      >
        <line
          x1={x}
          y1={y}
          x2={isH ? x + length : x}
          y2={isH ? y : y + length}
          stroke={dark ? WALL_STROKE_DARK : WALL_STROKE_LIGHT}
          strokeWidth={selected ? 3 : 2}
        />
        {selected && (
          <circle cx={isH ? x + length / 2 : x} cy={isH ? y : y + length / 2} r={4} fill={dark ? SELECTION_FILL_DARK : SELECTION_FILL_LIGHT} />
        )}
      </g>
    );
  }

  if (isMarker) {
    const label = MARKER_LABELS[element.kind] || element.kind;
    return (
      <g
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{ cursor: 'pointer' }}
      >
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={4}
          fill={dark ? MARKER_FILL_DARK : MARKER_FILL_LIGHT}
          stroke={selected ? (dark ? SELECTION_STROKE_DARK : SELECTION_STROKE_LIGHT) : (dark ? MARKER_STROKE_DARK : MARKER_STROKE_LIGHT)}
          strokeWidth={selected ? 2 : 1}
        />
        <text
          x={x + w / 2}
          y={y + h / 2 - (element.caption ? 6 : 0)}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={20}
          pointerEvents="none"
        >
          {element.kind === 'stage' ? '\uD83C\uDF99' :
           element.kind === 'entrance' ? '\uD83D\uDEAA' :
           element.kind === 'restroom' ? '\uD83D\uDEBB' :
           element.kind === 'food' ? '\uD83C\uDF74' :
           element.kind === 'info' ? '\u2139' :
           element.kind === 'firstAid' ? '\u271A' :
           element.kind === 'programming' ? '\uD83C\uDFAE' : '\uD83D\uDCCD'}
        </text>
        {element.caption && (
          <text
            x={x + w / 2}
            y={y + h / 2 + 10}
            textAnchor="middle"
            dominantBaseline="central"
            fill={dark ? MARKER_CAPTION_DARK : MARKER_CAPTION_LIGHT}
            fontSize={9}
            pointerEvents="none"
          >
            {element.caption}
          </text>
        )}
      </g>
    );
  }

  const fontSize = LABEL_FONT_SIZES[element.size || 'M'] || 14;

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Label: ${element.text || ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ cursor: 'pointer' }}
    >
      <rect
        x={x - 2}
        y={y - fontSize}
        width={w + 4}
        height={fontSize + 4}
        rx={2}
        fill={selected ? (dark ? SELECTION_FILL_DARK : SELECTION_FILL_LIGHT) : 'transparent'}
        opacity={selected ? 0.3 : 0}
        pointerEvents="none"
      />
      <text
        x={x}
        y={y}
        textAnchor="start"
        dominantBaseline="auto"
        fill={dark ? LABEL_TEXT_DARK : LABEL_TEXT_LIGHT}
        fontSize={fontSize}
        fontWeight={500}
        pointerEvents="none"
      >
        {element.text || 'Text'}
      </text>
    </g>
  );
}