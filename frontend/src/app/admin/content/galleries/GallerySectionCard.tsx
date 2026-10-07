'use client';

// One section of the gallery editor: optional heading, its photo grid
// (drag to reorder within the section) and Add photos / drop to upload.

import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react';
import { DragEvent, useState } from 'react';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import type { DraftSection } from '@/lib/galleries';
import PhotoTile from './PhotoTile';

interface GallerySectionCardProps {
  section: DraftSection;
  index: number;
  count: number;
  canAddPhotos: boolean;
  onChange: (section: DraftSection) => void;
  onMove: (offset: number) => void;
  onDelete: () => void;
  onAddPhotos: () => void;
  onDropFiles: (files: File[]) => void;
  onOpenPhoto: (itemKey: string) => void;
  onReordered: (message: string) => void;
}

const iconButton =
  'inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700';

export default function GallerySectionCard({
  section,
  index,
  count,
  canAddPhotos,
  onChange,
  onMove,
  onDelete,
  onAddPhotos,
  onDropFiles,
  onOpenPhoto,
  onReordered,
}: GallerySectionCardProps) {
  const [dragOver, setDragOver] = useState(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
  );
  const name = section.title.trim() || `Section ${index + 1}`;
  const titleId = `section-title-${section.key}`;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = section.items.findIndex((item) => item.key === active.id);
    const to = section.items.findIndex((item) => item.key === over.id);
    onChange({ ...section, items: arrayMove(section.items, from, to) });
    onReordered(`Moved photo ${from + 1} to position ${to + 1} in ${name}`);
  };

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

  return (
    <section
      aria-label={name}
      data-testid="gallery-section"
      onDragOver={(event) => {
        if (!hasFiles(event) || !canAddPhotos) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        if (!hasFiles(event) || !canAddPhotos) return;
        event.preventDefault();
        setDragOver(false);
        onDropFiles(Array.from(event.dataTransfer.files));
      }}
      className={`rounded-lg border bg-white p-4 shadow-sm dark:bg-slate-800 sm:p-5 ${
        dragOver ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-gray-200 dark:border-slate-700'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={titleId} className="sr-only">
            Section {index + 1} heading
          </label>
          <input
            id={titleId}
            value={section.title}
            onChange={(event) => onChange({ ...section, title: event.target.value })}
            maxLength={120}
            placeholder={count > 1 ? `Section ${index + 1} heading (optional)` : 'Heading (optional)'}
            className="block w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-base font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-500 hover:border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:text-white dark:placeholder:text-slate-400 dark:hover:border-slate-600"
          />
          <p className="px-2 text-sm text-gray-500 dark:text-slate-400">
            {section.items.length} {section.items.length === 1 ? 'photo' : 'photos'}
          </p>
        </div>
        {count > 1 && (
          <div className="flex flex-none items-center">
            <button type="button" className={iconButton} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${name} up`}>
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" className={iconButton} disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${name} down`}>
              <ArrowDown className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" className={`${iconButton} text-red-700 dark:text-red-300`} onClick={onDelete} aria-label={`Delete ${name}`}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
      </div>

      {section.items.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={section.items.map((item) => item.key)} strategy={rectSortingStrategy}>
            <ul
              aria-label={`Photos in ${name}`}
              className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
            >
              {section.items.map((item) => (
                <PhotoTile key={item.key} item={item} onOpen={() => onOpenPhoto(item.key)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          data-add-photos={section.key}
          onClick={onAddPhotos}
          disabled={!canAddPhotos}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:border-slate-600 dark:text-indigo-300 dark:hover:bg-slate-700"
        >
          <ImagePlus className="h-4 w-4" aria-hidden />
          Add photos
        </button>
        <span className="hidden text-sm text-gray-500 dark:text-slate-400 md:inline">or drop images here</span>
      </div>
    </section>
  );
}
