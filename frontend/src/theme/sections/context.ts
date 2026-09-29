// What every theme section reads besides its own props. Passed through Puck
// `metadata` so sections stay presentational: they never fetch (§8 step 3).

import type { ResolvedData, RenderOrganization, ThemeSettings } from '../types';

export interface SectionContext {
  organization: RenderOrganization;
  resolved: ResolvedData;
  settings: ThemeSettings;
  content: Record<string, string>;
  /** Custom-domain host, for shortening links; null on the platform host. */
  host: string | null;
  /** The organization name is this page's h1 (org home / events page). */
  nameIsHeading: boolean;
}

export function sectionContext(metadata: Record<string, unknown> | undefined): SectionContext {
  return (metadata ?? {}).ctx as SectionContext;
}

/** Catalog string with `{vars}` filled in (spec 038 D15). */
export function t(ctx: SectionContext, key: string, vars: Record<string, string> = {}) {
  const template = ctx.content?.[key] ?? key;
  return template.replace(/\{([a-z][a-zA-Z0-9]*)\}/g, (whole, name) => vars[name] ?? whole);
}

/** Section padding from the common settings (0-80 px, validated server-side). */
export function sectionPadding(props: { paddingTop?: unknown; paddingBottom?: unknown }) {
  const px = (v: unknown, d: number) => `${typeof v === 'number' ? v : d}px`;
  return { paddingTop: px(props.paddingTop, 0), paddingBottom: px(props.paddingBottom, 0) };
}
