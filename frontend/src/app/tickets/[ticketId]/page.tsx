// Ticket Detail page - Single ticket with QR code, event details, expired badge (T126, T130, T131)
// Shows full QR code, event details, purchase timestamp, expired badge if applicable per FR-018

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ProtectedRoute from '../../../components/ProtectedRoute';
import ticketService, { Ticket } from '../../../services/ticketService';

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

function formatPrice(price: number | string): string {
  const numPrice = typeof price === 'string' ? parseFloat(price) : price;
  return `$${Number(numPrice).toFixed(2)}`;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'EXPIRED':
      return (
        <span
          data-testid="expired-badge"
          className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-400"
        >
          <svg className="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
              clipRule="evenodd"
            />
          </svg>
          Expired
        </span>
      );
    case 'REDEEMED':
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
          <svg className="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          Redeemed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
          <svg className="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          Valid
        </span>
      );
  }
}

function TicketDetailContent() {
  const params = useParams();
  const router = useRouter();
  const ticketId = params.ticketId as string;
  const qrRef = useRef<HTMLImageElement>(null);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTicket() {
      try {
        setLoading(true);
        const data = await ticketService.getTicketById(ticketId);
        setTicket(data);
      } catch (err: any) {
        if (err.status === 404) {
          setError('Ticket not found');
        } else if (err.status === 403) {
          setError('You do not have access to this ticket');
        } else {
          setError(err.message || 'Failed to load ticket');
        }
      } finally {
        setLoading(false);
      }
    }

    if (ticketId) {
      fetchTicket();
    }
  }, [ticketId]);

  const handleDownloadQR = useCallback(() => {
    if (!ticket?.qrCode) return;

    const link = document.createElement('a');
    link.href = ticket.qrCode;
    link.download = `ticket-${ticket.ticketNumber}-qr.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [ticket]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-3 text-gray-500 dark:text-slate-500">Loading ticket...</p>
        </div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-red-500 text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-2">
            {error || 'Ticket not found'}
          </h2>
          <Link
            href="/my-tickets"
            className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition mt-4"
          >
            ← Back to My Tickets
          </Link>
        </div>
      </div>
    );
  }

  const isExpired = ticket.status === 'EXPIRED';
  const eventName = ticket.event?.name || ticket.eventName || 'Unknown Event';
  const eventDate = ticket.event?.date || ticket.eventDate || '';
  const venue = ticket.event?.venue || ticket.venue || '';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 shadow-sm border-b dark:border-slate-700">
        <div className="max-w-2xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <Link
            href="/my-tickets"
            className="inline-flex items-center text-sm text-gray-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to My Tickets
          </Link>
        </div>
      </div>

      {/* Ticket Card */}
      <div className="max-w-2xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div
          className={`bg-white dark:bg-slate-800 rounded-2xl shadow-lg dark:shadow-lg dark:shadow-black/20 overflow-hidden ${isExpired ? 'opacity-80' : ''}`}
        >
          {/* Event Info Header */}
          <div
            className={`px-6 py-5 ${isExpired ? 'bg-gray-100 dark:bg-slate-700' : 'bg-gradient-to-r from-indigo-600 to-purple-600'}`}
          >
            <div className="flex items-center justify-between">
              <h2
                data-testid="ticket-event-name"
                className={`text-xl font-bold ${isExpired ? 'text-gray-500 dark:text-slate-500' : 'text-white'}`}
              >
                {eventName}
              </h2>
              <div className="flex items-center gap-2">
                {ticket.saleStatus === 'ENDED' && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-200 dark:bg-slate-600 text-gray-600 dark:text-slate-300">
                    Sale Ended
                  </span>
                )}
                <StatusBadge status={ticket.status} />
              </div>
            </div>
            <div className="mt-2 space-y-1">
              <p
                data-testid="ticket-event-date"
                className={`text-sm flex items-center gap-1.5 ${isExpired ? 'text-gray-400 dark:text-slate-500' : 'text-indigo-100'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                {formatDate(eventDate)} at {formatTime(eventDate)}
              </p>
              <p
                data-testid="ticket-venue"
                className={`text-sm flex items-center gap-1.5 ${isExpired ? 'text-gray-400 dark:text-slate-500' : 'text-indigo-100'}`}
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
                {venue}
              </p>
            </div>
          </div>

          {/* QR Code Section */}
          <div className="px-6 py-8 flex flex-col items-center border-b border-gray-100 dark:border-slate-700">
            {ticket.qrCode ? (
              <div
                data-testid="qr-code"
                className={`p-4 bg-white dark:bg-slate-800 rounded-xl border-2 ${isExpired ? 'border-gray-200 dark:border-slate-700' : 'border-indigo-100 dark:border-indigo-900/50'} shadow-sm`}
              >
                <img
                  ref={qrRef}
                  src={ticket.qrCode}
                  alt={`QR Code for Ticket #${ticket.ticketNumber}`}
                  className={`w-48 h-48 ${isExpired ? 'grayscale opacity-50' : ''}`}
                />
              </div>
            ) : (
              <div
                data-testid="qr-code"
                className="w-48 h-48 bg-gray-100 dark:bg-slate-700 rounded-xl flex items-center justify-center"
              >
                <p className="text-gray-400 dark:text-slate-500 text-sm">QR Code unavailable</p>
              </div>
            )}

            {isExpired && (
              <p className="mt-3 text-sm text-gray-500 dark:text-slate-500 font-medium">
                This ticket has expired and is no longer valid for entry
              </p>
            )}

            {ticket.qrCode && !isExpired && (
              <button
                data-testid="download-qr-button"
                onClick={handleDownloadQR}
                className="mt-4 inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition shadow-sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Download QR Code
              </button>
            )}
          </div>

          {/* Refund Policy Badge */}
          <div className="px-6 pt-4">
            {ticket.isRefundable === false && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                <svg className="w-3.5 h-3.5 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                NON-REFUNDABLE
              </span>
            )}
            {ticket.isRefundable === true && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800">
                Refundable
              </span>
            )}
          </div>

          {/* Tier Description */}
          {ticket.priceTierDescription && (
            <div className="px-6 pt-3">
              <p className="text-sm text-gray-600 dark:text-slate-400 italic">{ticket.priceTierDescription}</p>
            </div>
          )}

          {/* Ticket Details */}
          <div className="px-6 py-5">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-slate-500 uppercase tracking-wide mb-3">
              Ticket Details
            </h3>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-xs font-medium text-gray-400 dark:text-slate-500">Ticket Number</dt>
                <dd className="mt-0.5 text-sm text-gray-900 dark:text-slate-100 font-semibold">
                  #{ticket.ticketNumber}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-400 dark:text-slate-500">Status</dt>
                <dd className="mt-0.5 text-sm text-gray-900 dark:text-slate-100 capitalize">
                  {ticket.status.toLowerCase()}
                </dd>
              </div>
              <div>
                <dt
                  className="text-xs font-medium text-gray-400 dark:text-slate-500"
                  data-testid="ticket-price"
                >
                  Price Paid
                </dt>
                <dd className="mt-0.5 text-sm text-gray-900 dark:text-slate-100 font-semibold">
                  {formatPrice(ticket.pricePaid)}
                </dd>
                {ticket.priceBreakdown && ticket.priceBreakdown.platformFee > 0 && (
                  <dd className="mt-0.5 text-xs text-gray-400 dark:text-slate-500">
                    Includes Base: {formatPrice(ticket.priceBreakdown.subtotal)}
                    {ticket.priceBreakdown.platformFee > 0 && <>, Fees: {formatPrice(ticket.priceBreakdown.platformFee + ticket.priceBreakdown.processingFee)}</>}
                    {ticket.priceBreakdown.tax > 0 && <>, Tax: {formatPrice(ticket.priceBreakdown.tax)}</>}
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-400 dark:text-slate-500">Purchased</dt>
                <dd className="mt-0.5 text-sm text-gray-900 dark:text-slate-100">
                  {new Date(ticket.purchaseTime || ticket.purchaseDate || '').toLocaleDateString(
                    'en-US',
                    {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }
                  )}
                </dd>
              </div>
              {ticket.saleEndDate && (
                <div>
                  <dt className="text-xs font-medium text-gray-400 dark:text-slate-500">Sale End Date</dt>
                  <dd className="mt-0.5 text-sm text-gray-900 dark:text-slate-100">
                    {new Date(ticket.saleEndDate).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TicketDetailPage() {
  return (
    <ProtectedRoute>
      <TicketDetailContent />
    </ProtectedRoute>
  );
}
