'use client';

// Shared state for the patron account (spec 040): the organization, the
// signed-in buyer and the application list (the nav hides the Applications
// tab when it is empty; the overview surfaces the ones waiting on the buyer).
// Provided by `account/(member)/layout.tsx`; every account page reads it.

import { createContext, useContext } from 'react';
import type { ThemeMode } from '@/lib/theme';
import type { ApplicantApplication } from '@/lib/applications';

export interface AccountOrganization {
  id: string;
  name: string;
  slug?: string | null;
  logoUrl: string | null;
  brandColor?: string | null;
  themeMode?: ThemeMode | null;
  /** Spec 031 phase 3: CODE organizations show a six-digit code field after the email step. */
  buyerSignInMethod?: 'LINK' | 'CODE';
}

export interface AccountProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organization: { id: string; name: string };
}

export interface AccountContextValue {
  org: AccountOrganization;
  profile: AccountProfile;
  /** null while loading. */
  applications: ApplicantApplication[] | null;
  reloadApplications: () => Promise<void>;
  /** Account path in platform form, shortened on custom domains: `href('orders')` → `/account/orders`. */
  href: (section?: string) => string;
}

export const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount must be used inside the account layout');
  return value;
}
