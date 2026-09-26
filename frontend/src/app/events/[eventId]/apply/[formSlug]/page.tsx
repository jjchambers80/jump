// Public application form (spec 011): tier choice (PAID) with optional
// add-ons (spec 012), contact, business profile with photos, the organizer's
// questions, submit. Submits as multipart straight to the backend (public
// route, IP rate-limited there). On success the applicant lands on their
// status page (token in the URL).
//
// Layout: numbered steps on the left, a sticky summary on the right (below
// the steps on phones) that carries the running total and the submit button.
// Tiers are ticket stubs in the event page's torn language (`.tier-stub`).
'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Check, ImagePlus, Lock, ShieldCheck, X } from 'lucide-react';
import api from '@/services/api';
import { acceptanceLine, estimatedApplicantTotal, money, SOCIAL_FIELDS, tierPriceLine, type PublicForm, type PublicTier, type Question } from '@/lib/applications';
import { acceptancesFor, applyConsentText, cardAuthorizationText, fetchLegalVersions, LEGAL_PAGES_ENABLED, LEGAL_PATHS, type LegalVersions } from '@/lib/legal';
import AddOnPicker from '@/components/AddOnPicker';
import ApplyShell from '../ApplyShell';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const MAX_PHOTOS = 6;
const MAX_PHOTO_MB = 5;
const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

const field =
  'w-full px-3.5 border rounded-xl bg-white text-[15px] text-gray-900 placeholder:text-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-link focus:border-transparent border-gray-300 hover:border-gray-400 dark:border-slate-600 dark:hover:border-slate-500 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder:text-slate-500';
