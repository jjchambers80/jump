'use client';

// Insert gallery: pick a Content › Galleries record and how it shows. With
// `editing` it changes or removes the selected embed. Escape, backdrop and ✕
// cancel; focus returns to the toolbar button. Portalled to <body> so the
// editor's .jump-prose styles don't reach it.

import Link from 'next/link';
import { X } from 'lucide-react';
import { RefObject, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GallerySummary } from '@/lib/galleries';
import type { GalleryAttrs, GalleryLayout } from './GalleryEmbed';

interface InsertGalleryDialogProps {
  galleries: GallerySummary[] | null;
  editing?: GalleryAttrs | null;
  returnFocusRef?: RefObject<HTMLElement>;
  onClose: () => void;
  onSubmit: (gallery: GalleryAttrs) => void;
  onRemove?: () => void;
}

const LAYOUTS: { value: GalleryLayout; label: string; help: string }[] = [
  { value: 'masonry', label: 'Masonry grid', help: 'Every photo, in columns. Opens a viewer on click.' },
  { value: 'carousel', label: 'Carousel', help: 'One row that scrolls sideways, with arrows.' },
];

export default function InsertGalleryDialog({
  galleries,
  editing,
  returnFocusRef,
  onClose,
  onSubmit,
  onRemove,
}: InsertGalleryDialogProps) {
  const id = useId();
  const [galleryId, setGalleryId] = useState(editing?.id ?? '');
  const [layout, setLayout] = useState<GalleryLayout>(editing?.layout ?? 'masonry');
  const selectRef = useRef<HTMLSelectElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      // aria-modal: Tab wraps inside the dialog instead of reaching the page.
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select, input:not([disabled])')
      ).filter((el) => !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const returnTo = returnFocusRef?.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo?.focus();
    };
    // Mount-only focus management.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!galleryId && galleries?.length) setGalleryId(galleries[0].id);
  }, [galleries, galleryId]);

  const missing = editing && galleries && !galleries.some((g) => g.id === editing.id);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="w-full max-w-lg rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-xl"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 id={`${id}-title`} className="text-base font-semibold text-gray-900 dark:text-white">
            {editing ? 'Edit gallery' : 'Insert gallery'}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="space-y-5 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {galleries === null ? (
            <div aria-label="Loading galleries" className="h-10 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
          ) : galleries.length === 0 ? (
            <p className="text-sm text-gray-700 dark:text-slate-300">
              No galleries yet.{' '}
              <Link href="/admin/content/galleries" target="_blank" className="font-medium text-indigo-700 underline dark:text-indigo-300">
                Create one in Content › Galleries
              </Link>
              , then come back.
            </p>
          ) : (
            <div>
              <label htmlFor={`${id}-gallery`} className="block text-sm font-medium text-gray-800 dark:text-slate-200">
                Gallery
              </label>
              <select
                ref={selectRef}
                id={`${id}-gallery`}
                value={galleryId}
                onChange={(event) => setGalleryId(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
              >
                {missing && <option value={editing!.id}>Deleted gallery</option>}
                {galleries.map((gallery) => (
                  <option key={gallery.id} value={gallery.id}>
                    {gallery.title} ({gallery.photoCount} {gallery.photoCount === 1 ? 'photo' : 'photos'})
                  </option>
                ))}
              </select>
            </div>
          )}
          <fieldset>
            <legend className="text-sm font-medium text-gray-800 dark:text-slate-200">Show as</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {LAYOUTS.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${
                    layout === option.value
                      ? 'border-indigo-600 ring-1 ring-indigo-600 dark:border-indigo-400 dark:ring-indigo-400'
                      : 'border-gray-300 dark:border-slate-600'
                  }`}
                >
                  <input
                    type="radio"
                    name={`${id}-layout`}
                    value={option.value}
                    checked={layout === option.value}
                    onChange={() => setLayout(option.value)}
                    className="mt-0.5 h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>
                    <span className="block font-medium text-gray-900 dark:text-white">{option.label}</span>
                    <span className="block text-gray-600 dark:text-slate-400">{option.help}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center justify-end gap-2">
            {editing && onRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="mr-auto min-h-10 rounded-lg px-2 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Remove gallery
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-10 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!galleryId}
              onClick={() => onSubmit({ id: galleryId, layout })}
              className="min-h-10 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-slate-900"
            >
              {editing ? 'Save gallery' : 'Insert gallery'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
