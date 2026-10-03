// Server frame for themed storefront pages (spec 038 §8): theme scope with
// the org's brand, forced mode and settings, then the header group, the
// page body and the footer group. Server Component; islands inside (nav
// drawer, announcement rotation, sign-in link) hydrate on their own.

import type { ReactNode } from 'react';
import { Render } from '@puckeditor/core/rsc';
import { renderConfig, renderable } from './render/config';
import ThemeScope from './ThemeScope';
import PreviewBar, { ClearPreviewCookie } from './PreviewBar';
import { schemeCss, settingsVars } from './settingsCss';
import type { SectionContext } from './sections/context';
import type { ThemeDocument, ThemeRender } from './types';

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
  children,
}: {
  data: ThemeRender;
  host: string | null;
  /** The organization name is the page's h1 (org home). */
  nameIsHeading?: boolean;
  /** Current path and query (EventList filter and page links). */
  path: string;
  query?: Record<string, string | undefined>;
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
  };
  return (
    <ThemeScope
      brandColor={data.organization.brandColor}
      themeMode={data.organization.themeMode}
      vars={settingsVars(data.settings)}
      css={schemeCss(data.settings)}
      className="min-h-screen bg-gray-50 dark:bg-slate-900"
    >
      {data.preview && <PreviewBar name={data.preview.name} path={path} />}
      {data.previewInvalid && <ClearPreviewCookie />}
      <div data-theme-frame={data.theme.id ?? 'preset'}>
        {renderDocument(data.documents.header, ctx)}
        {children ??
          (data.documents.template && (
            <main id="storefront-main" tabIndex={-1} className="outline-none">
              {renderDocument(data.documents.template, ctx)}
            </main>
          ))}
        {renderDocument(data.documents.footer, ctx)}
      </div>
    </ThemeScope>
  );
}
