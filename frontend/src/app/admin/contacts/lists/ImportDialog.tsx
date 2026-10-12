'use client';

// Import a CSV into a manual list (spec 055-D): choose a file, say which
// column is which (the server guesses from the header and re-checks every
// row), import with a step-up, then see what was added, created and skipped.

import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { Download, FileUp } from 'lucide-react';
import api from '@/services/api';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { useReauth, isReauthCancelled } from '@/app/admin/account/useReauth';
import { csvLine } from '@/lib/contactLists';

type Field = 'email' | 'firstName' | 'lastName' | 'name' | 'phone' | 'tags';
type Mapping = Record<Field, number | null>;

interface Preview {
  headers: string[];
  mapping: Mapping;
  sample: string[][];
  rowCount: number;
}

export interface ImportResult {
  rowCount: number;
  added: number;
  created: number;
  alreadyOn: number;
  skipped: { row: number; email: string; reason: string }[];
}

const FIELDS: { key: Field; label: string; hint?: string }[] = [
  { key: 'email', label: 'Email', hint: 'Required' },
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'name', label: 'Full name', hint: 'Used when there is no first or last name' },
  { key: 'phone', label: 'Phone' },
  { key: 'tags', label: 'Tags', hint: 'Separate several with commas' },
];

const control =
  'h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white';

const errorText = (err: unknown, fallback: string) => {
  const e = err as { message?: string; details?: { message?: string }[] };
  return e?.details?.[0]?.message || e?.message || fallback;
};

export default function ImportDialog({
  list,
  returnFocusRef,
  onClose,
  onImported,
}: {
  list: { id: string; name: string };
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  onImported: () => void;
}) {
  const { withReauth } = useReauth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = `/admin/contact-lists/${encodeURIComponent(list.id)}/import`;

  const choose = async (chosen: File | null) => {
    setError(null);
    setFile(chosen);
    setPreview(null);
    if (!chosen) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', chosen);
      const next = await api.upload<Preview>(`${base}/preview`, form);
      setPreview(next);
      setMapping(next.mapping);
    } catch (err) {
      setError(errorText(err, 'Could not read the file.'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (result) {
      onClose();
      return;
    }
    if (!file || !mapping) return;
    setBusy(true);
    setError(null);
    try {
      const imported = await withReauth(() => {
        const form = new FormData();
        form.append('file', file);
        form.append('mapping', JSON.stringify(mapping));
        return api.upload<ImportResult>(base, form);
      });
      setResult(imported);
      onImported();
    } catch (err) {
      if (!isReauthCancelled(err)) setError(errorText(err, 'Could not import the file.'));
    } finally {
      setBusy(false);
    }
  };

  const downloadSkipped = () => {
    if (!result) return;
    const text = [csvLine(['Row', 'Email', 'Reason']), ...result.skipped.map((s) => csvLine([s.row, s.email, s.reason]))].join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'skipped-rows.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const people = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'contact' : 'contacts'}`;
  const submitLabel = result ? 'Done' : preview ? `Import ${people(preview.rowCount)}` : 'Import';

  return (
    <SettingsDialog
      titleId="import-title"
      title={`Import contacts into ${list.name}`}
      dirty={Boolean(file) && !result}
      saving={busy}
      submitWhenClean
      saveDisabled={!result && (!preview || mapping?.email === null)}
      submitLabel={submitLabel}
      savingLabel={preview ? 'Importing…' : 'Reading…'}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      {result ? (
        <div className="space-y-4" role="status">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Import finished</h3>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Added to the list', result.added],
              ['New contacts', result.created],
              ['Already on it', result.alreadyOn],
              ['Skipped', result.skipped.length],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
                <dt className="text-xs text-gray-600 dark:text-slate-400">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{value}</dd>
              </div>
            ))}
          </dl>
          {result.created > 0 && (
            <p className="text-sm text-gray-700 dark:text-slate-300">New contacts are not subscribed to email; a file is not proof they agreed to it.</p>
          )}
          {result.skipped.length > 0 && (
            <div>
              <table className="w-full text-left text-sm">
                <caption className="mb-2 text-left text-sm font-medium text-gray-900 dark:text-white">
                  Skipped rows{result.skipped.length > 10 ? ' (first 10)' : ''}
                </caption>
                <thead className="text-xs text-gray-600 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">Row</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Email</th>
                    <th scope="col" className="py-1 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {result.skipped.slice(0, 10).map((s) => (
                    <tr key={s.row}>
                      <td className="py-1.5 pr-3 tabular-nums">{s.row}</td>
                      <td className="max-w-[12rem] truncate py-1.5 pr-3">{s.email || '—'}</td>
                      <td className="py-1.5">{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                onClick={downloadSkipped}
                className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-gray-300 px-4 text-sm font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 dark:border-slate-600 dark:text-white dark:hover:bg-slate-700"
              >
                <Download className="h-4 w-4" aria-hidden />
                Download skipped rows
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <label htmlFor="import-file" className="mb-1 block text-sm font-medium text-gray-800 dark:text-slate-200">
              CSV file
            </label>
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 p-4 dark:border-slate-600">
              <FileUp className="h-6 w-6 shrink-0 text-gray-500 dark:text-slate-400" aria-hidden />
              <input
                ref={fileRef}
                id="import-file"
                type="file"
                accept=".csv,text/csv"
                aria-describedby="import-file-hint"
                onChange={(e) => choose(e.target.files?.[0] ?? null)}
                className="min-w-0 flex-1 text-sm text-gray-800 file:mr-3 file:min-h-[44px] file:rounded-md file:border-0 file:bg-gray-100 file:px-4 file:text-sm file:font-semibold file:text-gray-900 hover:file:bg-gray-200 dark:text-slate-200 dark:file:bg-slate-700 dark:file:text-white"
              />
            </div>
            <p id="import-file-hint" className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              The first row names the columns. Up to 10,000 rows and 5 MB. New contacts are not subscribed to email.
            </p>
          </div>

          {preview && mapping && (
            <>
              <fieldset>
                <legend className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                  Match the columns ({people(preview.rowCount)} in the file)
                </legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {FIELDS.map((field) => (
                    <div key={field.key}>
                      <label htmlFor={`import-map-${field.key}`} className="mb-1 block text-sm font-medium text-gray-800 dark:text-slate-200">
                        {field.label}
                        {field.hint && <span className="ml-1 font-normal text-gray-600 dark:text-slate-400">· {field.hint}</span>}
                      </label>
                      <select
                        id={`import-map-${field.key}`}
                        value={mapping[field.key] ?? ''}
                        onChange={(e) =>
                          setMapping({ ...mapping, [field.key]: e.target.value === '' ? null : Number(e.target.value) })
                        }
                        className={control}
                      >
                        <option value="">{field.key === 'email' ? 'Choose a column' : 'Don’t import'}</option>
                        {preview.headers.map((header, index) => (
                          <option key={index} value={index}>
                            {header || `Column ${index + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </fieldset>

              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">First rows of the file</caption>
                  <thead className="bg-gray-50 text-xs text-gray-600 dark:bg-slate-800 dark:text-slate-300">
                    <tr>
                      {preview.headers.map((header, index) => (
                        <th key={index} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                          {header || `Column ${index + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {preview.sample.map((row, r) => (
                      <tr key={r}>
                        {preview.headers.map((_, c) => (
                          <td key={c} className="max-w-[12rem] truncate whitespace-nowrap px-3 py-2 text-gray-800 dark:text-slate-200">
                            {row[c] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      )}
    </SettingsDialog>
  );
}
