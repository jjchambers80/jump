'use client';

// Account › Security › Two-step authentication (spec 030 C): turn on
// (scan → code → save recovery codes), status, recovery codes, trusted
// devices, turn off. Every switch runs through withReauth.

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ShieldCheck } from 'lucide-react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { errorClass, fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { useAccountFormat } from '@/lib/accountFormat';
import { twoStepApi, type TwoStepStatus } from '../accountApi';
import { isReauthCancelled, useReauth } from '../useReauth';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const listClass = 'mt-4 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700';
const primaryButton = 'rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50';
const secondaryButton = 'rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700';
const dangerButton = 'rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20';

interface Props {
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}

/** Recovery codes shown once, with copy + download. */
function RecoveryCodesPanel({ codes, onSaved }: { codes: string[]; onSaved: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const text = codes.join('\n');
  const copy = () => navigator.clipboard?.writeText(text).catch(() => {});
  const download = () => {
    const blob = new Blob([`Jump recovery codes\n\n${text}\n\nEach code works once. Keep them somewhere safe.\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jump-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4" data-testid="recovery-codes">
      <p className="text-sm text-gray-600 dark:text-slate-400">
        Save these recovery codes somewhere safe. Each one signs you in once if you lose your authenticator. <strong>They won&apos;t be shown again.</strong>
      </p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-sm dark:border-slate-700 dark:bg-slate-900" aria-label="Recovery codes">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={secondaryButton}>Copy</button>
        <button type="button" onClick={download} className={secondaryButton}>Download</button>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
        <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
        I&apos;ve saved my recovery codes
      </label>
      <button type="button" disabled={!acknowledged} onClick={onSaved} className={primaryButton}>Done</button>
    </div>
  );
}

type Step = 'scan' | 'codes';

function EnableDialog({ onClose, onEnabled, returnFocusRef }: { onClose: () => void; onEnabled: (message: string) => void; returnFocusRef: React.RefObject<HTMLElement> }) {
  const { withReauth } = useReauth();
  const { update } = useSession();
  const [step, setStep] = useState<Step>('scan');
  const [setup, setSetup] = useState<{ otpauthUrl: string; qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const summary = useRef('');

  useEffect(() => {
    withReauth(() => twoStepApi.setup())
      .then(setSetup)
      .catch((e: any) => {
        if (isReauthCancelled(e)) onClose();
        else setError(e.message || 'Unable to start setup.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (step === 'codes') return;
    setBusy(true);
    setError(null);
    try {
      const result = await withReauth(() => twoStepApi.enable(code.trim()));
      // Our own session predates 2FA: redeem the proof so we stay signed in.
      await update({ mfaProof: result.proof });
      summary.current = `Two-step authentication is on${result.otherDevicesSignedOut ? `; ${result.otherDevicesSignedOut} other device${result.otherDevicesSignedOut === 1 ? '' : 's'} signed out` : ''}.`;
      setCodes(result.recoveryCodes);
      setStep('codes');
    } catch (err: any) {
      if (isReauthCancelled(err)) return;
      setError(err.code === 'CODE_INVALID' ? 'That code didn’t match. Wait for a fresh code and try again.' : err.message || 'Unable to turn on two-step authentication.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsDialog
      titleId="two-step-enable-title"
      title={step === 'scan' ? 'Turn on two-step authentication' : 'Save your recovery codes'}
      dirty={step === 'scan' ? code.length > 0 : true}
      saving={busy}
      submitLabel="Turn on"
      savingLabel="Checking…"
      saveDisabled={step === 'codes' || code.trim().length !== 6}
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      onClose={() => {
        // Closing after the codes were shown is fine — 2FA is already on.
        if (step === 'codes') onEnabled(summary.current);
        else onClose();
      }}
      onSubmit={submit}
    >
      {step === 'scan' ? (
        <fieldset disabled={busy} className="space-y-5">
          {error && <div role="alert" className={formAlertClass}>{error}</div>}
          <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700 dark:text-slate-300">
            <li>Install an authenticator app (1Password, Google Authenticator, Authy, Microsoft Authenticator…).</li>
            <li>Scan this QR code with it, or enter the key by hand.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          {setup ? (
            <div className="flex flex-wrap items-start gap-5">
              <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={180} height={180} className="rounded-lg border border-gray-200 bg-white p-2 dark:border-slate-700" />
              <div className="min-w-0 flex-1 text-sm">
                <button type="button" onClick={() => setShowSecret((v) => !v)} className="font-medium text-indigo-600 dark:text-indigo-400">
                  {showSecret ? 'Hide setup key' : 'Can’t scan? Show setup key'}
                </button>
                {showSecret && (
                  <code className="mt-2 block break-all rounded bg-gray-50 p-2 font-mono text-xs dark:bg-slate-900" data-testid="totp-secret">{setup.secret}</code>
                )}
              </div>
            </div>
          ) : (
            !error && <p className="text-sm text-gray-500">Preparing…</p>
          )}
          <div>
            <label htmlFor="two-step-enable-code" className={labelClass}>Code from your app</label>
            <input
              ref={inputRef}
              id="two-step-enable-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(null); }}
              className={fieldClass}
              disabled={!setup}
            />
            <p className={hintClass}>Turning this on signs out every other device.</p>
          </div>
        </fieldset>
      ) : (
        <RecoveryCodesPanel codes={codes} onSaved={() => onEnabled(summary.current)} />
      )}
    </SettingsDialog>
  );
}

function DisableDialog({ onClose, onDisabled, returnFocusRef }: { onClose: () => void; onDisabled: () => void; returnFocusRef: React.RefObject<HTMLElement> }) {
  const { withReauth } = useReauth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmed = code.trim();
      await withReauth(() => twoStepApi.disable(/^\d{6}$/.test(trimmed) ? { code: trimmed } : { recoveryCode: trimmed }));
      onDisabled();
    } catch (err: any) {
      if (isReauthCancelled(err)) return;
      setError(err.code === 'CODE_INVALID' ? 'That code didn’t match.' : err.message || 'Unable to turn off two-step authentication.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsDialog
      titleId="two-step-disable-title"
      title="Turn off two-step authentication"
      dirty={code.length > 0}
      saving={busy}
      submitLabel="Turn off"
      savingLabel="Turning off…"
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <fieldset disabled={busy} className="space-y-5">
        {error && <div role="alert" className={formAlertClass}>{error}</div>}
        <p className="text-sm text-gray-600 dark:text-slate-400">
          Your account will be protected by your first sign-in step only. Trusted devices and recovery codes are removed.
        </p>
        <div>
          <label htmlFor="two-step-disable-code" className={labelClass}>Authenticator or recovery code</label>
          <input ref={inputRef} id="two-step-disable-code" autoComplete="one-time-code" value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} className={fieldClass} />
        </div>
      </fieldset>
    </SettingsDialog>
  );
}

export default function TwoStepCard({ onChanged, onError }: Props) {
  const { withReauth } = useReauth();
  const { formatDateTime } = useAccountFormat();
  const [status, setStatus] = useState<TwoStepStatus | null>(null);
  const [dialog, setDialog] = useState<'enable' | 'disable' | 'codes' | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const codesRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setStatus(await twoStepApi.status());
    } catch (e: any) {
      setLoadError(e.message || 'Unable to load two-step settings.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const finish = (message: string) => {
    setDialog(null);
    setNewCodes(null);
    onChanged(message);
    void load();
  };

  const regenerate = async () => {
    if (!window.confirm('Generate new recovery codes? Your current codes will stop working.')) return;
    setBusy('codes');
    try {
      const result = await withReauth(() => twoStepApi.regenerateCodes());
      setNewCodes(result.recoveryCodes);
      setDialog('codes');
    } catch (e: any) {
      if (!isReauthCancelled(e)) onError(e.message || 'Unable to generate recovery codes.');
    } finally {
      setBusy(null);
    }
  };

  const revokeTrusted = async (id: string) => {
    setBusy(id);
    try {
      await withReauth(() => twoStepApi.revokeTrusted(id));
      finish('Trusted device removed.');
    } catch (e: any) {
      if (!isReauthCancelled(e)) onError(e.message || 'Unable to remove the trusted device.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cardClass} data-testid="two-step-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-gray-500 dark:text-slate-400"><ShieldCheck aria-hidden="true" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Two-step authentication</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              After signing in, verify your identity with a second step. It adds a layer of security by using more than your first sign-in method — even if someone gets your email link, Google account or password, they can&apos;t get in.
            </p>
          </div>
        </div>
        {status && (
          status.enabled ? (
            <button ref={toggleRef} type="button" onClick={() => setDialog('disable')} disabled={busy !== null} className={dangerButton}>Turn off</button>
          ) : (
            <button ref={toggleRef} type="button" onClick={() => setDialog('enable')} disabled={busy !== null} className={primaryButton}>Turn on</button>
          )
        )}
      </div>

      {loadError && (
        <div role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{loadError} <button type="button" onClick={load} className="font-medium underline">Retry</button></div>
      )}

      {status && !status.enabled && (
        <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-700 dark:bg-slate-900 dark:text-slate-300">
          <p className="font-medium text-gray-900 dark:text-white">How it works</p>
          <p className="mt-1">When you sign in to Jump, you&apos;ll:</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>Sign in with an email link, Google, your password or a passkey.</li>
            <li>Complete a second step to prove it&apos;s you: enter a code from your authenticator app, use a security key, or confirm on a trusted device.</li>
          </ol>
        </div>
      )}

      {status?.enabled && (
        <>
          <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">On since {status.enabledAt ? formatDateTime(status.enabledAt, { dateStyle: 'medium' }) : '—'}.</p>
          <ul className={listClass}>
            <li className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 dark:text-white">Authenticator app</span>
                <span className="block text-sm text-gray-600 dark:text-slate-400">Codes from your app are accepted.</span>
              </span>
            </li>
            <li className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 dark:text-white">Security key or passkey</span>
                <span className="block text-sm text-gray-600 dark:text-slate-400">
                  {status.methods.securityKey ? `${status.methods.passkeyCount} passkey${status.methods.passkeyCount === 1 ? '' : 's'} can complete the second step.` : 'Add a passkey above to use it as your second step.'}
                </span>
              </span>
            </li>
            <li className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 dark:text-white">Recovery codes</span>
                <span className="block text-sm text-gray-600 dark:text-slate-400" data-testid="recovery-codes-remaining">
                  {status.recoveryCodes ? `${status.recoveryCodes.remaining} of ${status.recoveryCodes.total} left.` : '—'}
                </span>
              </span>
              <button ref={codesRef} type="button" onClick={regenerate} disabled={busy !== null} className={secondaryButton}>
                {busy === 'codes' ? 'Generating…' : 'Generate new codes'}
              </button>
            </li>
          </ul>
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Trusted devices</h4>
            {status.trustedDevices.length === 0 ? (
              <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">None. Tick “Remember this device” when you verify to skip the second step for 30 days on that browser.</p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700">
                {status.trustedDevices.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="trusted-device-row">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{d.userAgent || 'Unknown browser'}</span>
                      <span className="block text-sm text-gray-600 dark:text-slate-400">Trusted until {formatDateTime(d.expiresAt, { dateStyle: 'medium' })}</span>
                    </span>
                    <button type="button" onClick={() => revokeTrusted(d.id)} disabled={busy !== null} className={secondaryButton} aria-label="Stop trusting this device">
                      {busy === d.id ? 'Removing…' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {dialog === 'enable' && (
        <EnableDialog returnFocusRef={toggleRef} onClose={() => setDialog(null)} onEnabled={finish} />
      )}
      {dialog === 'disable' && (
        <DisableDialog returnFocusRef={toggleRef} onClose={() => setDialog(null)} onDisabled={() => finish('Two-step authentication is off.')} />
      )}
      {dialog === 'codes' && newCodes && (
        <SettingsDialog
          titleId="two-step-codes-title"
          title="Your new recovery codes"
          dirty={false}
          saving={false}
          saveDisabled
          returnFocusRef={codesRef}
          onClose={() => finish('New recovery codes generated.')}
          onSubmit={(e) => e.preventDefault()}
        >
          <RecoveryCodesPanel codes={newCodes} onSaved={() => finish('New recovery codes generated.')} />
        </SettingsDialog>
      )}
    </div>
  );
}
