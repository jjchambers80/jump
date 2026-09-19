'use client';

// Pick an image from Content › Files (or upload one) — featured image and
// editor image insert. Resolves with the chosen file.

import { Search } from 'lucide-react';
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useFilesApi } from '@/app/admin/content/files/useFilesApi';
import { resolveAssetUrl } from '@/lib/assets';
import type { StoreFile } from '@/lib/content';
import UploadFilesDialog from './UploadFilesDialog';

interface FilePickerDialogProps {
  title?: string;
  returnFocusRef?: RefObject<HTMLElement>;
  onClose: () => void;
  onPick: (file: StoreFile) => void;
}

export default function FilePickerDialog({
  title = 'Choose an image',
  returnFocusRef,
  onClose,
  onPick,
}: FilePickerDialogProps) {
  const filesApi = useFilesApi();
  const [files, setFiles] = useState<StoreFile[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const uploadRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await filesApi.list({ type: 'image', q: q.trim(), sort: 'created_desc' });
      setFiles(result.files);
    } catch (err: any) {
      setError(err?.message || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [filesApi, q]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !uploadOpen) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const returnTo = returnFocusRef?.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadOpen]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      {...(uploadOpen ? { 'aria-hidden': true } : {})}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-picker-title"
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white p-5 shadow-2xl dark:bg-slate-900"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="file-picker-title"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            {title}
          </h2>
          <button
            ref={uploadRef}
            type="button"
            onClick={() => setUploadOpen(true)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Upload
          </button>
        </div>
        <div className="relative mt-3">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search images"
            placeholder="Search images"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="mt-3 min-h-40 flex-1 overflow-y-auto">
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {loading ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="aspect-square animate-pulse rounded-md bg-gray-200 dark:bg-slate-700"
                />
              ))}
            </div>
          ) : files.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500 dark:text-slate-400">
              {q ? 'No images match.' : 'No images yet — upload one.'}
            </p>
          ) : (
            <ul
              className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5"
              data-testid="file-picker-grid"
            >
              {files.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => onPick(file)}
                    className="group block w-full overflow-hidden rounded-md border border-gray-200 text-left focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={resolveAssetUrl(file.previewUrl ?? file.thumbUrl) || undefined}
                      alt={file.altText ?? file.name}
                      className="aspect-square w-full object-cover transition-transform duration-150 group-hover:scale-[1.02] motion-reduce:transition-none"
                    />
                    <span className="block truncate px-2 py-1 text-xs text-gray-700 dark:text-slate-300">
                      {file.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      </div>
      {uploadOpen && (
        <UploadFilesDialog
          upload={filesApi.upload}
          returnFocusRef={uploadRef}
          onClose={() => setUploadOpen(false)}
          onUploaded={(result) => {
            const image = result.files.find((file) => file.kind === 'image');
            if (image) onPick(image);
            else void load();
          }}
        />
      )}
    </div>
  );
}
