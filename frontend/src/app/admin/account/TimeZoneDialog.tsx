'use client';

import { FormEvent, RefObject, useMemo, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { browserTimeZone, timeZoneLabel, timeZoneOptions } from '@/lib/timeZones';
import { Account, accountApi } from './accountApi';

interface Props {
  account: Account;
  onClose: () => void;
  onSaved: (account: Account) => void;
  returnFocusRef: RefObject<HTMLElement>;
}

const BROWSER = '';

export default function TimeZoneDialog({ account, onClose, onSaved, returnFocusRef }: Props) {
  const [timeZone, setTimeZone] = useState(account.timeZone || BROWSER);
  const [filter, setFilter] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => timeZoneOptions(), []);
  const browser = useMemo(() => browserTimeZone(), []);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase().replace(/\s+/g, '_');
    if (!q) return options;
    return options.filter((o) => o.id.toLowerCase().includes(q) || o.city.toLowerCase().includes(filter.trim().toLowerCase()));
  }, [filter, options]);
  // Keep the current choice selectable even when the filter hides it.
  const current = timeZone && !visible.some((o) => o.id === timeZone) ? options.find((o) => o.id === timeZone) : null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setSaving(true);
      onSaved(await accountApi.update({ timeZone: timeZone || null }));
    } catch (error: any) {
      setFormError(error.message || 'Unable to save your time zone.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="account-timezone-dialog-title"
      title="Time zone"
      dirty={timeZone !== (account.timeZone || BROWSER)}
      saving={saving}
      initialFocusRef={filterRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <fieldset disabled={saving} className="space-y-5">
        {formError && <div role="alert" className={formAlertClass}>{formError}</div>}
        <div>
          <label htmlFor="account-timezone-filter" className={labelClass}>Search</label>
          <input
            ref={filterRef}
            id="account-timezone-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className={fieldClass}
            placeholder="City or region, e.g. Denver"
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="account-timezone" className={labelClass}>Time zone</label>
          <select
            id="account-timezone"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            aria-describedby="account-timezone-hint"
            className={fieldClass}
            size={8}
          >
            <option value={BROWSER}>
              Browser default{browser ? ` (${timeZoneLabel(browser)})` : ''}
            </option>
            {current && <option value={current.id}>{current.offset} · {current.id.replace(/_/g, ' ')}</option>}
            {visible.map((o) => (
              <option key={o.id} value={o.id}>
                {o.offset} · {o.id.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <p id="account-timezone-hint" className={hintClass}>
            This is the time zone for your account. It&apos;s used for the dates and times you see in Jump.
          </p>
        </div>
      </fieldset>
    </SettingsDialog>
  );
}
