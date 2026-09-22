'use client';

// Applications section of the buyer account page (spec 011): this
// organization's applications with status, payment state, withdraw, and
// (phase 2) pay-now for an outstanding balance or replacing the saved card.
// Approved vendors on a map-bound tier choose and buy their booth inline
// (spec 014 phase 2).

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { addOnSummary, formatDate, money, needsBoothPicker, PAYMENT_LABEL, STATUS_LABEL, STATUS_STYLE, type ApplicantApplication } from '@/lib/applications';
import { mapsApi } from '@/services/api';
import BoothPicker from '@/components/maps/BoothPicker';
import { formatEventDate } from '@/lib/eventTime';

export default function ApplicationsSection() {
  const [apps, setApps] = useState<ApplicantApplication[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pickerId, setPickerId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<ApplicantApplication[]> => {
    const res = await fetch('/api/buyer/me/applications', { cache: 'no-store' });
    if (!res.ok) {
      setApps([]);
      return [];
    }
    const body = await res.json();
    const list: ApplicantApplication[] = body.data || [];
    setApps(list);
    return list;
  }, []);

  /** Pay-now for a booth the picker holds: same proxy as the Pay button, but the picker follows the URL. */
  const payNowUrl = async (app: ApplicantApplication) => {
    const res = await fetch(`/api/buyer/me/applications/${app.id}/pay`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) throw new Error(body.message || body.error || 'Could not open checkout');
    return { url: body.url as string };
  };

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

  const checkout = async (app: ApplicantApplication, action: 'pay' | 'update-card') => {
    setBusyId(app.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/buyer/me/applications/${app.id}/${action}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.message || body.error || 'Could not open checkout');
      window.location.assign(body.url);
    } catch (err) {
      setMessage((err as Error).message);
      setBusyId(null);
    }
  };

  if (!apps || apps.length === 0) return null;

  return (
    <section id="applications" data-testid="account-applications">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">Applications</h2>
      {message && (
        <p role="status" className="mb-3 text-sm text-gray-700 dark:text-slate-300">{message}</p>
      )}
      <ul className="space-y-3">
        {apps.map((a) => {
          const pickBooth = needsBoothPicker(a);
          const pickerOpen = pickBooth && (pickerId === a.id || a.booth?.status === 'HELD');
          return (
          <li key={a.id} className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-slate-100">
                {a.event.name} · {a.form.name}{a.tier ? ` (${a.tier.name})` : ''}
              </p>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                {formatEventDate(a.event.date, a.event.timezone)} · {a.profile.businessName}
                {a.form.kind === 'PAID' ? ` · ${PAYMENT_LABEL[a.paymentStatus]}${a.amounts.applicantPays > 0 ? ` ${money(a.amounts.applicantPays)}` : ''}${a.paymentStatus === 'PAYMENT_DUE' && a.paymentDueAt ? ` by ${formatDate(a.paymentDueAt)}` : ''}` : ''}
                {a.booth && a.booth.status !== 'HELD' ? ` · Booth ${a.booth.label}` : a.boothLabel && !a.booth ? ` · ${a.boothLabel}` : ''}
                {a.orderRef ? <span className="font-mono"> · Order {a.orderRef}</span> : null}
              </p>
              {a.addOns?.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-slate-400" data-testid="account-application-add-ons">Add-ons: {addOnSummary(a.addOns)}</p>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {pickBooth ? (
                <button type="button" onClick={() => setPickerId((id) => (id === a.id ? null : a.id))} data-testid="account-application-choose-booth" aria-expanded={pickerOpen} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60">
                  {a.booth?.status === 'HELD' ? 'Finish buying booth' : pickerOpen ? 'Hide map' : 'Choose your booth'}
                </button>
              ) : a.canPay && (
                <button type="button" onClick={() => checkout(a, 'pay')} disabled={busyId === a.id} data-testid="account-application-pay" className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60">
                  {busyId === a.id ? 'Opening…' : `Pay ${money(a.amounts.applicantPays)}`}
                </button>
              )}
              {a.canUpdateCard && (
                <button type="button" onClick={() => checkout(a, 'update-card')} disabled={busyId === a.id} data-testid="account-application-update-card" className="text-xs font-semibold text-brand-link hover:underline disabled:opacity-60">
                  Update card
                </button>
              )}
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
          </div>
          {pickerOpen && (
            <div className="border-t border-gray-200 pt-3 dark:border-slate-700">
              <BoothPicker
                eventId={a.event.id}
                application={a}
                chooseBooth={(boothId) => mapsApi.chooseBoothForContact(a.id, boothId)}
                payNow={() => payNowUrl(a)}
                refresh={async () => (await load()).find((x) => x.id === a.id) ?? null}
              />
            </div>
          )}
          </li>
          );
        })}
      </ul>
    </section>
  );
}
