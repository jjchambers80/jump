'use client';

// Add or edit one lineup guest (spec 050-Q): name, role, plain-text bio,
// square photo and links. Dialog rules from §11.4: focus trap, Escape closes,
// focus returns to the opener (useDialog).

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useDialog } from '@/lib/useDialog';
import { resolveAssetUrl } from '@/lib/assets';
import { GUEST_LIMITS, GUEST_LINK_KEYS, type AdminEventGuest } from '@/lib/eventGuests';
import { SOCIAL_LABELS } from '@/components/storefront/SocialIcon';
import { errorText, hintClass, iconButton, inputClass, labelClass, primaryButton, textButton } from '../ui';
import type { GuestInput } from './useGuestLineup';

interface Props {
  guest: AdminEventGuest | null;
  busy: boolean;
  error: string | null;
  onSave: (input: GuestInput, image: { file?: File | null; remove?: boolean }) => void;
  onCancel: () => void;
}

export default function GuestDialog({ guest, busy, error, onSave, onCancel }: Props) {
  const panelRef = useDialog<HTMLDivElement>(true, onCancel);
  const [name, setName] = useState(guest?.name ?? '');
  const [role, setRole] = useState(guest?.role ?? '');
  const [bio, setBio] = useState(guest?.bio ?? '');
  const [links, setLinks] = useState<Record<string, string>>({ ...(guest?.links ?? {}) });
  const [file, setFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    document.getElementById('guest-name')?.focus();
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Enter the guest’s name');
      document.getElementById('guest-name')?.focus();
      return;
    }
    const cleaned = Object.fromEntries(Object.entries(links).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    onSave({ name: name.trim(), role: role.trim() || null, bio: bio.trim() || null, links: Object.keys(cleaned).length ? cleaned : null }, { file, remove: removeImage });
  };

  const currentImage = !removeImage && !file ? resolveAssetUrl(guest?.imageUrl) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-black/50" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="guest-dialog-title" className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-xl dark:bg-slate-800 sm:max-w-lg sm:rounded-lg">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-800 sm:px-6">
          <h2 id="guest-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white">{guest ? `Edit ${guest.name}` : 'Add a guest'}</h2>
          <button type="button" onClick={onCancel} aria-label="Close" className={iconButton}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <form onSubmit={submit} noValidate className="space-y-4 px-4 py-4 sm:px-6">
          {error && (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p>
          )}
          <div>
            <label htmlFor="guest-name" className={labelClass}>Name</label>
            <input id="guest-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={GUEST_LIMITS.name} className={inputClass} aria-invalid={!!nameError} aria-describedby={nameError ? 'guest-name-error' : undefined} autoComplete="off" />
            {nameError && <p id="guest-name-error" className={errorText}>{nameError}</p>}
          </div>
          <div>
            <label htmlFor="guest-role" className={labelClass}>Role <span className="font-normal text-gray-500 dark:text-slate-400">(optional)</span></label>
            <input id="guest-role" value={role} onChange={(e) => setRole(e.target.value)} maxLength={GUEST_LIMITS.role} placeholder="e.g. Voice actor, Panel host" className={inputClass} />
          </div>
          <div>
            <label htmlFor="guest-bio" className={labelClass}>Bio <span className="font-normal text-gray-500 dark:text-slate-400">(optional)</span></label>
            <textarea id="guest-bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={GUEST_LIMITS.bio} rows={4} className={inputClass} aria-describedby="guest-bio-hint" />
            <p id="guest-bio-hint" className={hintClass}>Plain text, up to {GUEST_LIMITS.bio} characters ({GUEST_LIMITS.bio - bio.length} left).</p>
          </div>
          <div>
            <label htmlFor="guest-photo" className={labelClass}>Photo <span className="font-normal text-gray-500 dark:text-slate-400">(optional)</span></label>
            {currentImage && (
              <div className="mb-2 flex items-center gap-3">
                <img src={currentImage} alt="" className="size-16 rounded-md object-cover" />
                <button type="button" className={textButton} onClick={() => setRemoveImage(true)}>Remove photo</button>
              </div>
            )}
            <input id="guest-photo" type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRemoveImage(false); }} className="block w-full text-sm text-gray-700 file:mr-3 file:min-h-11 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-4 file:text-sm file:font-medium dark:text-slate-300 dark:file:border-slate-600 dark:file:bg-slate-800 dark:file:text-slate-100" aria-describedby="guest-photo-hint" />
            <p id="guest-photo-hint" className={hintClass}>Shown as a square. JPG, PNG, GIF or WebP, up to 5 MB.</p>
          </div>
          <fieldset>
            <legend className={labelClass}>Links <span className="font-normal text-gray-500 dark:text-slate-400">(optional, https)</span></legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {GUEST_LINK_KEYS.map((key) => (
                <div key={key}>
                  <label htmlFor={`guest-link-${key}`} className="mb-1 block text-xs font-medium text-gray-700 dark:text-slate-300">{SOCIAL_LABELS[key]}</label>
                  <input id={`guest-link-${key}`} type="url" inputMode="url" value={links[key] ?? ''} onChange={(e) => setLinks((l) => ({ ...l, [key]: e.target.value }))} placeholder="https://" className={inputClass} />
                </div>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 dark:border-slate-700 sm:flex-row sm:justify-end">
            <button type="button" onClick={onCancel} className={textButton}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButton}>{busy ? 'Saving…' : guest ? 'Save guest' : 'Add guest'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
