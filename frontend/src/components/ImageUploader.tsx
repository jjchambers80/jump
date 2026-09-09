'use client';

import { useRef, useState, useCallback } from 'react';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_SIZE_MB = 5;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

interface ImageUploaderProps {
  currentPreview?: string | null;
  onFileSelect: (file: File) => void;
  onRemove: () => void;
  uploading?: boolean;
  label?: string;
}

/**
 * Reusable image upload component with drag-and-drop, preview, and validation.
 */
export default function ImageUploader({
  currentPreview,
  onFileSelect,
  onRemove,
  uploading = false,
  label = 'logo',
}: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateAndSelect = useCallback(
    (file: File) => {
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

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) validateAndSelect(file);
    },
    [validateAndSelect]
  );

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
          dragOver
            ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-900/20'
            : 'border-gray-300 dark:border-slate-600'
        }`}
      >
        {currentPreview ? (
          <img
            src={currentPreview}
            alt={`${label} preview`}
            className="mx-auto mb-3 h-24 w-24 rounded-lg object-cover"
          />
        ) : (
          <div className="mb-3 flex justify-center">
            <svg
              className="h-10 w-10 text-gray-400 dark:text-slate-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-md border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {currentPreview ? `Replace ${label}` : `Choose ${label}`}
          </button>
          {currentPreview && (
            <button
              type="button"
              onClick={onRemove}
              disabled={uploading}
              className="rounded-md border border-red-300 dark:border-red-700 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
            >
              Remove {label}
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) validateAndSelect(file);
            e.target.value = '';
          }}
        />

        {!currentPreview && (
          <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
            Drag and drop or click to browse
          </p>
        )}
      </div>

      {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        JPG, PNG, GIF, or WebP up to {MAX_SIZE_MB} MB.
      </p>
    </div>
  );
}