const input = `${field} h-11`;
const textarea = `${field} py-2.5 leading-relaxed`;
const label = 'block text-sm font-semibold text-gray-800 dark:text-slate-200 mb-1.5';
const check = 'mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-brand dark:border-slate-600';
const choice = 'flex items-start gap-3 rounded-xl border border-gray-200 px-3.5 py-3 text-sm text-gray-800 transition-colors hover:border-gray-300 has-[:checked]:border-brand-link has-[:checked]:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600 dark:has-[:checked]:bg-slate-900/50 cursor-pointer';

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
  // Spec 024 phase 3: account (default on, like checkout), marketing, the
  // data-collection consent, and the card authorization on forms that charge
  // the saved card at approval. Versions are echoed so a stale one is refused.
  const [optInAccount, setOptInAccount] = useState(true);
  const [optInMarketing, setOptInMarketing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [cardAuthorized, setCardAuthorized] = useState(false);
  const [legalVersions, setLegalVersions] = useState<LegalVersions | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLegalVersions()
      .then(setLegalVersions)
      .catch(() => setLegalVersions(null));
  }, []);

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

  const needsCardAuthorization = form?.kind === 'PAID' && form.chargeTiming === 'APPROVAL';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || submitting) return;
    if (form.kind === 'PAID' && !tierId) {
      setError('Choose an option to continue.');
      return;
    }
    if (!consent) {
      setError('Please agree to the collection and storage of your information to continue.');
      return;
    }
    if (needsCardAuthorization && !cardAuthorized) {
      setError('Please authorize the charge to the card you are about to save.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const versions = legalVersions ?? (await fetchLegalVersions());
      const payload = {
        formSlug: form.slug,
        ...(form.kind === 'PAID' && { tierId }),
        ...(addOnLines.length > 0 && { addOns: addOnLines }),
        contact,
        profile: { ...profile, socials },
        answers,
        optInAccount,
        optInMarketing,
        acceptances: acceptancesFor(versions, { cardAuthorization: needsCardAuthorization }),
      };
      const body = new FormData();
      body.append('payload', JSON.stringify(payload));
      photos.forEach((p) => body.append('profilePhotos', p, p.name));
      Object.entries(answerPhotos).forEach(([qid, file]) => body.append(`answer:${qid}`, file, file.name));
      const res = await fetch(`${API_URL}/events/${params.eventId}/applications`, { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The versions moved under us: forget the cached ones so the next try shows the current text.
        if (data.code === 'LEGAL_VERSION_STALE') setLegalVersions(null);
        throw new Error(data.message || data.error || 'Could not submit your application');
      }
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

  const submitLabel = submitting
    ? 'Submitting…'
    : form?.kind === 'PAID' && form.chargeTiming === 'APPROVAL'
      ? 'Continue to save a card'
      : form?.kind === 'PAID'
        ? 'Continue to payment'
        : 'Submit application';
  const chargeAmount = selectedTier && form ? (addOnLines.length > 0 ? money(estimatedTotal) : tierPriceLine(selectedTier, form.feeMode)) : '';

  return (
    <ApplyShell eventId={params.eventId} title={form?.name} kicker="Application" width={form && !closedLine && !loadError ? 'wide' : 'narrow'}>
      {() => {
        if (loadError) return <p role="alert" className="text-red-700 dark:text-red-300">{loadError}</p>;
        if (!form) return <p className="text-gray-600 dark:text-slate-400">Loading…</p>;
        // Steps are numbered in the order they render; PAID forms open with the tier choice.
        let step = 0;
        const next = () => ++step;
        if (closedLine) {
          return (
            <div className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800" data-testid="apply-closed">
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                <Lock className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold text-gray-900 dark:text-slate-100">This form is {closedLine.toLowerCase()}.</p>
                <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Check back later, or head back to the event page for tickets.</p>
              </div>
            </div>
          );
        }
        return (
          <form onSubmit={handleSubmit} noValidate data-testid="apply-form" className="lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-10">
            <div className="space-y-5">
              {form.intro && (
                <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white py-5 pl-6 pr-5 motion-safe:animate-card-in dark:border-slate-700 dark:bg-slate-800">
                  <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brand" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-slate-400">
                    From {form.organizationName || 'the organizer'}
                  </p>
                  <p className="mt-2 whitespace-pre-line leading-relaxed text-gray-700 dark:text-slate-300">{form.intro}</p>
                </div>
              )}

              {form.kind === 'PAID' && (
                <Step n={next()} title="Choose an option" hint={form.tiers.length > 1 ? 'Pick the spot that fits. You can add extras after.' : undefined} as="fieldset">
                  <div className="space-y-3" role="radiogroup" aria-label="Options">
                    {form.tiers.map((t) => (
                      <TierOption key={t.id} tier={t} feeMode={form.feeMode} selected={tierId === t.id} onSelect={() => setTierId(t.id)} />
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
                </Step>
              )}

              <Step n={next()} title="Your details" hint="Where the organizer sends their decision.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="firstName" className={label}>First name</label>
                    <input id="firstName" required autoComplete="given-name" className={input} value={contact.firstName} onChange={(e) => setContact({ ...contact, firstName: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="lastName" className={label}>Last name</label>
                    <input id="lastName" required autoComplete="family-name" className={input} value={contact.lastName} onChange={(e) => setContact({ ...contact, lastName: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label htmlFor="email" className={label}>Email</label>
                  <input id="email" type="email" required autoComplete="email" className={input} value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
                </div>
              </Step>

              <Step n={next()} title="Your business" hint="This is what the organizer reviews. Show them your best.">
                <div>
                  <label htmlFor="businessName" className={label}>Business or outlet name</label>
                  <input id="businessName" required autoComplete="organization" className={input} value={profile.businessName} onChange={(e) => setProfile({ ...profile, businessName: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="description" className={label}>Tell us about it</label>
                  <textarea id="description" rows={4} className={textarea} value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="website" className={label}>Website</label>
                  <input id="website" className={input} placeholder="example.com" value={profile.website} onChange={(e) => setProfile({ ...profile, website: e.target.value })} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {SOCIAL_FIELDS.map((s) => (
                    <div key={s.key}>
                      <label htmlFor={`social-${s.key}`} className={label}>{s.label}</label>
                      <input id={`social-${s.key}`} className={input} placeholder={s.placeholder} value={socials[s.key] || ''} onChange={(e) => setSocials({ ...socials, [s.key]: e.target.value })} />
                    </div>
                  ))}
                </div>
                <div>
                  <p className={label} id="photos-label">
                    Photos of your work or products <span className="font-normal text-gray-500 dark:text-slate-400">· up to {MAX_PHOTOS}</span>
                  </p>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4" data-testid={photos.length > 0 ? 'apply-photos' : undefined}>
                    {photos.map((p, i) => (
                      <PhotoThumb key={`${p.name}-${i}`} file={p} onRemove={() => setPhotos(photos.filter((_, j) => j !== i))} />
                    ))}
                    {photos.length < MAX_PHOTOS && (
                      <label
                        htmlFor="photos"
                        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-300 text-center text-xs font-semibold text-gray-600 transition-colors hover:border-brand-link hover:text-brand-link has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-link dark:border-slate-600 dark:text-slate-400 ${photos.length === 0 ? 'col-span-3 py-8 sm:col-span-4' : 'aspect-square'}`}
                      >
                        <ImagePlus className="h-6 w-6" aria-hidden />
                        <span>{photos.length === 0 ? 'Add photos' : 'Add more'}</span>
                        {photos.length === 0 && <span className="font-normal text-gray-500 dark:text-slate-500">JPG, PNG, GIF or WebP · {MAX_PHOTO_MB} MB each</span>}
                        <input
                          id="photos"
                          type="file"
                          accept={ACCEPT}
                          multiple
                          aria-labelledby="photos-label"
                          onChange={(e) => {
                            addPhotos(e.target.files);
                            e.target.value = '';
                          }}
                          className="sr-only"
                        />
                      </label>
                    )}
                  </div>
                </div>
              </Step>

              {form.questions.length > 0 && (
                <Step n={next()} title="A few questions" hint={`From ${form.organizationName || 'the organizer'}.`}>
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
                </Step>
              )}

              <Step n={next()} title="Before you submit">
                {/* Account + marketing opt-ins — independent; applied once the application is submitted (spec 024 phase 3) */}
                <label className={choice}>
                  <input type="checkbox" checked={optInAccount} onChange={(e) => setOptInAccount(e.target.checked)} className={check} data-testid="apply-opt-in-account" />
                  <span>
                    <span className="font-semibold">Create an account with {form.organizationName || 'the organizer'} to manage your applications</span>
                    <span className="block text-gray-500 dark:text-slate-400">No password. We&apos;ll email you a sign-in link.</span>
                  </span>
                </label>
                <label className={choice}>
                  <input type="checkbox" checked={optInMarketing} onChange={(e) => setOptInMarketing(e.target.checked)} className={check} data-testid="apply-opt-in-marketing" />
                  <span>Email me about future events from {form.organizationName || 'this organizer'}</span>
                </label>
                <label className={choice}>
                  <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className={check} data-testid="apply-consent" />
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
                {needsCardAuthorization && selectedTier && (
                  <label className={choice}>
                    <input type="checkbox" required checked={cardAuthorized} onChange={(e) => setCardAuthorized(e.target.checked)} className={check} data-testid="apply-card-authorization" />
                    <span>{cardAuthorizationText({ amount: estimatedTotal, paymentDueDays: form.paymentDueDays, organizationName: form.organizationName })}</span>
                  </label>
                )}
              </Step>
            </div>

            {/* Summary: running total and the submit button; sticks beside the steps from lg up */}
            <aside className="mt-6 lg:sticky lg:top-6 lg:mt-0" aria-label="Application summary">
              <div className="tier-stub-shadow">
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                  <div className="px-5 pb-4 pt-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-slate-400">Your application</p>
                    <p className="mt-1 font-semibold leading-snug text-gray-900 dark:text-slate-100">{form.name}</p>
                  </div>

                  <div className="border-t-2 border-dashed border-gray-200 px-5 py-4 dark:border-slate-700">
                    {form.kind !== 'PAID' ? (
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-gray-600 dark:text-slate-400">Cost to apply</span>
                        <span className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-slate-50">Free</span>
                      </div>
                    ) : !selectedTier ? (
                      <p className="text-sm text-gray-500 dark:text-slate-400">Choose an option to see your total.</p>
                    ) : (
                      <div className="space-y-3" data-testid="apply-price-note">
                        <ul className="space-y-1.5 text-sm tabular-nums text-gray-700 dark:text-slate-300" data-testid="apply-total-line">
                          <li className="flex justify-between gap-3">
                            <span className="min-w-0">{selectedTier.name}</span> <span>{money(selectedTier.applicantPays)}</span>
                          </li>
                          {tierAddOns
                            .filter((a) => (addOnQty[a.id] ?? 0) > 0)
                            .map((a) => (
                              <li key={a.id} className="flex justify-between gap-3">
                                <span className="min-w-0">{a.name} ×{addOnQty[a.id]}</span> <span>{money(a.applicantPays * addOnQty[a.id])}</span>
                              </li>
                            ))}
                          <li className="flex items-baseline justify-between gap-3 border-t border-gray-200 pt-2.5 dark:border-slate-700">
                            <span className="font-semibold text-gray-900 dark:text-slate-100">Total</span>{' '}
                            <span className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-slate-50">{money(estimatedTotal)}</span>
                          </li>
                        </ul>
                        <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-600 dark:bg-slate-900/50 dark:text-slate-400">
                          {form.chargeTiming === 'APPROVAL'
                            ? `You will save a card now and be charged ${chargeAmount} only if your application is accepted.`
                            : `You will pay ${chargeAmount} when you submit.`}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 border-t border-gray-200 bg-gray-50/60 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/30">
                    {error && (
                      <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                        {error}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full rounded-xl bg-brand py-3 font-semibold text-brand-fg transition-[background-color,transform] hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 active:scale-[0.99] disabled:opacity-60 dark:focus-visible:ring-offset-slate-800"
                    >
                      {submitLabel}
                    </button>
                    <p className="flex items-center justify-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                      {form.kind === 'PAID' ? 'Card details are handled by Stripe' : 'Reviewed by the organizer'}
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </form>
        );
      }}
    </ApplyShell>
  );
}

/** A numbered form step. The number rides in a brand disc beside the title. */
function Step({ n, title, hint, as = 'section', children }: { n: number; title: string; hint?: string; as?: 'section' | 'fieldset'; children: ReactNode }) {
  const heading = (
    <span className="flex items-start gap-3">
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold tabular-nums text-brand-fg">
        {n}
      </span>
      <span className="min-w-0 pt-0.5">
        <span className="block text-lg font-bold leading-snug tracking-tight text-gray-900 dark:text-slate-100">{title}</span>
        {hint && <span className="mt-0.5 block text-sm font-normal text-gray-500 dark:text-slate-400">{hint}</span>}
      </span>
    </span>
  );
  const body = <div className="mt-5 space-y-4 sm:pl-10">{children}</div>;
  const cls = 'rounded-2xl border border-gray-200 bg-white p-5 motion-safe:animate-card-in dark:border-slate-700 dark:bg-slate-800 sm:p-6';
  const delay = { animationDelay: `${Math.min(n, 5) * 50}ms` };
  if (as === 'fieldset') {
    return (
      <fieldset className={cls} style={delay}>
        <legend className="sr-only">{title}</legend>
        {heading}
        {body}
      </fieldset>
    );
  }
  return (
    <section className={cls} style={delay}>
      <h2>{heading}</h2>
      {body}
    </section>
  );
}

/** One tier as a selectable ticket stub: details on the left, the price torn off on the right. */
function TierOption({ tier: t, feeMode, selected, onSelect }: { tier: PublicTier; feeMode: PublicForm['feeMode']; selected: boolean; onSelect: () => void }) {
  const detail = tierPriceLine(t, feeMode).replace(/^\$[\d,.]+\s*/, '');
  return (
    <label className="tier-stub-shadow block cursor-pointer rounded-2xl has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-link has-[:focus-visible]:ring-offset-2 dark:has-[:focus-visible]:ring-offset-slate-900" data-selected={selected}>
      <span
        className={`tier-stub relative grid grid-cols-1 overflow-hidden rounded-2xl border bg-white transition-colors duration-200 dark:bg-slate-800 sm:grid-cols-[minmax(0,1fr)_10rem] ${
          selected ? 'border-brand-link' : 'border-gray-200 hover:border-gray-300 dark:border-slate-700 dark:hover:border-slate-600'
        }`}
      >
        <span aria-hidden className={`absolute inset-y-0 left-0 w-1 bg-brand transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`} />
        <span className="flex min-w-0 items-start gap-3 py-4 pl-5 pr-4 sm:py-5">
          <span
            aria-hidden
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
              selected ? 'border-brand bg-brand text-brand-fg' : 'border-gray-300 dark:border-slate-600'
            }`}
          >
            {selected && <Check className="h-3 w-3" strokeWidth={3.5} />}
          </span>
          <span className="min-w-0">
            <span className="block text-[17px] font-semibold leading-snug tracking-tight text-gray-900 dark:text-slate-100">{t.name}</span>
            {t.description && <span className="mt-1 block text-sm leading-relaxed text-gray-600 dark:text-slate-400">{t.description}</span>}
            {t.soldOut && (
              <span className="mt-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/30">
                Full — you can still apply for the waitlist
              </span>
            )}
          </span>
        </span>
        <span className="relative flex h-16 items-center justify-between gap-3 border-t-2 border-dashed border-gray-200 pl-5 pr-4 dark:border-slate-700 sm:h-auto sm:flex-col sm:justify-center sm:gap-0.5 sm:border-l-2 sm:border-t-0 sm:px-2 sm:py-4 sm:text-center">
          <span aria-hidden className={`pointer-events-none absolute inset-0 bg-brand transition-opacity duration-200 ${selected ? 'opacity-[0.07] dark:opacity-[0.12]' : 'opacity-0'}`} />
          <span className="relative text-xl font-extrabold tabular-nums tracking-tight text-gray-900 dark:text-slate-50 sm:text-2xl">
            {t.applicantPays === 0 ? 'Free' : money(t.applicantPays)}
          </span>
          {detail && <span className="relative text-xs text-gray-500 dark:text-slate-400">{detail}</span>}
        </span>
        {/* The real radio spans the card, invisible, so a click anywhere selects it */}
        <input type="radio" name="tier" value={t.id} checked={selected} onChange={onSelect} className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none opacity-0" />
      </span>
    </label>
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
  const req = q.required ? <span className="text-red-600 dark:text-red-400"> *</span> : null;
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
