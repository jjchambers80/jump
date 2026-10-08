'use client';

// Pick an image (or, with kind="video", a video) from Content › Files, or
// upload one — featured image, editor image insert, theme Hero video. With
// `multiple`, tiles toggle a selection and the footer adds them all at once
// (galleries, spec 046); uploads join the selection.

import { Check, Search } from 'lucide-react';
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useFilesApi } from '@/app/admin/content/files/useFilesApi';
import { resolveAssetUrl } from '@/lib/assets';
import type { StoreFile } from '@/lib/content';
import UploadFilesDialog from './UploadFilesDialog';

interface FilePickerDialogProps {
  title?: string;
  kind?: 'image' | 'video';
  returnFocusRef?: RefObject<HTMLElement>;
  onClose: () => void;
  onPick?: (file: StoreFile) => void;
  multiple?: boolean;
  onPickMany?: (files: StoreFile[]) => void;
}

export default function FilePickerDialog({
  kind = 'image',
  title = kind === 'video' ? 'Choose a video' : 'Choose an image',
  returnFocusRef,
  onClose,
  onPick,
  multiple = false,
  onPickMany,
}: FilePickerDialogProps) {
  const filesApi = useFilesApi();
  const [files, setFiles] = useState<StoreFile[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<StoreFile[]>([]);
  const isSelected = (file: StoreFile) => selected.some((entry) => entry.id === file.id);
  const toggle = (file: StoreFile) =>
    setSelected((current) =>
      current.some((entry) => entry.id === file.id)
        ? current.filter((entry) => entry.id !== file.id)
        : [...current, file]
    );
  const noun = kind === 'video' ? 'video' : 'photo';
  const uploadRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await filesApi.list({ type: kind, q: q.trim(), sort: 'created_desc' });
      setFiles(result.files);
    } catch (err: any) {
      setError(err?.message || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [filesApi, q, kind]);

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
            aria-label={`Search ${kind}s`}
            placeholder={`Search ${kind}s`}
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
              {q ? `No ${kind}s match.` : `No ${kind}s yet — upload one.`}
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
                    onClick={() => (multiple ? toggle(file) : onPick?.(file))}
                    {...(multiple ? { 'aria-pressed': isSelected(file) } : {})}
                    className={`group relative block w-full overflow-hidden rounded-md border text-left focus:outline-none focus:ring-2 focus:ring-accent-500 ${
                      multiple && isSelected(file)
                        ? 'border-accent-600 ring-2 ring-accent-600 dark:border-accent-400 dark:ring-accent-400'
                        : 'border-gray-200 dark:border-slate-600'
                    }`}
                  >
                    {multiple && (
                      <span
                        aria-hidden
                        className={`absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow ${
                          isSelected(file) ? 'bg-accent-500 text-gray-950' : 'bg-black/30 text-transparent'
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {kind === 'video' ? (
                      <video
                        src={resolveAssetUrl(file.url) || undefined}
                        muted
                        preload="metadata"
                        aria-hidden
                        className="aspect-square w-full bg-black object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveAssetUrl(file.previewUrl ?? file.thumbUrl) || undefined}
                        alt={file.altText ?? file.name}
                        className="aspect-square w-full object-cover transition-transform duration-150 group-hover:scale-[1.02] motion-reduce:transition-none"
                      />
                    )}
                    <span className="block truncate px-2 py-1 text-xs text-gray-700 dark:text-slate-300">
                      {file.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          {multiple && (
            <p aria-live="polite" className="mr-auto text-sm text-gray-600 dark:text-slate-300">
              {selected.length ? `${selected.length} selected` : ''}
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          {multiple && (
            <button
              type="button"
              disabled={!selected.length}
              onClick={() => onPickMany?.(selected)}
              className="rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-gray-950 hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selected.length
                ? `Add ${selected.length} ${noun}${selected.length === 1 ? '' : 's'}`
                : `Add ${noun}s`}
            </button>
          )}
        </div>
      </div>
      {uploadOpen && (
        <UploadFilesDialog
          upload={filesApi.upload}
          returnFocusRef={uploadRef}
          onClose={() => setUploadOpen(false)}
          onUploaded={(result) => {
            if (multiple) {
              const uploaded = result.files.filter((file) => file.kind === kind);
              setSelected((current) => [...current, ...uploaded.filter((file) => !current.some((c) => c.id === file.id))]);
              void load();
              return;
            }
            const picked = result.files.find((file) => file.kind === kind);
            if (picked) onPick?.(picked);
            else void load();
          }}
        />
      )}
    </div>
  );
}
