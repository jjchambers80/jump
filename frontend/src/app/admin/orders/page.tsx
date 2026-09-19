'use client';

// Orders (spec 024 phase 2): the one money surface. "Orders" lists one row
// per order — ticket purchases and paid applications alike; "Tickets" is the
// ticket-level view (purchaser / attendee / barcode / check-in) the page had
// before. The choice is remembered per browser.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import OrdersListView from './OrdersListView';
import TicketRowsView from './TicketRowsView';

type View = 'orders' | 'tickets';
const STORAGE_KEY = 'jump.admin.orders.view';

export default function AdminOrdersPage() {
  const [view, setView] = useState<View>('orders');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'tickets' || saved === 'orders') setView(saved);
    } catch {
      // storage unavailable: default view
    }
  }, []);

  const choose = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
            <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Orders</h1>
          <div role="tablist" aria-label="View" className="ml-3 inline-flex rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5">
            {(
              [
                ['orders', 'Orders'],
                ['tickets', 'Tickets'],
              ] as [View, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                data-testid={`orders-view-${key}`}
                onClick={() => choose(key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  view === key ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Link
          href="/admin/orders/scan"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
          Check In
        </Link>
      </div>

      {view === 'orders' ? <OrdersListView /> : <TicketRowsView />}
    </div>
  );
}
