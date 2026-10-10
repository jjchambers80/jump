'use client';

// Venue editor: /admin/venues/new and /admin/venues/:id/edit. Same frame as the
// event editor (EventFormLayout): content cards on the left, visibility and the
// save card in the aside, a sticky save bar below `xl`. Nothing saves until
// Save — including removing the logo — so Cancel always means cancel.
// Saving lands on the venue's Details page.

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { resolveAssetUrl } from '@/lib/assets';
import { StateSelect } from '@/components/StateSelect';
import ImageUploader from '@/components/ImageUploader';
import SlugField from '@/components/SlugField';
import VenueTimeZoneField from '@/components/VenueTimeZoneField';
import { EventSaveCard, jumpTo } from '@/components/events/EventEditSummary';
import {
  EVENT_FORM_ID,
  EventFormActions,
  EventFormHeader,
  EventFormShell,
  FormAlert,
  FormCard,
  hintClass,
  inputClass,
  labelClass,
} from '@/components/events/EventFormLayout';
import VisibilityBadge from '@/components/venues/VisibilityBadge';
import type { AdminVenue } from '@/lib/venues';

interface VenueForm {
  name: string;
  slug: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  /** null follows the address (spec 033); a value is the organizer's own choice. */
  timezone: string | null;
  isPublic: boolean;
}

const EMPTY: VenueForm = { name: '', slug: '', address: '', city: '', state: '', postalCode: '', timezone: null, isPublic: true };

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900';

function toForm(venue: AdminVenue): VenueForm {
  return {
    name: venue.name,
    slug: venue.slug || '',
    address: venue.address,
    city: venue.city || '',
    state: venue.state || '',
    postalCode: venue.postalCode || '',
    // Only a hand-picked zone reopens as an override; a derived one follows
    // the address so editing the ZIP re-resolves it.
    timezone: venue.timezoneSource === 'MANUAL' ? venue.timezone : null,
    isPublic: venue.isPublic,
  };
}

