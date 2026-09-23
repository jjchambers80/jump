'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import api from '@/services/api';
import { rsvpTimelineText } from '@/lib/customers';

type TimelineAuthor = {
  id: string;
  name?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

export type TimelineItem = {
  id: string;
  kind: 'COMMENT' | 'EVENT' | string;
  type?: string;
  body?: string;
  text?: string;
  message?: string;
  createdAt: string;
  author?: TimelineAuthor | null;
  authorUserId?: string | null;
  canDelete?: boolean;
  partySize?: number;
  event?: { id: string; name: string } | null;
};

type TimelineResponse = {
  items?: TimelineItem[];
  data?: TimelineItem[];
  nextCursor?: string | null;
  pagination?: { nextCursor?: string | null };
};

function authorName(author?: TimelineAuthor | null): string {
  if (!author) return 'Jump';
  const fullName = [author.firstName, author.lastName].filter(Boolean).join(' ');
  return author.name || fullName || author.email || 'Staff member';
}

function itemText(item: TimelineItem): string {
  if (item.kind === 'COMMENT') return item.body || '';
  if (item.type === 'RSVP_CREATED') {
    return rsvpTimelineText(item.event?.name, item.partySize);
  }
  if (item.type === 'RSVP_CANCELLED') {
    return `Cancelled RSVP to ${item.event?.name || 'an event'}`;
  }
  return item.text || item.message || item.type?.toLowerCase().replace(/_/g, ' ') || 'Customer activity';
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function unpack(response: TimelineResponse) {
  return {
    items: response.items || response.data || [],
    nextCursor: response.nextCursor ?? response.pagination?.nextCursor ?? null,
  };
}

function newestFirst(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => {
    const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return byDate || b.id.localeCompare(a.id);
  });
}

export default function CustomerTimeline({ contactId }: { contactId: string }) {
  const { data: session } = useSession();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    cursor ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const response = await api.get<TimelineResponse>(`/admin/customers/${contactId}/timeline${query}`);
      const page = unpack(response);
      setItems((current) => newestFirst(cursor ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (err: any) {
      setError(err.message || 'Failed to load customer activity');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [contactId]);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    load();
  }, [load]);

  const currentUser = session?.user as { id?: string; role?: string } | undefined;
  const normalizedBody = body.trim();
  const remaining = 2000 - body.length;

  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!normalizedBody || body.length > 2000 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const comment = await api.post<TimelineItem>(`/admin/customers/${contactId}/comments`, { body: normalizedBody });
      setItems((current) => newestFirst([comment, ...current]));
      setBody('');
    } catch (err: any) {
      setError(err.message || 'Failed to add comment');
    } finally {
      setSaving(false);
    }
  };

  const deleteComment = async (id: string) => {
    setError(null);
    try {
      await api.delete(`/admin/customers/${contactId}/comments/${id}`);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (err: any) {
      setError(err.message || 'Failed to delete comment');
    }
  };

  const renderedItems = useMemo(() => newestFirst(items), [items]);

  return (
    <section className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden" data-testid="customer-timeline">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Timeline</h2>
      </div>

      <form onSubmit={submitComment} className="p-4 border-b border-gray-200 dark:border-slate-700">
        <label htmlFor="customer-comment" className="sr-only">Add a comment</label>
        <textarea
          id="customer-comment"
          value={body}
          maxLength={2000}
          rows={3}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a comment about this customer…"
          className="w-full resize-y rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className={`text-xs ${remaining < 0 ? 'text-red-600' : 'text-gray-500 dark:text-slate-400'}`}>{Math.max(remaining, 0)} characters remaining</span>
          <button
            type="submit"
            disabled={!normalizedBody || body.length > 2000 || saving}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add comment'}
          </button>
        </div>
      </form>

      {error && <div role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">{error}</div>}

      {loading ? (
        <div aria-label="Loading customer activity" className="space-y-3 p-4">
          {[1, 2, 3].map((row) => <div key={row} className="h-14 animate-pulse rounded bg-gray-100 dark:bg-slate-700" />)}
        </div>
      ) : renderedItems.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-slate-400">No activity yet.</p>
      ) : (
        <ol className="divide-y divide-gray-100 dark:divide-slate-700/50">
          {renderedItems.map((item) => {
            const isComment = item.kind === 'COMMENT';
            const canDelete = isComment && (item.canDelete === true || currentUser?.role === 'ADMIN' || item.author?.id === currentUser?.id || item.authorUserId === currentUser?.id);
            return (
              <li key={item.id} data-timeline-item className="flex gap-3 px-4 py-3">
                <span aria-hidden className={`mt-1 h-2.5 w-2.5 flex-none rounded-full ${isComment ? 'bg-indigo-500' : 'bg-gray-400 dark:bg-slate-500'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-slate-200">{itemText(item)}</p>
                    {canDelete && (
                      <button type="button" onClick={() => deleteComment(item.id)} aria-label="Delete comment" className="flex-none text-xs font-medium text-gray-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400">Delete</button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                    {isComment ? `${authorName(item.author)} · ` : ''}<time dateTime={item.createdAt}>{formatTimestamp(item.createdAt)}</time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {nextCursor && !loading && (
        <div className="border-t border-gray-200 p-3 text-center dark:border-slate-700">
          <button type="button" disabled={loadingMore} onClick={() => load(nextCursor)} className="text-sm font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400">
            {loadingMore ? 'Loading…' : 'Load older activity'}
          </button>
        </div>
      )}
    </section>
  );
}
