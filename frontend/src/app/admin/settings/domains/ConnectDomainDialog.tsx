'use client';

// "Connect existing domain" (spec 008): one field, Cancel / Next. Next
// registers the hostname and the caller navigates to its setup page.

import { FormEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '../SettingsDialog';
import { errorClass, fieldClass, formAlertClass, hintClass, labelClass } from '../formShared';
import { useDomainApi, describeError } from './useDomainApi';
import { hostnameError, type StorefrontDomain } from './types';

interface ConnectDomainDialogProps {
  onClose: () => void;
  onConnected: (domain: StorefrontDomain) => void;
  returnFocusRef: RefObject<HTMLElement>;
}

export default function ConnectDomainDialog({ onClose, onConnected, returnFocusRef }: ConnectDomainDialogProps) {
  const domainApi = useDomainApi();
  const [hostname, setHostname] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = hostnameError(hostname);
    if (problem) {
      setFieldError(problem);
      fieldRef.current?.focus();
      return;
    }
    setFieldError(null);
    setFormError(null);
    setSaving(true);
    try {
      const created = await domainApi.add(hostname.trim());
      onConnected(created);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      const message = describeError(err, 'Could not connect the domain. Try again.');
      if (e.status === 400 || e.status === 409) setFieldError(message);
      else setFormError(message);
      setSaving(false);
      fieldRef.current?.focus();
    }
  };

  return (
    <SettingsDialog
      titleId="connect-domain-title"
      title="Connect existing domain"
      dirty={hostname.trim().length > 0}
      saving={saving}
      submitLabel="Next"
      savingLabel="Connecting…"
      initialFocusRef={fieldRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      {formError && (
        <div role="alert" className={formAlertClass}>
          {formError}
        </div>
      )}
      <label htmlFor="connect-domain-hostname" className={labelClass}>
        Domain
      </label>
      <input
        ref={fieldRef}
        id="connect-domain-hostname"
        name="hostname"
        type="text"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="tickets.yourvenue.com"
        value={hostname}
        onChange={(event) => {
          setHostname(event.target.value);
          if (fieldError) setFieldError(null);
        }}
        aria-invalid={fieldError ? true : undefined}
        aria-describedby={fieldError ? 'connect-domain-error' : 'connect-domain-hint'}
        className={`${fieldClass} mt-1`}
        disabled={saving}
      />
      {fieldError ? (
        <p id="connect-domain-error" className={errorClass}>
          {fieldError}
        </p>
      ) : (
        <p id="connect-domain-hint" className={hintClass}>
          Enter a subdomain you already own, such as <code>tickets.yourvenue.com</code>. Root domains (<code>yourvenue.com</code>) are
          not supported yet.
        </p>
      )}
    </SettingsDialog>
  );
}
