// Spike 038-0: server-rendered themed storefront page.
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Render } from '@puckeditor/core/rsc';
import { renderConfig } from '@/theme/spike/config.render';
import ThemeScope from '@/theme/spike/ThemeScope';
import { fetchRender } from '@/theme/spike/render';
import ClearAccessCookie from '@/theme/spike/ClearAccessCookie';
import UnlockForm from '@/theme/spike/UnlockForm';

export const dynamic = 'force-dynamic';

export default async function SpikeStorefrontPage({ params }: { params: { orgId: string } }) {
  // The URL may carry the slug while cookies are keyed by org id, so forward
  // every access cookie (the backend accepts up to 10, comma-separated), as
  // the browser does today with its localStorage tokens.
  const accessCookie = cookies()
    .getAll()
    .filter((c) => c.name.startsWith('jump_store_access_') && c.value)
    .slice(0, 10)
    .map((c) => c.value)
    .join(',');
  const t0 = performance.now();
  const { status, body, ms } = await fetchRender(params.orgId, 'home', accessCookie ? { 'X-Storefront-Access': accessCookie } : {});
  if (status === 404 || !body) notFound();

  if ('locked' in body) {
    return (
      <ThemeScope brandColor={body.organization.brandColor} themeMode={body.organization.themeMode} settings={{ pageWidth: 1200, radius: 16, buttonRadius: 9999, sectionGap: 0, headingFont: 'inherit' }}>
        {accessCookie && <ClearAccessCookie orgId={body.organization.id} />}
        <main data-testid="store-gate" className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">This store is private</h1>
            {body.message && <p className="mt-2 text-gray-600 dark:text-slate-400">{body.message}</p>}
            <UnlockForm orgId={body.organization.id} />
          </div>
        </main>
      </ThemeScope>
    );
  }
  if (body.renderer === 'legacy') {
    return <p data-testid="legacy-renderer">legacy renderer</p>;
  }

  const tree = (
    <ThemeScope brandColor={body.organization.brandColor} themeMode={body.organization.themeMode} settings={body.settings}>
      <Render config={renderConfig} data={body.document} metadata={{ resolved: body.resolved }} />
    </ThemeScope>
  );
  const renderMs = performance.now() - t0;
  return (
    <>
      {tree}
      <Link href="/spike/blank">Leave store</Link>
      <meta name="x-spike-fetch-ms" content={ms.toFixed(1)} />
      <meta name="x-spike-page-ms" content={renderMs.toFixed(1)} />
    </>
  );
}
