// Spec 044D: a standing form on its own page — the no-JavaScript and
// shareable target of a page's Apply button (which normally opens a panel).

import type { Metadata } from 'next';
import { fetchPublicJson } from '@/lib/storefrontMeta';
import StandingApplyView from './StandingApplyView';

type Params = { orgId: string; formSlug: string };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const form = await fetchPublicJson<{ name: string; intro: string | null; organization: { name: string } }>(
    `/organizations/${encodeURIComponent(params.orgId)}/public/apply/${encodeURIComponent(params.formSlug)}`
  );
  if (!form) return {};
  return {
    title: `${form.name} · ${form.organization.name}`,
    description: form.intro ?? undefined,
    openGraph: { title: form.name, description: form.intro ?? undefined, siteName: form.organization.name },
  };
}

export default function StandingApplyPage({ params }: { params: Params }) {
  return <StandingApplyView orgId={params.orgId} formSlug={params.formSlug} />;
}
