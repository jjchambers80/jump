'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '../../services/api';
import { TicketDisplay } from '../../components/TicketDisplay';

interface Ticket {
  id: string;
  status: string;
  qrCode: string;
  event: {
    id: string;
    name: string;
    date: string;
    venue: string;
  };
  customer?: {
    email: string;
  };
  pricePaid: string;
  purchaseTime: string;
}

interface ConfirmationPageProps {
  searchParams: { session_id?: string };
}

export default function ConfirmationPage({ searchParams }: ConfirmationPageProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sessionId = searchParams.session_id;

  useEffect(() => {
    if (!sessionId) {
      setError('No session ID provided');
      setLoading(false);
      return;
    }

    fetchTickets();
  }, [sessionId]);

  const fetchTickets = async () => {
    if (!sessionId) return;

    try {
      setLoading(true);
      setError(null);

      const response = await api.get<{ tickets: Ticket[] }>(
        `/tickets/confirm?session_id=${sessionId}`
      );

      setTickets(response.tickets);
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve tickets');
      console.error('Error fetching tickets:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <svg
            className="animate-spin h-12 w-12 text-blue-600 dark:text-indigo-400 mx-auto mb-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <p className="text-gray-600 dark:text-slate-400">Retrieving your tickets...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md dark:shadow-lg dark:shadow-black/20 p-8 max-w-md w-full text-center">
          <div className="text-red-600 mb-4">
            <svg
              className="w-16 h-16 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">
            Unable to Retrieve Tickets
          </h2>
          <p className="text-gray-600 dark:text-slate-400 mb-6">{error}</p>
          <Link
            href="/events"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded transition-colors duration-200"
          >
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg dark:shadow-lg dark:shadow-black/20 p-8 mb-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full mb-4">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">
              Purchase Successful!
            </h1>
            <p className="text-gray-600 dark:text-slate-400 text-lg">
              Your tickets have been sent to{' '}
              <span className="font-semibold">{tickets[0]?.customer?.email || 'your email'}</span>
            </p>
          </div>

          <div className="border-t border-gray-200 dark:border-slate-700 pt-8">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-4">
              Your Tickets
            </h2>
            <p className="text-gray-600 dark:text-slate-400 mb-6">
              Please save these tickets. You'll need to present them at the event entrance.
            </p>

            <div className="space-y-6">
              {tickets.map((ticket) => (
                <TicketDisplay key={ticket.id} ticket={ticket} />
              ))}
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200 dark:border-slate-700">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-slate-600 rounded-lg p-4 mb-6">
              <div className="flex items-start">
                <svg
                  className="w-5 h-5 text-blue-600 dark:text-indigo-400 mt-0.5 mr-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div className="text-blue-800 dark:text-blue-300">
                  <p className="font-semibold mb-1">Important Information:</p>
                  <ul className="list-disc list-inside text-sm space-y-1">
                    <li>A confirmation email has been sent to your email address</li>
                    <li>Save or screenshot these tickets for event entry</li>
                    <li>Arrive at least 30 minutes before the event starts</li>
                    <li>Present your QR code at the entrance for scanning</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="text-center">
              <Link
                href="/events"
                className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg transition-colors duration-200"
              >
                Browse More Events
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
