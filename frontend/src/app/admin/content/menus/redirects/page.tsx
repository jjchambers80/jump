'use client';

// Content › Menus › URL redirects — /admin/content/menus/redirects (spec 028)

import Link from 'next/link';
import { ArrowLeft, ExternalLink, Search } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import ConfirmDialog from '@/components/content/ConfirmDialog';
import ToastHost, { showToast } from '@/components/content/Toast';
import { useRedirectsApi, type UrlRedirect } from './useRedirectsApi';

const th =
  'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400';
const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const label = 'block text-sm font-medium text-gray-700 dark:text-slate-300';

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function RedirectsPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const redirectsApi = useRedirectsApi();
  const [rows, setRows] = useState<UrlRedirect[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<UrlRedirect | 'new' | null>(null);
  const [fromPath, setFromPath] = useState('');
  const [toPath, setToPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const createRef = useRef<HTMLButtonElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const bulkRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await redirectsApi.list(debouncedQ, page);
      setRows(result.redirects);
      setTotal(result.total);
      setPageSize(result.pageSize);
      setSelected(new Set());
    } catch (err: any) {
      setError(err?.message || 'Failed to load redirects');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, redirectsApi, debouncedQ, page]);

  useEffect(() => {
    if (!orgLoading) void load();
  }, [orgLoading, load]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, selectedOrgId]);

  const open = (target: UrlRedirect | 'new') => {
    setDialogError(null);
    setFromPath(target === 'new' ? '' : target.fromPath);
    setToPath(target === 'new' ? '' : target.toPath);
    setEditing(target);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || saving) return;
    setSaving(true);
    setDialogError(null);
    try {
      if (editing === 'new')
        await redirectsApi.create({ fromPath: fromPath.trim(), toPath: toPath.trim() });
      else
        await redirectsApi.update(editing.id, { fromPath: fromPath.trim(), toPath: toPath.trim() });
      showToast(editing === 'new' ? 'Redirect created' : 'Redirect updated');
      setEditing(null);
      await load();
    } catch (err: any) {
      const detail = Array.isArray(err?.details)
        ? err.details.map((d: { message: string }) => d.message).join(' ')
        : '';
      setDialogError(detail || err?.message || 'Could not save the redirect');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.length === 1) await redirectsApi.remove(pendingDelete[0]);
      else await redirectsApi.bulkDelete(pendingDelete);
      showToast(
        pendingDelete.length === 1
          ? 'Redirect deleted'
          : `${pendingDelete.length} redirects deleted`
      );
      setPendingDelete(null);
      await load();
    } catch (err: any) {
      showToast(err?.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const dirty =
    editing === 'new'
      ? fromPath.trim().length > 0 || toPath.trim().length > 0
      : editing
        ? fromPath.trim() !== editing.fromPath || toPath.trim() !== editing.toPath
        : false;
  const returnRef =
    editing && editing !== 'new' ? { current: rowRefs.current.get(editing.id) ?? null } : createRef;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <ToastHost />
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4"
        data-testid="redirects-header"
      >
        <div>
          <Link
            href="/admin/content/menus"
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline dark:text-slate-300"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Menus
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">URL redirects</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Send visitors from an old or printed link to the right place on your storefront.
          </p>
        </div>
        <button
          ref={createRef}
          type="button"
          onClick={() => open('new')}
          disabled={!selectedOrgId}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
        >
          Create URL redirect
        </button>
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

      {selectedOrgId && (
        <div className="rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div className="border-b border-gray-200 p-3 dark:border-slate-700">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <input
                type="search"
                aria-label="Search redirects"
                placeholder="Search paths"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </div>
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
                ref={bulkRef}
                type="button"
                onClick={() => setPendingDelete([...selected])}
                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-slate-600 dark:bg-slate-800 dark:text-red-300"
              >
                Delete
              </button>
            </div>
          )}
          {loading ? (
            <div aria-label="Loading redirects" className="space-y-3 p-4">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700"
                />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div
              data-testid="redirects-empty-state"
              className="flex min-h-56 flex-col items-center justify-center px-6 py-12 text-center"
            >
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {debouncedQ ? 'No redirects match' : 'No redirects yet'}
              </h2>
              <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-slate-400">
                {debouncedQ
                  ? 'Try another search.'
                  : 'Add one when a page moves or a printed link points somewhere that no longer exists.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table
                aria-label="URL redirects"
                className="min-w-full divide-y divide-gray-200 dark:divide-slate-700"
              >
                <thead className="bg-gray-50 dark:bg-slate-900/50">
                  <tr>
                    <th scope="col" className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all redirects"
                        checked={allSelected}
                        onChange={() =>
                          setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </th>
                    <th scope="col" className={th}>
                      Redirect from
                    </th>
                    <th scope="col" className={th}>
                      Redirect to
                    </th>
                    <th scope="col" className={th}>
                      Created
                    </th>
                    <th scope="col" className="px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {rows.map((row) => (
                    <tr key={row.id} data-testid="redirect-row">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.fromPath}`}
                          checked={selected.has(row.id)}
                          onChange={() =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (next.has(row.id)) next.delete(row.id);
                              else next.add(row.id);
                              return next;
                            })
                          }
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-gray-900 dark:text-white">
                        {row.fromPath}
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-gray-700 dark:text-slate-300">
                        <span className="inline-flex items-center gap-1">
                          {row.absolute && (
                            <ExternalLink className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                          )}
                          {row.toPath}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm">
                        <button
                          ref={(el) => {
                            if (el) rowRefs.current.set(row.id, el);
                          }}
                          type="button"
                          onClick={() => open(row)}
                          className="font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete([row.id])}
                          className="ml-3 font-medium text-red-600 hover:underline dark:text-red-300"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && total > pageSize && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 text-sm text-gray-500 dark:border-slate-700 dark:text-slate-400">
              <span>
                {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setPage((c) => Math.max(1, c - 1))}
                  disabled={page <= 1}
                  className="rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 dark:border-slate-600"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((c) => Math.min(pageCount, c + 1))}
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

      {!orgLoading && !selectedOrgId && (
        <p className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">
          Pick an organization from the menu in the top right.
        </p>
      )}

      {editing && (
        <SettingsDialog
          titleId="redirect-dialog-title"
          title={editing === 'new' ? 'Create URL redirect' : 'Edit URL redirect'}
          dirty={dirty}
          saving={saving}
          saveDisabled={!fromPath.trim() || !toPath.trim()}
          submitLabel={editing === 'new' ? 'Create' : 'Save'}
          initialFocusRef={fromRef}
          returnFocusRef={returnRef}
          onClose={() => setEditing(null)}
          onSubmit={submit}
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="redirect-from" className={label}>
                Redirect from
              </label>
              <input
                ref={fromRef}
                id="redirect-from"
                value={fromPath}
                onChange={(event) => setFromPath(event.target.value)}
                placeholder="/old-page"
                maxLength={255}
                className={`${field} font-mono`}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                The path visitors land on. Live pages such as /events or /account cannot be
                redirected.
              </p>
            </div>
            <div>
              <label htmlFor="redirect-to" className={label}>
                Redirect to
              </label>
              <input
                id="redirect-to"
                value={toPath}
                onChange={(event) => setToPath(event.target.value)}
                placeholder="/pages/faq or https://…"
                maxLength={2048}
                className={`${field} font-mono`}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                A storefront path like /pages/faq or /blogs/news, or a full https:// link.
              </p>
            </div>
            {dialogError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {dialogError}
              </p>
            )}
          </div>
        </SettingsDialog>
      )}

      {pendingDelete && (
        <ConfirmDialog
          titleId="delete-redirects-title"
          title={
            pendingDelete.length === 1
              ? 'Delete this redirect?'
              : `Delete ${pendingDelete.length} redirects?`
          }
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={deleting}
          danger
          returnFocusRef={pendingDelete.length > 1 ? bulkRef : undefined}
          onClose={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p>Visitors using the old link will see a not-found page instead.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
