'use client';

// Revision history (spec 038 D6, §11): the last 50 saves of the live theme.
// Restore puts the WHOLE theme back to that save and is itself a save.

import { useEffect, useState } from 'react';
import ConfirmDialog from '@/components/content/ConfirmDialog';
import { useAccountFormat } from '@/lib/accountFormat';
import { useDialog } from '@/lib/useDialog';
import { themesApi, type ThemeRevision } from '@/lib/themes';

const KEY_LABELS: Record<string, string> = {
  settings: 'Theme settings',
  content: 'Default content',
  header: 'Header',
  footer: 'Footer',
  home: 'Home page',
  events: 'Events page',
};

export function describeChange(keys: string[]) {
  if (keys[0]?.startsWith('restore:')) return 'Restored an earlier version';
  return keys.map((k) => KEY_LABELS[k] ?? (k.startsWith('page:') ? 'A page' : k)).join(', ') || 'Saved';
}

export default function RevisionsDialog({
  themeId,
  themeVersion,
  onClose,
  onRestored,
}: {
  themeId: string;
  themeVersion: number;
  onClose: () => void;
  onRestored: () => void;
}) {
  const panelRef = useDialog<HTMLDivElement>(true, onClose);
  const { formatDateTime } = useAccountFormat();
  const [revisions, setRevisions] = useState<ThemeRevision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ThemeRevision | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    themesApi
      .revisions(themeId)
      .then((r) => setRevisions(r.revisions))
      .catch((err) => setError(err?.message || 'Could not load the history'));
  }, [themeId]);

  const when = (value: string) => formatDateTime(value, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="revisions-title" className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-4">
          <h2 id="revisions-title" className="text-lg font-semibold text-gray-900">
            Revision history
          </h2>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
            Close
          </button>
        </div>
        <p className="mt-1 text-sm text-gray-600">Every save of your live theme. Restoring brings back the whole theme as it was then.</p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {!revisions && !error && <p className="mt-4 text-sm text-gray-500">Loading…</p>}
        {revisions && revisions.length === 0 && <p className="mt-4 text-sm text-gray-500">No saves yet.</p>}
        {revisions && revisions.length > 0 && (
          <ol className="mt-4 divide-y divide-gray-100" data-testid="revision-list">
            {revisions.map((revision, i) => (
              <li key={revision.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-gray-900">
                    {describeChange(revision.changedKeys)}
                    {i === 0 && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">Current</span>}
                  </p>
                  <p className="text-gray-500">
                    {when(revision.createdAt)}
                    {revision.savedBy ? ` · ${revision.savedBy.name ?? 'a former member'}` : ''}
                  </p>
                </div>
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirming(revision)}
                    className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          titleId="restore-title"
          title="Restore this version?"
          confirmLabel="Restore"
          busyLabel="Restoring…"
          busy={busy}
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await themesApi.restore(themeId, confirming.id, themeVersion);
              onRestored();
            } catch (err: any) {
              setError(err?.status === 409 ? 'The theme changed since you opened the editor. Reload and try again.' : err?.message || 'Could not restore');
              setConfirming(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm text-gray-700">
            Restore the whole theme to how it was on {when(confirming.createdAt)}? Newer changes are replaced; you can restore them again from this list.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
