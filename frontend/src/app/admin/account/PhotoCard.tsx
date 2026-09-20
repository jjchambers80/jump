'use client';

import { useRef, useState } from 'react';
import { resolveAssetUrl } from '@/lib/assets';
import { Account, accountApi, initialsOf } from './accountApi';

interface Props {
  account: Account;
  onSaved: (account: Account, message: string) => void;
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_SIZE_MB = 5;

const buttonClass =
  'rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700';

/** Upload / replace / remove the account photo. The provider picture is a display fallback only. */
export default function PhotoCard({ account, onSaved }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const src = resolveAssetUrl(account.avatar?.urls.thumb || account.imageFallbackUrl);

  const handleFile = async (file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Only JPG, PNG, GIF, and WebP images are allowed.');
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`Image must be ${MAX_SIZE_MB} MB or smaller.`);
      return;
    }
    setError(null);
    try {
      setBusy('upload');
      onSaved(await accountApi.uploadAvatar(file), 'Photo updated.');
    } catch (requestError: any) {
      setError(requestError.message || 'Unable to upload the photo.');
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm('Remove your photo? Your initials will be shown instead.')) return;
    setError(null);
    try {
      setBusy('remove');
      onSaved(await accountApi.removeAvatar(), 'Photo removed.');
    } catch (requestError: any) {
      setError(requestError.message || 'Unable to remove the photo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-4">
      {src ? (
        <img src={src} alt="Your photo" className="h-20 w-20 rounded-full bg-gray-200 object-cover dark:bg-slate-600" />
      ) : (
        <span
          aria-label="No photo; showing initials"
          className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-200 text-xl font-bold text-gray-600 dark:bg-slate-600 dark:text-slate-200"
        >
          {initialsOf(account.name, account.email)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy !== null} className={buttonClass}>
            {busy === 'upload' ? 'Uploading…' : account.avatar ? 'Replace photo' : 'Upload photo'}
          </button>
          {account.avatar && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy !== null}
              className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              {busy === 'remove' ? 'Removing…' : 'Remove photo'}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">JPG, PNG, GIF, or WebP up to {MAX_SIZE_MB} MB.</p>
        {error && <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          className="hidden"
          aria-label="Choose a photo"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
