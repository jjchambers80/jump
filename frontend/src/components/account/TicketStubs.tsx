'use client';

// The buyer's tickets for this organization, drawn as the storefront's ticket
// stubs (`.event-stub`, shared with `EventStub` and the RSVP pass): a
// brand date tile, a perforation, then the details and the self-serve refund
// (spec 031 — eligibility always comes from the server's `refundPolicy`).

import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { dateTile } from '@/lib/dateTile';
import { formatEventTime } from '@/lib/eventTime';

export interface BuyerTicket {
  id: string;
  ticketNumber: number;
  eventId: string;
  eventName: string;
  eventDate: string;
  /** IANA zone of the event's venue (spec 033). */
  eventTimezone?: string | null;
  venue: string;
  priceTierName?: string;
  status: string;
  pricePaid?: number;
  isRefundable?: boolean;
  /** Self-serve refund policy (spec 031): what the buyer may do right now and on what terms. */
  refundPolicy?: {
    eligible: boolean;
    reason: 'DISABLED' | 'TIER' | 'STATUS' | 'WINDOW_CLOSED' | 'ZERO' | null;
    deadline: string | null;
    fee: number;
    refundAmount: number;
  };
}

const STATUS_LABEL: Record<string, string> = {
  VALID: 'Valid',
  REDEEMED: 'Used',
  EXPIRED: 'Expired',
  VOIDED: 'Void',
};

function formatDateTime(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** One line under a ticket explaining the refund terms; null when there is nothing to say. */
function refundTerms(t: BuyerTicket): string | null {
  const p = t.refundPolicy;
  if (!p || t.status !== 'VALID') return null;
  if (p.eligible) {
    const fee = p.fee > 0 ? ` · $${p.fee.toFixed(2)} fee` : '';
    return `Refundable until ${formatDateTime(p.deadline)}${fee}`;
  }
  if (p.reason === 'WINDOW_CLOSED') return 'Refund window closed';
  if (p.reason === 'TIER' || p.reason === 'DISABLED' || p.reason === 'ZERO') return 'Not refundable';
  return null;
}

/** Upcoming until the end of the event's day, roughly: 12 hours after the start. */
export function isUpcoming(t: Pick<BuyerTicket, 'eventDate'>, now = Date.now()) {
  return new Date(t.eventDate).getTime() > now - 12 * 60 * 60 * 1000;
}

export default function TicketStubs({
  tickets,
  onChanged,
  muted = false,
  labelledBy,
}: {
  tickets: BuyerTicket[];
  /** Called after a refund so the page reloads the list. */
  onChanged: () => Promise<void>;
  /** Past tickets: the date tile drops the brand colour. */
  muted?: boolean;
  labelledBy?: string;
}) {
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundMessage, setRefundMessage] = useState<string | null>(null);

  const requestRefund = async (t: BuyerTicket) => {
    const p = t.refundPolicy;
    const terms =
      p && p.fee > 0
        ? ` You'll receive $${p.refundAmount.toFixed(2)} (a $${p.fee.toFixed(2)} fee is kept).`
        : p
          ? ` You'll receive $${p.refundAmount.toFixed(2)}.`
          : '';
    if (!window.confirm(`Refund ticket #${t.ticketNumber} for ${t.eventName}?${terms} This cannot be undone.`)) return;
    setRefundingId(t.id);
    setRefundMessage(null);
    try {
      const res = await fetch(`/api/buyer/me/tickets/${t.id}/refund`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || 'Refund failed');
      const amount = typeof body.amount === 'number' ? `$${body.amount.toFixed(2)} returns` : 'The amount returns';
      setRefundMessage(`Ticket #${t.ticketNumber} refunded. ${amount} to your original payment method.`);
      await onChanged();
    } catch (err: any) {
      setRefundMessage(err.message);
    } finally {
      setRefundingId(null);
    }
  };

  return (
    <>
      {refundMessage && (
        <p role="status" className="mb-4 rounded-lg bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
          {refundMessage}
        </p>
      )}
      <ul className="space-y-3" aria-labelledby={labelledBy}>
        {tickets.map((t) => {
          const tile = dateTile(t.eventDate, t.eventTimezone);
          const time = formatEventTime(t.eventDate, t.eventTimezone);
          const terms = refundTerms(t);
          const canRefund = t.refundPolicy ? t.refundPolicy.eligible : Boolean(t.isRefundable) && t.status === 'VALID';
          const faded = muted || t.status !== 'VALID';
          return (
            <li key={t.id} className="event-stub-shadow" data-testid="account-ticket">
              <div className="event-stub flex min-h-[7.5rem] overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-gray-200 dark:bg-slate-800 dark:ring-slate-700">
                <div
                  className={`flex w-20 shrink-0 flex-col items-center justify-center px-2 py-4 sm:w-28 ${
                    faded ? 'bg-gray-100 text-gray-600 dark:bg-slate-700/60 dark:text-slate-300' : 'bg-brand text-brand-fg'
                  }`}
                >
                  {tile && (
                    <>
                      <span className="text-[11px] font-bold uppercase tracking-[0.18em]">{tile.month}</span>
                      <span className="text-[32px] font-extrabold leading-none tracking-tight tabular-nums sm:text-[40px]">{tile.day}</span>
                      {/* Past tickets carry the year: "Aug 30" alone is ambiguous a year on. */}
                      <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em]">{muted ? tile.year : tile.weekday}</span>
                    </>
                  )}
                </div>
                <div aria-hidden className="my-3 border-l-2 border-dashed border-gray-200 dark:border-slate-600" />
                <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:pl-6">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-slate-100">
                      {t.eventName} · #{t.ticketNumber}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-gray-600 dark:text-slate-400">
                      <span>{time}</span>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin aria-hidden className="h-3.5 w-3.5" />
                        {t.venue}
                      </span>
                      {t.priceTierName ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>{t.priceTierName}</span>
                        </>
                      ) : null}
                    </p>
                    {terms && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400" data-testid="refund-terms">
                        {terms}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {canRefund && (
                      <button
                        type="button"
                        onClick={() => requestRefund(t)}
                        disabled={refundingId === t.id}
                        className="text-xs font-semibold text-brand-link hover:underline disabled:opacity-60"
                      >
                        {refundingId === t.id ? 'Refunding…' : 'Request refund'}
                      </button>
                    )}
                    {/* An unused ticket to an event that is over is not "Valid" in any useful sense. */}
                    {!(muted && t.status === 'VALID') && (
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        t.status === 'VALID'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
