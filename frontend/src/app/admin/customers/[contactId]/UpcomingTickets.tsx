import Link from 'next/link';
import { formatEventDate } from '@/lib/eventTime';

export type UpcomingTicket = {
  id: string;
  ticketNumber?: number | null;
  priceTierName?: string | null;
  status: string;
  redeemedAt: string | null;
  event: { id: string; name: string; date: string; timezone?: string | null };
};

type EventGroup = {
  event: UpcomingTicket['event'];
  tickets: UpcomingTicket[];
};

const statusLabels: Record<string, string> = {
  VALID: 'Active',
  REDEEMED: 'Checked in',
  EXPIRED: 'Expired',
  VOIDED: 'Voided',
};

const statusColors: Record<string, string> = {
  VALID: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  REDEEMED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  EXPIRED: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
  VOIDED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function groupTickets(tickets: UpcomingTicket[]): EventGroup[] {
  const now = Date.now();
  const groups = new Map<string, EventGroup>();
  for (const ticket of tickets) {
    if (new Date(ticket.event.date).getTime() < now) continue;
    const group = groups.get(ticket.event.id) || { event: ticket.event, tickets: [] };
    group.tickets.push(ticket);
    groups.set(ticket.event.id, group);
  }
  return [...groups.values()].sort((a, b) => new Date(a.event.date).getTime() - new Date(b.event.date).getTime());
}

function summary(tickets: UpcomingTicket[]): string[] {
  return ['VALID', 'REDEEMED', 'EXPIRED', 'VOIDED']
    .map((status) => {
      const count = tickets.filter((ticket) => ticket.status === status).length;
      if (!count) return null;
      const label = statusLabels[status].toLowerCase();
      return `${count} ${label}`;
    })
    .filter((value): value is string => Boolean(value));
}

export default function UpcomingTickets({ tickets }: { tickets: UpcomingTicket[] }) {
  const groups = groupTickets(tickets || []);

  return (
    <section className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden" data-testid="upcoming-tickets">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Upcoming tickets</h2>
      </div>
      {groups.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-slate-400">No upcoming tickets.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
          {groups.map(({ event, tickets: eventTickets }) => (
            <div key={event.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/admin/events/${event.id}/edit`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    {event.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{formatEventDate(event.date, event.timezone)} · {eventTickets.length} ticket{eventTickets.length === 1 ? '' : 's'}</p>
                  {summary(eventTickets).length > 0 && <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">{summary(eventTickets).join(' · ')}</p>}
                </div>
              </div>
              <ul className="mt-2 space-y-1.5">
                {eventTickets.map((ticket) => (
                  <li key={ticket.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-gray-700 dark:text-slate-300">
                      {ticket.priceTierName || `Ticket${ticket.ticketNumber ? ` #${ticket.ticketNumber}` : ''}`}
                    </span>
                    <span className="flex items-center gap-2">
                      {ticket.redeemedAt && <span className="text-gray-500 dark:text-slate-400">Checked in {formatDate(ticket.redeemedAt)}</span>}
                      <span className={`rounded-full px-2 py-0.5 font-medium ${statusColors[ticket.status] || 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'}`}>
                        {statusLabels[ticket.status] || ticket.status}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
