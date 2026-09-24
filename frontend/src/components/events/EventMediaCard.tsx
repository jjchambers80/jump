'use client';

// Media card on the admin event edit page. One image for now (the event logo),
// laid out like a media grid: the image tile, then a dashed drop tile that
// replaces it. Empty state is a single dashed drop zone.

import { useCallback, useRef, useState } from 'react';
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { ALLOWED_TYPES, MAX_SIZE_BYTES, MAX_SIZE_MB } from '@/components/ImageUploader';
import { FormCard } from './EventFormLayout';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800';

const acceptsHint = `Accepts JPG, PNG, GIF or WebP up to ${MAX_SIZE_MB} MB`;

export function EventMediaCard({
  preview,
  eventName,
  uploading,
  onFileSelect,
  onRemove,
}: {
  preview: string | null;
  eventName: string;
  uploading: boolean;
  onFileSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!ALLOWED_TYPES.includes(file.type)) {
        setError('Only JPG, PNG, GIF, and WebP images are allowed');
        return;
      }
      if (file.size > MAX_SIZE_BYTES) {
        setError(`Image must be ${MAX_SIZE_MB} MB or smaller`);
        return;
      }
      setError(null);
      onFileSelect(file);
    },
    [onFileSelect]
  );

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (!uploading) setDragOver(true);
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (!uploading) pick(e.dataTransfer.files[0]);
    },
  };

  const browse = () => inputRef.current?.click();

  const dropTone = dragOver
    ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-900/20'
    : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50 dark:border-slate-600 dark:hover:border-slate-500 dark:hover:bg-slate-700/40';

  return (
    <FormCard id="event-media" title="Media">
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_TYPES.join(',')}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {preview ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
          <figure className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-900">
            <img
              src={preview}
              alt={eventName ? `${eventName} event image` : 'Event image'}
              className="h-full w-full object-contain"
            />
            {uploading && <UploadingOverlay />}
            <button
              type="button"
              onClick={onRemove}
              disabled={uploading}
              aria-label="Remove image"
              title="Remove image"
              className={`absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white/95 text-gray-700 shadow-sm transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800/95 dark:text-slate-200 dark:hover:bg-red-900/30 dark:hover:text-red-300 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 motion-reduce:transition-none ${focusRing}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </figure>

          <button
            type="button"
            onClick={browse}
            disabled={uploading}
            {...dropHandlers}
            className={`flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm font-medium text-gray-600 transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 motion-reduce:transition-none ${dropTone} ${focusRing}`}
          >
            <RefreshCw className="h-5 w-5 text-gray-400 dark:text-slate-500" aria-hidden />
            Replace
          </button>
        </div>
      ) : (
        <div
          {...dropHandlers}
          className={`relative flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors motion-reduce:transition-none ${dropTone}`}
        >
          {uploading ? (
            <UploadingOverlay />
          ) : (
            <>
              <ImagePlus className="h-8 w-8 text-gray-400 dark:text-slate-500" aria-hidden />
              <button
                type="button"
                onClick={browse}
                className={`inline-flex min-h-9 items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 ${focusRing}`}
              >
                Upload new
              </button>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                or drag and drop an image
                <span className="mt-1 block">{acceptsHint}</span>
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {preview && <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">{acceptsHint}</p>}
    </FormCard>
  );
}

function UploadingOverlay() {
  return (
    <div
      role="status"
      className="absolute inset-0 flex items-center justify-center gap-2 bg-white/70 text-sm font-medium text-gray-700 dark:bg-slate-900/70 dark:text-slate-200"
    >
      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
      Uploading…
    </div>
  );
}
