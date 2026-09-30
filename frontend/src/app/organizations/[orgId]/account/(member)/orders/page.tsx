// Order history for this organization (spec 040): ticket orders link to the
// order page, application orders (spec 024) to the Applications section.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Receipt } from 'lucide-react';
import { formatEventDate } from '@/lib/eventTime';
import { useAccount } from '@/components/account/AccountContext';

interface OrderSummary {
  id: string;
  orderRef: string;
  /** TICKET or APPLICATION (spec 024): an application order links to the application, not a ticket page. */
  kind?: 'TICKET' | 'APPLICATION';
  applicationId?: string | null;
  description?: string;
  eventName?: string;
  eventDate?: string;
  /** IANA zone of the event's venue (spec 033). */
  eventTimezone?: string | null;
  quantity: number;
  totalAmount: number;
  status: string;
  statusDetail?: { label: string } | null;
  createdAt: string;
}

export default function AccountOrdersPage() {
  const { href } = useAccount();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/buyer/me/orders', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .catch(() => ({ data: [] }))
      .then((body) => {
        if (!cancelled) setOrders(body.data || []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="account-orders-heading">
      <h2 id="account-orders-heading" className="mb-4 text-lg font-semibold text-gray-900 dark:text-slate-100">
        Orders
      </h2>
      {orders === null ? (
        <p className="text-gray-600 dark:text-slate-400">Loading orders…</p>
      ) : orders.length === 0 ? (
        <p className="flex items-center gap-3 rounded-2xl border border-dashed border-gray-300 p-6 text-gray-600 dark:border-slate-600 dark:text-slate-400">
          <Receipt aria-hidden className="h-5 w-5 shrink-0 text-gray-400 dark:text-slate-500" />
          No orders yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 dark:divide-slate-700 dark:bg-slate-800 dark:ring-slate-700">
          {orders.map((o) => {
            const isApplication = o.kind === 'APPLICATION' && o.applicationId;
            const target = isApplication ? href('applications') : `/orders/${o.id}`;
            return (
              <li key={o.id} data-testid="account-order" data-kind={o.kind ?? 'TICKET'}>
                <Link
                  href={target}
                  className="group flex items-center justify-between gap-4 p-4 outline-none hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand dark:hover:bg-slate-700/40 dark:focus-visible:bg-slate-700/40 sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-gray-900 dark:text-slate-100">{o.eventName || 'Event'}</span>
                    <span className="block text-sm text-gray-600 dark:text-slate-400">
                      {formatEventDate(o.eventDate, o.eventTimezone)} ·{' '}
                      {o.kind === 'APPLICATION'
                        ? `Application${o.description ? ` — ${o.description}` : ''}`
                        : `${o.quantity} ticket${o.quantity === 1 ? '' : 's'}`}
                    </span>
                    <span className="mt-1 block text-xs text-gray-500 dark:text-slate-400">
                      <span className="font-mono">{o.orderRef}</span>
                      {o.statusDetail ? ` · ${o.statusDetail.label}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold tabular-nums text-gray-900 dark:text-slate-100">${o.totalAmount.toFixed(2)}</span>
                    <ChevronRight aria-hidden className="h-4 w-4 text-gray-400 group-hover:text-gray-600 dark:text-slate-500" />
                    <span className="sr-only">{isApplication ? 'View application' : 'View order'}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
