'use client';

// Business profile section of the buyer account page (spec 011 phase 3):
// the applicant's per-organization identity (name, description, website,
// socials, photos) that every application form pre-fills. Renders nothing
// until the buyer has applied at least once (no profile yet).

import { useCallback, useEffect, useState } from 'react';
import { resolveAssetUrl } from '@/lib/assets';
import { SOCIAL_FIELDS, type ApplicantProfile } from '@/lib/applications';

const MAX_PHOTOS = 6;
const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100';
const label = 'block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400 mb-1';

interface Draft {
  businessName: string;
  description: string;
  website: string;
  socials: Record<string, string>;
}

function toDraft(p: ApplicantProfile): Draft {
  return { businessName: p.businessName, description: p.description ?? '', website: p.website ?? '', socials: { ...p.socials } };
}

export default function ApplicantProfileSection() {
  const [profile, setProfile] = useState<ApplicantProfile | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/buyer/me/applicant-profile', { cache: 'no-store' });
    if (!res.ok) {
      setProfile(null);
      return;
    }
    const body = await res.json().catch(() => null);
    setProfile(body && body.id ? body : null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!profile) return null;

  const start = () => {
    setDraft(toDraft(profile));
    setEditing(true);
    setError(null);
    setMessage(null);
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const socials = Object.fromEntries(Object.entries(draft.socials).filter(([, v]) => v.trim() !== ''));
      const res = await fetch('/api/buyer/me/applicant-profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName: draft.businessName, description: draft.description || null, website: draft.website || null, socials }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || 'Could not save your profile');
      setProfile(body);
      setEditing(false);
      setMessage('Profile saved. New applications will use these details.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files).slice(0, MAX_PHOTOS)) form.append('photos', f);
      const res = await fetch('/api/buyer/me/applicant-profile/photos', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || 'Could not upload photos');
      setProfile(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async (imageId: string) => {
    if (!window.confirm('Remove this photo?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/buyer/me/applicant-profile/photos/${encodeURIComponent(imageId)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || 'Could not remove the photo');
      setProfile(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="account-applicant-profile">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Business profile</h2>
        {!editing && (
          <button type="button" onClick={start} className="text-xs font-semibold text-brand-link hover:underline" data-testid="applicant-profile-edit">
            Edit
          </button>
        )}
      </div>
      {message && <p role="status" className="mb-3 text-sm text-gray-700 dark:text-slate-300">{message}</p>}
      {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 space-y-4">
        {editing && draft ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div>
              <label htmlFor="profile-businessName" className={label}>Business or outlet name</label>
              <input id="profile-businessName" value={draft.businessName} required maxLength={120} onChange={(e) => setDraft({ ...draft, businessName: e.target.value })} className={field} />
            </div>
            <div>
              <label htmlFor="profile-description" className={label}>Description</label>
              <textarea id="profile-description" rows={4} maxLength={2000} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={field} />
            </div>
            <div>
              <label htmlFor="profile-website" className={label}>Website</label>
              <input id="profile-website" value={draft.website} placeholder="yourbusiness.example" onChange={(e) => setDraft({ ...draft, website: e.target.value })} className={field} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {SOCIAL_FIELDS.map((s) => (
                <div key={s.key}>
                  <label htmlFor={`profile-social-${s.key}`} className={label}>{s.label}</label>
                  <input id={`profile-social-${s.key}`} value={draft.socials[s.key] ?? ''} placeholder={s.placeholder} maxLength={200} onChange={(e) => setDraft({ ...draft, socials: { ...draft.socials, [s.key]: e.target.value } })} className={field} />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60" data-testid="applicant-profile-save">
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" disabled={busy} onClick={() => setEditing(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="text-sm">
            <p className="font-semibold text-gray-900 dark:text-slate-100">{profile.businessName}</p>
            {profile.description && <p className="mt-1 whitespace-pre-line text-gray-700 dark:text-slate-300">{profile.description}</p>}
            <p className="mt-1 text-gray-600 dark:text-slate-400">
              {profile.website && (
                <a href={profile.website} target="_blank" rel="noreferrer" className="text-brand-link hover:underline">
                  {profile.website.replace(/^https?:\/\//, '')}
                </a>
              )}
              {SOCIAL_FIELDS.filter((s) => profile.socials[s.key]).map((s) => (
                <span key={s.key} className="ml-2">
                  {s.label}: {profile.socials[s.key]}
                </span>
              ))}
            </p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between">
            <h3 className={label}>Photos ({profile.photos.length}/{MAX_PHOTOS})</h3>
            {profile.photos.length < MAX_PHOTOS && (
              <label className="cursor-pointer text-xs font-semibold text-brand-link hover:underline">
                Add photos
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden disabled={busy} onChange={(e) => upload(e.target.files)} data-testid="applicant-profile-photo-input" />
              </label>
            )}
          </div>
          {profile.photos.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-slate-400">No photos yet. Organizers see these when reviewing your applications.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {profile.photos.map((p) => (
                <li key={p.imageId} className="relative">
                  {p.urls?.thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolveAssetUrl(p.urls.thumb) ?? p.urls.thumb} alt="" className="h-20 w-20 rounded-md object-cover" />
                  )}
                  <button type="button" disabled={busy} onClick={() => removePhoto(p.imageId)} aria-label="Remove photo" className="absolute -right-1 -top-1 rounded-full bg-white px-1.5 text-xs text-gray-700 shadow dark:bg-slate-700 dark:text-slate-200">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
