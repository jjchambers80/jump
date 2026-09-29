// Server frame for themed storefront pages (spec 038 §8): theme scope with
// the org's brand, forced mode and settings, then the header group, the
// page body and the footer group. Server Component; islands inside (nav
// drawer, announcement rotation, sign-in link) hydrate on their own.

import type { ReactNode } from 'react';
import { Render } from '@puckeditor/core/rsc';
import { renderConfig } from './render/config';
import ThemeScope from './ThemeScope';
import { schemeCss, settingsVars } from './settingsCss';
import type { SectionContext } from './sections/context';
import type { ThemeDocument, ThemeRender } from './types';

function renderDocument(doc: ThemeDocument, ctx: SectionContext) {
  // Puck's Data shape; documents never carry drop zones (validated server-side).
  return <Render config={renderConfig} data={{ root: doc.root, content: doc.content, zones: {} } as any} metadata={{ ctx }} />;
}

export default function ThemeFrame({
  data,
  host,
  nameIsHeading = false,
  children,
}: {
  data: ThemeRender;
  host: string | null;
  /** The organization name is the page's h1 (org home). */
  nameIsHeading?: boolean;
  children: ReactNode;
}) {
  const ctx: SectionContext = {
    organization: data.organization,
    resolved: data.resolved,
    settings: data.settings,
    content: data.content,
    host,
    nameIsHeading,
  };
  return (
    <ThemeScope
      brandColor={data.organization.brandColor}
      themeMode={data.organization.themeMode}
      vars={settingsVars(data.settings)}
      css={schemeCss(data.settings)}
      className="min-h-screen bg-gray-50 dark:bg-slate-900"
    >
      <div data-theme-frame={data.theme.id ?? 'preset'}>
        {renderDocument(data.documents.header, ctx)}
        {children}
        {renderDocument(data.documents.footer, ctx)}
      </div>
    </ThemeScope>
  );
}
