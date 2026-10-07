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
  /** Current page path and query, for filter and pagination links (EventList). */
  path: string;
  query: Record<string, string | undefined>;
  /** Inside the theme editor's canvas (038D): unresolved links still render. */
  editing?: boolean;
  /** Home page: this Hero opens the page and runs behind the header group (ThemeFrame). */
  heroUnderHeaderId?: string;
}

export function sectionContext(metadata: Record<string, unknown> | undefined): SectionContext {
  return (metadata ?? {}).ctx as SectionContext;
}

/** Catalog string with `{vars}` filled in (spec 038 D15). */
export function t(ctx: SectionContext, key: string, vars: Record<string, string> = {}) {
  const template = ctx.content?.[key] ?? key;
  return template.replace(/\{([a-z][a-zA-Z0-9]*)\}/g, (whole, name) => vars[name] ?? whole);
}

/**
 * Section padding from the common settings (0-80 px, validated server-side).
 * Only values the organizer set: a preset section without them keeps its
 * own spacing, so the default theme matches today's pages.
 */
const SECTION_WIDTHS: Record<string, string> = { narrow: '768px', wide: '1600px', full: 'none' };

/** `--theme-section-width` from the common sectionWidth enum; `page` (default) sets nothing. */
export function sectionWidthStyle(props: { sectionWidth?: unknown }): Record<string, string> {
  const width = typeof props.sectionWidth === 'string' ? SECTION_WIDTHS[props.sectionWidth] : undefined;
  return width ? { '--theme-section-width': width } : {};
}

export function sectionPadding(props: { paddingTop?: unknown; paddingBottom?: unknown }) {
  const style: { paddingTop?: string; paddingBottom?: string } = {};
  if (typeof props.paddingTop === 'number') style.paddingTop = `${props.paddingTop}px`;
  if (typeof props.paddingBottom === 'number') style.paddingBottom = `${props.paddingBottom}px`;
  return style;
}
