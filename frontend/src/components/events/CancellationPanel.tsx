'use client';

// Refunds of a cancelled event (spec 054-C), on its Overview: how many orders
// are refunded, skipped or failed, polled while the sweep is still running,
// and every failed refund with Stripe's reason and two ways out: Retry (puts
// it back in the queue; needs orders.refund and a step-up) or Mark handled
// (staff sorted it out; the buyer gets the "we'll be in touch" email).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/services/api';
import { useCan } from '@/components/OrgContext';
import { isReauthCancelled, useReauth } from '@/app/admin/account/useReauth';

export interface CancellationStatus {
  id: string;
  mode: 'REFUND_ALL' | 'MANUAL';
  message: string | null;
  createdAt: string;
  completedAt: string | null;
  total: number;
  counts: { pending: number; refunded: number; skipped: number; failed: number };
  refundedTotal: number;
  failed: { id: string; orderId: string; orderRef: string | null; buyer: string | null; email: string | null; amount: number; error: string | null; attempts: number }[];
}

const POLL_MS = 5000;
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const button =
  'inline-flex min-h-9 items-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

export default function CancellationPanel({ orgId, eventId }: { orgId: string; eventId: string }) {
  const canAct = useCan('events.cancel');
  const canRefund = useCan('orders.refund');
  const { withReauth } = useReauth();
  const [status, setStatus] = useState<CancellationStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/organizations/${orgId}/events/${eventId}/cancellation`;

  const load = useCallback(async () => {
    try {
      setStatus((await api.get<{ cancellation: CancellationStatus | null }>(base)).cancellation);
    } catch (err) {
      setError((err as Error)?.message || 'Could not load the refunds');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);
  // Poll while the sweep is still working through the orders.
  const running = !!status && !status.completedAt;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [running, load]);

  const act = async (itemId: string, action: 'retry' | 'handled') => {
    setBusy(itemId);
    setError(null);
    try {
      const run = () => api.post<{ cancellation: CancellationStatus }>(`${base}/items/${itemId}/${action}`, {});
      const res = action === 'retry' ? await withReauth(run) : await run();
      setStatus(res.cancellation);
    } catch (err) {
      if (!isReauthCancelled(err)) setError((err as Error)?.message || 'Could not update this refund');
    } finally {
      setBusy(null);
    }
  };

  if (status === undefined && !error) return null;
  if (!status) return error ? <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p> : null;
  if (status.total === 0) return null;

  const refundAll = status.mode === 'REFUND_ALL';
  const settled = status.total - status.counts.pending;
  const pct = Math.round((settled / status.total) * 100);
  const heading = refundAll ? (status.completedAt ? 'Refunds' : 'Refunding orders') : 'Buyers told';

  return (
    <section aria-labelledby="cancellation-heading" className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5" data-testid="cancellation-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="cancellation-heading" className="text-base font-semibold text-gray-900 dark:text-white">
          {heading}
        </h2>
        <p className="text-sm text-gray-600 dark:text-slate-400">
          {status.completedAt ? 'Done' : 'In progress'}
        </p>
      </div>

      <p className="mt-2 text-sm text-gray-800 dark:text-slate-200">
        {refundAll
          ? `Refunded ${status.counts.refunded} of ${status.total} ${status.total === 1 ? 'order' : 'orders'} · ${money(status.refundedTotal)}`
          : `${settled} of ${status.total} buyers emailed. Refund them from Orders.`}
      </p>
      <div
        role="progressbar"
        aria-label={heading}
        aria-valuemin={0}
        aria-valuemax={status.total}
        aria-valuenow={settled}
        aria-valuetext={`${settled} of ${status.total} handled`}
        className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700"
      >
        <div className="h-full rounded-full bg-emerald-600 motion-safe:transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-slate-400">
        {refundAll && <li>{status.counts.refunded} refunded</li>}
        {status.counts.skipped > 0 && <li>{status.counts.skipped} not refunded (free, disputed, already refunded or handled)</li>}
        {status.counts.pending > 0 && <li>{status.counts.pending} waiting</li>}
        {status.counts.failed > 0 && <li className="font-medium text-red-700 dark:text-red-300">{status.counts.failed} failed</li>}
      </ul>

      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}

      {status.failed.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Refunds that need you</h3>
          <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700">
            {status.failed.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between" data-testid={`cancellation-failed-${item.id}`}>
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-gray-900 dark:text-white">
                    <Link href={`/admin/orders/${item.orderId}`} className="underline underline-offset-2">
                      {item.orderRef ?? 'Order'}
                    </Link>{' '}
                    · {money(item.amount)}
                    {item.buyer ? ` · ${item.buyer}` : ''}
                  </p>
                  {item.error && <p className="mt-0.5 break-words text-gray-600 dark:text-slate-400">{item.error}</p>}
                </div>
                {canAct && (
                  <div className="flex shrink-0 gap-2">
                    {canRefund && (
                      <button type="button" className={button} disabled={busy !== null} onClick={() => void act(item.id, 'retry')}>
                        {busy === item.id ? 'Working…' : 'Retry'}
                      </button>
                    )}
                    <button type="button" className={button} disabled={busy !== null} onClick={() => void act(item.id, 'handled')} aria-describedby="cancellation-handled-hint">
                      Mark handled
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canAct && (
            <p id="cancellation-handled-hint" className="mt-2 text-xs text-gray-600 dark:text-slate-400">
              Mark handled when you&apos;ve refunded the buyer another way. They get an email that you&apos;ll be in touch.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
