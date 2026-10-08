'use client';

// One photo in the gallery editor grid: a button that opens the photo panel,
// draggable by mouse or press-and-hold on touch. Keyboard users move photos
// with the panel's buttons (2.5.7), so no keyboard drag sensor is attached.

import { AlertTriangle } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { resolveAssetUrl } from '@/lib/assets';
import { effectiveAlt, needsAlt, type DraftItem } from '@/lib/galleries';

interface PhotoTileProps {
  item: DraftItem;
  onOpen: () => void;
}

export default function PhotoTile({ item, onOpen }: PhotoTileProps) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: item.key });
  const missing = needsAlt(item);
  const label = effectiveAlt(item) || item.file.name;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-10 opacity-80' : 'relative'}
    >
      <button
        type="button"
        data-tile-key={item.key}
        data-testid="gallery-photo"
        onClick={onOpen}
        aria-label={`Edit photo: ${label}${missing ? ' (alt text missing)' : ''}`}
        className="group block aspect-square w-full touch-manipulation overflow-hidden rounded-md border border-gray-200 bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:border-slate-600 dark:bg-slate-700 dark:focus-visible:ring-offset-slate-800"
        {...listeners}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolveAssetUrl(item.file.previewUrl ?? item.file.thumbUrl) || undefined}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
        {missing && (
          <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 shadow-sm">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Alt text
          </span>
        )}
        {item.decorative && (
          <span className="absolute bottom-1 left-1 rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium text-gray-700 shadow-sm">
            Decorative
          </span>
        )}
      </button>
    </li>
  );
}