function VenueEditorContent({ venueId }: { venueId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const orgId = selectedOrgId || searchParams.get('orgId');
  const q = searchParams.get('orgId') ? `?orgId=${encodeURIComponent(searchParams.get('orgId')!)}` : '';
  const isNew = !venueId;

  const [venue, setVenue] = useState<AdminVenue | null>(null);
  const [form, setForm] = useState<VenueForm>(EMPTY);
  const [saved, setSaved] = useState<VenueForm>(EMPTY);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);

  useEffect(() => {
    if (isNew || orgLoading || !orgId) return;
    (async () => {
      try {
        const data = await api.get<AdminVenue>(`/organizations/${orgId}/venues/${venueId}`);
        setVenue(data);
        setForm(toForm(data));
        setSaved(toForm(data));
        setLogoPreview(resolveAssetUrl(data.logoUrl));
      } catch (err: any) {
        setError(err?.status === 404 ? 'This venue is not in the selected organization.' : err?.message || 'Failed to load the venue');
      } finally {
        setLoading(false);
      }
    })();
  }, [isNew, orgLoading, orgId, venueId]);

  // Deep links from the Details page (#venue-location, …) land on their card.
  useEffect(() => {
    if (loading) return;
    const id = window.location.hash.slice(1);
    if (id) requestAnimationFrame(() => jumpTo(id));
  }, [loading]);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(saved) || Boolean(logoFile) || removeLogo,
    [form, saved, logoFile, removeLogo]
  );

  useEffect(() => {
    if (!dirty || saving) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);

  const set = <K extends keyof VenueForm>(key: K, value: VenueForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const backHref = isNew ? `/admin/venues${q}` : `/admin/venues/${venueId}${q}`;

  const cancel = () => {
    if (dirty && !window.confirm('Leave without saving your changes?')) return;
    router.push(backHref);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setSaving(true);
    setError(null);
    setSlugError(null);

    // Spec 033: a value is the organizer's own choice (stored MANUAL). On an
    // edit, null is sent explicitly to drop a previous override and re-derive
    // from the address; on a create there is nothing to drop, so the key is
    // omitted and the backend derives it.
    const { timezone, ...rest } = form;
    const payload = timezone ? { ...rest, timezone } : isNew ? rest : { ...rest, timezone: null };

    let result: AdminVenue;
    try {
      result = isNew
        ? await api.post<AdminVenue>(`/organizations/${orgId}/venues`, payload)
        : await api.patch<AdminVenue>(`/organizations/${orgId}/venues/${venueId}`, payload);
    } catch (err: any) {
      if (err?.status === 409) setSlugError(err?.message || 'This URL is already taken. Choose another.');
      else setError(err?.message || 'Failed to save the venue');
      setSaving(false);
      return;
    }

    let notice = isNew ? 'Venue created.' : 'Changes saved.';
    try {
      if (logoFile) {
        const upload = new FormData();
        upload.append('logo', logoFile);
        await api.upload(`/organizations/${orgId}/venues/${result.id}/logo`, upload);
      } else if (removeLogo) {
        await api.delete(`/organizations/${orgId}/venues/${result.id}/logo`);
      }
    } catch (err: any) {
      notice = `Venue saved, but the logo could not be updated: ${err?.message || 'upload failed'}`;
    }

    const params = new URLSearchParams(q.slice(1));
    params.set('notice', notice);
    router.push(`/admin/venues/${result.id}?${params.toString()}`);
  };

  if (orgLoading || (orgId && loading)) {
    return (
      <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 sm:py-8" aria-busy="true" aria-label="Loading venue">
        <div className="h-64 animate-pulse rounded-xl bg-gray-200 motion-reduce:animate-none dark:bg-slate-800" />
      </div>
    );
  }

  if (!orgId || (!isNew && !venue)) {
    return (
      <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 sm:py-8">
        <FormAlert tone="error">{error || 'Choose an organization to edit its venues.'}</FormAlert>
        <Link href={`/admin/venues${q}`} className={`rounded text-sm font-medium text-accent-700 hover:underline dark:text-accent-300 ${focusRing}`}>
          Back to venues
        </Link>
      </div>
    );
  }

  const actionProps = {
    submitLabel: isNew ? 'Create venue' : 'Save changes',
    savingLabel: 'Saving…',
    saving,
    disabled: saving || (!isNew && !dirty),
    onCancel: cancel,
  };

  return (
    <EventFormShell
      asideLabel="Venue settings"
      header={
        <>
          <nav aria-label="Breadcrumb" className="mb-3 text-sm">
            <ol className="flex min-w-0 items-center gap-1 text-gray-600 dark:text-slate-400">
              <li>
                <Link href={`/admin/venues${q}`} className={`rounded font-medium hover:text-gray-900 dark:hover:text-white ${focusRing}`}>
                  Venues
                </Link>
              </li>
              {venue && (
                <>
                  <li aria-hidden>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </li>
                  <li className="min-w-0 truncate">
                    <Link href={backHref} className={`rounded font-medium hover:text-gray-900 dark:hover:text-white ${focusRing}`}>
                      {venue.name}
                    </Link>
                  </li>
                </>
              )}
              <li aria-hidden>
                <ChevronRight className="h-3.5 w-3.5" />
              </li>
              <li aria-current="page" className="text-gray-900 dark:text-slate-200">
                {isNew ? 'New' : 'Edit'}
              </li>
            </ol>
          </nav>
          <EventFormHeader
            eyebrow={isNew ? 'New venue' : 'Edit venue'}
            title={form.name.trim() || (isNew ? 'Untitled venue' : venue!.name)}
            meta={<VisibilityBadge isPublic={form.isPublic} />}
          />
        </>
      }
      alerts={error && <FormAlert tone="error">{error}</FormAlert>}
      main={
        <form id={EVENT_FORM_ID} onSubmit={handleSubmit} className="space-y-6">
          <FormCard id="venue-basics" step={1} title="Basics" description="How the venue is named on tickets, event pages and its own page.">
            <div className="space-y-4">
              <div>
                <label htmlFor="venue-name" className={labelClass}>
                  Name <span aria-hidden className="text-red-600 dark:text-red-400">*</span>
                </label>
                <input
                  id="venue-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. The Fillmore"
                  autoComplete="organization"
                  required
                  aria-required="true"
                  className={inputClass}
                />
              </div>
              <SlugField
                id="venue-slug"
                value={form.slug}
                onChange={(value) => set('slug', value)}
                source={form.name}
                prefix="/venues/"
                baseUrl={typeof window !== 'undefined' ? window.location.origin : undefined}
                error={slugError}
              />
            </div>
          </FormCard>

          <FormCard
            id="venue-location"
            step={2}
            title="Location"
            description="The address buyers see. Its state and ZIP code set the venue's time zone."
          >
            <div className="space-y-4">
              <div>
                <label htmlFor="venue-address" className={labelClass}>
                  Street address <span aria-hidden className="text-red-600 dark:text-red-400">*</span>
                </label>
                <input
                  id="venue-address"
                  type="text"
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  placeholder="123 Main St"
                  autoComplete="address-line1"
                  required
                  aria-required="true"
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
                <div className="sm:col-span-3">
                  <label htmlFor="venue-city" className={labelClass}>
                    City
                  </label>
                  <input
                    id="venue-city"
                    type="text"
                    value={form.city}
                    onChange={(e) => set('city', e.target.value)}
                    placeholder="e.g. Raleigh"
                    autoComplete="address-level2"
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <StateSelect id="venue-state" value={form.state} onChange={(value) => set('state', value)} className={inputClass} />
                </div>
                <div className="sm:col-span-1">
                  <label htmlFor="venue-postal-code" className={labelClass}>
                    ZIP code
                  </label>
                  <input
                    id="venue-postal-code"
                    type="text"
                    inputMode="numeric"
                    value={form.postalCode}
                    onChange={(e) => set('postalCode', e.target.value)}
                    placeholder="27601"
                    autoComplete="postal-code"
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 p-4 dark:bg-slate-900/50">
                <VenueTimeZoneField
                  id="venue-timezone"
                  state={form.state}
                  postalCode={form.postalCode}
                  value={form.timezone}
                  onChange={(value) => set('timezone', value)}
                  className={inputClass}
                  labelClassName={labelClass}
                />
                <p className={hintClass}>Event times at this venue print on this clock for every viewer.</p>
              </div>
            </div>
          </FormCard>

          <FormCard id="venue-logo" step={3} title="Logo" description="Shown on the venue's public page. Square images work best.">
            <ImageUploader
              label="venue logo"
              currentPreview={logoPreview}
              onFileSelect={(file) => {
                setLogoFile(file);
                setRemoveLogo(false);
                setLogoPreview(URL.createObjectURL(file));
              }}
              onRemove={() => {
                setLogoFile(null);
                setLogoPreview(null);
                setRemoveLogo(Boolean(venue?.logoUrl));
              }}
              uploading={saving && Boolean(logoFile)}
            />
          </FormCard>
        </form>
      }
      aside={
        <>
          <FormCard id="venue-visibility" title="Public page" description="Lists the published events held here.">
            <label className="flex min-h-11 cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                role="switch"
                form={EVENT_FORM_ID}
                checked={form.isPublic}
                onChange={(e) => set('isPublic', e.target.checked)}
                aria-describedby="venue-visibility-hint"
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-gray-300 transition-colors after:absolute after:start-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-accent-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 peer-focus-visible:ring-offset-2 dark:bg-slate-600 dark:after:border-slate-500 dark:peer-focus-visible:ring-offset-slate-800 motion-reduce:transition-none motion-reduce:after:transition-none"
              />
              <span className="text-sm">
                <span className="block font-medium text-gray-900 dark:text-white">Public venue page</span>
                <span id="venue-visibility-hint" className="mt-0.5 block text-gray-600 dark:text-slate-400">
                  {form.isPublic
                    ? 'Anyone with the link can open it.'
                    : 'The public URL returns not found. Events here still sell on their own pages.'}
                </span>
              </span>
            </label>
          </FormCard>
          <EventSaveCard dirty={dirty}>
            <EventFormActions {...actionProps} layout="stack" />
          </EventSaveCard>
        </>
      }
      mobileActions={<EventFormActions {...actionProps} layout="row" />}
    />
  );
}

// useSearchParams() needs a Suspense boundary (Next 14 App Router).
export default function VenueEditor({ venueId }: { venueId?: string }) {
  return (
    <Suspense fallback={null}>
      <VenueEditorContent venueId={venueId} />
    </Suspense>
  );
}
