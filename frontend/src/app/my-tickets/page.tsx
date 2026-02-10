// My Tickets page - Customer purchase history (T125)
// Displays list of tickets grouped by event with event name, date, venue, ticket count

'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ProtectedRoute from '../../components/ProtectedRoute';
import { useSession } from 'next-auth/react';
import ticketService, { Ticket } from '../../services/ticketService';

interface GroupedTickets {
  eventName: string;
  eventDate: string;
  venue: string;
  tickets: Ticket[];
}

function groupTicketsByEvent(tickets: Ticket[]): GroupedTickets[] {
  const groups: Record<string, GroupedTickets> = {};

  tickets.forEach((ticket) => {
    const key = ticket.event?.name || ticket.eventName || 'Unknown Event';
    if (!groups[key]) {
      groups[key] = {
        eventName: ticket.event?.name || ticket.eventName || 'Unknown Event',
        eventDate: ticket.event?.date || ticket.eventDate || '',
        venue: ticket.event?.venue || ticket.venue || '',
        tickets: [],
      };
    }
    groups[key].tickets.push(ticket);
  });

  // Sort groups by event date descending
  return Object.values(groups).sort(
    (a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime()
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isEventPast(dateStr: string): boolean {
  const eventDate = new Date(dateStr);
  const now = new Date();
  return eventDate.getTime() + 60 * 60 * 1000 < now.getTime();
}

function formatPrice(price: number | string): string {
  const numPrice = typeof price === 'string' ? parseFloat(price) : price;
  return `$${(numPrice / 100).toFixed(2)}`;
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const isExpired = ticket.status === 'EXPIRED';
  const eventDate = ticket.event?.date || ticket.eventDate || '';

  return (
    <Link
      href={`/tickets/${ticket.id}`}
      data-testid="ticket-card"
      className={`block rounded-lg border p-4 transition-all duration-200 ${
        isExpired
          ? 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700 opacity-75 hover:opacity-90'
          : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:shadow-md dark:shadow-lg dark:shadow-black/20 hover:border-indigo-300 dark:hover:border-indigo-600'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4
              className={`text-sm font-medium truncate ${isExpired ? 'text-gray-500 dark:text-slate-500' : 'text-gray-900 dark:text-slate-100'}`}
            >
              Ticket #{ticket.id.slice(0, 8)}
            </h4>
            {isExpired ? (
              <span
                data-testid="expired-badge"
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-400"
              >
                Expired
              </span>
            ) : ticket.status === 'REDEEMED' ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400">
                Redeemed
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                Valid
              </span>
            )}
          </div>
          <p
            className={`text-xs ${isExpired ? 'text-gray-400 dark:text-slate-500' : 'text-gray-500 dark:text-slate-500'}`}
          >
            Purchased{' '}
            {new Date(ticket.purchaseTime || ticket.purchaseDate || '').toLocaleDateString()}
          </p>
        </div>
        <div className="text-right ml-4">
          <p
            className={`text-sm font-semibold ${isExpired ? 'text-gray-400 dark:text-slate-500' : 'text-gray-900 dark:text-slate-100'}`}
          >
            {formatPrice(ticket.pricePaid)}
          </p>
          <svg
            className={`w-4 h-4 ml-auto mt-1 ${isExpired ? 'text-gray-300 dark:text-slate-600' : 'text-gray-400 dark:text-slate-500'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}

function EventGroup({ group }: { group: GroupedTickets }) {
  const past = isEventPast(group.eventDate);

  return (
    <div
      className={`rounded-xl border ${past ? 'border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-900/50' : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800'} overflow-hidden`}
    >
      {/* Event Header */}
      <div
        className={`px-5 py-4 border-b ${past ? 'border-gray-200 dark:border-slate-700 bg-gray-100/50 dark:bg-slate-800/50' : 'border-gray-100 dark:border-slate-700 bg-gradient-to-r from-indigo-50 dark:from-indigo-900/20 to-white dark:to-slate-800'}`}
      >
        <h3
          className={`text-lg font-bold ${past ? 'text-gray-500 dark:text-slate-500' : 'text-gray-900 dark:text-slate-100'}`}
        >
          {group.eventName}
        </h3>
        <div className="flex flex-wrap gap-4 mt-1 text-sm">
          <span
            className={`flex items-center gap-1 ${past ? 'text-gray-400 dark:text-slate-500' : 'text-gray-600 dark:text-slate-400'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            {formatDate(group.eventDate)} at {formatTime(group.eventDate)}
          </span>
          <span
            className={`flex items-center gap-1 ${past ? 'text-gray-400 dark:text-slate-500' : 'text-gray-600 dark:text-slate-400'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            {group.venue}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${past ? 'bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-slate-500' : 'bg-indigo-100 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'}`}
          >
            {group.tickets.length} ticket{group.tickets.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Ticket List */}
      <div className="divide-y divide-gray-100 dark:divide-slate-700 p-3">
        {group.tickets.map((ticket) => (
          <div key={ticket.id} className="py-1 first:pt-0 last:pb-0">
            <TicketCard ticket={ticket} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MyTicketsContent() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: session } = useSession();
  const user = session?.user;

  useEffect(() => {
    async function fetchTickets() {
      try {
        setLoading(true);
        const data = await ticketService.getMyTickets();
        setTickets(data.tickets || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load tickets');
      } finally {
        setLoading(false);
      }
    }

    fetchTickets();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 dark:border-indigo-400 mx-auto" />
          <p className="mt-3 text-gray-500 dark:text-slate-500">Loading your tickets...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-red-500 text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-2">
            Something went wrong
          </h2>
          <p className="text-gray-600 dark:text-slate-400 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const grouped = groupTicketsByEvent(tickets);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 shadow-sm dark:shadow-lg dark:shadow-black/20 border-b dark:border-slate-700">
        <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">My Tickets</h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-500">
                {user?.name ? `Welcome back, ${user.name}` : 'Your purchase history'}
              </p>
            </div>
            <Link
              href="/events"
              className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-slate-600 text-sm font-medium rounded-lg text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 transition"
            >
              Browse Events
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {grouped.length === 0 ? (
          <div className="text-center py-16">
            <svg
              className="w-16 h-16 text-gray-300 dark:text-slate-600 mx-auto mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 dark:text-slate-100 mb-2">
              No tickets yet
            </h3>
            <p className="text-gray-500 dark:text-slate-500 mb-6">
              When you purchase tickets for events, they&apos;ll appear here.
            </p>
            <Link
              href="/events"
              className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition"
            >
              Browse Events
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <EventGroup key={group.eventName} group={group} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MyTicketsPage() {
  return (
    <ProtectedRoute>
      <MyTicketsContent />
    </ProtectedRoute>
  );
}
