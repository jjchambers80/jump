// Server frame for themed storefront pages (spec 038 §8): theme scope with
// the org's brand, forced mode and settings, then the header group, the
// page body and the footer group. Server Component; islands inside (nav
// drawer, announcement rotation, sign-in link) hydrate on their own.

import type { CSSProperties, ReactNode } from 'react';
import { Render } from '@puckeditor/core/rsc';
import { renderConfig, renderable } from './render/config';
import RetroGridBackground from './RetroGridBackground';
import ThemeScope from './ThemeScope';
import PreviewBar, { ClearPreviewCookie } from './PreviewBar';
import { pageWidthVars, schemeCss, settingsVars } from './settingsCss';
import type { SectionContext } from './sections/context';
import type { ThemeDocument, ThemeRender } from './types';

// The page opens with an edge-to-edge Hero that has an image or video: the only
// case where a header laid over it still has something to sit on.
function heroUnderHeader(data: ThemeRender): string | undefined {
  const first = data.documents.template && renderable(data.documents.template).content[0];
  const p = first?.type === 'Hero' ? first.props : null;
  const media = p && (p.image?.fileId || p.video?.fileId || p.videoWebm?.fileId);
  return media && (p.layout ?? 'full-bleed') === 'full-bleed' && p.sectionWidth === 'full' ? p.id : undefined;
}

function renderDocument(doc: ThemeDocument, ctx: SectionContext) {
  // Puck's Data shape; documents never carry drop zones (validated server-side).
  const data = renderable(doc);
  return <Render config={renderConfig} data={{ root: data.root, content: data.content, zones: {} } as any} metadata={{ ctx }} />;
}

export default function ThemeFrame({
  data,
  host,
  nameIsHeading = false,
  path,
  query = {},
  overlayHeader = false,
  children,
}: {
  data: ThemeRender;
  host: string | null;
  /** The organization name is the page's h1 (org home). */
  nameIsHeading?: boolean;
  /** Current path and query (EventList filter and page links). */
  path: string;
  query?: Record<string, string | undefined>;
  /**
   * Home page: lay the header group over an opening full-width Hero (dark,
   * solid at the top fading to transparent) instead of above it.
   */
  overlayHeader?: boolean;
  /** The page body. Omitted: the template document renders as the page's main. */
  children?: ReactNode;
}) {
  const ctx: SectionContext = {
    organization: data.organization,
    resolved: data.resolved,
    settings: data.settings,
    content: data.content,
    host,
    nameIsHeading,
    path,
    query,
    heroUnderHeaderId: overlayHeader && !children ? heroUnderHeader(data) : undefined,
  };
  // `dark` switches the header's own dark: styles on (light text) whatever the
  // page mode; a scheme background on the Header section would hide the gradient.
  const header = ctx.heroUnderHeaderId ? (
    <div
      data-header-overlay
      className="dark absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black via-black/60 to-transparent pb-4 [&_[data-section=Header]]:!bg-transparent"
    >
      {renderDocument(data.documents.header, ctx)}
    </div>
  ) : (
    renderDocument(data.documents.header, ctx)
  );
  return (
    <ThemeScope
      brandColor={data.organization.brandColor}
      themeMode={data.organization.themeMode}
      vars={settingsVars(data.settings)}
      css={schemeCss(data.settings)}
      className="min-h-screen bg-gray-50 dark:bg-slate-900"
    >
      {data.previewInvalid && <ClearPreviewCookie />}
      <RetroGridBackground settings={data.settings} />
      {/* relative: paints above the fixed backdrop */}
      <div data-theme-frame={data.theme.id ?? 'preset'} className="relative" style={pageWidthVars(data.documents.template?.root) as CSSProperties | undefined}>
        {header}
        {children ??
          (data.documents.template && (
            <main id="storefront-main" tabIndex={-1} className="outline-none">
              {renderDocument(data.documents.template, ctx)}
            </main>
          ))}
        {renderDocument(data.documents.footer, ctx)}
      </div>
      {data.preview && !data.preview.thumbnail && <PreviewBar name={data.preview.name} path={path} />}
    </ThemeScope>
  );
}
