'use client';

// Cards of Settings › Brand (spec 049). Each card owns its drafts and saves
// only its own fields through PATCH /organizations/:id (or the image routes).

import { FormEvent, ReactNode, useState } from 'react';
import { SETTINGS_GROUPS } from '@jump/theme';
import api from '@/services/api';
import ImageUploader from '@/components/ImageUploader';
import BrandColorPicker from '@/components/BrandColorPicker';
import ThemeModePicker from '@/components/ThemeModePicker';
import SocialIcon, { SOCIAL_LABELS } from '@/components/storefront/SocialIcon';
import { resolveAssetUrl } from '@/lib/assets';
import { evaluateBrandColor } from '@/lib/color';
import { DEFAULT_THEME_MODE, type ThemeMode } from '@/lib/theme';

export const SLOGAN_MAX = 120;
export const SHORT_DESCRIPTION_MAX = 300;

export type SocialLinks = Partial<Record<string, string>>;

export interface BrandOrg {
  id: string;
  name: string;
  logoUrl?: string | null;
  squareLogoUrl?: string | null;
  coverUrl?: string | null;
  brandColor?: string | null;
  brandSecondaryColor?: string | null;
  themeMode?: ThemeMode;
  slogan?: string | null;
  shortDescription?: string | null;
  socialLinks?: SocialLinks | null;
}

interface CardProps {
  org: BrandOrg;
  onSaved: (next: BrandOrg) => void;
}

export const cardClass =
  'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300';
const hint = 'mt-1 text-xs text-gray-500 dark:text-slate-400';
const saveButton =
  'rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-gray-950 shadow-sm hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-slate-800';

const SOCIAL_FIELDS = SETTINGS_GROUPS.social.fields as Record<string, { hosts: string[] | null }>;

function errorMessage(err: any, fallback: string) {
  const detail = Array.isArray(err?.details) ? err.details[0]?.message : null;
  return detail || err?.message || fallback;
}

/** Shared save state for one card: busy, error, "Saved". */
function useSave(org: BrandOrg, onSaved: (next: BrandOrg) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const run = async (request: () => Promise<BrandOrg>, fallback: string) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await request();
      onSaved({ ...org, ...next });
      setSaved(true);
    } catch (err: any) {
      setError(errorMessage(err, fallback));
    } finally {
      setSaving(false);
    }
  };
  const patch = (body: Partial<BrandOrg>, fallback: string) =>
    run(() => api.patch<BrandOrg>(`/organizations/${org.id}`, body), fallback);
  return { saving, error, saved, run, patch };
}

function Status({ error, saved }: { error: string | null; saved: boolean }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {error}
      </p>
    );
  }
  return saved ? (
    <p role="status" className="text-sm text-green-700 dark:text-green-400">
      Saved
    </p>
  ) : null;
}

function Card({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} data-testid={`brand-${id}`} className={cardClass}>
      <h3 id={`${id}-heading`} className="text-sm font-semibold text-gray-900 dark:text-white">
        {title}
      </h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">{description}</p>
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  );
}

type ImageKind = 'logo' | 'square-logo' | 'cover';

const IMAGES: { kind: ImageKind; title: string; label: string; help: string; url: (org: BrandOrg) => string | null | undefined }[] = [
  { kind: 'logo', title: 'Default logo', label: 'logo', help: 'Shown in your store header and emails.', url: (o) => o.logoUrl },
  {
    kind: 'square-logo',
    title: 'Square logo',
    label: 'square logo',
    help: 'Used where a square fits, like the browser tab icon. Cropped to a square.',
    url: (o) => o.squareLogoUrl,
  },
  { kind: 'cover', title: 'Cover image', label: 'cover image', help: 'Used as the sharing image for your store.', url: (o) => o.coverUrl },
];

export function LogosCard({ org, onSaved }: CardProps) {
  const [busy, setBusy] = useState<ImageKind | null>(null);
  const { error, saved, run } = useSave(org, onSaved);

  const upload = (kind: ImageKind, file: File) => {
    setBusy(kind);
    const formData = new FormData();
    formData.append('logo', file);
    return run(() => api.upload<BrandOrg>(`/organizations/${org.id}/${kind}`, formData), 'Failed to upload the image').finally(() =>
      setBusy(null)
    );
  };
  const remove = (kind: ImageKind) => {
    setBusy(kind);
    return run(() => api.delete<BrandOrg>(`/organizations/${org.id}/${kind}`), 'Failed to remove the image').finally(() => setBusy(null));
  };

  return (
    <Card id="logos" title="Logos" description="Images that identify your store.">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {IMAGES.map((image) => (
          <div key={image.kind} data-testid={`brand-image-${image.kind}`}>
            <p className={`${labelClass} mb-2`}>{image.title}</p>
            <ImageUploader
              currentPreview={resolveAssetUrl(image.url(org))}
              onFileSelect={(file) => upload(image.kind, file)}
              onRemove={() => remove(image.kind)}
              uploading={busy === image.kind}
              label={image.label}
            />
            <p className={hint}>{image.help}</p>
          </div>
        ))}
      </div>
      <Status error={error} saved={saved} />
    </Card>
  );
}

function ColorField({
  id,
  legend,
  help,
  value,
  onChange,
}: {
  id: string;
  legend: string;
  help: string;
  value: string | null;
  onChange: (hex: string | null) => void;
}) {
  const passes = value ? evaluateBrandColor(value).passesAA : true;
  return (
    <fieldset data-testid={id}>
      <legend className={labelClass}>{legend}</legend>
      <p className={`${hint} mb-2`}>{help}</p>
      <BrandColorPicker value={value} onChange={onChange} />
      {!passes && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="brand-color-warning">
          You can save this color, but it may not meet ADA requirements.
        </p>
      )}
    </fieldset>
  );
}

