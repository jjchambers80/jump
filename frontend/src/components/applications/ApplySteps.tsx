'use client';

// The application form's fields, shared by the event apply page (spec 011),
// the standing-form page and the page Apply drawer (spec 044D). One
// implementation: `useApplyForm` owns the state and the multipart submit,
// `ApplySteps` renders the numbered steps. Callers own the layout and the
// submit button.

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { businessFieldsOf, SOCIAL_FIELDS, type PublicForm, type Question } from '@/lib/applications';
import { acceptancesFor, applyConsentText, fetchLegalVersions, LEGAL_PAGES_ENABLED, LEGAL_PATHS, type LegalVersions } from '@/lib/legal';
import { storefrontInput, storefrontLabel, storefrontTextarea } from '@/components/storefront/formStyles';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const MAX_PHOTOS = 6;
const MAX_PHOTO_MB = 5;
const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

const input = storefrontInput;
const textarea = storefrontTextarea;
const label = storefrontLabel;
const check = 'mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-brand dark:border-slate-600';
// Most fields are required, so the exceptions carry the mark.
const optional = <span className="ml-1.5 text-xs font-normal text-gray-500 dark:text-slate-400">Optional</span>;
const choice = 'flex items-start gap-3 rounded-xl border border-gray-200 px-3.5 py-3 text-sm text-gray-800 transition-colors hover:border-gray-300 has-[:checked]:border-brand-link has-[:checked]:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:has-[:checked]:bg-slate-900/50 cursor-pointer';

type Answers = Record<string, string | string[] | boolean>;

/** The text parts of an application, kept in sessionStorage as a draft (files never are). */
interface Draft {
  contact: { email: string; firstName: string; lastName: string };
  profile: { businessName: string; description: string; website: string };
  socials: Record<string, string>;
  answers: Answers;
  optInAccount: boolean;
  optInMarketing: boolean;
}

const EMPTY: Draft = {
  contact: { email: '', firstName: '', lastName: '' },
  profile: { businessName: '', description: '', website: '' },
  socials: {},
  answers: {},
  optInAccount: true,
  optInMarketing: false,
};

function readDraft(key?: string): Draft {
  if (!key) return EMPTY;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function photoError(file: File): string | null {
  if (!ACCEPT.split(',').includes(file.type)) return `${file.name}: only JPG, PNG, GIF or WebP`;
  if (file.size > MAX_PHOTO_MB * 1024 * 1024) return `${file.name}: ${MAX_PHOTO_MB} MB max`;
  return null;
}

export interface SubmitResult {
  applicationId: string;
  statusUrl: string;
}

/**
 * State and submit for one application form. `submitUrl` is the multipart
 * endpoint (event or standing); `draftKey` keeps the typed text in
 * sessionStorage so closing the drawer or reloading loses nothing.
 */
export function useApplyForm(form: PublicForm | null, { submitUrl, draftKey }: { submitUrl: string; draftKey?: string }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [photos, setPhotos] = useState<File[]>([]);
  const [answerPhotos, setAnswerPhotos] = useState<Record<string, File>>({});
  // Spec 024 phase 3: account (default on, like checkout), marketing and the
  // data-collection consent. Versions are echoed so a stale one is refused.
  const [consent, setConsent] = useState(false);
  const [legalVersions, setLegalVersions] = useState<LegalVersions | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(readDraft(draftKey)), [draftKey]);
  useEffect(() => {
    fetchLegalVersions()
      .then(setLegalVersions)
      .catch(() => setLegalVersions(null));
  }, []);

  const update = (patch: Partial<Draft>) =>
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      if (draftKey) {
        try {
          sessionStorage.setItem(draftKey, JSON.stringify(next));
        } catch {
          // Storage full or blocked: the draft just isn't kept.
        }
      }
      return next;
    });

  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY) || photos.length > 0 || Object.keys(answerPhotos).length > 0;

  const clearDraft = () => {
    if (draftKey) {
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
    }
    setDraft(EMPTY);
    setPhotos([]);
    setAnswerPhotos({});
    setConsent(false);
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const next = [...photos];
    for (const file of Array.from(files)) {
      const err = photoError(file);
      if (err) {
        setError(err);
        return;
      }
      if (next.length >= MAX_PHOTOS) break;
      next.push(file);
    }
    setError(null);
    setPhotos(next);
  };

  const setAnswerPhoto = (questionId: string, file: File | null) => {
    if (file) {
      const err = photoError(file);
      if (err) {
        setError(err);
        return;
      }
    }
    setAnswerPhotos((prev) => {
      const next = { ...prev };
      if (file) next[questionId] = file;
      else delete next[questionId];
      return next;
    });
  };

  /** Submits the application; resolves with the status link, or null when it failed (see `error`). */
  const submit = async (e?: FormEvent): Promise<SubmitResult | null> => {
    e?.preventDefault();
    if (!form || submitting) return null;
    if (!consent) {
      setError('Please agree to the collection and storage of your information to continue.');
      return null;
    }
    setSubmitting(true);
    setError(null);
    try {
      const versions = legalVersions ?? (await fetchLegalVersions());
      const asks = businessFieldsOf(form);
      // Only the business fields this form asks; a draft may hold others from an earlier form.
      const profile = Object.fromEntries(
        Object.entries({ ...draft.profile, socials: draft.socials }).filter(([k]) => (asks as string[]).includes(k))
      );
      const payload = {
        formSlug: form.slug,
        contact: draft.contact,
        ...(asks.length > 0 && { profile }),
        answers: draft.answers,
        optInAccount: form.offerAccount !== false && draft.optInAccount,
        optInMarketing: form.offerMarketing !== false && draft.optInMarketing,
        acceptances: acceptancesFor(versions),
      };
      const body = new FormData();
      body.append('payload', JSON.stringify(payload));
      if (asks.includes('photos')) photos.forEach((p) => body.append('profilePhotos', p, p.name));
      Object.entries(answerPhotos).forEach(([qid, file]) => body.append(`answer:${qid}`, file, file.name));
      const res = await fetch(`${API_URL}${submitUrl}`, { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The versions moved under us: forget the cached ones so the next try shows the current text.
        if (data.code === 'LEGAL_VERSION_STALE') setLegalVersions(null);
        throw new Error(data.message || data.error || 'Could not submit your application');
      }
      clearDraft();
      setSubmitting(false);
      return { applicationId: data.applicationId, statusUrl: data.statusUrl };
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
      return null;
    }
  };

  return {
    ...draft,
    update,
    photos,
    setPhotos,
    addPhotos,
    answerPhotos,
    setAnswerPhoto,
    consent,
    setConsent,
    submitting,
    error,
    setError,
    dirty,
    submit,
  };
}

