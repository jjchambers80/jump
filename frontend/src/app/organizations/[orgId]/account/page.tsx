// Buyer account page for one organization (spec 007 phase 2).
// Passwordless: signed out → email form that sends a magic link; signed in →
// this organization's orders and tickets only. The session cookie is
// httpOnly and handled by /api/buyer/* route handlers.
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { rememberNext, safeNextPath } from '@/lib/buyerNext';
import { api } from '../../../../services/api';
import { resolveAssetUrl } from '../../../../lib/assets';
import BrandScope from '../../../../components/BrandScope';
import ApplicationsSection from './ApplicationsSection';
import ApplicantProfileSection from './ApplicantProfileSection';
import type { ThemeMode } from '@/lib/theme';

interface OrganizationPublic {
  id: string;
  name: string;
  logoUrl: string | null;
  brandColor?: string | null;
  themeMode?: ThemeMode | null;
}

interface BuyerProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organization: { id: string; name: string };
}

interface OrderSummary {
  id: string;
  orderRef: string;
  /** TICKET or APPLICATION (spec 024): an application order links to the application, not a ticket page. */
  kind?: 'TICKET' | 'APPLICATION';
  applicationId?: string | null;
  description?: string;
  eventName?: string;
  eventDate?: string;
  quantity: number;
  totalAmount: number;
  status: string;
  statusDetail?: { label: string } | null;
  createdAt: string;
}

