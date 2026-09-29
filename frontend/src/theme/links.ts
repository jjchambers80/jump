// Theme link objects → hrefs (spec 038 §6.1). Targets resolve on the server
// (`resolved.links`); a link whose target is gone or hidden has no href and
// the caller leaves it out (D8).

import { linkKey } from '@jump/theme';
import { storefrontHref } from '@/lib/storefrontPath';
import type { ResolvedData } from './types';

export interface ThemeLink {
  type: string;
  targetId?: string;
  url?: string;
}

export interface LinkContext {
  resolved: ResolvedData;
  organization: { id: string; slug: string };
  host: string | null;
}

/** Platform paths shortened on a custom domain (menu hrefs use the slug, routes may use the id). */
export function shortenHref(href: string, ctx: Pick<LinkContext, 'organization' | 'host'>) {
  if (!ctx.host) return href;
  const bySlug = storefrontHref(href, ctx.organization.slug, ctx.host);
  return bySlug !== href ? bySlug : storefrontHref(href, ctx.organization.id, ctx.host);
}

export function linkHref(link: ThemeLink | null | undefined, ctx: LinkContext): string | null {
  if (!link) return null;
  if (link.type === 'EXTERNAL') return link.url && /^https:\/\//.test(link.url) ? link.url : null;
  const href = ctx.resolved.links?.[linkKey(link) ?? ''];
  return href ? shortenHref(href, ctx) : null;
}
