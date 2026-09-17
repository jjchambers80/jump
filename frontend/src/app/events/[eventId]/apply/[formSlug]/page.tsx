// Public application form (spec 011): tier choice (PAID) with optional
// add-ons (spec 012), contact, business profile with photos, the organizer's
// questions, submit. Submits as multipart straight to the backend (public
// route, IP rate-limited there). On success the applicant lands on their
// status page (token in the URL).
'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import api from '@/services/api';
import { acceptanceLine, estimatedApplicantTotal, money, SOCIAL_FIELDS, tierPriceLine, type PublicForm, type Question } from '@/lib/applications';
import AddOnPicker from '@/components/AddOnPicker';
import ApplyShell from '../ApplyShell';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const MAX_PHOTOS = 6;
const MAX_PHOTO_MB = 5;
const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

const input =
  'w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 text-sm';
const label = 'block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1';
const section = 'bg-white dark:bg-slate-800 rounded-lg shadow-sm p-5 sm:p-6 space-y-4';

type Answers = Record<string, string | string[] | boolean>;

function photoError(file: File): string | null {
  if (!ACCEPT.split(',').includes(file.type)) return `${file.name}: only JPG, PNG, GIF or WebP`;
  if (file.size > MAX_PHOTO_MB * 1024 * 1024) return `${file.name}: ${MAX_PHOTO_MB} MB max`;
  return null;
}

