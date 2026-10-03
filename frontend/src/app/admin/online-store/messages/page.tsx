'use client';

// Spec 042: inbox for storefront contact-form messages. List on the left,
// the open message on the right (desktop); on phones the message replaces
// the list with a Back button. Opening a message marks it read.

import { useSession } from 'next-auth/react';
import { ArrowLeft, Mail, MailOpen, Reply, Trash2 } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import { MESSAGES_CHANGED_EVENT } from '@/components/AdminSidebar';
import { useAccountFormat } from '@/lib/accountFormat';
import api, { type ContactInquiry, type ContactInquiryList } from '@/services/api';

type Filter = 'all' | 'unread';

const card =
  'rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800';

function replyHref(inquiry: ContactInquiry) {
  const subject = inquiry.subject ? `Re: ${inquiry.subject}` : 'Re: your message';
  return `mailto:${encodeURIComponent(inquiry.email)}?subject=${encodeURIComponent(subject)}`;
}

export default function MessagesPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canDelete = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const { formatDateTime } = useAccountFormat();

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ContactInquiryList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status: filter, page: String(page) });
      if (search) params.set('q', search);
      setData(await api.get<ContactInquiryList>(`/admin/contact-inquiries?${params}`));
    } catch (err: any) {
      setError(err.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, filter, page, search]);

  useEffect(() => {
    if (!orgLoading) void load();
  }, [orgLoading, load]);

  const inquiries = data?.inquiries ?? [];
  const open = inquiries.find((item) => item.id === openId) ?? null;

  const replace = (updated: ContactInquiry, unreadDelta: number) =>
    setData((current) =>
      current
        ? {
            ...current,
            unreadCount: Math.max(0, current.unreadCount + unreadDelta),
            inquiries: current.inquiries.map((item) => (item.id === updated.id ? updated : item)),
          }
        : current
    );

  const setRead = async (inquiry: ContactInquiry, read: boolean) => {
    if (Boolean(inquiry.readAt) === read) return;
    try {
      const updated = await api.patch<ContactInquiry>(`/admin/contact-inquiries/${inquiry.id}`, { read });
      replace(updated, read ? -1 : 1);
      window.dispatchEvent(new Event(MESSAGES_CHANGED_EVENT));
    } catch (err: any) {
      setError(err.message || 'Failed to update the message');
    }
  };

  const openMessage = (inquiry: ContactInquiry) => {
    setOpenId(inquiry.id);
    void setRead(inquiry, true);
  };

  const remove = async (inquiry: ContactInquiry) => {
    if (!window.confirm(`Delete the message from ${inquiry.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/contact-inquiries/${inquiry.id}`);
      window.dispatchEvent(new Event(MESSAGES_CHANGED_EVENT));
      setOpenId(null);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to delete the message');
    }
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(query.trim());
  };

  const filterButton = (value: Filter, label: string) => (
    <button
      type="button"
      aria-pressed={filter === value}
      onClick={() => {
        setFilter(value);
        setPage(1);
      }}
      className={`rounded-full px-3 py-1 text-sm font-medium ${
        filter === value
          ? 'bg-gray-900 text-white dark:bg-white dark:text-slate-900'
          : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6" data-testid="messages-header">
        <p className="text-sm font-medium text-indigo-600 dark:text-indigo-300">Online store</p>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Messages</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          What visitors send through contact forms on your pages. Each message is also emailed to
          your store email.
          {data ? ` ${data.unreadCount} unread.` : ''}
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-2 font-semibold underline">
            Try again
          </button>
        </div>
      )}

      {!selectedOrgId && !orgLoading ? (
        <p className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">
          Pick an organization from the menu in the top right.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <section aria-label="Message list" className={`${card} ${open ? 'hidden lg:block' : ''}`}>
            <div className="space-y-3 border-b border-gray-200 p-3 dark:border-slate-700">
              <div className="flex gap-1" role="group" aria-label="Filter messages">
                {filterButton('all', 'All')}
                {filterButton('unread', 'Unread')}
              </div>
              <form onSubmit={submitSearch} role="search">
                <label htmlFor="messages-search" className="sr-only">
                  Search messages
                </label>
                <input
                  id="messages-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, email or text"
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </form>
            </div>

            {loading ? (
              <div aria-label="Loading messages" className="space-y-2 p-3">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-16 animate-pulse rounded-md bg-gray-200 dark:bg-slate-700" />
                ))}
              </div>
            ) : inquiries.length === 0 ? (
              <p data-testid="messages-empty" className="px-4 py-12 text-center text-sm text-gray-500 dark:text-slate-400">
                {search
                  ? 'No messages match your search.'
                  : filter === 'unread'
                    ? 'No unread messages.'
                    : 'No messages yet. They appear here when visitors use a contact form on your pages.'}
              </p>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-slate-700">
                {inquiries.map((inquiry) => {
                  const unread = !inquiry.readAt;
                  return (
                    <li key={inquiry.id}>
                      <button
                        type="button"
                        onClick={() => openMessage(inquiry)}
                        aria-current={inquiry.id === openId ? 'true' : undefined}
                        className={`block w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 ${
                          inquiry.id === openId ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''
                        }`}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`truncate text-sm ${unread ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-slate-300'}`}>
                            {unread && <span className="sr-only">Unread: </span>}
                            {inquiry.name}
                          </span>
                          <span className="shrink-0 text-xs text-gray-500 dark:text-slate-400">
                            {formatDateTime(inquiry.createdAt, { month: 'short', day: 'numeric' })}
                          </span>
                        </span>
                        <span className={`block truncate text-sm ${unread ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-400'}`}>
                          {inquiry.subject || 'No subject'}
                        </span>
                        <span className="block truncate text-xs text-gray-500 dark:text-slate-400">
                          {inquiry.message}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {data && data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-200 p-3 text-sm dark:border-slate-700">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                  className="font-medium text-indigo-600 disabled:opacity-40 dark:text-indigo-300"
                >
                  Newer
                </button>
                <span className="text-gray-500 dark:text-slate-400">
                  Page {data.pagination.page} of {data.pagination.totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                  className="font-medium text-indigo-600 disabled:opacity-40 dark:text-indigo-300"
                >
                  Older
                </button>
              </div>
            )}
          </section>

          <section
            aria-label="Message"
            className={`${card} min-h-[20rem] ${open ? '' : 'hidden lg:block'}`}
            data-testid="message-detail"
          >
            {!open ? (
              <div className="flex h-full min-h-[20rem] items-center justify-center p-6 text-sm text-gray-500 dark:text-slate-400">
                Select a message to read it.
              </div>
            ) : (
              <article className="p-5 sm:p-6">
                <button
                  type="button"
                  onClick={() => setOpenId(null)}
                  className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 lg:hidden dark:text-indigo-300"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden /> All messages
                </button>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                      {open.subject || 'No subject'}
                    </h2>
                    <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">
                      {open.name} ·{' '}
                      <a href={`mailto:${open.email}`} className="text-indigo-600 hover:underline dark:text-indigo-300">
                        {open.email}
                      </a>
                      {open.phone && (
                        <>
                          {' · '}
                          <a href={`tel:${open.phone}`} className="hover:underline">
                            {open.phone}
                          </a>
                        </>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                      {formatDateTime(open.createdAt)}
                      {open.page && ` · from ${open.page.title ?? 'a deleted page'}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={replyHref(open)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                    >
                      <Reply className="h-4 w-4" aria-hidden /> Reply
                    </a>
                    <button
                      type="button"
                      onClick={() => void setRead(open, !open.readAt)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      {open.readAt ? (
                        <>
                          <Mail className="h-4 w-4" aria-hidden /> Mark unread
                        </>
                      ) : (
                        <>
                          <MailOpen className="h-4 w-4" aria-hidden /> Mark read
                        </>
                      )}
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => void remove(open)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden /> Delete
                      </button>
                    )}
                  </div>
                </div>
                {open.emailError && (
                  <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    This message could not be emailed to your store email. It is only here.
                  </p>
                )}
                <p className="mt-6 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-gray-800 dark:text-slate-200">
                  {open.message}
                </p>
              </article>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
