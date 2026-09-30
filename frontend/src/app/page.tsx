import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import OrganizationPage, { generateMetadata as organizationMetadata } from './organizations/[orgId]/page';

// `HOME_ORGANIZATION` (the slug, read at request time) makes the platform
// root that organization's storefront homepage, in its configured theme, at
// `/` itself. Unset: `/` keeps sending visitors to the platform event list.
// Tenant hosts never reach this page — middleware rewrites their `/`.
export const dynamic = 'force-dynamic';

function homeOrganization(): string | null {
  return process.env.HOME_ORGANIZATION?.trim() || null;
}

export async function generateMetadata(): Promise<Metadata> {
  const orgId = homeOrganization();
  return orgId ? organizationMetadata({ params: { orgId } }) : {};
}

export default function Home({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  const orgId = homeOrganization();
  if (!orgId) redirect('/events');
  return <OrganizationPage params={{ orgId }} searchParams={searchParams} />;
}
