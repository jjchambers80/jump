'use client';

// Upload files (Content › Files): drop zone + picker, client-side pre-checks,
// one multipart request, per-file server errors listed before closing.

import { Upload } from 'lucide-react';
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  ACCEPT_ATTRIBUTE,
  MAX_FILES_PER_UPLOAD,
  MAX_FILE_MB,
  formatBytes,
  validateLocalFile,
} from '@/lib/content';
import type { UploadResult } from '@/app/admin/content/files/useFilesApi';

interface UploadFilesDialogProps {
  upload: (files: File[]) => Promise<UploadResult>;
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  onUploaded: (result: UploadResult) => void;
  /** Files dropped onto the page before the dialog opened. */
  initialFiles?: File[];
}

interface Row {
  file: File;
  error: string | null;
}

export default function UploadFilesDialog({
  upload,
  returnFocusRef,
  onClose,
  onUploaded,
  initialFiles,
}: UploadFilesDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>(() =>
    (initialFiles ?? []).map((file) => ({ file, error: validateLocalFile(file) }))
  );
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [serverErrors, setServerErrors] = useState<{ name: string; message: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !uploading) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const returnTo = returnFocusRef.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploading]);

  const addFiles = useCallback((list: FileList | File[] | null) => {
    if (!list) return;
    setError(null);
    setRows((current) => {
      const next = [...current];
      for (const file of Array.from(list)) {
        if (next.length >= MAX_FILES_PER_UPLOAD) {
          setError(`Upload up to ${MAX_FILES_PER_UPLOAD} files at a time`);
          break;
        }
        next.push({ file, error: validateLocalFile(file) });
      }
      return next;
    });
  }, []);

  const valid = rows.filter((row) => !row.error);

  const submit = async () => {
    if (!valid.length || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const result = await upload(valid.map((row) => row.file));
      if (result.errors.length) {
        setServerErrors(result.errors);
        setRows((current) =>
          current.filter((row) => result.errors.some((e) => e.name === row.file.name))
        );
        onUploaded(result);
        setUploading(false);
        return;
      }
      onUploaded(result);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
      setUploading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !uploading) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-files-title"
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl dark:bg-slate-900"
      >
        <h2 id="upload-files-title" className="text-lg font-semibold text-gray-900 dark:text-white">
          Upload files
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          JPG, PNG, GIF, WebP or PDF, up to {MAX_FILE_MB} MB each, {MAX_FILES_PER_UPLOAD} at a time.
        </p>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            addFiles(event.dataTransfer.files);
          }}
          className={`mt-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragOver
              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
              : 'border-gray-300 dark:border-slate-600'
          }`}
        >
          <Upload className="h-6 w-6 text-gray-400" aria-hidden />
          <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">Drag files here, or</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Choose files
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            data-testid="upload-input"
            className="sr-only"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </div>

        {rows.length > 0 && (
          <ul className="mt-4 max-h-56 divide-y divide-gray-200 overflow-y-auto rounded-md border border-gray-200 text-sm dark:divide-slate-700 dark:border-slate-700">
            {rows.map((row, index) => (
              <li
                key={`${row.file.name}-${index}`}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900 dark:text-white">
                    {row.file.name}
                  </p>
                  <p
                    className={`text-xs ${row.error ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-slate-400'}`}
                  >
                    {row.error ?? formatBytes(row.file.size)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${row.file.name}`}
                  disabled={uploading}
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                  className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {serverErrors.length > 0 && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
          >
            <p className="font-medium">Some files were not uploaded</p>
            <ul className="mt-1 list-disc pl-5">
              {serverErrors.map((e) => (
                <li key={e.name}>
                  {e.name}: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {serverErrors.length ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid.length || uploading}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : `Upload${valid.length ? ` ${valid.length}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
