'use client';

// Spec 042: the contact_form section of a page template. Posts to the public
// contact route, which saves the message and emails it to the store email.
// `website` is a honeypot: hidden from people and assistive tech, bots fill it.

import { FormEvent, useId, useState } from 'react';
import api, { type ContactFormSettings } from '@/services/api';
import { storefrontInput, storefrontLabel, storefrontTextarea } from './formStyles';

type Field = 'name' | 'email' | 'phone' | 'subject' | 'message';
type Errors = Partial<Record<Field, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPTY = { name: '', email: '', phone: '', subject: '', message: '', website: '' };

export default function ContactFormSection({
  organizationId,
  pageSlug,
  settings,
  available,
}: {
  organizationId: string;
  pageSlug: string;
  settings: ContactFormSettings;
  /** False when the store has no email to deliver to. */
  available: boolean;
}) {
  const id = useId();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const headingId = `${id}-heading`;

  const set = (field: keyof typeof EMPTY) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const validate = (): Errors => {
    const next: Errors = {};
    if (!values.name.trim()) next.name = 'Enter your name';
    if (!values.email.trim()) next.email = 'Enter your email address';
    else if (!EMAIL_RE.test(values.email.trim())) next.email = 'Enter a valid email address';
    if (!values.message.trim()) next.message = 'Enter a message';
    return next;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) {
      document.getElementById(`${id}-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setSending(true);
    try {
      await api.post(
        `/organizations/${encodeURIComponent(organizationId)}/public/pages/${encodeURIComponent(pageSlug)}/contact`,
        {
          name: values.name,
          email: values.email,
          phone: settings.showPhone ? values.phone : undefined,
          subject: settings.showSubject ? values.subject : undefined,
          message: values.message,
          website: values.website,
        }
      );
      setSent(true);
      setValues(EMPTY);
    } catch (err: any) {
      if (err.status === 400 && Array.isArray(err.details)) {
        const fromServer: Errors = {};
        for (const detail of err.details as { field: string; message: string }[]) {
          if (['name', 'email', 'phone', 'subject', 'message'].includes(detail.field)) {
            fromServer[detail.field as Field] = detail.message;
          }
        }
        setErrors(fromServer);
      }
      setFormError(
        err.status === 429
          ? 'Too many messages from your connection. Try again later.'
          : err.status === 409
            ? 'This store is not accepting messages right now.'
            : err.status === 400
              ? 'Check the highlighted fields.'
              : 'Your message could not be sent. Try again in a moment.'
      );
    } finally {
      setSending(false);
    }
  };

  const fieldProps = (field: Field) => ({
    id: `${id}-${field}`,
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${id}-${field}-error` : undefined,
  });
  const errorText = (field: Field) =>
    errors[field] ? (
      <p id={`${id}-${field}-error`} className="mt-1.5 text-sm text-red-600 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;

  return (
    <section
      aria-labelledby={settings.heading ? headingId : undefined}
      aria-label={settings.heading ? undefined : 'Contact form'}
      className="mt-10 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-8"
      data-testid="contact-form-section"
    >
      {settings.heading && (
        <h2 id={headingId} className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
          {settings.heading}
        </h2>
      )}
      {settings.intro && <p className="mt-2 text-gray-600 dark:text-slate-300">{settings.intro}</p>}

      {!available ? (
        <p className="mt-4 text-sm text-gray-600 dark:text-slate-300">
          This form is not available right now.
        </p>
      ) : sent ? (
        <div role="status" className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
          <p className="font-semibold">Message sent</p>
          <p className="mt-1 text-sm">{settings.successMessage}</p>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="mt-3 text-sm font-semibold text-brand-link underline"
          >
            Send another message
          </button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-6 space-y-5">
          {formError && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {formError}
            </p>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-name`} className={storefrontLabel}>Name</label>
              <input
                {...fieldProps('name')}
                autoComplete="name"
                maxLength={100}
                value={values.name}
                onChange={(event) => set('name')(event.target.value)}
                className={storefrontInput}
              />
              {errorText('name')}
            </div>
            <div>
              <label htmlFor={`${id}-email`} className={storefrontLabel}>Email</label>
              <input
                {...fieldProps('email')}
                type="email"
                autoComplete="email"
                maxLength={254}
                value={values.email}
                onChange={(event) => set('email')(event.target.value)}
                className={storefrontInput}
              />
              {errorText('email')}
            </div>
            {settings.showPhone && (
              <div>
                <label htmlFor={`${id}-phone`} className={storefrontLabel}>
                  Phone <span className="font-normal text-gray-500 dark:text-slate-400">(optional)</span>
                </label>
                <input
                  {...fieldProps('phone')}
                  type="tel"
                  autoComplete="tel"
                  maxLength={40}
                  value={values.phone}
                  onChange={(event) => set('phone')(event.target.value)}
                  className={storefrontInput}
                />
                {errorText('phone')}
              </div>
            )}
            {settings.showSubject && (
              <div className={settings.showPhone ? '' : 'sm:col-span-2'}>
                <label htmlFor={`${id}-subject`} className={storefrontLabel}>
                  Subject <span className="font-normal text-gray-500 dark:text-slate-400">(optional)</span>
                </label>
                <input
                  {...fieldProps('subject')}
                  maxLength={150}
                  value={values.subject}
                  onChange={(event) => set('subject')(event.target.value)}
                  className={storefrontInput}
                />
                {errorText('subject')}
              </div>
            )}
          </div>
          <div>
            <label htmlFor={`${id}-message`} className={storefrontLabel}>Message</label>
            <textarea
              {...fieldProps('message')}
              rows={6}
              maxLength={5000}
              value={values.message}
              onChange={(event) => set('message')(event.target.value)}
              className={storefrontTextarea}
            />
            {errorText('message')}
          </div>
          <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
            <label htmlFor={`${id}-website`}>Website</label>
            <input
              id={`${id}-website`}
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={values.website}
              onChange={(event) => set('website')(event.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={sending}
            className="w-full rounded-xl bg-brand px-6 py-3 font-semibold text-brand-fg transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 disabled:opacity-60 dark:focus-visible:ring-offset-slate-800 sm:w-auto"
          >
            {sending ? 'Sending…' : settings.submitLabel}
          </button>
        </form>
      )}
    </section>
  );
}
