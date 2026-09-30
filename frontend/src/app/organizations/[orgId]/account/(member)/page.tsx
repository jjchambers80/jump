// Account overview (spec 040): what the buyer needs next — applications
// waiting on them, then upcoming tickets, then past ones.
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Ticket } from 'lucide-react';
import { storefrontHref } from '@/lib/storefrontPath';
import { needsSpaceChoice } from '@/lib/applications';
import { formatEventDate } from '@/lib/eventTime';
import { useAccount } from '@/components/account/AccountContext';
import TicketStubs, { isUpcoming, type BuyerTicket } from '@/components/account/TicketStubs';

export default function AccountOverviewPage() {
  const { org, applications, reloadApplications, href } = useAccount();
  const [tickets, setTickets] = useState<BuyerTicket[] | null>(null);

  const loadTickets = useCallback(async () => {
    const res = await fetch('/api/buyer/me/tickets', { cache: 'no-store' }).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    setTickets(body?.data ?? []);
  }, []);

  useEffect(() => {
    void loadTickets();
    // Payments made on the Applications page change what needs action here.
    void reloadApplications();
  }, [loadTickets, reloadApplications]);

  const waiting = (applications ?? []).filter((a) => needsSpaceChoice(a) || a.canPay);
  const upcoming = (tickets ?? []).filter((t) => isUpcoming(t));
  const past = (tickets ?? []).filter((t) => !isUpcoming(t));

  return (
    <div className="space-y-10">
      {waiting.length > 0 && (
        <section aria-labelledby="account-action-heading" data-testid="account-action-needed">
          <h2 id="account-action-heading" className="sr-only">
            Needs your attention
          </h2>
          <ul className="space-y-3">
            {waiting.map((a) => (
              <li key={a.id}>
                <Link
                  href={href('applications')}
                  className="group flex items-center justify-between gap-4 rounded-2xl border-l-4 border-brand bg-white p-4 shadow-sm ring-1 ring-gray-200 outline-none focus-visible:ring-2 focus-visible:ring-brand dark:bg-slate-800 dark:ring-slate-700"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-bold uppercase tracking-[0.16em] text-brand-link">
                      {needsSpaceChoice(a) ? (a.selection?.state === 'HELD' ? 'Finish paying' : 'Choose your space') : 'Payment due'}
                    </span>
                    <span className="mt-0.5 block font-semibold text-gray-900 dark:text-slate-100">
                      {a.event.name} · {a.form.name}
                    </span>
                    <span className="block text-sm text-gray-600 dark:text-slate-400">
                      {formatEventDate(a.event.date, a.event.timezone)}
                    </span>
                  </span>
                  <ArrowRight aria-hidden className="h-5 w-5 shrink-0 text-brand-link transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="account-upcoming-heading">
        <h2 id="account-upcoming-heading" className="mb-4 text-lg font-semibold text-gray-900 dark:text-slate-100">
          Upcoming
        </h2>
        {tickets === null ? (
          <p className="text-gray-600 dark:text-slate-400">Loading tickets…</p>
        ) : upcoming.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-gray-300 p-6 dark:border-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-3 text-gray-600 dark:text-slate-400">
              <Ticket aria-hidden className="h-5 w-5 shrink-0 text-gray-400 dark:text-slate-500" />
              No upcoming tickets.
            </p>
            <Link
              href={storefrontHref(`/organizations/${org.id}`, org.id)}
              className="text-sm font-semibold text-brand-link hover:underline"
            >
              See what&apos;s on at {org.name}
            </Link>
          </div>
        ) : (
          <TicketStubs tickets={upcoming} onChanged={loadTickets} labelledBy="account-upcoming-heading" />
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="account-past-heading">
          <h2 id="account-past-heading" className="mb-4 text-lg font-semibold text-gray-900 dark:text-slate-100">
            Past
          </h2>
          <TicketStubs tickets={past} onChanged={loadTickets} muted labelledBy="account-past-heading" />
        </section>
      )}
    </div>
  );
}
