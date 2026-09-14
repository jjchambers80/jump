'use client';

// Customer billing statement: the name buyers see on their card statement.
// The platform prefix is fixed; the organization edits the suffix. Trade name
// and support phone are read-only here and link to Settings › General.

import Link from 'next/link';
import { FormEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '../SettingsDialog';
import { WarningIcon } from '../icons';
import { errorClass, fieldClass, formAlertClass, formatPhone, hintClass, labelClass } from '../formShared';
import { describeError, usePaymentsApi } from './usePaymentsApi';
import { descriptorError, normalizeDescriptor, type PaymentSettings } from './types';

interface StatementDescriptorDialogProps {
  settings: PaymentSettings;
  canEdit: boolean;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onSaved: (settings: PaymentSettings) => void;
}

const readOnlyRow = 'mt-1 flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900/40';
const generalLink = 'shrink-0 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300';

export default function StatementDescriptorDialog({ settings, canEdit, returnFocusRef, onClose, onSaved }: StatementDescriptorDialogProps) {
  const api = usePaymentsApi();
  const { prefix, budget } = settings.descriptor;
  const initial = settings.statementDescriptorSuffix ?? '';
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validation = descriptorError(value, budget, prefix);
  const dirty = normalizeDescriptor(value) !== initial;
  const previewSuffix = value.trim() ? normalizeDescriptor(value) : settings.descriptor.derived ? settings.descriptor.suffix : null;
  const preview = prefix && previewSuffix ? `${prefix}* ${previewSuffix}` : null;
  const remaining = budget - normalizeDescriptor(value).length;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || validation || saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const next = normalizeDescriptor(value);
      onSaved(await api.update({ statementDescriptorSuffix: next === '' ? null : next }));
    } catch (err) {
      setError(describeError(err, 'Could not save the statement name'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="statement-descriptor-title"
      title="Customer billing statement"
      dirty={dirty}
      saving={saving}
      saveDisabled={!canEdit || validation !== null}
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className="space-y-5">
        {error && (
          <div role="alert" className={formAlertClass}>
            {error}
          </div>
        )}

        <div>
          <span className={labelClass}>Trade name</span>
          <div className={readOnlyRow}>
            <span className="truncate text-gray-900 dark:text-white">{settings.organization.name}</span>
            <Link href="/admin/settings" className={generalLink}>
              Edit on General
            </Link>
          </div>
        </div>

        <div>
          <label htmlFor="statement-descriptor-suffix" className={labelClass}>
            Name on customer statement
          </label>
          <div className="mt-1 flex rounded-md shadow-sm">
            <span
              data-testid="statement-descriptor-prefix"
              className="inline-flex items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-3 text-sm text-gray-600 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-400"
            >
              {prefix ? `${prefix}*` : '—'}
            </span>
            <input
              ref={inputRef}
              id="statement-descriptor-suffix"
              type="text"
              value={value}
              maxLength={Math.max(budget, 1)}
              disabled={!canEdit || !prefix}
              placeholder={settings.descriptor.derived ? settings.descriptor.suffix ?? '' : ''}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={validation !== null}
              aria-describedby="statement-descriptor-help statement-descriptor-count"
              className={`${fieldClass} mt-0 rounded-l-none uppercase`}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="mt-1 flex items-start justify-between gap-3">
            <p id="statement-descriptor-help" className={hintClass}>
              Helps buyers recognise the charge on their bank statement. Letters, numbers and spaces only. Leave blank to use your trade name.
            </p>
            <span id="statement-descriptor-count" className="shrink-0 text-xs text-gray-500 dark:text-slate-400">
              {prefix ? `${Math.max(remaining, 0)} of ${budget} left` : ''}
            </span>
          </div>
          {validation && (
            <p role="alert" className={errorClass}>
              {validation}
            </p>
          )}
          {!prefix && (
            <p className="mt-2 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300">
              <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
              Ask the platform owner to set a statement descriptor prefix on the Stripe account before choosing a name.
            </p>
          )}
        </div>

        <div>
          <span className={labelClass}>Preview</span>
          <p
            data-testid="statement-descriptor-preview"
            className="mt-1 rounded-md border border-dashed border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 dark:border-slate-600 dark:text-white"
          >
            {preview ?? '—'}
          </p>
        </div>

        <div>
          <span className={labelClass}>Support phone number</span>
          <div className={readOnlyRow}>
            <span className="text-gray-900 dark:text-white">
              {settings.organization.phoneNumber
                ? `${settings.organization.phoneCountryCode ?? '+1'} ${formatPhone(settings.organization.phoneNumber)}`
                : 'Not set'}
            </span>
            <Link href="/admin/settings" className={generalLink}>
              Edit on General
            </Link>
          </div>
        </div>
      </div>
    </SettingsDialog>
  );
}