interface BuyerTicket {
  id: string;
  ticketNumber: number;
  eventId: string;
  eventName: string;
  eventDate: string;
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

function formatDate(value?: string) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function BuyerAccountPage({ params }: { params: { orgId: string } }) {
  const router = useRouter();
  // Spec 031: ?next=<same-origin path> — where to go once signed in (checkout
  // sends buyers here). Read once from the URL so a later re-render cannot
  // resurrect it; kept in sessionStorage across the magic-link round trip.
  const nextPath = useRef<string | null>(null);
  if (nextPath.current === null && typeof window !== 'undefined') {
    nextPath.current = safeNextPath(new URLSearchParams(window.location.search).get('next')) ?? '';
  }
  const [org, setOrg] = useState<OrganizationPublic | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [tickets, setTickets] = useState<BuyerTicket[]>([]);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    const me = await fetch('/api/buyer/me', { cache: 'no-store' });
    if (!me.ok) {
      setProfile(null);
      return;
    }
    const data: BuyerProfile = await me.json();
    // One cookie on the shared Jump domain; a session for another org counts as signed out here.
    if (data.organization?.id !== params.orgId) {
      setProfile(null);
      return;
    }
    if (nextPath.current) {
      // Already signed in here: continue where the buyer was going.
      const target = nextPath.current;
      nextPath.current = '';
      router.replace(target);
      return;
    }
    setProfile(data);
    const [o, t] = await Promise.all([
      fetch('/api/buyer/me/orders', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { data: [] })),
      fetch('/api/buyer/me/tickets', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { data: [] })),
    ]);
    setOrders(o.data || []);
    setTickets(t.data || []);
  }, [params.orgId, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.get<{ organization: OrganizationPublic }>(
          `/organizations/${params.orgId}/public`
        );
        if (!cancelled) setOrg(result.organization);
        await loadSession();
      } catch (err: any) {
        if (!cancelled) setOrgError(err.message || 'Organization not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.orgId, loadSession]);

  const requestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError('Please enter a valid email address');
      return;
    }
    setFormError(null);
    setSending(true);
    rememberNext(nextPath.current || null);
    try {
      const res = await fetch('/api/buyer/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: params.orgId, email: email.trim().toLowerCase() }),
      });
      if (!res.ok && res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not send sign-in link');
      }
      setSent(true);
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSending(false);
    }
  };

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
      await loadSession();
    } catch (err: any) {
      setRefundMessage(err.message);
    } finally {
      setRefundingId(null);
    }
  };

  const signOut = async () => {
    await fetch('/api/buyer/logout', { method: 'POST' });
    setProfile(null);
    setOrders([]);
    setTickets([]);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <p className="text-gray-600 dark:text-slate-400">Loading...</p>
      </div>
    );
  }

  if (orgError || !org) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-8 max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">Organization Not Found</h2>
          <p className="text-gray-600 dark:text-slate-400">{orgError || 'This organization does not exist.'}</p>
        </div>
      </div>
    );
  }

  const logoSrc = resolveAssetUrl(org.logoUrl);

  return (
    <BrandScope color={org.brandColor} themeMode={org.themeMode} className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link
          href={`/organizations/${org.id}`}
          className="mb-6 inline-flex items-center text-brand-link hover:opacity-80 font-semibold transition-opacity"
        >
          ← Back to {org.name}
        </Link>

        <div className="flex items-center gap-4 mb-8">
          {logoSrc ? (
            <img src={logoSrc} alt={`${org.name} logo`} className="h-12 w-auto rounded object-contain" />
          ) : null}
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Your tickets with {org.name}</h1>
            {profile && (
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Signed in as {profile.email} ·{' '}
                <button type="button" onClick={signOut} className="text-brand-link hover:underline">
                  Sign out
                </button>
              </p>
            )}
          </div>
        </div>

        {!profile ? (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 md:p-8">
            {sent ? (
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">Check your email</h2>
                <p className="text-gray-600 dark:text-slate-400">
                  If <strong>{email}</strong> has an account with {org.name}, a sign-in link is on its way. It works once
                  and expires in 15 minutes.
                </p>
                <button
                  type="button"
                  onClick={() => setSent(false)}
                  className="mt-6 text-brand-link hover:underline text-sm font-semibold"
                >
                  Use a different email
                </button>
              </div>
            ) : (
              <form onSubmit={requestLink} noValidate>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-1">Sign in</h2>
                <p className="text-gray-600 dark:text-slate-400 mb-6">
                  No password. Enter the email you used at checkout and we&apos;ll send you a sign-in link.
                </p>
                <label htmlFor="buyer-email" className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                  Email Address
                </label>
                <input
                  id="buyer-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFormError(null);
                  }}
                  disabled={sending}
                  className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand dark:bg-slate-700 dark:text-slate-100 ${
                    formError ? 'border-red-500' : 'border-gray-300 dark:border-slate-600'
                  }`}
                  placeholder="your.email@example.com"
                />
                {formError && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{formError}</p>}
                <button
                  type="submit"
                  disabled={sending}
                  className="mt-6 w-full py-3 rounded-lg font-semibold bg-brand hover:bg-brand-hover text-brand-fg disabled:opacity-60 transition-colors"
                >
                  {sending ? 'Sending...' : 'Email me a sign-in link'}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            <ApplicationsSection />
            <ApplicantProfileSection />
            <section>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">Orders</h2>
              {orders.length === 0 ? (
                <p className="text-gray-600 dark:text-slate-400">No orders yet.</p>
              ) : (
                <ul className="space-y-3">
                  {orders.map((o) => (
                    <li key={o.id} className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 flex items-center justify-between gap-4" data-testid="account-order" data-kind={o.kind ?? 'TICKET'}>
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-slate-100">{o.eventName || 'Event'}</p>
                        <p className="text-sm text-gray-600 dark:text-slate-400">
                          {formatDate(o.eventDate)} ·{' '}
                          {o.kind === 'APPLICATION' ? `Application${o.description ? ` — ${o.description}` : ''}` : `${o.quantity} ticket${o.quantity === 1 ? '' : 's'}`} · $
                          {o.totalAmount.toFixed(2)} · {o.orderRef}
                          {o.statusDetail ? ` · ${o.statusDetail.label}` : ''}
                        </p>
                      </div>
                      {o.kind === 'APPLICATION' && o.applicationId ? (
                        <a href="#applications" className="text-brand-link hover:underline text-sm font-semibold whitespace-nowrap">
                          View application
                        </a>
                      ) : (
                        <Link href={`/orders/${o.id}`} className="text-brand-link hover:underline text-sm font-semibold whitespace-nowrap">
                          View order
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">Tickets</h2>
              {refundMessage && (
                <p role="status" className="mb-3 text-sm text-gray-700 dark:text-slate-300">{refundMessage}</p>
              )}
              {tickets.length === 0 ? (
                <p className="text-gray-600 dark:text-slate-400">No tickets yet.</p>
              ) : (
                <ul className="space-y-3">
                  {tickets.map((t) => (
                    <li key={t.id} className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-slate-100">
                          {t.eventName} · #{t.ticketNumber}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-slate-400">
                          {formatDate(t.eventDate)} · {t.venue}
                          {t.priceTierName ? ` · ${t.priceTierName}` : ''}
                        </p>
                        {refundTerms(t) && (
                          <p className="text-xs text-gray-500 dark:text-slate-500" data-testid="refund-terms">
                            {refundTerms(t)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {(t.refundPolicy ? t.refundPolicy.eligible : t.isRefundable && t.status === 'VALID') && (
                          <button
                            type="button"
                            onClick={() => requestRefund(t)}
                            disabled={refundingId === t.id}
                            className="text-xs font-semibold text-brand-link hover:underline disabled:opacity-60"
                          >
                            {refundingId === t.id ? 'Refunding…' : 'Request refund'}
                          </button>
                        )}
                        <span
                          className={`text-xs font-semibold px-2 py-1 rounded ${
                            t.status === 'VALID'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                              : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </BrandScope>
  );
}