export default function ApplyFormPage({ params }: { params: { eventId: string; formSlug: string } }) {
  const router = useRouter();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tierId, setTierId] = useState('');
  const [addOnQty, setAddOnQty] = useState<Record<string, number>>({});
  const [contact, setContact] = useState({ email: '', firstName: '', lastName: '' });
  const [profile, setProfile] = useState({ businessName: '', description: '', website: '' });
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<File[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [answerPhotos, setAnswerPhotos] = useState<Record<string, File>>({});
  const [optInMarketing, setOptInMarketing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PublicForm>(`/events/${params.eventId}/applications/forms/${params.formSlug}`)
      .then((f) => {
        setForm(f);
        if (f.tiers.length === 1) setTierId(f.tiers[0].id);
      })
      .catch((err) => setLoadError(err?.message || 'This form is not available'));
  }, [params.eventId, params.formSlug]);

  const selectedTier = useMemo(() => form?.tiers.find((t) => t.id === tierId) ?? null, [form, tierId]);
  const closedLine = form ? acceptanceLine(form.acceptance) : null;
  // Add-on lines the chosen tier offers with a quantity; another tier may not offer the same ones.
  const tierAddOns = useMemo(() => selectedTier?.addOns ?? [], [selectedTier]);
  const addOnLines = useMemo(
    () => tierAddOns.filter((a) => (addOnQty[a.id] ?? 0) > 0).map((a) => ({ addOnId: a.id, quantity: addOnQty[a.id] })),
    [tierAddOns, addOnQty]
  );
  const estimatedTotal = selectedTier ? estimatedApplicantTotal(selectedTier, addOnQty) : 0;

  const setAnswer = (id: string, value: string | string[] | boolean) => setAnswers((prev) => ({ ...prev, [id]: value }));

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || submitting) return;
    if (form.kind === 'PAID' && !tierId) {
      setError('Choose an option to continue.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        formSlug: form.slug,
        ...(form.kind === 'PAID' && { tierId }),
        ...(addOnLines.length > 0 && { addOns: addOnLines }),
        contact,
        profile: { ...profile, socials },
        answers,
        optInMarketing,
      };
      const body = new FormData();
      body.append('payload', JSON.stringify(payload));
      photos.forEach((p) => body.append('profilePhotos', p, p.name));
      Object.entries(answerPhotos).forEach(([qid, file]) => body.append(`answer:${qid}`, file, file.name));
      const res = await fetch(`${API_URL}/events/${params.eventId}/applications`, { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not submit your application');
      if (data.next === 'checkout' && data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      router.push(new URL(data.statusUrl).pathname + new URL(data.statusUrl).search);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <ApplyShell eventId={params.eventId} title={form?.name}>
      {() => {
        if (loadError) return <p role="alert" className="text-red-700 dark:text-red-300">{loadError}</p>;
        if (!form) return <p className="text-gray-600 dark:text-slate-400">Loading…</p>;
        if (closedLine) {
          return (
            <div className={section} data-testid="apply-closed">
              <p className="text-gray-800 dark:text-slate-200">This form is {closedLine.toLowerCase()}.</p>
            </div>
          );
        }
        return (
          <form onSubmit={handleSubmit} noValidate className="space-y-6" data-testid="apply-form">
            {form.intro && <p className="text-gray-700 dark:text-slate-300 whitespace-pre-line">{form.intro}</p>}

            {form.kind === 'PAID' && (
              <fieldset className={section}>
                <legend className="text-lg font-semibold text-gray-900 dark:text-slate-100">Choose an option</legend>
                <div className="space-y-2">
                  {form.tiers.map((t) => (
                    <label
                      key={t.id}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${tierId === t.id ? 'border-brand-link bg-gray-50 dark:bg-slate-900/40' : 'border-gray-200 dark:border-slate-700'} ${t.soldOut ? 'opacity-70' : ''}`}
                    >
                      <input type="radio" name="tier" value={t.id} checked={tierId === t.id} onChange={() => setTierId(t.id)} className="mt-1" />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-gray-900 dark:text-slate-100">{t.name}</span>
                          <span className="text-sm font-semibold text-brand-link whitespace-nowrap">{tierPriceLine(t, form.feeMode)}</span>
                        </span>
                        {t.description && <span className="block text-sm text-gray-600 dark:text-slate-400">{t.description}</span>}
                        {t.soldOut && <span className="block text-xs text-amber-700 dark:text-amber-300 mt-1">Full — you can still apply for the waitlist</span>}
                      </span>
                    </label>
                  ))}
                </div>
                {selectedTier && tierAddOns.length > 0 && (
                  <AddOnPicker
                    addOns={tierAddOns}
                    quantities={addOnQty}
                    onChange={(id, quantity) => setAddOnQty((prev) => ({ ...prev, [id]: quantity }))}
                    unitPrice={(a) => tierAddOns.find((x) => x.id === a.id)?.applicantPays ?? a.price}
                    title="Add-ons"
                    hint="Optional extras for your spot. Charged with your application."
                  />
                )}
                {selectedTier && (
                  <div className="text-sm text-gray-700 dark:text-slate-300 space-y-1" data-testid="apply-price-note">
                    {addOnLines.length > 0 && (
                      <p data-testid="apply-total-line">
                        {selectedTier.name} {money(selectedTier.applicantPays)}
                        {tierAddOns
                          .filter((a) => (addOnQty[a.id] ?? 0) > 0)
                          .map((a) => ` + ${a.name} ×${addOnQty[a.id]} ${money(a.applicantPays * addOnQty[a.id])}`)
                          .join('')}{' '}
                        = <strong>{money(estimatedTotal)}</strong>
                      </p>
                    )}
                    <p>
                      {form.chargeTiming === 'APPROVAL'
                        ? `You will save a card now and be charged ${addOnLines.length > 0 ? money(estimatedTotal) : tierPriceLine(selectedTier, form.feeMode)} only if your application is accepted.`
                        : `You will pay ${addOnLines.length > 0 ? money(estimatedTotal) : tierPriceLine(selectedTier, form.feeMode)} when you submit.`}
                    </p>
                  </div>
                )}
              </fieldset>
            )}

            <div className={section}>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Your details</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className={label}>First name</label>
                  <input id="firstName" required className={input} value={contact.firstName} onChange={(e) => setContact({ ...contact, firstName: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="lastName" className={label}>Last name</label>
                  <input id="lastName" required className={input} value={contact.lastName} onChange={(e) => setContact({ ...contact, lastName: e.target.value })} />
                </div>
              </div>
              <div>
                <label htmlFor="email" className={label}>Email</label>
                <input id="email" type="email" required autoComplete="email" className={input} value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
              </div>
              <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input type="checkbox" checked={optInMarketing} onChange={(e) => setOptInMarketing(e.target.checked)} className="mt-1" />
                Email me about future events from this organizer
              </label>
            </div>

            <div className={section}>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Your business</h2>
              <div>
                <label htmlFor="businessName" className={label}>Business or outlet name</label>
                <input id="businessName" required className={input} value={profile.businessName} onChange={(e) => setProfile({ ...profile, businessName: e.target.value })} />
              </div>
              <div>
                <label htmlFor="description" className={label}>Tell us about it</label>
                <textarea id="description" rows={4} className={input} value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} />
              </div>
              <div>
                <label htmlFor="website" className={label}>Website</label>
                <input id="website" className={input} placeholder="example.com" value={profile.website} onChange={(e) => setProfile({ ...profile, website: e.target.value })} />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {SOCIAL_FIELDS.map((s) => (
                  <div key={s.key}>
                    <label htmlFor={`social-${s.key}`} className={label}>{s.label}</label>
                    <input id={`social-${s.key}`} className={input} placeholder={s.placeholder} value={socials[s.key] || ''} onChange={(e) => setSocials({ ...socials, [s.key]: e.target.value })} />
                  </div>
                ))}
              </div>
              <div>
                <label htmlFor="photos" className={label}>Photos of your work or products (up to {MAX_PHOTOS})</label>
                <input id="photos" type="file" accept={ACCEPT} multiple onChange={(e) => addPhotos(e.target.files)} className="text-sm" />
                {photos.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2" data-testid="apply-photos">
                    {photos.map((p, i) => (
                      <li key={`${p.name}-${i}`} className="flex items-center gap-2 rounded bg-gray-100 dark:bg-slate-700 px-2 py-1 text-xs text-gray-800 dark:text-slate-200">
                        {p.name}
                        <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-600">×</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {form.questions.length > 0 && (
              <div className={section}>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">A few questions</h2>
                {form.questions.map((q) => (
                  <QuestionField
                    key={q.id}
                    question={q}
                    value={answers[q.id]}
                    onChange={(v) => setAnswer(q.id, v)}
                    file={answerPhotos[q.id]}
                    onFile={(f) => {
                      if (f) {
                        const err = photoError(f);
                        if (err) {
                          setError(err);
                          return;
                        }
                      }
                      setAnswerPhotos((prev) => {
                        const next = { ...prev };
                        if (f) next[q.id] = f;
                        else delete next[q.id];
                        return next;
                      });
                    }}
                  />
                ))}
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {error}
              </p>
            )}

            <button type="submit" disabled={submitting} className="w-full py-3 rounded-lg font-semibold bg-brand hover:bg-brand-hover text-brand-fg disabled:opacity-60 transition-colors">
              {submitting ? 'Submitting…' : form.kind === 'PAID' && form.chargeTiming === 'APPROVAL' ? 'Continue to save a card' : form.kind === 'PAID' ? 'Continue to payment' : 'Submit application'}
            </button>
          </form>
        );
      }}
    </ApplyShell>
  );
}

function QuestionField({
  question: q,
  value,
  onChange,
  file,
  onFile,
}: {
  question: Question;
  value: string | string[] | boolean | undefined;
  onChange: (v: string | string[] | boolean) => void;
  file?: File;
  onFile: (f: File | null) => void;
}) {
  const id = `q-${q.id}`;
  const req = q.required ? <span className="text-red-600"> *</span> : null;
  const help = q.helpText ? <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{q.helpText}</p> : null;
  switch (q.type) {
    case 'LONG_TEXT':
      return (
        <div>
          <label htmlFor={id} className={label}>{q.label}{req}</label>
          <textarea id={id} rows={4} required={q.required} className={input} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />
          {help}
        </div>
      );
    case 'SINGLE_CHOICE':
      return (
        <fieldset>
          <legend className={label}>{q.label}{req}</legend>
          <div className="space-y-1">
            {q.options.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
                <input type="radio" name={id} value={o} checked={value === o} onChange={() => onChange(o)} required={q.required} />
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
          <div className="space-y-1">
            {q.options.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
                <input type="checkbox" checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />
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
          <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-slate-200">
            <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} required={q.required} className="mt-1" />
            <span>{q.label}{req}</span>
          </label>
          {help}
        </div>
      );
    case 'PHOTO':
      return (
        <div>
          <label htmlFor={id} className={label}>{q.label}{req}</label>
          <input id={id} type="file" accept={ACCEPT} required={q.required && !file} onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="text-sm" />
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
