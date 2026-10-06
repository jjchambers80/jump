'use client';

// Applications section of the buyer account page (spec 011): this
// organization's applications with status, payment state, withdraw, and
// (phase 2) pay-now for an outstanding balance or replacing the saved card.
// Approved vendors on a PAID form choose their space (tier, or a spot in the
// stacked SpotWorkspace) and pay inline (spec 037 phase 5, ChooseSpace).

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { addOnSummary, formatDate, money, needsSpaceChoice, PAYMENT_LABEL, STATUS_LABEL, STATUS_STYLE, type AddOnLineInput, type ApplicantApplication } from '@/lib/applications';
import type { ChooseBoothResult } from '@/services/api';
import ChooseSpace, { type SpaceApi } from '@/components/applications/ChooseSpace';
import { formatEventDate } from '@/lib/eventTime';

/** POST through the buyer proxy; errors carry `status` / `code` like `services/api`. */
async function buyerPost<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, code: data.code, message: data.message || data.error || 'Something went wrong' };
  return data as T;
}

function spaceApiFor(id: string): SpaceApi {
  const base = `/api/buyer/me/applications/${encodeURIComponent(id)}`;
  return {
    select: (body: { boothId?: string | null; addOns: AddOnLineInput[]; useSavedCard?: boolean }) =>
      buyerPost<ChooseBoothResult & { orderRef?: string | null }>(`${base}/select`, body),
    pay: () => buyerPost<{ url: string }>(`${base}/pay`),
    release: () => buyerPost(`${base}/release`),
  };
}

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
          const choosing = needsSpaceChoice(a);
          const pickerOpen = choosing && (pickerId === a.id || a.selection?.state === 'HELD');
          return (
          <li key={a.id} className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 space-y-3">
          {/* Phones: details, then the actions wrapping underneath; from sm they share a row. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-slate-100">
                {a.event.name} · {a.form.name}{a.tier ? ` (${a.tier.name})` : ''}
              </p>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                {formatEventDate(a.event.date, a.event.timezone)} · {a.profile.businessName}
                {a.form.kind === 'PAID' ? ` · ${PAYMENT_LABEL[a.paymentStatus]}${a.amounts.applicantPays > 0 ? ` ${money(a.amounts.applicantPays)}` : ''}${['PAYMENT_DUE', 'AWAITING_SELECTION'].includes(a.paymentStatus) && a.paymentDueAt ? ` by ${formatDate(a.paymentDueAt)}` : ''}` : ''}
                {a.booth && a.booth.status !== 'HELD' ? ` · Booth ${a.booth.label}` : a.boothLabel && !a.booth ? ` · ${a.boothLabel}` : ''}
                {a.orderRef ? <span className="font-mono"> · Order {a.orderRef}</span> : null}
              </p>
              {a.addOns?.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-slate-400" data-testid="account-application-add-ons">Add-ons: {addOnSummary(a.addOns)}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:shrink-0 sm:flex-nowrap">
              {choosing ? (
                <button type="button" onClick={() => setPickerId((id) => (id === a.id ? null : a.id))} data-testid="account-application-choose-space" aria-expanded={pickerOpen} className="rounded-[var(--theme-button-radius,6px)] bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60">
                  {a.selection?.state === 'HELD' ? 'Finish paying' : pickerOpen ? 'Hide' : 'Choose your space'}
                </button>
              ) : a.canPay && (
                <button type="button" onClick={() => checkout(a, 'pay')} disabled={busyId === a.id} data-testid="account-application-pay" className="rounded-[var(--theme-button-radius,6px)] bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60">
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
              <ChooseSpace application={a} spaceApi={spaceApiFor(a.id)} refresh={async () => (await load()).find((x) => x.id === a.id) ?? null} />
            </div>
          )}
          </li>
          );
        })}
      </ul>
    </section>
  );
}