export function ColorsCard({ org, onSaved }: CardProps) {
  const [primary, setPrimary] = useState<string | null>(org.brandColor ?? null);
  const [secondary, setSecondary] = useState<string | null>(org.brandSecondaryColor ?? null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(org.themeMode ?? DEFAULT_THEME_MODE);
  const { saving, error, saved, patch } = useSave(org, onSaved);

  const body: Partial<BrandOrg> = {};
  if (primary !== (org.brandColor ?? null)) body.brandColor = primary;
  if (secondary !== (org.brandSecondaryColor ?? null)) body.brandSecondaryColor = secondary;
  if (themeMode !== (org.themeMode ?? DEFAULT_THEME_MODE)) body.themeMode = themeMode;
  const dirty = Object.keys(body).length > 0;

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (dirty) void patch(body, 'Failed to save colors');
  };

  return (
    <form onSubmit={save}>
      <Card id="colors" title="Colors" description="Your brand colors and the light or dark mode of your public pages.">
        <ColorField
          id="primary-color"
          legend="Primary"
          help="Buttons, links and highlights."
          value={primary}
          onChange={setPrimary}
        />
        <ColorField
          id="secondary-color"
          legend="Secondary"
          help="An accent your theme can use alongside the primary color."
          value={secondary}
          onChange={setSecondary}
        />
        <fieldset>
          <legend className={labelClass}>Theme mode</legend>
          <p className={`${hint} mb-2`}>Light or dark mode on your public event, venue and organization pages.</p>
          <ThemeModePicker value={themeMode} onChange={setThemeMode} />
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || !dirty} data-testid="brand-colors-save" className={saveButton}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <Status error={error} saved={saved} />
        </div>
      </Card>
    </form>
  );
}

export function TextCard({ org, onSaved }: CardProps) {
  const [slogan, setSlogan] = useState(org.slogan ?? '');
  const [description, setDescription] = useState(org.shortDescription ?? '');
  const { saving, error, saved, patch } = useSave(org, onSaved);

  const body: Partial<BrandOrg> = {};
  if ((slogan.trim() || null) !== (org.slogan ?? null)) body.slogan = slogan.trim() || null;
  if ((description.trim() || null) !== (org.shortDescription ?? null)) body.shortDescription = description.trim() || null;
  const dirty = Object.keys(body).length > 0;

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (dirty) void patch(body, 'Failed to save the slogan and description');
  };

  return (
    <form onSubmit={save}>
      <Card id="text" title="Slogan and short description" description="How your store describes itself, in your footer and when shared.">
        <div>
          <label htmlFor="brand-slogan" className={labelClass}>
            Slogan
          </label>
          <input
            id="brand-slogan"
            value={slogan}
            onChange={(event) => setSlogan(event.target.value)}
            maxLength={SLOGAN_MAX}
            placeholder="Raleigh's retro gaming market"
            aria-describedby="brand-slogan-count"
            className={field}
          />
          <p id="brand-slogan-count" className={hint}>
            {slogan.length} of {SLOGAN_MAX} characters used
          </p>
        </div>
        <div>
          <label htmlFor="brand-description" className={labelClass}>
            Short description
          </label>
          <textarea
            id="brand-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={SHORT_DESCRIPTION_MAX}
            rows={3}
            aria-describedby="brand-description-count"
            className={field}
          />
          <p id="brand-description-count" className={hint}>
            {description.length} of {SHORT_DESCRIPTION_MAX} characters used
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || !dirty} data-testid="brand-text-save" className={saveButton}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <Status error={error} saved={saved} />
        </div>
      </Card>
    </form>
  );
}

export function SocialLinksCard({ org, onSaved }: CardProps) {
  const initial = org.socialLinks ?? {};
  const [links, setLinks] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.keys(SOCIAL_LABELS).map((key) => [key, initial[key] ?? '']))
  );
  const { saving, error, saved, patch } = useSave(org, onSaved);

  const next = Object.fromEntries(
    Object.entries(links)
      .map(([key, url]) => [key, url.trim()] as const)
      .filter(([, url]) => url)
  );
  // Key order is irrelevant (Postgres jsonb reorders keys).
  const dirty = Object.keys(SOCIAL_LABELS).some((key) => (next[key] ?? '') !== (initial[key] ?? ''));

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (dirty) void patch({ socialLinks: Object.keys(next).length ? next : null }, 'Failed to save social links');
  };

  return (
    <form onSubmit={save}>
      <Card id="social" title="Social links" description="Links to your store on other sites. Leave a network blank to hide it.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Object.entries(SOCIAL_LABELS).map(([key, name]) => {
            const host = SOCIAL_FIELDS[key]?.hosts?.[0];
            return (
              <div key={key}>
                <label htmlFor={`social-${key}`} className={`${labelClass} flex items-center gap-2`}>
                  <SocialIcon network={key} className="h-4 w-4 text-gray-500 dark:text-slate-400" />
                  {name}
                </label>
                <input
                  id={`social-${key}`}
                  type="url"
                  inputMode="url"
                  value={links[key]}
                  onChange={(event) => setLinks((current) => ({ ...current, [key]: event.target.value }))}
                  placeholder={host ? `https://${host}/…` : 'https://…'}
                  spellCheck={false}
                  className={field}
                />
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || !dirty} data-testid="brand-social-save" className={saveButton}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <Status error={error} saved={saved} />
        </div>
      </Card>
    </form>
  );
}
