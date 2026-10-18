'use client';

// Step 5, "Add an image": the event editor's media card (upload, replace,
// remove). Each action saves on its own (POST/DELETE …/logo) and refreshes the
// preview; nothing here waits for Next.

import { useState } from 'react';
import api from '@/services/api';
import { resolveAssetUrl } from '@/lib/assets';
import { EventMediaCard } from '@/components/events/EventMediaCard';
import type { SavedRowProps } from './types';

export default function ImageStep({ orgId, saved, setSaved, refreshPreview }: SavedRowProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const base = `/organizations/${orgId}/events/${encodeURIComponent(saved.id)}/logo`;

  async function run(action: () => Promise<string | null>, done: string, failed: string) {
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      const logoUrl = await action();
      setSaved((row) => (row ? { ...row, logoUrl } : row));
      setStatus(done);
      refreshPreview();
    } catch (err) {
      setError(`${failed}: ${(err as Error)?.message || 'try again'}`);
    } finally {
      setBusy(false);
    }
  }

  const upload = (file: File) => {
    const form = new FormData();
    form.append('logo', file);
    void run(async () => (await api.upload<{ logoUrl: string | null }>(base, form)).logoUrl, 'Image saved', "Couldn't upload the image");
  };
  const remove = () => {
    if (!window.confirm('Remove the event image?')) return;
    void run(async () => (await api.delete(base), null), 'Image removed', "Couldn't remove the image");
  };

  return (
    <div className="space-y-3">
      <EventMediaCard preview={resolveAssetUrl(saved.logoUrl ?? null)} eventName={saved.name} uploading={busy} onFileSelect={upload} onRemove={remove} />
      <p role="status" className="sr-only">
        {status}
      </p>
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
