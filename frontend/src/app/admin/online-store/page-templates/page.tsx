'use client';

// Spec 042: developer screen for the active organization's page templates.
// A SYSTEM_ADMIN uploads a JSON manifest (docs/development/page-templates.md);
// the template then shows in the Template dropdown of that organization's pages.

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import api, { type PageTemplate } from '@/services/api';

const SECTION_LABELS: Record<string, string> = {
  page_content: 'Page content',
  rich_text: 'Rich text',
  contact_form: 'Contact form',
};

interface FieldError {
  field: string;
  message: string;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PageTemplatesPage() {
  const { data: session, status } = useSession();
  const isSystemAdmin = (session?.user as { role?: string } | undefined)?.role === 'SYSTEM_ADMIN';
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const [templates, setTemplates] = useState<PageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<FieldError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<{ templates: PageTemplate[] }>('/admin/page-templates');
      setTemplates(result.templates);
    } catch (err: any) {
      setError(err.message || 'Failed to load page templates');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    if (!orgLoading && isSystemAdmin) void load();
  }, [orgLoading, isSystemAdmin, load]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadErrors([]);
    setNotice(null);
    let manifest: unknown;
    try {
      manifest = JSON.parse(await file.text());
    } catch {
      setUploadErrors([{ field: file.name, message: 'The file is not valid JSON' }]);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.post<PageTemplate>('/admin/page-templates', manifest);
      setNotice(`Uploaded “${saved.label}” (${saved.name}).`);
      await load();
    } catch (err: any) {
      const details = Array.isArray(err.details) ? (err.details as FieldError[]) : [];
      setUploadErrors(details.length ? details : [{ field: file.name, message: err.message || 'Upload failed' }]);
    } finally {
      setBusy(false);
    }
  };

  const download = async (template: PageTemplate) => {
    const manifest = await api.get(`/admin/page-templates/${template.id}/manifest`);
    const url = URL.createObjectURL(
      new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `page.${template.name}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const remove = async (template: PageTemplate) => {
    const usage =
      template.pageCount > 0
        ? ` ${template.pageCount} page${template.pageCount === 1 ? '' : 's'} will go back to the default layout.`
        : '';
    if (!window.confirm(`Delete the “${template.label}” template?${usage}`)) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.delete(`/admin/page-templates/${template.id}`);
      setNotice(`Deleted “${template.label}”.`);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to delete the template');
    } finally {
      setBusy(false);
    }
  };

  if (status !== 'loading' && !isSystemAdmin) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Page templates</h1>
        <p className="mt-4 text-sm text-gray-600 dark:text-slate-300">
          Page templates are uploaded by Eventimus developers. Ask support if your store needs a
          custom page layout.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4" data-testid="page-templates-header">
        <div>
          <Link
            href="/admin/online-store/pages"
            className="text-sm font-medium text-accent-600 hover:underline dark:text-accent-300"
          >
            ← Pages
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Page templates</h1>
          <p className="mt-1 max-w-xl text-sm text-gray-500 dark:text-slate-400">
            Templates uploaded here show in the Template menu of this organization&apos;s pages
            only. Uploading a template with an existing name replaces it.
          </p>
        </div>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={upload}
            aria-label="Template file"
            data-testid="template-file-input"
          />
          <button
            type="button"
            disabled={busy || !selectedOrgId}
            onClick={() => fileInput.current?.click()}
            className="rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-gray-950 shadow-sm hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Upload template
          </button>
        </div>
      </div>

      {notice && (
        <p role="status" className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          {notice}
        </p>
      )}

      {uploadErrors.length > 0 && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <p className="font-semibold">The template was not uploaded</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {uploadErrors.map((item) => (
              <li key={`${item.field}:${item.message}`}>
                <code className="font-mono text-xs">{item.field}</code>: {item.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-2 font-semibold underline">
            Try again
          </button>
        </div>
      )}

      {!selectedOrgId && !orgLoading && (
        <p className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">
          Pick an organization from the menu in the top right.
        </p>
      )}

      {loading && selectedOrgId && (
        <div aria-label="Loading page templates" className="space-y-3">
          {[1, 2].map((item) => (
            <div key={item} className="h-14 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
          ))}
        </div>
      )}

      {!loading && !error && selectedOrgId && templates.length === 0 && (
        <div
          data-testid="page-templates-empty"
          className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center text-sm text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
        >
          No page templates yet. Upload a <code className="font-mono">page.&lt;name&gt;.json</code>{' '}
          manifest, for example <code className="font-mono">templates/pages/page.contact.json</code>.
        </div>
      )}

      {!loading && templates.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table aria-label="Page templates" className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:bg-slate-900/50 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">Template</th>
                  <th scope="col" className="px-4 py-3">Sections</th>
                  <th scope="col" className="px-4 py-3">Pages</th>
                  <th scope="col" className="px-4 py-3">Updated</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-gray-900 dark:text-white">{template.label}</span>
                      <code className="font-mono text-xs text-gray-500 dark:text-slate-400">{template.name}</code>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                      {template.sections.map((section) => SECTION_LABELS[section.type] ?? section.type).join(' · ')}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{template.pageCount}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{formatDate(template.updatedAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void download(template)}
                        className="mr-3 font-medium text-accent-600 hover:underline dark:text-accent-300"
                        aria-label={`Download ${template.label}`}
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(template)}
                        className="font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                        aria-label={`Delete ${template.label}`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
