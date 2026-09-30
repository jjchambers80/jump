'use client';

// Frame for account pages a visitor reaches from an emailed link without a
// session (spec 040: confirm a new email, unsubscribe): the organization's
// header and brand colours around one centred card.

import React, { useEffect, useState } from 'react';
import { api } from '@/services/api';
import BrandScope from '@/components/BrandScope';
import OrganizationHeader from '@/components/OrganizationHeader';
import type { AccountOrganization } from './AccountContext';

export default function TokenPageShell({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  const [org, setOrg] = useState<AccountOrganization | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ organization: AccountOrganization }>(`/organizations/${orgId}/public`)
      .then((r) => !cancelled && setOrg(r.organization))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return (
    <BrandScope color={org?.brandColor} themeMode={org?.themeMode} className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {org && <OrganizationHeader organization={{ id: org.id, name: org.name, logoUrl: org.logoUrl, storefrontLogo: org.storefrontLogo }} />}
      <main className="flex justify-center px-4 py-12 sm:py-20">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700 sm:p-8">
          {children}
        </div>
      </main>
    </BrandScope>
  );
}
