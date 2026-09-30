'use client';

// Shared state for the patron account (spec 040): the organization, the
// signed-in buyer, and the application and RSVP lists (the nav hides the Applications
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
  phone?: string | null;
  location?: string | null;
  emailSubscribed?: boolean;
  /** Address an email change is waiting on (spec 040). */
  pendingEmail?: string | null;
  /** The exact marketing consent label; the backend records it as the acceptance text. */
  marketingConsentText?: string;
  /** "Delete my data" confirmed; the account is erased at this moment unless cancelled (spec 040 card D). */
  erasureScheduledAt?: string | null;
  organization: { id: string; name: string };
}

export interface AccountRsvp {
  id: string;
  partySize: number;
  status: 'GOING' | 'CANCELLED';
  cancelledAt: string | null;
  createdAt: string;
  event: {
    id: string;
    slug?: string | null;
    name: string;
    date: string;
    /** IANA zone of the venue (spec 033). */
    timezone: string | null;
    venue: { name: string; city?: string | null; state?: string | null } | null;
  };
}

export interface AccountContextValue {
  org: AccountOrganization;
  profile: AccountProfile;
  /** Replace the profile after a save (name, phone, pending email, marketing). */
  setProfile: (profile: AccountProfile) => void;
  /** null while loading. */
  applications: ApplicantApplication[] | null;
  reloadApplications: () => Promise<void>;
  /** null while loading; the RSVPs tab shows only when there are some. */
  rsvps: AccountRsvp[] | null;
  reloadRsvps: () => Promise<void>;
  /** Account path in platform form, shortened on custom domains: `href('orders')` → `/account/orders`. */
  href: (section?: string) => string;
}

export const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount must be used inside the account layout');
  return value;
}
