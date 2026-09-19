'use client';

// Content › Files › file — /admin/content/files/[fileId] (spec 025)
// Preview + Information card (name, alt text, details, used in), focal point
// for images, Download top-right. Nothing persists until Save.

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Download, FileText, Trash2 } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import ConfirmDialog from '@/components/content/ConfirmDialog';
import CopyLinkButton from '@/components/content/CopyLinkButton';
import FocalPointPicker from '@/components/content/FocalPointPicker';
import ToastHost, { showToast } from '@/components/content/Toast';
import { resolveAssetUrl } from '@/lib/assets';
import {
  FILE_ALT_MAX,
  FILE_NAME_MAX,
  fileTypeLabel,
  formatBytes,
  type StoreFileDetail,
} from '@/lib/content';
import { useFilesApi } from '../useFilesApi';

const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const label = 'block text-sm font-medium text-gray-700 dark:text-slate-300';

function formatAdded(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function FileDetailPage() {
  const params = useParams<{ fileId: string }>();
  const fileId = params.fileId;
  const router = useRouter();
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const filesApi = useFilesApi();

  const [file, setFile] = useState<StoreFileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [name, setName] = useState('');
  const [altText, setAltText] = useState('');
  const [focal, setFocal] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);

  const reset = useCallback((next: StoreFileDetail) => {
    setFile(next);
    setName(next.name);
    setAltText(next.altText ?? '');
    setFocal({ x: next.focalX ?? 0.5, y: next.focalY ?? 0.5 });
  }, []);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      reset(await filesApi.get(fileId));
    } catch (err: any) {
      if (err?.status === 404) setNotFound(true);
      else setError(err?.message || 'Failed to load file');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, filesApi, fileId, reset]);

  useEffect(() => {
    if (!orgLoading) void load();
  }, [orgLoading, load]);

  const dirty =
    !!file &&
    (name.trim() !== file.name ||
      altText.trim() !== (file.altText ?? '') ||
      (file.kind === 'image' && (focal.x !== file.focalX || focal.y !== file.focalY)));
  const valid =
    name.trim().length > 0 &&
    name.trim().length <= FILE_NAME_MAX &&
    !/[\\/]/.test(name) &&
    altText.trim().length <= FILE_ALT_MAX;

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!file || !dirty || !valid || saving) return;
    setSaving(true);
    setSaveError(null);
    const body: { name?: string; altText?: string | null; focalX?: number; focalY?: number } = {};
    if (name.trim() !== file.name) body.name = name.trim();
    if (altText.trim() !== (file.altText ?? '')) body.altText = altText.trim() || null;
    if (file.kind === 'image' && (focal.x !== file.focalX || focal.y !== file.focalY)) {
      body.focalX = focal.x;
      body.focalY = focal.y;
    }
    try {
      reset(await filesApi.update(file.id, body));
      showToast('Saved');
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (file) reset(file);
  };

  const remove = async () => {
    if (!file) return;
    setDeleting(true);
    try {
      await filesApi.remove(file.id);
      router.push('/admin/content/files');
    } catch (err: any) {
      setDeleting(false);
      setConfirmDelete(false);
      showToast(err?.message || 'Delete failed');
    }
  };

  const back = (
    <Link
      href="/admin/content/files"
      className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline dark:text-slate-300"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Files
    </Link>
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        {back}
        <div aria-label="Loading file" className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="h-96 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
          <div className="h-72 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  if (notFound || (!file && !error)) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        {back}
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          {selectedOrgId
            ? 'This file was not found.'
            : 'Pick an organization from the menu in the top right.'}
        </div>
      </div>
    );
  }

  if (error || !file) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        {back}
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 font-semibold underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const previewSrc = resolveAssetUrl(file.kind === 'image' ? file.url : null);

  return (
    <form onSubmit={save} className="mx-auto max-w-7xl px-4 py-8 pb-28">
      <ToastHost />
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4"
        data-testid="file-header"
      >
        <div className="min-w-0">
          {back}
          <h1 className="mt-1 truncate text-2xl font-bold text-gray-900 dark:text-white">
            {file.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <CopyLinkButton url={file.url} className="border border-gray-300 dark:border-slate-600" />
          <button
            ref={deleteRef}
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-800 dark:text-red-300"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete
          </button>
          <a
            href={file.downloadUrl}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            <Download className="h-4 w-4" aria-hidden />
            Download
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section
          aria-label="Preview"
          className="flex min-h-[24rem] items-center justify-center rounded-lg border border-gray-200 bg-[linear-gradient(45deg,#f3f4f6_25%,transparent_25%,transparent_75%,#f3f4f6_75%),linear-gradient(45deg,#f3f4f6_25%,transparent_25%,transparent_75%,#f3f4f6_75%)] bg-white p-6 [background-position:0_0,10px_10px] [background-size:20px_20px] dark:border-slate-700 dark:bg-slate-800 dark:bg-none"
        >
          {file.kind === 'image' && previewSrc ? (
            <div className="text-center">
              <FocalPointPicker
                src={previewSrc}
                alt={file.altText ?? file.name}
                focalX={focal.x}
                focalY={focal.y}
                onChange={(x, y) => setFocal({ x, y })}
              />
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-gray-900/80 px-3 py-1 text-xs text-white dark:bg-slate-900">
                <span className="h-2.5 w-2.5 rounded-full bg-indigo-400" aria-hidden />
                Click the image to set the focal point
              </p>
            </div>
          ) : (
            <div className="w-full">
              <object
                data={resolveAssetUrl(file.url) || undefined}
                type={file.mimeType}
                className="h-[32rem] w-full rounded-md"
                aria-label={`${file.name} preview`}
              >
                <div className="flex h-64 flex-col items-center justify-center text-gray-500 dark:text-slate-400">
                  <FileText className="h-10 w-10" aria-hidden />
                  <p className="mt-2 text-sm">
                    {fileTypeLabel(file)} preview is not available here.
                  </p>
                </div>
              </object>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Information</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="file-name" className={label}>
                  Name
                </label>
                <input
                  id="file-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={FILE_NAME_MAX}
                  required
                  className={field}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  .{file.extension} — existing links keep working after a rename.
                </p>
              </div>
              <div>
                <label htmlFor="file-alt" className={label}>
                  Alt text
                </label>
                <textarea
                  id="file-alt"
                  value={altText}
                  onChange={(event) => setAltText(event.target.value)}
                  maxLength={FILE_ALT_MAX}
                  rows={3}
                  placeholder={
                    file.kind === 'image'
                      ? 'Describe the image for screen readers and search engines'
                      : 'Optional description'
                  }
                  className={field}
                />
                <p className="mt-1 text-right text-xs text-gray-500 dark:text-slate-400">
                  {altText.length}/{FILE_ALT_MAX}
                </p>
              </div>
              <dl className="text-sm">
                <dt className="font-medium text-gray-700 dark:text-slate-300">Details</dt>
                <dd className="text-gray-600 dark:text-slate-400">
                  {fileTypeLabel(file)}
                  {file.width && file.height ? ` • ${file.width} × ${file.height}` : ''} •{' '}
                  {formatBytes(file.sizeBytes)}
                </dd>
                <dd className="text-gray-600 dark:text-slate-400">
                  Added {formatAdded(file.createdAt)}
                </dd>
                <dt className="mt-3 font-medium text-gray-700 dark:text-slate-300">Used in</dt>
                <dd className="text-gray-600 dark:text-slate-400" data-testid="used-in">
                  {file.references.length === 0 ? (
                    'Not used yet'
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {file.references.map((ref) => (
                        <li key={`${ref.kind}:${ref.targetId}`}>
                          <Link
                            href={ref.href}
                            className="text-indigo-600 hover:underline dark:text-indigo-300"
                          >
                            {ref.title}
                          </Link>
                          <span className="ml-1 text-xs text-gray-500 dark:text-slate-500">
                            {ref.kind === 'PAGE' ? 'Page' : 'Blog post'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </dl>
            </div>
          </section>
          <section className="rounded-lg border border-gray-200 bg-white p-5 text-sm dark:border-slate-700 dark:bg-slate-800">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Link</h2>
            <p className="mt-2 break-all text-gray-600 dark:text-slate-400" data-testid="file-url">
              {file.url}
            </p>
          </section>
        </aside>
      </div>

      {dirty && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
          data-testid="save-bar"
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <p className="text-sm font-medium text-gray-900 dark:text-white">Unsaved changes</p>
            <div className="flex items-center gap-2">
              {saveError && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {saveError}
                </p>
              )}
              <button
                type="button"
                onClick={discard}
                disabled={saving}
                className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Discard
              </button>
              <button
                type="submit"
                disabled={!valid || saving}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          titleId="delete-file-title"
          title={`Delete ${file.name}?`}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={deleting}
          danger
          returnFocusRef={deleteRef}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        >
          <p>Links to this file will stop working. This cannot be undone.</p>
          {file.references.length > 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              Used in {file.references.length} {file.references.length === 1 ? 'place' : 'places'}:{' '}
              {file.references.map((ref) => ref.title).join(', ')}.
            </p>
          )}
        </ConfirmDialog>
      )}
    </form>
  );
}