export type ApplyFormState = ReturnType<typeof useApplyForm>;

/** The form's numbered steps: details, business (when the form collects it), questions, consent. */
export function ApplySteps({ form, apply, idPrefix = '' }: { form: PublicForm; apply: ApplyFormState; idPrefix?: string }) {
  const { contact, profile, socials, answers, update } = apply;
  const orgName = form.organizationName || 'the organizer';
  const asks = businessFieldsOf(form);
  const id = (name: string) => `${idPrefix}${name}`;
  let step = 0;
  const next = () => ++step;

  return (
    // One surface, sections split by hairlines: the caller's page or panel is the card.
    <div className="divide-y divide-gray-200 dark:divide-slate-700">
      {form.intro && (
        <p className="max-w-prose whitespace-pre-line pb-8 text-base leading-relaxed text-gray-700 motion-safe:animate-card-in dark:text-slate-300">{form.intro}</p>
      )}

      <Step n={next()} id={id('step-details')} title="Your details" hint="Where the organizer sends their decision.">
        {form.collectName !== false && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={id('firstName')} className={label}>First name</label>
            <input id={id('firstName')} required autoComplete="given-name" className={input} value={contact.firstName} onChange={(e) => update({ contact: { ...contact, firstName: e.target.value } })} />
          </div>
          <div>
            <label htmlFor={id('lastName')} className={label}>Last name</label>
            <input id={id('lastName')} required autoComplete="family-name" className={input} value={contact.lastName} onChange={(e) => update({ contact: { ...contact, lastName: e.target.value } })} />
          </div>
        </div>
        )}
        <div>
          <label htmlFor={id('email')} className={label}>Email</label>
          <input id={id('email')} type="email" required autoComplete="email" className={input} value={contact.email} onChange={(e) => update({ contact: { ...contact, email: e.target.value } })} />
        </div>
      </Step>

      {asks.length > 0 && (
        <Step n={next()} id={id('step-business')} title="Your business" hint="This is what the organizer reviews. Show them your best.">
          {asks.includes('businessName') && (
          <div>
            <label htmlFor={id('businessName')} className={label}>Business or outlet name</label>
            <input id={id('businessName')} required autoComplete="organization" className={input} value={profile.businessName} onChange={(e) => update({ profile: { ...profile, businessName: e.target.value } })} />
          </div>
          )}
          {asks.includes('description') && (
          <div>
            <label htmlFor={id('description')} className={label}>Tell us about it{optional}</label>
            <textarea id={id('description')} rows={4} className={textarea} value={profile.description} onChange={(e) => update({ profile: { ...profile, description: e.target.value } })} />
          </div>
          )}
          {asks.includes('website') && (
          <div>
            <label htmlFor={id('website')} className={label}>Website{optional}</label>
            <input id={id('website')} className={input} placeholder="example.com" value={profile.website} onChange={(e) => update({ profile: { ...profile, website: e.target.value } })} />
          </div>
          )}
          {asks.includes('socials') && (
          <fieldset>
            <legend className={label}>Social profiles{optional}</legend>
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {SOCIAL_FIELDS.map((s) => (
              <div key={s.key}>
                <label htmlFor={id(`social-${s.key}`)} className="mb-1 block text-xs font-medium text-gray-600 dark:text-slate-400">{s.label}</label>
                <input id={id(`social-${s.key}`)} className={input} placeholder={s.placeholder} value={socials[s.key] || ''} onChange={(e) => update({ socials: { ...socials, [s.key]: e.target.value } })} />
              </div>
            ))}
            </div>
          </fieldset>
          )}
          {asks.includes('photos') && (
          <div>
            <p className={label} id={id('photos-label')}>
              Photos of your work or products
              <span className="ml-1.5 text-xs font-normal text-gray-500 dark:text-slate-400">Optional · up to {MAX_PHOTOS}</span>
            </p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4" data-testid={apply.photos.length > 0 ? 'apply-photos' : undefined}>
              {apply.photos.map((p, i) => (
                <PhotoThumb key={`${p.name}-${i}`} file={p} onRemove={() => apply.setPhotos(apply.photos.filter((_, j) => j !== i))} />
              ))}
              {apply.photos.length < MAX_PHOTOS && (
                <label
                  htmlFor={id('photos')}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-300 text-center text-xs font-semibold text-gray-600 transition-colors hover:border-brand-link hover:text-brand-link has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-link dark:border-slate-600 dark:text-slate-400 ${apply.photos.length === 0 ? 'col-span-3 py-8 sm:col-span-4' : 'aspect-square'}`}
                >
                  <ImagePlus className="h-6 w-6" aria-hidden />
                  <span>{apply.photos.length === 0 ? 'Add photos' : 'Add more'}</span>
                  {apply.photos.length === 0 && <span className="font-normal text-gray-500 dark:text-slate-400">JPG, PNG, GIF or WebP · {MAX_PHOTO_MB} MB each</span>}
                  <input
                    id={id('photos')}
                    type="file"
                    accept={ACCEPT}
                    multiple
                    aria-labelledby={id('photos-label')}
                    onChange={(e) => {
                      apply.addPhotos(e.target.files);
                      e.target.value = '';
                    }}
                    className="sr-only"
                  />
                </label>
              )}
            </div>
          </div>
          )}
        </Step>
      )}

      {form.questions.length > 0 && (
        <Step n={next()} id={id('step-questions')} title="A few questions" hint={`From ${orgName}.`}>
          {form.questions.map((q) => (
            <QuestionField
              id={id(`q-${q.id}`)}
              key={q.id}
              question={q}
              value={answers[q.id]}
              onChange={(v) => update({ answers: { ...answers, [q.id]: v } })}
              file={apply.answerPhotos[q.id]}
              onFile={(f) => apply.setAnswerPhoto(q.id, f)}
            />
          ))}
        </Step>
      )}

      <Step n={next()} id={id('step-submit')} title="Before you submit">
        {/* Account + marketing opt-ins — independent; applied once the application is submitted (spec 024 phase 3) */}
        {form.offerAccount !== false && (
        <label className={choice}>
          <input type="checkbox" checked={apply.optInAccount} onChange={(e) => update({ optInAccount: e.target.checked })} className={check} data-testid="apply-opt-in-account" />
          <span>
            <span className="font-semibold">Create an account with {orgName} to manage your applications</span>
            <span className="block text-gray-500 dark:text-slate-400">No password. We&apos;ll email you a sign-in link.</span>
          </span>
        </label>
        )}
        {form.offerMarketing !== false && (
        <label className={choice}>
          <input type="checkbox" checked={apply.optInMarketing} onChange={(e) => update({ optInMarketing: e.target.checked })} className={check} data-testid="apply-opt-in-marketing" />
          <span>Email me about future events from {form.organizationName || 'this organizer'}</span>
        </label>
        )}
        <label className={choice}>
          <input type="checkbox" required checked={apply.consent} onChange={(e) => apply.setConsent(e.target.checked)} className={check} data-testid="apply-consent" />
          <span>
            {applyConsentText(form.organizationName)}
            {LEGAL_PAGES_ENABLED && (
              <>
                {' '}
                <a href={LEGAL_PATHS.privacy} target="_blank" rel="noreferrer" className="text-brand-link underline" data-testid="apply-privacy-link">
                  Read the Privacy Policy
                </a>
                .
              </>
            )}
          </span>
        </label>
      </Step>
    </div>
  );
}

/** A numbered form step: a section of the one form surface, the number in a brand disc beside the title. */
function Step({ n, title, hint, id, children }: { n: number; title: string; hint?: string; id: string; children: ReactNode }) {
  const titleId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className="py-8 first:pt-0 last:pb-0 motion-safe:animate-card-in"
      style={{ animationDelay: `${Math.min(n, 5) * 50}ms` }}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold tabular-nums text-brand-fg">
          {n}
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 id={titleId} className="text-lg font-bold leading-snug tracking-tight text-gray-900 dark:text-slate-100">{title}</h2>
          {hint && <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">{hint}</p>}
        </div>
      </div>
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

/** A chosen profile photo, previewed from a local object URL. */
function PhotoThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl border border-gray-200 bg-gray-100 dark:border-slate-700 dark:bg-slate-700">
      {src && <img src={src} alt={file.name} className="h-full w-full object-cover" />}
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function QuestionField({
  id,
  question: q,
  value,
  onChange,
  file,
  onFile,
}: {
  /** The field's DOM id, prefixed like the rest of the form so two mounted copies never collide. */
  id: string;
  question: Question;
  value: string | string[] | boolean | undefined;
  onChange: (v: string | string[] | boolean) => void;
  file?: File;
  onFile: (f: File | null) => void;
}) {
  const req = q.required ? null : optional;
  const help = q.helpText ? <p className="mt-1.5 text-xs text-gray-500 dark:text-slate-400">{q.helpText}</p> : null;
  switch (q.type) {
    case 'LONG_TEXT':
      return (
        <div>
          <label htmlFor={id} className={label}>{q.label}{req}</label>
          <textarea id={id} rows={4} required={q.required} className={textarea} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />
          {help}
        </div>
      );
    case 'SINGLE_CHOICE':
      return (
        <fieldset>
          <legend className={label}>{q.label}{req}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {q.options.map((o) => (
              <label key={o} className={choice}>
                <input type="radio" name={id} value={o} checked={value === o} onChange={() => onChange(o)} required={q.required} className={check} />
                {o}
              </label>
            ))}
          </div>
          {help}
        </fieldset>
      );
    case 'MULTI_CHOICE': {
      const list = Array.isArray(value) ? value : [];
      return (
        <fieldset>
          <legend className={label}>{q.label}{req}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {q.options.map((o) => (
              <label key={o} className={choice}>
                <input type="checkbox" checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} className={check} />
                {o}
              </label>
            ))}
          </div>
          {help}
        </fieldset>
      );
    }
    case 'CHECKBOX':
      return (
        <div>
          <label className={choice}>
            <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} required={q.required} className={check} />
            <span>{q.label}{req}</span>
          </label>
          {help}
        </div>
      );
    case 'PHOTO':
      return (
        <div>
          <label htmlFor={id} className={label}>{q.label}{req}</label>
          <input id={id} type="file" accept={ACCEPT} required={q.required && !file} onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-full file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-gray-800 hover:file:bg-gray-200 dark:text-slate-400 dark:file:bg-slate-700 dark:file:text-slate-200" />
          {file && <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">{file.name}</p>}
          {help}
        </div>
      );
    default: {
      const type = q.type === 'EMAIL' ? 'email' : q.type === 'PHONE' ? 'tel' : q.type === 'NUMBER' ? 'number' : q.type === 'URL' ? 'url' : 'text';
      return (
        <div>
          <label htmlFor={id} className={label}>{q.label}{req}</label>
          <input id={id} type={type === 'url' ? 'text' : type} inputMode={type === 'url' ? 'url' : undefined} required={q.required} className={input} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />
          {help}
        </div>
      );
    }
  }
}
