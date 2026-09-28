// Spike 038-0: server-side call to the render endpoint (§8, §9a.3).
// Always `cache: 'no-store'`: access, visibility and theme changes show on
// the next request. Server-side base URL = INTERNAL_API_URL ?? API_URL.

import { API_URL } from '@/lib/assets';
import type { Data } from '@puckeditor/core';
import type { ThemeMode } from '@/lib/theme';
import type { SpikeResolved } from './sections';
import type { SpikeThemeSettings } from './ThemeScope';

export interface RenderOrganization {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  themeMode: ThemeMode | null;
}

export type RenderResponse =
  | { renderer: 'legacy' }
  | { locked: true; organization: RenderOrganization; message: string | null }
  | {
      renderer: 'theme';
      organization: RenderOrganization;
      settings: SpikeThemeSettings;
      document: Data;
      resolved: SpikeResolved;
    };

const SERVER_API_URL = process.env.INTERNAL_API_URL || API_URL;

export async function fetchRender(
  orgId: string,
  page: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: RenderResponse | null; ms: number }> {
  const started = performance.now();
  const res = await fetch(
    `${SERVER_API_URL}/organizations/${encodeURIComponent(orgId)}/public/storefront/render?page=${encodeURIComponent(page)}`,
    { cache: 'no-store', headers, signal: AbortSignal.timeout(5000) },
  );
  const body = res.ok ? ((await res.json()) as RenderResponse) : null;
  return { status: res.status, body, ms: performance.now() - started };
}
