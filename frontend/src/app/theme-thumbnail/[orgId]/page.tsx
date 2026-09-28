// Spike 038-0 (§9a.5): cookie-free thumbnail render. The token rides in the
// query string, never in a cookie, so any number of thumbnails can load at
// once. No script runs in the sandboxed iframe, so the theme mode is written
// into the markup: a `dark` class on an outer wrapper (Tailwind's class
// strategy matches any ancestor; `.dark .brand-scope` needs a descendant).
//
// Not `/_thumbnail`: App Router treats `_folders` as private (not routable).
import { notFound } from 'next/navigation';
import { Render } from '@puckeditor/core/rsc';
import { renderConfig } from '@/theme/spike/config.render';
import ThemeScope from '@/theme/spike/ThemeScope';
import { fetchRender } from '@/theme/spike/render';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function ThumbnailPage({
  params,
  searchParams,
}: {
  params: { orgId: string };
  searchParams: { t?: string };
}) {
  if (!searchParams.t) notFound();
  const { body } = await fetchRender(params.orgId, 'home', { 'X-Theme-Thumbnail': searchParams.t });
  if (!body || !('renderer' in body) || body.renderer !== 'theme') notFound();
  const mode = body.organization.themeMode;
  const dark = mode === 'DARK';
  return (
    <div className={dark ? 'dark' : 'light'} data-thumbnail-mode={dark ? 'dark' : 'light'} style={{ colorScheme: dark ? 'dark' : 'light' }}>
      <ThemeScope brandColor={body.organization.brandColor} themeMode={mode} settings={body.settings} staticMode>
        <Render config={renderConfig} data={body.document} metadata={{ resolved: body.resolved }} />
      </ThemeScope>
    </div>
  );
}
