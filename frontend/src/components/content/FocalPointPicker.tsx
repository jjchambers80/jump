'use client';

// Click (or arrow-key) to set the focal point of an image — the part kept in
// view when a variant is cropped. Values are fractions 0–1 from the top left.

import { useRef } from 'react';

interface FocalPointPickerProps {
  src: string;
  alt: string;
  focalX: number;
  focalY: number;
  onChange: (focalX: number, focalY: number) => void;
}

const clamp = (value: number) => Math.min(1, Math.max(0, Math.round(value * 100) / 100));

export default function FocalPointPicker({
  src,
  alt,
  focalX,
  focalY,
  onChange,
}: FocalPointPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Focal point"
      aria-valuetext={`${Math.round(focalX * 100)}% from the left, ${Math.round(focalY * 100)}% from the top`}
      aria-valuenow={Math.round(focalX * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      data-testid="focal-point-picker"
      className="relative inline-block max-w-full cursor-crosshair select-none rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onChange(
          clamp((event.clientX - rect.left) / rect.width),
          clamp((event.clientY - rect.top) / rect.height)
        );
      }}
      onKeyDown={(event) => {
        const step = 0.01;
        if (event.key === 'ArrowLeft') onChange(clamp(focalX - step), focalY);
        else if (event.key === 'ArrowRight') onChange(clamp(focalX + step), focalY);
        else if (event.key === 'ArrowUp') onChange(focalX, clamp(focalY - step));
        else if (event.key === 'ArrowDown') onChange(focalX, clamp(focalY + step));
        else return;
        event.preventDefault();
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="block max-h-[70vh] max-w-full rounded-md"
        draggable={false}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-indigo-600/70 shadow ring-1 ring-black/30"
        style={{ left: `${focalX * 100}%`, top: `${focalY * 100}%` }}
      />
    </div>
  );
}
