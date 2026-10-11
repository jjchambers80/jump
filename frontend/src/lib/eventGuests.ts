// Special guest lineup (spec 050 §6.3 / §7.6, card 050-Q).

/** Public event payload row: visible guests only, in order. */
export interface EventGuest {
  id: string;
  name: string;
  role: string | null;
  /** Plain text, rendered as text (never HTML). */
  bio: string | null;
  imageUrl: string | null;
  /** Keys of SETTINGS_GROUPS.social (instagram, x, website, …) → https URL. */
  links: Record<string, string> | null;
}

/** Organizer row (`GET …/guests`, preview payload `guests`). */
export interface AdminEventGuest extends EventGuest {
  isVisible: boolean;
  displayOrder: number;
  applicationId: string | null;
  imageId: string | null;
}

export const GUEST_LIMITS = { name: 120, role: 80, bio: 600 } as const;

/** Link keys in the order the editor and the storefront show them. */
export const GUEST_LINK_KEYS = ['website', 'instagram', 'tiktok', 'x', 'youtube', 'twitch', 'facebook', 'threads', 'reddit', 'linkedin'] as const;
