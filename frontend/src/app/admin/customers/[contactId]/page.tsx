'use client';

import React, { Suspense, useEffect, useState, useCallback, useRef, FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { resolveAssetUrl } from '@/lib/assets';
import { fieldClass, formAlertClass, hintClass } from '@/app/admin/settings/formShared';
import { ChevronRightIcon, EllipsisIcon } from '@/app/admin/settings/icons';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import CustomerTimeline from './CustomerTimeline';
import UpcomingTickets, { type UpcomingTicket } from './UpcomingTickets';
import { segmentBadgeClass, type CustomerSegment } from '@/lib/customers';
import { formatEventDateTime } from '@/lib/eventTime';

// ── Types ──────────────────────────────────────────────────────────────────

interface OrderEvent {
  id: string;
  name: string;
  date: string;
  logoUrl: string | null;
  /** IANA zone of the event's venue (spec 033). */
  timezone?: string | null;
}

interface CustomerOrder {
  id: string;
  orderRef: string;
  kind?: 'TICKET' | 'APPLICATION';
  applicationId?: string | null;
  totalAmount: number;
  quantity: number;
  status: string;
  createdAt: string;
  ticketCount: number;
  event: OrderEvent;
}

interface CustomerApplication {
  id: string;
  eventId: string;
  form: { id: string; name: string; kind: 'PAID' | 'FREE' };
  tier: { id: string; name: string } | null;
  businessName: string | null;
  status: string;
  paymentStatus: string;
  paymentSource: 'stripe' | 'offline';
  applicantPays: number;
  refunded: number;
  paidAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  event: OrderEvent;
  detailUrl: string;
  orderId?: string;
  orderRef?: string;
}

interface CustomerRsvp {
  id: string;
  partySize: number;
  status: 'GOING' | 'CANCELLED';
  createdAt: string;
  cancelledAt: string | null;
  event: OrderEvent;
}

interface CustomerDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  location: string | null;
  note: string | null;
  emailSubscribed: boolean;
  emailSubscribedAt: string | null;
  emailSubscribedSource: string | null;
  emailUnsubscribedAt: string | null;
  accountCreatedAt: string | null;
  lastSignInAt: string | null;
  accountUrl: string | null;
  tags: string[];
  segment: CustomerSegment | null;
  prevId?: string | null;
  nextId?: string | null;
  upcomingTickets?: UpcomingTicket[];
  createdAt: string;
  transactionCount: number;
  ticketOrderCount: number;
  applicationCount: number;
  totalSpent: number;
  totalRefunded: number;
  lastActivityAt: string | null;
  orders: CustomerOrder[];
  applications: CustomerApplication[];
  rsvps: CustomerRsvp[];
}

