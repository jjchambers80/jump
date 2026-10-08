// Shapes of GET /organizations/:id/public/storefront/render (contracts C1).

import type { EventSummary } from '@/components/EventCard';
import type { PublicMenus } from '@/lib/menus';
import type { PublicGallery } from '@/lib/galleries';
import type { ThemeMode } from '@/lib/theme';
import type { PublicPage } from '@/components/storefront/StorefrontPageBody';

export interface ThemeItem {
  type: string;
  props: Record<string, any> & { id: string; hidden?: boolean; blocks?: ThemeItem[] };
}

export interface ThemeDocument {
  root: { props: Record<string, any> };
  content: ThemeItem[];
}

export interface RenderOrganization {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  brandColor: string | null;
  themeMode: ThemeMode | null;
  buyerSignInLinks: boolean;
}

export interface ThemeScheme {
  id: string;
  name: string;
  background: string;
  foreground: string;
  accent: string;
  accentForeground: string;
  secondaryButtonLabel: string;
  border: string;
  muted: string;
  shadow: string;
}

export type ThemeSettings = Record<string, Record<string, any>> & {
  colors?: { schemes?: ThemeScheme[] };
};

export interface ResolvedData {
  events: EventSummary[];
  menus: PublicMenus;
  links: Record<string, string>;
  files: Record<string, { url: string; width: number | null; height: number | null; alt: string | null; mimeType?: string }>;
  /** Galleries placed by Gallery sections (spec 046), keyed by id; missing = render nothing. */
  galleries?: Record<string, PublicGallery>;
  /** The Content page being rendered (`page=page:<id or slug>`). */
  page?: PublicPage;
}

export interface ThemeRender {
  renderer: 'theme';
  page: string;
  fallback: boolean;
  theme: { id: string | null; name: string };
  organization: RenderOrganization;
  settings: ThemeSettings;
  content: Record<string, string>;
  documents: { header: ThemeDocument; template: ThemeDocument | null; footer: ThemeDocument };
  resolved: ResolvedData;
  /** A draft theme opened through a preview link (D11). */
  preview?: { themeId: string; name: string; expiresAt: string; share: boolean; thumbnail?: true };
  /** A preview cookie was sent but no longer fits: the frame clears it. */
  previewInvalid?: true;
}

export interface StorefrontLockInfo {
  organization: { id: string; name: string; logoUrl: string | null; brandColor?: string | null; themeMode?: ThemeMode | null };
  message: string | null;
}
