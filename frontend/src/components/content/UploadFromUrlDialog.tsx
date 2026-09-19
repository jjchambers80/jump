'use client';

import { FormEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import type { StoreFile } from '@/lib/content';

interface UploadFromUrlDialogProps {
  fromUrl: (url: string) => Promise<StoreFile>;
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  onUploaded: (file: StoreFile) => void;
}

export default function UploadFromUrlDialog({
  fromUrl,
  returnFocusRef,
  onClose,
  onUploaded,
}: UploadFromUrlDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const file = await fromUrl(url.trim());
      onUploaded(file);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not fetch that URL');
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="upload-from-url-title"
      title="Upload from URL"
      dirty={url.trim().length > 0}
      saving={saving}
      saveDisabled={!url.trim()}
      submitLabel="Upload"
      savingLabel="Fetching…"
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <label
        htmlFor="upload-url"
        className="block text-sm font-medium text-gray-700 dark:text-slate-300"
      >
        Image or PDF URL
      </label>
      <input
        ref={inputRef}
        id="upload-url"
        type="url"
        inputMode="url"
        placeholder="https://example.com/flyer.pdf"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
      />
      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        The file is downloaded once and stored with your other files.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </SettingsDialog>
  );
}