// ── Tag helpers ───────────────────────────────────────────────────────────

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;
function addTag(list: string[], raw: string): string[] {
  const tag = raw.trim().replace(/\s+/g, ' ');
  if (!tag) return list;
  if (list.some((t) => t.toLowerCase() === tag.toLowerCase())) return list;
  return [...list, tag];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    REFUNDED: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    PARTIALLY_REFUNDED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    PAID: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  };
  const label = status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.PENDING}`}>
      {label}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

function CustomerDetailPageContent() {
  const { contactId } = useParams<{ contactId: string }>();
  const searchParams = useSearchParams();
  const { selectedOrgId } = useOrg();
  const listQuery = searchParams.toString();

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline editing state
  const [editingField, setEditingField] = useState<'note' | 'location' | 'phone' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Name dialog state
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Tags dialog state
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [tagInputTags, setTagInputTags] = useState<string[]>([]);
  const [tagInputDraft, setTagInputDraft] = useState('');
  const [tagSaving, setTagSaving] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Account card state
  const [signInLinkSending, setSignInLinkSending] = useState(false);
  const [signInLinkResult, setSignInLinkResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [accountUrlCopied, setAccountUrlCopied] = useState(false);

  // Actions menu state
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  const fetchCustomer = useCallback(async () => {
    if (!selectedOrgId || !contactId) return;
    try {
      setLoading(true);
      setError(null);
      const result = await api.get<CustomerDetail>(`/admin/customers/${contactId}${listQuery ? `?${listQuery}` : ''}`);
      setCustomer(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load customer');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, contactId, listQuery]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  const customerHref = (id: string) => `/admin/customers/${id}${listQuery ? `?${listQuery}` : ''}`;
  const customersHref = `/admin/customers${listQuery ? `?${listQuery}` : ''}`;

  // Close actions menu on outside click
  useEffect(() => {
    if (!actionsMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setActionsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [actionsMenuOpen]);

  // ── Inline edit handlers ──────────────────────────────────────────────

  const startEdit = (field: 'note' | 'location' | 'phone') => {
    if (!customer) return;
    setEditingField(field);
    if (field === 'note') setEditValue(customer.note || '');
    else if (field === 'phone') setEditValue(customer.phone || '');
    else setEditValue(customer.location || '');
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const saveEdit = async () => {
    if (!customer || !editingField) return;
    try {
      setSaving(true);
      await api.patch(`/admin/customers/${customer.id}`, { [editingField]: editValue || null });
      setCustomer({ ...customer, [editingField]: editValue || null });
      cancelEdit();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle subscription ───────────────────────────────────────────────

  const toggleSubscription = async () => {
    if (!customer) return;
    try {
      const newValue = !customer.emailSubscribed;
      await api.patch(`/admin/customers/${customer.id}`, { emailSubscribed: newValue });
      const updated = await api.get<CustomerDetail>(`/admin/customers/${customer.id}`);
      setCustomer(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to update subscription');
    }
  };

  // ── Copy email ────────────────────────────────────────────────────────

  const copyEmail = () => {
    if (!customer) return;
    navigator.clipboard.writeText(customer.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Name dialog submit ────────────────────────────────────────────────

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (nameSaving || !customer) return;
    const fnInput = (e.target as HTMLFormElement).querySelector<HTMLInputElement>('#customer-first-name');
    const lnInput = (e.target as HTMLFormElement).querySelector<HTMLInputElement>('#customer-last-name');
    if (!fnInput || !lnInput) return;
    try {
      setNameSaving(true);
      setNameError(null);
      await api.patch(`/admin/customers/${contactId}`, {
        firstName: fnInput.value.trim() || null,
        lastName: lnInput.value.trim() || null,
      });
      setCustomer((prev) => prev ? {
        ...prev,
        firstName: fnInput.value.trim() || '',
        lastName: lnInput.value.trim() || '',
      } : prev);
      setNameDialogOpen(false);
    } catch (err: any) {
      setNameError(err.message || 'Unable to save name.');
    } finally {
      setNameSaving(false);
    }
  };

  // ── Tags dialog handlers ──────────────────────────────────────────────

  const openTagsDialog = () => {
    if (!customer) return;
    setTagInputTags(customer.tags || []);
    setTagInputDraft('');
    setTagError(null);
    setTagSaving(false);
    setTagsDialogOpen(true);
  };

  const commitTagDraft = (): boolean => {
    const next = addTag(tagInputTags, tagInputDraft);
    if (next.length > MAX_TAGS) {
      setTagError(`At most ${MAX_TAGS} tags.`);
      return false;
    }
    if (tagInputDraft.trim().length > MAX_TAG_LENGTH) {
      setTagError(`Tags are ${MAX_TAG_LENGTH} characters or fewer.`);
      return false;
    }
    setTagInputTags(next);
    setTagInputDraft('');
    setTagError(null);
    return true;
  };

  const saveTags = async (e: FormEvent) => {
    e.preventDefault();
    if (tagSaving) return;
    let next = tagInputTags;
    if (tagInputDraft.trim()) {
      if (!commitTagDraft()) return;
      next = addTag(tagInputTags, tagInputDraft);
    }
    setTagSaving(true);
    setTagError(null);
    try {
      await api.patch(`/admin/customers/${contactId}`, { tags: next });
      setCustomer((prev) => prev ? { ...prev, tags: next } : prev);
      setTagsDialogOpen(false);
    } catch (err: any) {
      setTagError(err.message || 'Could not save tags');
      setTagSaving(false);
    }
  };

  // ── Send sign-in link ─────────────────────────────────────────────────

  const sendSignInLink = async () => {
    if (!customer || signInLinkSending) return;
    setSignInLinkSending(true);
    setSignInLinkResult(null);
    try {
      await api.post(`/admin/customers/${customer.id}/send-sign-in-link`, {});
      setSignInLinkResult({ ok: true, message: 'Sign-in link sent.' });
    } catch (err: any) {
      if (err.status === 422) {
        setSignInLinkResult({ ok: false, message: 'This customer checked out as a guest and does not have an account to sign in to.' });
      } else if (err.status === 429) {
        setSignInLinkResult({ ok: false, message: 'Too many sign-in links sent recently. Try again later.' });
      } else {
        setSignInLinkResult({ ok: false, message: err.message || 'Failed to send sign-in link.' });
      }
    } finally {
      setSignInLinkSending(false);
    }
  };

  // ── Copy account URL ──────────────────────────────────────────────────

  const copyAccountUrl = () => {
    if (!customer?.accountUrl) return;
    navigator.clipboard.writeText(customer.accountUrl);
    setAccountUrlCopied(true);
    setTimeout(() => setAccountUrlCopied(false), 2000);
  };

  // ── Marketing provenance label ────────────────────────────────────────

  function marketingProvenance(): string {
    if (!customer) return '';
    if (customer.emailSubscribed) {
      if (customer.emailSubscribedAt) {
        const source = customer.emailSubscribedSource || 'UNKNOWN';
        const sourceLabel =
          source === 'CHECKOUT' ? 'checkout' :
          source === 'ADMIN' ? 'admin' :
          source === 'APPLICATION' ? 'application' :
          source === 'BUYER_SIGNUP' ? 'account signup' :
          'unknown';
        return `Subscribed via ${sourceLabel} on ${formatDateTime(customer.emailSubscribedAt)}`;
      }
      return 'Subscribed';
    }
    if (customer.emailUnsubscribedAt) {
      return `Unsubscribed on ${formatDateTime(customer.emailUnsubscribedAt)}`;
    }
    if (customer.emailSubscribedAt) {
      return `Previously subscribed on ${formatDateTime(customer.emailSubscribedAt)}`;
    }
    return 'Not subscribed';
  }

  // ── Loading state ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-48" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-gray-200 dark:bg-slate-700 rounded-lg" />
            ))}
          </div>
          <div className="h-64 bg-gray-200 dark:bg-slate-700 rounded-lg" />
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────

    if (error || !customer) {
      return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-6 text-center">
            <p className="text-red-800 dark:text-red-300">{error || 'Customer not found'}</p>
            <Link href={customersHref} className="mt-3 inline-block text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
              Back to customers
            </Link>
          </div>
        </div>
      );
    }

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* ── Name dialog ── */}
      {nameDialogOpen && (
        <SettingsDialog
          titleId="customer-name-dialog-title"
          title="Edit name"
          dirty={true}
          saving={nameSaving}
          returnFocusRef={{ current: null } as React.RefObject<HTMLButtonElement>}
          onClose={() => setNameDialogOpen(false)}
          onSubmit={saveName}
        >
          <fieldset disabled={nameSaving} className="space-y-5">
            {nameError && <div role="alert" className={formAlertClass}>{nameError}</div>}
            <div>
              <label htmlFor="customer-first-name" className="block text-sm font-medium text-gray-700 dark:text-slate-300">First name</label>
              <input
                id="customer-first-name"
                defaultValue={customer.firstName || ''}
                autoFocus
                className={fieldClass}
                autoComplete="given-name"
              />
            </div>
            <div>
              <label htmlFor="customer-last-name" className="block text-sm font-medium text-gray-700 dark:text-slate-300">Last name</label>
              <input
                id="customer-last-name"
                defaultValue={customer.lastName || ''}
                className={fieldClass}
                autoComplete="family-name"
              />
            </div>
          </fieldset>
        </SettingsDialog>
      )}

      {/* ── Tags dialog ── */}
      {tagsDialogOpen && (
        <SettingsDialog
          titleId="customer-tags-dialog-title"
          title="Edit tags"
          dirty={JSON.stringify(tagInputTags) !== JSON.stringify(customer.tags || []) || tagInputDraft.trim() !== ''}
          saving={tagSaving}
          submitLabel="Save tags"
          savingLabel="Saving…"
          initialFocusRef={tagInputRef as React.RefObject<HTMLInputElement>}
          returnFocusRef={{ current: null } as React.RefObject<HTMLButtonElement>}
          onClose={() => setTagsDialogOpen(false)}
          onSubmit={saveTags}
        >
          <div className="space-y-3">
            {tagError && <div role="alert" className={formAlertClass}>{tagError}</div>}
            <p className="text-sm text-gray-700 dark:text-slate-300">
              Tags on <strong>{customer.firstName} {customer.lastName}</strong>. Free-form, visible only to your team.
            </p>
            <div>
              <label htmlFor="tag-input" className="block text-sm font-medium text-gray-700 dark:text-slate-300">Tags</label>
              <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800">
                {tagInputTags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                    {t}
                    <button type="button" aria-label={`Remove tag ${t}`} className="rounded-full px-1 leading-none hover:bg-amber-200 dark:hover:bg-amber-800" onClick={() => setTagInputTags(tagInputTags.filter((x) => x !== t))}>
                      ×
                    </button>
                  </span>
                ))}
                <input
                  id="tag-input"
                  ref={tagInputRef}
                  value={tagInputDraft}
                  maxLength={MAX_TAG_LENGTH}
                  onChange={(e) => { setTagInputDraft(e.target.value); setTagError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      commitTagDraft();
                    } else if (e.key === 'Backspace' && tagInputDraft === '' && tagInputTags.length) {
                      setTagInputTags(tagInputTags.slice(0, -1));
                    }
                  }}
                  onBlur={() => tagInputDraft.trim() && commitTagDraft()}
                  className="mt-0 min-w-[8rem] flex-1 border-0 px-1 py-0.5 shadow-none focus:ring-0 bg-transparent text-sm text-gray-900 dark:text-slate-100"
                  placeholder={tagInputTags.length ? '' : 'Type a tag and press Enter'}
                />
              </div>
              <p className={hintClass}>Enter or comma adds a tag; Backspace removes the last one. Up to {MAX_TAGS} tags.</p>
            </div>
          </div>
        </SettingsDialog>
      )}

      {/* Breadcrumb + Header + Nav */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
            <Link href={customersHref} className="hover:text-indigo-600 dark:hover:text-indigo-400">
              Customers
            </Link>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-gray-900 dark:text-white font-medium">
              {customer.firstName} {customer.lastName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setNameDialogOpen(true)}
              className="group flex items-center gap-1 text-lg font-bold text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400"
              data-testid="customer-name-edit"
            >
              <span>{customer.firstName} {customer.lastName}</span>
              <svg className="w-4 h-4 text-gray-400 group-hover:text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
            {customer.segment && (
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${segmentBadgeClass(customer.segment)}`}>
                {customer.segment}
              </span>
            )}
          </div>
        </div>

        {/* More actions menu */}
        <div className="relative" ref={actionsMenuRef}>
          <button
            onClick={() => setActionsMenuOpen(!actionsMenuOpen)}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700/50"
            aria-label="More actions"
            aria-haspopup="true"
            aria-expanded={actionsMenuOpen}
          >
            <EllipsisIcon />
          </button>
          {actionsMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-40 w-56 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg py-1">
              <button
                onClick={() => { setActionsMenuOpen(false); sendSignInLink(); }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700/50"
              >
                Send sign-in link
              </button>
              {customer.accountUrl && (
                <button
                  onClick={() => { setActionsMenuOpen(false); copyAccountUrl(); }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700/50"
                >
                  Copy account URL
                </button>
              )}
              <hr className="my-1 border-gray-200 dark:border-slate-700" />
              <button
                disabled
                title="Customer erasure will be available in a future update (spec 023)."
                className="w-full text-left px-4 py-2 text-sm text-gray-400 dark:text-slate-500 cursor-not-allowed flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Erase customer data
                <span className="text-xs text-gray-400 dark:text-slate-500">(coming soon)</span>
              </button>
            </div>
          )}
        </div>
        <nav aria-label="Customer navigation" className="flex items-center gap-2 mr-2">
          {customer.prevId ? (
            <Link href={customerHref(customer.prevId)} aria-label="Previous customer" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
              Previous
            </Link>
          ) : (
            <span aria-disabled="true" className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-400 dark:border-slate-700 dark:text-slate-600">
              Previous
            </span>
          )}
          {customer.nextId ? (
            <Link href={customerHref(customer.nextId)} aria-label="Next customer" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
              Next
            </Link>
          ) : (
            <span aria-disabled="true" className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-400 dark:border-slate-700 dark:text-slate-600">
              Next
            </span>
          )}
        </nav>
      </div>

      {/* Sign-in link result flash */}
      {signInLinkResult && (
        <div className={`mb-4 rounded-lg border p-4 ${signInLinkResult.ok ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
          <p className={`text-sm ${signInLinkResult.ok ? 'text-green-800 dark:text-green-300' : 'text-yellow-800 dark:text-yellow-300'}`}>
            {signInLinkResult.message}
          </p>
        </div>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Amount spent', value: formatCurrency(customer.totalSpent), hint: customer.totalRefunded > 0 ? `${formatCurrency(customer.totalRefunded)} refunded` : undefined },
          { label: 'Transactions', value: String(customer.transactionCount), hint: customer.applicationCount > 0 ? `${customer.ticketOrderCount} order${customer.ticketOrderCount !== 1 ? 's' : ''} · ${customer.applicationCount} application${customer.applicationCount !== 1 ? 's' : ''}` : undefined },
          { label: 'Customer since', value: formatRelative(customer.createdAt) },
          { label: 'Last activity', value: customer.lastActivityAt ? formatRelative(customer.lastActivityAt) : 'N/A' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-4 py-3">
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">{stat.label}</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{stat.value}</p>
            {stat.hint && <p className="text-[11px] text-gray-400 dark:text-slate-500">{stat.hint}</p>}
          </div>
        ))}
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">Segment</p>
          <span data-testid="customer-segment" className={`inline-flex rounded-full px-2.5 py-1 text-sm font-semibold ${customer.segment ? segmentBadgeClass(customer.segment) : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'}`}>
            {customer.segment || '—'}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Order history */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Order history</h2>
            </div>

            {customer.orders.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-slate-400">
                No orders found.
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {customer.orders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/admin/orders/${order.id}`}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    {/* Event logo */}
                    <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-slate-700 flex-shrink-0 overflow-hidden flex items-center justify-center">
                      {order.event.logoUrl ? (
                        <img src={resolveAssetUrl(order.event.logoUrl) || undefined} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <svg className="w-5 h-5 text-gray-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      )}
                    </div>

                    {/* Order info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">#{order.orderRef}</span>
                        <StatusBadge status={order.status} />
                        {order.kind === 'APPLICATION' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300" data-testid="customer-order-kind">
                            Application
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                        {order.event.name} &middot; {formatEventDateTime(order.event.date, order.event.timezone)}
                      </p>
                    </div>

                    {/* Ticket count + amount */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(order.totalAmount)}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        {order.kind === 'APPLICATION' ? 'Application' : `${order.ticketCount} ticket${order.ticketCount !== 1 ? 's' : ''}`}
                      </p>
                    </div>

                    {/* Chevron */}
                    <ChevronRightIcon className="w-4 h-4 text-gray-400 dark:text-slate-500 flex-shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Applications */}
          {customer.applications.length > 0 && (
            <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden" data-testid="customer-applications">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Applications</h2>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {customer.applications.map((application) => (
                  <Link
                    key={application.id}
                    href={application.detailUrl}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-slate-700 flex-shrink-0 overflow-hidden flex items-center justify-center">
                      {application.event.logoUrl ? (
                        <img src={resolveAssetUrl(application.event.logoUrl) || undefined} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <svg className="w-5 h-5 text-gray-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6M7 4h10a2 2 0 012 2v14l-4-2-3 2-3-2-4 2V6a2 2 0 012-2z" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {application.businessName || application.form.name}
                        </span>
                        <StatusBadge status={application.paymentStatus} />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                        {application.event.name} &middot; {application.form.name}
                        {application.tier ? ` \u2014 ${application.tier.name}` : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(application.applicantPays)}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        {application.refunded > 0 ? `${formatCurrency(application.refunded)} refunded` : application.paidAt ? `Paid ${formatDate(application.paidAt)}` : application.status.toLowerCase()}
                      </p>
                    </div>
                    <ChevronRightIcon className="w-4 h-4 text-gray-400 dark:text-slate-500 flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {customer.rsvps.length > 0 && (
            <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden" data-testid="customer-rsvps">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">RSVPs</h2>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {customer.rsvps.map((rsvp) => (
                  <Link
                    key={rsvp.id}
                    href={`/admin/events/${rsvp.event.id}/rsvps`}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{rsvp.event.name}</span>
                        <StatusBadge status={rsvp.status} />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        {formatEventDateTime(rsvp.event.date, rsvp.event.timezone)} · Party of {rsvp.partySize}
                      </p>
                    </div>
                    <ChevronRightIcon className="w-4 h-4 text-gray-400 dark:text-slate-500 flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          <CustomerTimeline contactId={customer.id} />
        </div>

        {/* Right: Sidebar */}
        <div className="space-y-4">
          <UpcomingTickets tickets={customer.upcomingTickets || []} />
          {/* Contact info */}
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Contact information</h2>
            </div>
            <div className="px-4 py-3 space-y-3">
              {/* Email */}
              <div className="flex items-center justify-between">
                <a href={`mailto:${customer.email}`} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline truncate">
                  {customer.email}
                </a>
                <button
                  onClick={copyEmail}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 flex-shrink-0 ml-2"
                  title="Copy email"
                >
                  {copied ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Phone */}
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">Phone</p>
                {editingField === 'phone' ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="tel"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                      autoFocus
                      className="w-full px-2 py-1 text-sm rounded border border-indigo-300 dark:border-indigo-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-indigo-500"
                      placeholder="(555) 555-0100"
                    />
                    <button onClick={saveEdit} disabled={saving} className="text-green-600 hover:text-green-700 flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    </button>
                    <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => startEdit('phone')}
                    className="text-sm text-gray-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {customer.phone || <span className="text-gray-400 dark:text-slate-500 italic">Add phone...</span>}
                  </button>
                )}
              </div>

              {/* Location */}
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">Location</p>
                {editingField === 'location' ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                      autoFocus
                      className="w-full px-2 py-1 text-sm rounded border border-indigo-300 dark:border-indigo-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-indigo-500"
                      placeholder="City, State"
                    />
                    <button onClick={saveEdit} disabled={saving} className="text-green-600 hover:text-green-700 flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    </button>
                    <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => startEdit('location')}
                    className="text-sm text-gray-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {customer.location || <span className="text-gray-400 dark:text-slate-500 italic">Add location...</span>}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Marketing card */}
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Marketing</h2>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm text-gray-700 dark:text-slate-300">Email subscription</span>
                </div>
                <button
                  onClick={toggleSubscription}
                  className={`inline-flex items-center justify-center w-9 h-5 rounded-full transition-colors ${
                    customer.emailSubscribed
                      ? 'bg-green-500'
                      : 'bg-gray-300 dark:bg-slate-600'
                  }`}
                  title={customer.emailSubscribed ? 'Subscribed' : 'Unsubscribed'}
                >
                  <span
                    className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                      customer.emailSubscribed ? 'translate-x-1.5' : '-translate-x-1.5'
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                {marketingProvenance()}
              </p>
            </div>
          </div>

          {/* Tags card */}
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Tags</h2>
              <button
                onClick={openTagsDialog}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
                title="Edit tags"
                data-testid="edit-tags-button"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            </div>
            <div className="px-4 py-3">
              {(customer.tags || []).length === 0 ? (
                <button
                  onClick={openTagsDialog}
                  className="text-sm text-gray-400 dark:text-slate-500 italic hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  No tags
                </button>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(customer.tags || []).map((tag) => (
                    <span key={tag} className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Account card */}
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Account</h2>
            </div>
            <div className="px-4 py-3 space-y-3">
              {customer.accountCreatedAt ? (
                <>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Account since</p>
                    <p className="text-sm text-gray-700 dark:text-slate-300">{formatDate(customer.accountCreatedAt)}</p>
                  </div>
                  {customer.lastSignInAt && (
                    <div>
                      <p className="text-xs text-gray-500 dark:text-slate-400">Last sign-in</p>
                      <p className="text-sm text-gray-700 dark:text-slate-300">{formatRelative(customer.lastSignInAt)}</p>
                    </div>
                  )}
                  <div className="pt-1 space-y-2">
                    <button
                      onClick={sendSignInLink}
                      disabled={signInLinkSending}
                      className="w-full px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {signInLinkSending ? 'Sending link...' : 'Send sign-in link'}
                    </button>
                    {customer.accountUrl && (
                      <button
                        onClick={copyAccountUrl}
                        className="w-full px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-700 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors flex items-center justify-center gap-1.5"
                      >
                        {accountUrlCopied ? (
                          <>
                            <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Copied
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                            </svg>
                            Copy account URL
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="text-sm text-gray-700 dark:text-slate-300">Guest checkout</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 ml-6">
                    This customer does not have an account. They completed their purchase as a guest.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Notes</h2>
              {editingField !== 'note' && (
                <button
                  onClick={() => startEdit('note')}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
                  title="Edit notes"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              )}
            </div>
            <div className="px-4 py-3">
              {editingField === 'note' ? (
                <div className="space-y-2">
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
                    autoFocus
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm rounded border border-indigo-300 dark:border-indigo-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-indigo-500 resize-none"
                    placeholder="Add a note about this customer..."
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={cancelEdit} className="px-3 py-1 text-xs font-medium text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-slate-600 rounded hover:bg-gray-50 dark:hover:bg-slate-700">
                      Cancel
                    </button>
                    <button onClick={saveEdit} disabled={saving} className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50">
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-700 dark:text-slate-300">
                  {customer.note || <span className="text-gray-400 dark:text-slate-500 italic">No notes</span>}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CustomerDetailPage() {
  return (
    <Suspense fallback={<div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">Loading customer…</div>}>
      <CustomerDetailPageContent />
    </Suspense>
  );
}
