'use client';

// API calls for Content › Blog posts. Org scoping as Files: X-Jump-Org from the
// api client; SYSTEM_ADMIN also sends ?organizationId= from the switcher.

import { useMemo } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import type { Blog, BlogPost, BlogPostInput, BlogPostList, BlogPostListQuery } from '@/lib/blog';

export function useBlogApi() {
  const { selectedOrgId } = useOrg();
  const orgParam = selectedOrgId ? `organizationId=${encodeURIComponent(selectedOrgId)}` : '';
  const qs = orgParam ? `?${orgParam}` : '';
  const join = (base: string, extra: string) =>
    `${base}${extra ? (base.includes('?') ? '&' : '?') + extra : ''}`;

  return useMemo(
    () => ({
      blogs: () => api.get<{ blogs: Blog[] }>(`/admin/blogs${qs}`),
      createBlog: (body: { title: string; handle?: string }) =>
        api.post<Blog>(`/admin/blogs${qs}`, body),
      updateBlog: (id: string, body: { title?: string; handle?: string }) =>
        api.patch<Blog>(`/admin/blogs/${id}${qs}`, body),
      deleteBlog: (id: string, moveToBlogId?: string) =>
        api.delete<void>(
          join(
            `/admin/blogs/${id}${qs}`,
            moveToBlogId ? `moveToBlogId=${encodeURIComponent(moveToBlogId)}` : ''
          )
        ),
      list: (query: BlogPostListQuery) => {
        const params = new URLSearchParams();
        if (query.q) params.set('q', query.q);
        if (query.status && query.status !== 'all') params.set('status', query.status);
        if (query.blogId) params.set('blogId', query.blogId);
        if (query.sort) params.set('sort', query.sort);
        if (query.page && query.page > 1) params.set('page', String(query.page));
        if (orgParam) params.set('organizationId', selectedOrgId as string);
        const search = params.toString();
        return api.get<BlogPostList>(`/admin/blog-posts${search ? `?${search}` : ''}`);
      },
      tags: () =>
        api.get<{ tags: { tag: string; count: number }[] }>(`/admin/blog-posts/tags${qs}`),
      get: (id: string) => api.get<BlogPost>(`/admin/blog-posts/${id}${qs}`),
      create: (body: Partial<BlogPostInput> & { title: string }) =>
        api.post<BlogPost>(`/admin/blog-posts${qs}`, body),
      update: (id: string, body: Partial<BlogPostInput>) =>
        api.patch<BlogPost>(`/admin/blog-posts/${id}${qs}`, body),
      remove: (id: string) => api.delete<void>(`/admin/blog-posts/${id}${qs}`),
      bulk: (ids: string[], action: 'delete' | 'show' | 'hide') =>
        api.post<{ affected: string[]; failed: { id: string; message: string }[] }>(
          `/admin/blog-posts/bulk${qs}`,
          { ids, action }
        ),
    }),
    [qs, orgParam, selectedOrgId]
  );
}
