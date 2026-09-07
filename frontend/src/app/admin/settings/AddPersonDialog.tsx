'use client';

import { FormEvent, RefObject, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '@/services/api';
import { CreateOrganizationPersonPayload, OrganizationPersonSummary } from './types';

interface AddPersonDialogProps {
  currentRepresentative?: OrganizationPersonSummary;
  onAdded: (person: OrganizationPersonSummary) => void;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement>;
}

const months = [
  ['01', 'January'], ['02', 'February'], ['03', 'March'], ['04', 'April'],
  ['05', 'May'], ['06', 'June'], ['07', 'July'], ['08', 'August'],
  ['09', 'September'], ['10', 'October'], ['11', 'November'], ['12', 'December'],
] as const;

const inputClass = 'mt-1 block w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300';

function canonicalDate(month: string, day: string, year: string) {
  if (!/^\d{2}$/.test(month) || !/^\d{1,2}$/.test(day) || !/^\d{4}$/.test(year)) return null;
  const paddedDay = day.padStart(2, '0');
  const value = `${year}-${month}-${paddedDay}`;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  ) return null;
  const today = new Date();
  const todayValue = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
  return value > todayValue ? 'future' : value;
}

export default function AddPersonDialog({ currentRepresentative, onAdded, onClose, returnFocusRef }: AddPersonDialogProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');
  const [representative, setRepresentative] = useState(false);
  const [dateError, setDateError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  savingRef.current = saving;

  const close = () => {
    if (!savingRef.current) onClose();
  };

  useEffect(() => {
    firstNameRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [onClose, returnFocusRef]);

  const complete = Boolean(firstName.trim() && lastName.trim() && month && day && year);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (savingRef.current || !complete) return;
    const date = canonicalDate(month, day, year);
    if (date === 'future') {
      setDateError('Date of birth cannot be in the future.');
      return;
    }
    if (!date) {
      setDateError('Enter a valid date of birth.');
      return;
    }
    const payload: CreateOrganizationPersonPayload = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dateOfBirth: date,
      isAccountRepresentative: representative,
    };
    setDateError('');
    setFormError('');
    try {
      setSaving(true);
      const person = await api.post<OrganizationPersonSummary>('/admin/settings/people', payload);
      onAdded(person);
      onClose();
    } catch (error: any) {
      setFormError(error.message || 'Unable to add person.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="add-person-title" className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900">
        <form onSubmit={submit} className="min-w-0 overflow-y-auto">
          <header className="flex items-center justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-slate-700">
            <h2 id="add-person-title" className="text-lg font-semibold text-gray-900 dark:text-white">Add person</h2>
            <button type="button" aria-label="Close Add person" onClick={close} disabled={saving} className="rounded-md px-3 py-2 text-xl text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">×</button>
          </header>
          <div className="space-y-5 px-5 py-5">
            <p className="text-sm text-gray-600 dark:text-slate-300">Add a person associated with your business.</p>
            {formError && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">{formError}</div>}
            <fieldset disabled={saving} className="space-y-5">
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <div><label htmlFor="person-first-name" className={labelClass}>First name</label><input ref={firstNameRef} id="person-first-name" value={firstName} onChange={(e) => { setFirstName(e.target.value); setFormError(''); }} autoComplete="given-name" className={inputClass} /></div>
                <div><label htmlFor="person-last-name" className={labelClass}>Last name</label><input id="person-last-name" value={lastName} onChange={(e) => { setLastName(e.target.value); setFormError(''); }} autoComplete="family-name" className={inputClass} /></div>
              </div>
              <div>
                <span className={labelClass}>Date of birth</span>
                <div className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-2">
                  <div><label htmlFor="birth-month" className="sr-only">Month</label><select id="birth-month" aria-label="Month" value={month} onChange={(e) => { setMonth(e.target.value); setDateError(''); }} className={inputClass}><option value="">Month</option>{months.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                  <div><label htmlFor="birth-day" className="sr-only">DD</label><input id="birth-day" aria-label="DD" value={day} onChange={(e) => { setDay(e.target.value.replace(/\D/g, '').slice(0, 2)); setDateError(''); }} placeholder="DD" inputMode="numeric" maxLength={2} className={inputClass} /></div>
                  <div><label htmlFor="birth-year" className="sr-only">YYYY</label><input id="birth-year" aria-label="YYYY" value={year} onChange={(e) => { setYear(e.target.value.replace(/\D/g, '').slice(0, 4)); setDateError(''); }} placeholder="YYYY" inputMode="numeric" maxLength={4} className={inputClass} /></div>
                </div>
                {dateError && <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">{dateError}</p>}
              </div>
              <div>
                <label className="flex items-start gap-3 text-sm font-medium text-gray-800 dark:text-slate-200"><input type="checkbox" checked={representative} onChange={(e) => setRepresentative(e.target.checked)} className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" /> <span>Assign as account representative</span></label>
                <p className="ml-7 mt-1 text-xs text-gray-500 dark:text-slate-400">A person with authority to make financial decisions for your business.{currentRepresentative ? ` Currently set to ${currentRepresentative.firstName.trim()} ${currentRepresentative.lastName.trim()}.` : ''}</p>
              </div>
            </fieldset>
          </div>
          <footer className="flex justify-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-slate-700">
            <button type="button" onClick={close} disabled={saving} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
            <button type="submit" disabled={!complete || saving} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Adding…' : 'Add'}</button>
          </footer>
        </form>
      </div>
    </div>,
    document.body
  );
}
