// Content › Blog posts (spec 026) — shared types and helpers.

import type { StoreFile } from './content';

export type BlogPostStatus = 'visible' | 'hidden' | 'scheduled';

export interface Blog {
  id: string;
  organizationId: string;
  title: string;
  handle: string;
  postCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BlogPostNeighbor {
  id: string;
  title: string;
}

export interface BlogPost {
  id: string;
  organizationId: string;
  blogId: string;
  blog: { id: string; title: string; handle: string };
  title: string;
  handle: string;
  content: string;
  excerpt: string | null;
  authorName: string;
  tags: string[];
  featuredFileId: string | null;
  featuredFile: StoreFile | null;
  isVisible: boolean;
  publishedAt: string | null;
  status: BlogPostStatus;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
  neighbors?: { prev: BlogPostNeighbor | null; next: BlogPostNeighbor | null };
}

export interface BlogPostInput {
  title: string;
  blogId: string;
  content: string;
  excerpt: string | null;
  authorName: string;
  tags: string[];
  featuredFileId: string | null;
  isVisible: boolean;
  publishedAt: string | null;
  handle: string;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface BlogPostList {
  posts: BlogPost[];
  total: number;
  page: number;
  pageSize: number;
  summary: { all: number; visible: number; hidden: number; scheduled: number };
}

export type BlogPostSort = 'updated_desc' | 'updated_asc' | 'title' | 'published_desc';

export interface BlogPostListQuery {
  q?: string;
  status?: BlogPostStatus | 'all';
  blogId?: string;
  sort?: BlogPostSort;
  page?: number;
}

export const STATUS_LABELS: Record<BlogPostStatus, string> = {
  visible: 'Visible',
  hidden: 'Hidden',
  scheduled: 'Scheduled',
};

export const STATUS_CLASSES: Record<BlogPostStatus, string> = {
  visible: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  hidden: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
  scheduled: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

/** Public storefront path for a post (platform host form). */
export function blogPostPath(orgId: string, blogHandle: string, postHandle: string) {
  return `/organizations/${orgId}/blogs/${blogHandle}/${postHandle}`;
}

export function formatDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date
    .toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
      hour: 'numeric',
      minute: '2-digit',
    })
    .replace(',', ' at');
}

export function formatDate(value: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** `datetime-local` value (local time) for an ISO string, and back. */
export function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
