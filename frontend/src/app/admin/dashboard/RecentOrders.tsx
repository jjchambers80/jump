// Latest paid orders, tickets and applications alike (one ledger, spec 024).
// Times are relative; the exact moment is in the viewer's account zone.

import Link from 'next/link';
import { Receipt } from 'lucide-react';
import type { DashboardOverview } from '@/services/adminService';
import { useAccountFormat } from '@/lib/accountFormat';
import { Panel, PanelLink, Skeleton, formatMoney, timeAgo } from './ui';

type Order = DashboardOverview['recentOrders'][number];

function orderSummary(order: Order) {
  if (order.kind === 'APPLICATION') return 'Application';
  return `${order.quantity} ${order.quantity === 1 ? 'ticket' : 'tickets'}`;
}

export default function RecentOrders({ orders }: { orders: Order[] | null }) {
  const { formatDateTime } = useAccountFormat();

  return (
    <Panel
      id="recent-orders-heading"
      title="Recent orders"
      icon={<Receipt className="h-4 w-4 text-gray-500 dark:text-slate-400" aria-hidden="true" />}
      action={<PanelLink href="/admin/orders" label="View all orders" />}
    >
      {!orders ? (
        <div className="space-y-4 p-4 sm:px-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex justify-between gap-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      ) : orders.length === 0 ? (
        <p className="px-4 py-5 text-sm text-gray-500 dark:text-slate-400 sm:px-5">
          No orders yet. They show up here the moment someone checks out.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-slate-700" data-testid="recent-orders">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/admin/orders/${order.id}`}
                className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500 dark:hover:bg-slate-700/50 dark:focus-visible:bg-slate-700/50 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{order.buyer}</p>
                  <p className="truncate text-xs text-gray-500 dark:text-slate-400">
                    {orderSummary(order)}
                    {order.eventName && ` · ${order.eventName}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{formatMoney(order.total, 2)}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    <time dateTime={order.at} title={formatDateTime(order.at)}>
                      {timeAgo(order.at)}
                    </time>
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
