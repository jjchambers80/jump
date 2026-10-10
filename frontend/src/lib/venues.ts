// Admin venue shapes and the small formatting rules the list, details and
// editor pages share.

export type VenueTimeZoneSource = 'DERIVED' | 'MANUAL' | 'DEFAULT';

export interface AdminVenue {
  id: string;
  name: string;
  slug?: string | null;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country?: string;
  timezone: string;
  /** Spec 033: MANUAL survives an address edit; DERIVED / DEFAULT re-derive. */
  timezoneSource?: VenueTimeZoneSource;
  isPublic: boolean;
  logoUrl: string | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  _count?: { events: number };
}

export interface VenueEvent {
  id: string;
  slug?: string | null;
  name: string;
  date: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | string;
  admissionMode?: 'TICKETED' | 'RSVP' | null;
  logoUrl?: string | null;
}

/** GET /organizations/:orgId/venues/:id */
export interface AdminVenueDetails extends AdminVenue {
  events: VenueEvent[];
}

/** "Raleigh, NC 27601" — the line under the street; empty when none is set. */
export function venueLocality(venue: Pick<AdminVenue, 'city' | 'state' | 'postalCode'>): string {
  const region = [venue.state, venue.postalCode].filter(Boolean).join(' ');
  return [venue.city, region].filter(Boolean).join(', ');
}

/** Public storefront path; the slug when there is one. */
export function venuePublicPath(venue: Pick<AdminVenue, 'id' | 'slug'>): string {
  return `/venues/${encodeURIComponent(venue.slug || venue.id)}`;
}

/** Directions link for the full address. */
export function venueMapsHref(venue: Pick<AdminVenue, 'address' | 'city' | 'state' | 'postalCode'>): string {
  const query = [venue.address, venueLocality(venue)].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export const TIME_ZONE_SOURCE_LABEL: Record<VenueTimeZoneSource, string> = {
  DERIVED: 'From the address',
  MANUAL: 'Set by hand',
  DEFAULT: 'Default — add a ZIP code to confirm',
};

export function venueMonogram(name: string): string {
  return (name.trim()[0] ?? 'V').toUpperCase();
}
