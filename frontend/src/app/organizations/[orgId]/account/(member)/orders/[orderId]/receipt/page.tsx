// Printable receipt for one of the buyer's paid orders (spec 040 PA-06).
// The browser's print dialog saves it as a PDF; the account chrome is
// `print:hidden` in the layout, so only this sheet prints.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { formatEventDateTime } from '@/lib/eventTime';
import { useAccount } from '@/components/account/AccountContext';

interface Receipt {
  id: string;
  orderRef: string;
  kind: 'TICKET' | 'APPLICATION';
  status: string;
  organization: { name: string | null; logoUrl: string | null };
  event: {
    name: string | null;
    date: string | null;
    timezone: string | null;
    venue: { name: string; address?: string | null; city?: string | null; state?: string | null } | null;
  };
  billedTo: { firstName: string; lastName: string; email: string };
  createdAt: string;
  paidAt: string | null;
  paymentSource: 'STRIPE' | 'OFFLINE' | null;
  offlineMethod: string | null;
  lines: { description: string; quantity: number; unitPrice: number; amount: number }[];
  subtotal: number;
  fees: number;
  tax: number;
  total: number;
  currency: string;
  refunds: { amount: number; feeRetained: number; createdAt: string }[];
}

const money = (n: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(n);

/** When it happened to the buyer: their own clock, not the venue's (spec 033 — operational timestamp). */
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';

export default function AccountReceiptPage({ params }: { params: { orderId: string } }) {
  const { href } = useAccount();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/buyer/me/orders/${encodeURIComponent(params.orderId)}/receipt`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(res.status === 404 ? 'There is no receipt for this order.' : body.message || 'Could not load the receipt');
        return body as Receipt;
      })
      .then((r) => !cancelled && setReceipt(r))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [params.orderId]);

  const back = (
    <Link href={href('orders')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-link hover:underline print:hidden">
      <ArrowLeft aria-hidden className="h-4 w-4" />
      Orders
    </Link>
  );

  if (error) {
    return (
      <div className="space-y-4">
        {back}
        <p role="alert" className="text-gray-700 dark:text-slate-300">{error}</p>
      </div>
    );
  }
  if (!receipt) return <p className="text-gray-600 dark:text-slate-400">Loading receipt…</p>;

  const refunded = receipt.refunds.reduce((sum, r) => sum + r.amount, 0);
  const venue = receipt.event.venue;
  const place = venue ? [venue.name, venue.city, venue.state].filter(Boolean).join(', ') : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        {back}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-[var(--theme-button-radius,8px)] bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:bg-brand-hover"
        >
          <Printer aria-hidden className="h-4 w-4" />
          Print or save as PDF
        </button>
      </div>

      <article
        aria-labelledby="receipt-heading"
        data-testid="receipt"
        className="rounded-2xl bg-white p-6 text-gray-900 shadow-sm ring-1 ring-gray-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700 sm:p-10 print:rounded-none print:bg-white print:p-0 print:text-black print:shadow-none print:ring-0"
      >
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-6 dark:border-slate-700 sm:flex-row sm:items-start sm:justify-between print:border-gray-300">
          <div>
            <p className="text-sm font-semibold text-gray-600 dark:text-slate-400 print:text-gray-600">{receipt.organization.name}</p>
            <h2 id="receipt-heading" className="mt-1 text-2xl font-bold tracking-tight">
              Receipt
            </h2>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm sm:text-right">
            <dt className="text-gray-500 dark:text-slate-400 print:text-gray-600">Order</dt>
            <dd className="font-mono font-semibold">{receipt.orderRef}</dd>
            <dt className="text-gray-500 dark:text-slate-400 print:text-gray-600">Paid</dt>
            <dd>{day(receipt.paidAt ?? receipt.createdAt)}</dd>
            {receipt.paymentSource === 'OFFLINE' && (
              <>
                <dt className="text-gray-500 dark:text-slate-400 print:text-gray-600">Method</dt>
                <dd className="capitalize">{(receipt.offlineMethod || 'offline').toLowerCase()}</dd>
              </>
            )}
          </dl>
        </header>

        <div className="grid gap-6 border-b border-gray-200 py-6 text-sm dark:border-slate-700 sm:grid-cols-2 print:border-gray-300">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-gray-500 dark:text-slate-400 print:text-gray-600">Billed to</p>
            <p className="mt-1 font-medium">
              {receipt.billedTo.firstName} {receipt.billedTo.lastName}
            </p>
            <p className="text-gray-600 dark:text-slate-300 print:text-gray-700">{receipt.billedTo.email}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-gray-500 dark:text-slate-400 print:text-gray-600">
              {receipt.kind === 'APPLICATION' ? 'Application for' : 'Event'}
            </p>
            <p className="mt-1 font-medium">{receipt.event.name}</p>
            {receipt.event.date && (
              <p className="text-gray-600 dark:text-slate-300 print:text-gray-700">{formatEventDateTime(receipt.event.date, receipt.event.timezone)}</p>
            )}
            {place && <p className="text-gray-600 dark:text-slate-300 print:text-gray-700">{place}</p>}
          </div>
        </div>

        <table className="mt-6 w-full text-sm">
          <caption className="sr-only">Items</caption>
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-[0.12em] text-gray-500 dark:border-slate-700 dark:text-slate-400 print:border-gray-300 print:text-gray-600">
              <th scope="col" className="pb-2 font-semibold">Item</th>
              <th scope="col" className="pb-2 text-right font-semibold">Qty</th>
              <th scope="col" className="hidden pb-2 text-right font-semibold sm:table-cell print:table-cell">Price</th>
              <th scope="col" className="pb-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line, i) => (
              <tr key={i} className="border-b border-gray-100 dark:border-slate-700/60 print:border-gray-200">
                <td className="py-2.5 pr-3">{line.description}</td>
                <td className="py-2.5 text-right tabular-nums">{line.quantity}</td>
                <td className="hidden py-2.5 text-right tabular-nums sm:table-cell print:table-cell">{money(line.unitPrice, receipt.currency)}</td>
                <td className="py-2.5 text-right tabular-nums">{money(line.amount, receipt.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto mt-4 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-gray-600 dark:text-slate-400 print:text-gray-700">Subtotal</dt>
          <dd className="text-right tabular-nums">{money(receipt.subtotal, receipt.currency)}</dd>
          {receipt.fees > 0 && (
            <>
              <dt className="text-gray-600 dark:text-slate-400 print:text-gray-700">Fees</dt>
              <dd className="text-right tabular-nums">{money(receipt.fees, receipt.currency)}</dd>
            </>
          )}
          {receipt.tax > 0 && (
            <>
              <dt className="text-gray-600 dark:text-slate-400 print:text-gray-700">Tax</dt>
              <dd className="text-right tabular-nums">{money(receipt.tax, receipt.currency)}</dd>
            </>
          )}
          <dt className="mt-1 border-t border-gray-200 pt-2 font-semibold dark:border-slate-700 print:border-gray-300">Total paid</dt>
          <dd className="mt-1 border-t border-gray-200 pt-2 text-right font-semibold tabular-nums dark:border-slate-700 print:border-gray-300" data-testid="receipt-total">
            {money(receipt.total, receipt.currency)}
          </dd>
          {receipt.refunds.map((r, i) => (
            <div key={i} className="contents">
              <dt className="text-gray-600 dark:text-slate-400 print:text-gray-700">Refunded {day(r.createdAt)}</dt>
              <dd className="text-right tabular-nums">−{money(r.amount, receipt.currency)}</dd>
            </div>
          ))}
          {refunded > 0 && (
            <>
              <dt className="font-semibold">Net</dt>
              <dd className="text-right font-semibold tabular-nums">{money(receipt.total - refunded, receipt.currency)}</dd>
            </>
          )}
        </dl>
      </article>
    </div>
  );
}
