'use client';

// Applications section of the buyer account page (spec 011): this
// organization's applications with status, payment state and withdraw.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatDate, money, PAYMENT_LABEL, STATUS_LABEL, STATUS_STYLE, type ApplicantApplication } from '@/lib/applications';

export default function ApplicationsSection() {
  const [apps, setApps] = useState<ApplicantApplication[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/buyer/me/applications', { cache: 'no-store' });
    if (!res.ok) {
      setApps([]);
      return;
    }
    const body = await res.json();
    setApps(body.data || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const withdraw = async (app: ApplicantApplication) => {
    if (!window.confirm(`Withdraw your ${app.form.name} application for ${app.event.name}?`)) return;
    setBusyId(app.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/buyer/me/applications/${app.id}/withdraw`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || 'Could not withdraw');
      setMessage('Application withdrawn.');
      await load();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (!apps || apps.length === 0) return null;

  return (
    <section data-testid="account-applications">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">Applications</h2>
      {message && (
        <p role="status" className="mb-3 text-sm text-gray-700 dark:text-slate-300">{message}</p>
      )}
      <ul className="space-y-3">
        {apps.map((a) => (
          <li key={a.id} className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-slate-100">
                {a.event.name} · {a.form.name}{a.tier ? ` (${a.tier.name})` : ''}
              </p>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                {formatDate(a.event.date)} · {a.profile.businessName}
                {a.form.kind === 'PAID' ? ` · ${PAYMENT_LABEL[a.paymentStatus]}${a.amounts.applicantPays > 0 ? ` ${money(a.amounts.applicantPays)}` : ''}` : ''}
                {a.boothLabel ? ` · ${a.boothLabel}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {a.canWithdraw && (
                <button type="button" onClick={() => withdraw(a)} disabled={busyId === a.id} className="text-xs font-semibold text-brand-link hover:underline disabled:opacity-60">
                  {busyId === a.id ? 'Withdrawing…' : 'Withdraw'}
                </button>
              )}
              <Link href={`/events/${a.event.id}`} className="text-xs font-semibold text-gray-600 dark:text-slate-400 hover:underline">
                Event
              </Link>
              <span className={`text-xs font-semibold px-2 py-1 rounded ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
