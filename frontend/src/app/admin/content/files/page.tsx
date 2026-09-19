'use client';

// Content › Files — /admin/content/files (spec 025)
// Organization-scoped uploads (images, PDFs) with public links. Rows open the
// detail page; hovering a row reveals Copy link / Download / Delete.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import ConfirmDialog from '@/components/content/ConfirmDialog';
import CopyLinkButton from '@/components/content/CopyLinkButton';
import FileThumb from '@/components/content/FileThumb';
import ToastHost, { showToast } from '@/components/content/Toast';
import UploadFilesDialog from '@/components/content/UploadFilesDialog';
import UploadFromUrlDialog from '@/components/content/UploadFromUrlDialog';
import { resolveAssetUrl } from '@/lib/assets';
import {
  fileTypeLabel,
  formatBytes,
  formatDateAdded,
  type FileSort,
  type FileTypeFilter,
  type StoreFile,
} from '@/lib/content';
import { useFilesApi } from './useFilesApi';

const th =
  'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400';
const iconButton =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 opacity-0 transition-opacity duration-150 hover:bg-gray-100 hover:text-gray-900 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white';

export default function FilesPage() {
  const router = useRouter();
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const filesApi = useFilesApi();

  const [files, setFiles] = useState<StoreFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [type, setType] = useState<FileTypeFilter>('all');
  const [sort, setSort] = useState<FileSort>('created_desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [uploadOpen, setUploadOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[] | undefined>();
  const [urlOpen, setUrlOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StoreFile[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const urlButtonRef = useRef<HTMLButtonElement>(null);
  const bulkDeleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setFiles([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await filesApi.list({ q: debouncedQ, type, sort, page });
      setFiles(result.files);
      setTotal(result.total);
      setPageSize(result.pageSize);
      setSelected(new Set());
    } catch (err: any) {
      setError(err?.message || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, filesApi, debouncedQ, type, sort, page]);

  useEffect(() => {
    if (!orgLoading) void load();
  }, [orgLoading, load]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, type, sort, selectedOrgId]);

  const allSelected = files.length > 0 && files.every((file) => selected.has(file.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(files.map((file) => file.id)));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.length === 1) {
        await filesApi.remove(pendingDelete[0].id);
        showToast('File deleted');
      } else {
        const result = await filesApi.bulkDelete(pendingDelete.map((file) => file.id));
        showToast(
          result.failed.length
            ? `${result.deleted.length} deleted, ${result.failed.length} failed`
            : `${result.deleted.length} files deleted`
        );
      }
      setPendingDelete(null);
      await load();
    } catch (err: any) {
      showToast(err?.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const referencedCount = (pendingDelete ?? []).reduce(
    (sum, file) => sum + (file.referenceCount ?? 0),
    0
  );
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div
      className="mx-auto max-w-7xl px-4 py-8"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        setDragOver(false);
        setDroppedFiles(Array.from(event.dataTransfer.files));
        setUploadOpen(true);
      }}
    >
      <ToastHost />
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4"
        data-testid="files-header"
      >
        <div>
          <p className="text-sm font-medium text-indigo-600 dark:text-indigo-300">Content</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Files</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            ref={urlButtonRef}
            type="button"
            onClick={() => setUrlOpen(true)}
            disabled={!selectedOrgId}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Upload from URL
          </button>
          <button
            ref={uploadButtonRef}
            type="button"
            onClick={() => {
              setDroppedFiles(undefined);
              setUploadOpen(true);
            }}
            disabled={!selectedOrgId}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            Upload files
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
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
      )}

      {!orgLoading && !selectedOrgId && (
        <p className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">
          Pick an organization from the menu in the top right.
        </p>
      )}

      {selectedOrgId && (
        <div
          className={`relative rounded-lg border bg-white dark:bg-slate-800 ${dragOver ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-gray-200 dark:border-slate-700'}`}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-indigo-50/80 text-sm font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
              Drop to upload
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-3 dark:border-slate-700">
            <label className="sr-only" htmlFor="files-type">
              File type
            </label>
            <select
              id="files-type"
              value={type}
              onChange={(event) => setType(event.target.value as FileTypeFilter)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="all">All</option>
              <option value="image">Images</option>
              <option value="pdf">PDFs</option>
            </select>
            <div className="relative min-w-[12rem] flex-1">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <input
                type="search"
                aria-label="Search files"
                placeholder="Search by name or alt text"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <label className="sr-only" htmlFor="files-sort">
              Sort
            </label>
            <select
              id="files-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as FileSort)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="created_desc">Date added (newest)</option>
              <option value="created_asc">Date added (oldest)</option>
              <option value="name">Name</option>
              <option value="size_desc">Size</option>
            </select>
          </div>

          {selected.size > 0 && (
            <div
              className="flex items-center gap-3 border-b border-gray-200 bg-indigo-50 px-4 py-2 text-sm dark:border-slate-700 dark:bg-indigo-900/20"
              data-testid="bulk-bar"
            >
              <span className="font-medium text-gray-900 dark:text-white">
                {selected.size} selected
              </span>
              <button
                ref={bulkDeleteRef}
                type="button"
                onClick={() => setPendingDelete(files.filter((file) => selected.has(file.id)))}
                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-800 dark:text-red-300"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-sm text-gray-600 underline dark:text-slate-300"
              >
                Clear
              </button>
            </div>
          )}

          {loading ? (
            <div aria-label="Loading files" className="space-y-3 p-4">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-12 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700"
                />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div
              data-testid="files-empty-state"
              className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center"
            >
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {debouncedQ || type !== 'all' ? 'No files match' : 'No files yet'}
              </h2>
              <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-slate-400">
                {debouncedQ || type !== 'all'
                  ? 'Try a different search or file type.'
                  : 'Upload images and PDFs to link from your pages, blog posts and emails.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table
                aria-label="Files"
                className="min-w-full divide-y divide-gray-200 dark:divide-slate-700"
              >
                <thead className="bg-gray-50 dark:bg-slate-900/50">
                  <tr>
                    <th scope="col" className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all files"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </th>
                    <th scope="col" className={th}>
                      File name
                    </th>
                    <th scope="col" className={th}>
                      Alt text
                    </th>
                    <th scope="col" className={th}>
                      Date added
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Size
                    </th>
                    <th scope="col" className={th}>
                      References
                    </th>
                    <th scope="col" className="px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {files.map((file) => {
                    const href = `/admin/content/files/${file.id}`;
                    return (
                      <tr
                        key={file.id}
                        data-testid="file-row"
                        className="group cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/40"
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest('a,button,input')) return;
                          router.push(href);
                        }}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${file.name}`}
                            checked={selected.has(file.id)}
                            onChange={() => toggle(file.id)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <FileThumb file={file} />
                            <div className="min-w-0">
                              <Link
                                href={href}
                                className="block max-w-xs truncate text-sm font-medium text-gray-900 hover:underline dark:text-white"
                              >
                                {file.name}
                              </Link>
                              <p className="text-xs text-gray-500 dark:text-slate-400">
                                {fileTypeLabel(file)}
                              </p>
                            </div>
                            <CopyLinkButton url={file.url} revealOnHover />
                          </div>
                        </td>
                        <td className="max-w-md truncate px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          {file.altText ?? ''}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                          {formatDateAdded(file.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500 dark:text-slate-400">
                          {formatBytes(file.sizeBytes)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                          {file.referenceCount
                            ? `${file.referenceCount} ${file.referenceCount === 1 ? 'reference' : 'references'}`
                            : ''}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <a
                              href={file.downloadUrl}
                              aria-label={`Download ${file.name}`}
                              title="Download"
                              className={iconButton}
                            >
                              <Download className="h-4 w-4" aria-hidden />
                            </a>
                            <button
                              type="button"
                              aria-label={`Delete ${file.name}`}
                              title="Delete"
                              onClick={() => setPendingDelete([file])}
                              className={`${iconButton} hover:text-red-700 dark:hover:text-red-300`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && total > 0 && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 text-sm text-gray-500 dark:border-slate-700 dark:text-slate-400">
              <span>
                {from}–{to} of {total}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 dark:border-slate-600"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  disabled={page >= pageCount}
                  className="rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 dark:border-slate-600"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {uploadOpen && (
        <UploadFilesDialog
          upload={filesApi.upload}
          initialFiles={droppedFiles}
          returnFocusRef={uploadButtonRef}
          onClose={() => setUploadOpen(false)}
          onUploaded={(result) => {
            if (result.files.length)
              showToast(
                `${result.files.length} ${result.files.length === 1 ? 'file' : 'files'} uploaded`
              );
            void load();
          }}
        />
      )}
      {urlOpen && (
        <UploadFromUrlDialog
          fromUrl={filesApi.fromUrl}
          returnFocusRef={urlButtonRef}
          onClose={() => setUrlOpen(false)}
          onUploaded={() => {
            showToast('File uploaded');
            void load();
          }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          titleId="delete-files-title"
          title={
            pendingDelete.length === 1
              ? `Delete ${pendingDelete[0].name}?`
              : `Delete ${pendingDelete.length} files?`
          }
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={deleting}
          danger
          returnFocusRef={pendingDelete.length > 1 ? bulkDeleteRef : undefined}
          onClose={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p>
            Links to {pendingDelete.length === 1 ? 'this file' : 'these files'} will stop working.
            This cannot be undone.
          </p>
          {referencedCount > 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              Used in {referencedCount} {referencedCount === 1 ? 'place' : 'places'} (pages or blog
              posts). Those will show a broken image or link.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
