// Shared shape of the public event page (spec 050 §8.2). The container fills
// it from GET /events/:id; the wizard preview (050-H) builds it client side, so
// every field a draft can leave unset is nullable here and the view renders a
// placeholder for it in `preview` mode.

import type { StorefrontLogo } from '@/components/OrganizationHeader';
import type { ThemeMode } from '@/lib/theme';
import type { AddOn } from '@/lib/addOns';
import { computeTierAllInPrice } from '@/lib/fees';

export interface EventVenue {
  id: string;
  name: string;
  address: string;
  timezone?: string;
  isPublic?: boolean;
}

export interface PriceTier {
  id: string;
  name: string;
  description?: string | null;
  /** Null only in a wizard preview, before the organizer sets a price. */
  price: number | null;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  quantityAvailable: number;
  displayOrder: number;
  minPerOrder: number | null;
  maxPerOrder: number | null;
  isActive: boolean;
  isRefundable: boolean;
}

export interface EventPageEvent {
  id: string;
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  /** Null only in a wizard preview, before step 3. */
  date: string | null;
  /** Spec 050: optional end, venue wall clock. */
  endDate?: string | null;
  capacity: number | null;
  category?: string | null;
  status: string;
  admissionMode?: 'TICKETED' | 'RSVP';
  rsvpLimit?: number | null;
  rsvpMaxPartySize?: number;
  rsvpRemaining?: number | null;
  taxRate: number;
  /** Listed tier prices already include tax (spec 009 phase 3). */
  taxInclusivePricing?: boolean;
  organizationId?: string | null;
  organizationName?: string | null;
  organizationLogoUrl?: string | null;
  organizationStorefrontLogo?: StorefrontLogo | null;
  organizationBrandColor?: string | null;
  organizationThemeMode?: ThemeMode | null;
  /** Settings › Customer accounts › Show sign-in links (spec 031). */
  organizationSignInLinks?: boolean;
  venue: EventVenue | null;
  priceTiers: PriceTier[];
  /** Ticket-scope add-ons (spec 012); offered per cart tier. */
  addOns?: AddOn[];
  /** Staff draft preview (spec 050 F): set by the backend after it verified X-Event-Preview. */
  preview?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Most a buyer may pick of one tier: availability, the tier's cap, and 10. */
export const tierMaximum = (tier: PriceTier) => Math.min(tier.quantityAvailable, tier.maxPerOrder ?? 10, 10);

/** What the page shows, derived once from the event (same rules as before the split). */
export function eventPageState(event: EventPageEvent) {
  const isRsvp = event.admissionMode === 'RSVP';
  const activeTiers = event.priceTiers.filter((tier) => tier.isActive);
  const totalAvailable = isRsvp ? 0 : activeTiers.reduce((sum, tier) => sum + tier.quantityAvailable, 0);
  const isSoldOut = !isRsvp && totalAvailable === 0;
  const isPastEvent = !!event.date && new Date(event.date) < new Date();
  const canBuy = !isRsvp && !isPastEvent && !isSoldOut && activeTiers.some((tier) => tier.quantityAvailable > 0);
  const prices = activeTiers
    .filter((tier) => tier.quantityAvailable > 0 && tier.price != null)
    .map((tier) => computeTierAllInPrice(tier.price ?? 0, event.taxRate ?? 0, event.taxInclusivePricing === true).total);
  const fromPrice = canBuy && prices.length > 0 ? Math.min(...prices) : null;
  const rsvpFull = isRsvp && !isPastEvent && event.rsvpRemaining != null && event.rsvpRemaining <= 0;
  return { isRsvp, activeTiers, isSoldOut, isPastEvent, canBuy, fromPrice, rsvpFull };
}

export type EventPageState = ReturnType<typeof eventPageState>;

/** The organization identity the page is branded and headed with. */
export interface EventPageOrg {
  id?: string | null;
  name?: string | null;
  logoUrl?: string | null;
  storefrontLogo?: StorefrontLogo | null;
  brandColor?: string | null;
  themeMode?: ThemeMode | null;
  /** Settings › Customer accounts › Show sign-in links (spec 031). */
  signInLinks?: boolean;
}

export const orgFromEvent = (event: EventPageEvent): EventPageOrg => ({
  id: event.organizationId,
  name: event.organizationName,
  logoUrl: event.organizationLogoUrl,
  storefrontLogo: event.organizationStorefrontLogo,
  brandColor: event.organizationBrandColor,
  themeMode: event.organizationThemeMode,
  signInLinks: event.organizationSignInLinks,
});
