'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { accountApi, type ReauthMethod } from './accountApi';

interface Props {
  onVerified: (reauthToken: string) => void;
  onCancel: () => void;
}

const METHOD_LABEL: Record<ReauthMethod, string> = {
  passkey: 'Use a passkey',
  password: 'Enter your password',
  email: 'Email me a code',
};

/** "Confirm it's you": one of the account's step-up methods → 10-minute proof. */
export default function ReauthDialog({ onVerified, onCancel }: Props) {
  const [methods, setMethods] = useState<ReauthMethod[] | null>(null);
  const [method, setMethod] = useState<ReauthMethod | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnRef = useRef<HTMLElement>(typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null);

  useEffect(() => {
    accountApi.reauth
      .start()
      .then((res) => {
        setMethods(res.methods);
        setMethod(res.methods[0] ?? 'email');
      })
      .catch((e: any) => setError(e.message || 'Unable to start verification.'));
  }, []);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await accountApi.reauth.start('email');
      setSentTo(res.sentTo ?? null);
    } catch (e: any) {
      setError(e.message || 'Unable to send the code.');
    } finally {
      setBusy(false);
    }
  };

  const usePasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await accountApi.reauth.start('passkey');
      const assertion = await startAuthentication({ optionsJSON: res.passkeyOptions as any });
      const proof = await accountApi.reauth.verify({ passkey: assertion });
      onVerified(proof.reauthToken);
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? 'The passkey prompt was cancelled.' : e.message || 'Passkey verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (method === 'passkey') return usePasskey();
    if (method === 'email' && !sentTo) return sendCode();
    setBusy(true);
    setError(null);
    try {
      const proof = await accountApi.reauth.verify(method === 'password' ? { password } : { code: code.trim() });
      onVerified(proof.reauthToken);
    } catch (e: any) {
      setError(e.code === 'REAUTH_LOCKED' ? e.message : method === 'password' ? 'That password didn’t match.' : 'That code is wrong or expired.');
    } finally {
      setBusy(false);
    }
  };

  const dirty = method === 'password' ? password.length > 0 : method === 'email' ? Boolean(sentTo) && code.length > 0 : true;
  const submitLabel = method === 'passkey' ? 'Continue with passkey' : method === 'email' && !sentTo ? 'Send code' : 'Verify';

  return (
    <SettingsDialog
      titleId="reauth-dialog-title"
      title="Confirm it’s you"
      dirty={dirty}
      saving={busy}
      submitWhenClean={method === 'passkey' || (method === 'email' && !sentTo)}
      submitLabel={submitLabel}
      savingLabel="Verifying…"
      initialFocusRef={inputRef}
      returnFocusRef={returnRef}
      onClose={onCancel}
      onSubmit={submit}
    >
      <fieldset disabled={busy} className="space-y-5">
        <p className="text-sm text-gray-600 dark:text-slate-400">
          Changing how you sign in needs a quick check. You won&apos;t be asked again for 10 minutes.
        </p>
        {error && <div role="alert" className={formAlertClass}>{error}</div>}
        {!methods && !error && <p className="text-sm text-gray-500">Loading…</p>}
        {methods && methods.length > 1 && (
          <div role="radiogroup" aria-label="Verification method" className="flex flex-wrap gap-2">
            {methods.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => { setMethod(m); setError(null); }}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${method === m ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'border-gray-300 text-gray-700 dark:border-slate-600 dark:text-slate-300'}`}
              >
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>
        )}
        {method === 'password' && (
          <div>
            <label htmlFor="reauth-password" className={labelClass}>Password</label>
            <input ref={inputRef} id="reauth-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} />
          </div>
        )}
        {method === 'email' && (
          <div>
            <label htmlFor="reauth-code" className={labelClass}>Verification code</label>
            <input
              ref={inputRef}
              id="reauth-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              disabled={!sentTo}
              aria-describedby="reauth-code-hint"
              className={fieldClass}
            />
            <p id="reauth-code-hint" className={hintClass}>
              {sentTo ? (
                <>We emailed a 6-digit code to <span className="font-medium">{sentTo}</span>. It expires in 10 minutes.{' '}
                  <button type="button" onClick={sendCode} className="font-medium text-indigo-600 dark:text-indigo-400">Send again</button></>
              ) : (
                'We’ll email a 6-digit code to your account address.'
              )}
            </p>
          </div>
        )}
        {method === 'passkey' && (
          <p className={hintClass.replace('text-xs', 'text-sm')}>Your browser will ask for your passkey (Touch ID, Face ID, Windows Hello or a security key).</p>
        )}
      </fieldset>
    </SettingsDialog>
  );
}
