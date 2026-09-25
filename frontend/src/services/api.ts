// Base HTTP client for API calls
// Error handling and Authorization header injection

import { getSession, signOut } from 'next-auth/react';
import type { OrderAddOnLine } from '@/lib/addOns';
import { allStorefrontAccessTokens } from '@/lib/storefrontAccess';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

let activeOrganizationId: string | null = null;

/**
 * Step-up proof for security mutations (spec 030 B). Set by useReauth after
 * the user re-proves who they are; sent as X-Jump-Reauth on every request
 * while it lasts (10 min server-side).
 */
let reauthToken: string | null = null;
export function setReauthToken(token: string | null) {
  reauthToken = token;
}
export function getReauthToken(): string | null {
  return reauthToken;
}
/** Set by OrgContext whenever the admin org switcher changes. */
export function setActiveOrganizationId(id: string | null) {
  activeOrganizationId = id;
}
/** The organization the admin org switcher chose (for direct `fetch` calls such as CSV downloads). */
export function getActiveOrganizationId(): string | null {
  return activeOrganizationId;
}

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>;
}

/**
 * A 401 SESSION_REVOKED means this device was logged out from Account ›
 * Security › Devices (spec 030 D). Drop the cookie and land on sign-in;
 * the Auth.js claims refresh would do it within a minute anyway.
 */
let revokedSignOutStarted = false;
function handleRevokedSession(status: number, code: unknown) {
  if (status !== 401 || code !== 'SESSION_REVOKED' || typeof window === 'undefined' || revokedSignOutStarted) return;
  revokedSignOutStarted = true;
  void signOut({ callbackUrl: '/auth/signin?reason=revoked' });
}

/** A 401 TWO_STEP_REQUIRED means the second step is still due (spec 030 C): go finish it. */
let twoStepRedirectStarted = false;
function handleTwoStepRequired(status: number, code: unknown) {
  if (status !== 401 || code !== 'TWO_STEP_REQUIRED' || typeof window === 'undefined' || twoStepRedirectStarted) return;
  if (window.location.pathname.startsWith('/auth/two-step')) return;
  twoStepRedirectStarted = true;
  const callbackUrl = window.location.pathname + window.location.search;
  window.location.assign(`/auth/two-step?callbackUrl=${encodeURIComponent(callbackUrl)}`);
}

class ApiClient {
  private baseURL: string;

  constructor(baseURL: string = API_URL) {
    this.baseURL = baseURL;
  }

  async request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;

    // Auto-inject Authorization header from Auth.js session
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Active organization chosen in the admin org switcher (spec 007 phase 4).
    // The backend honors it only when the user is a member of that organization.
    if (activeOrganizationId && !headers['X-Jump-Org']) {
      headers['X-Jump-Org'] = activeOrganizationId;
    }
    if (reauthToken && !headers['X-Jump-Reauth']) {
      headers['X-Jump-Reauth'] = reauthToken;
    }

    // Private storefront tokens (Online store › Preferences › Store access):
    // send every one the visitor holds; the backend picks the matching org.
    if (typeof window !== 'undefined' && !headers['X-Storefront-Access']) {
      const tokens = allStorefrontAccessTokens();
      if (tokens.length) headers['X-Storefront-Access'] = tokens.join(',');
    }

    if (typeof window !== 'undefined' && !headers['Authorization']) {
      try {
        const session = (await getSession()) as any;
        if (session?.accessToken) {
          headers['Authorization'] = `Bearer ${session.accessToken}`;
        }
      } catch {
        // No session available — proceed without auth
      }
    }

    const config: RequestInit = {
      ...options,
      headers,
    };

    try {
      const response = await fetch(url, config);
      const text = await response.text();
      const data = text ? JSON.parse(text) : undefined;

      if (!response.ok) {
        handleRevokedSession(response.status, data?.code);
        handleTwoStepRequired(response.status, data?.code);
        throw {
          status: response.status,
          message: data?.message || 'Request failed',
          error: data?.error,
          // Machine-readable code from the backend error handler (e.g. EMAIL_TAKEN)
          code: data?.code,
          details: data?.details,
        };
      }

      return data;
    } catch (error: any) {
      if (error.status) {
        throw error; // Re-throw API errors
      }
      // Network or parse errors
      throw {
        status: 0,
        message: 'Network error',
        error: error.message,
      };
    }
  }

  get<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T = any>(endpoint: string, data: any, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  patch<T = any>(endpoint: string, data: any, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  put<T = any>(endpoint: string, data: any, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  delete<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  async upload<T = any>(
    endpoint: string,
    formData: FormData,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;

    // Don't set Content-Type — browser sets multipart boundary automatically
    const headers: Record<string, string> = {
      ...options.headers,
    };
    if (activeOrganizationId && !headers['X-Jump-Org']) {
      headers['X-Jump-Org'] = activeOrganizationId;
    }

    if (typeof window !== 'undefined' && !headers['Authorization']) {
      try {
        const session = (await getSession()) as any;
        if (session?.accessToken) {
          headers['Authorization'] = `Bearer ${session.accessToken}`;
        }
      } catch {
        // No session available
      }
    }

    const response = await fetch(url, {
      ...options,
      method: 'POST',
      headers,
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      handleRevokedSession(response.status, data?.code);
      handleTwoStepRequired(response.status, data?.code);
      throw {
        status: response.status,
        message: data.message || 'Upload failed',
        error: data.error,
        code: data.code,
      };
    }
    return data;
  }
}

// ===== Orders =====

export interface OrderSummary {
  id: string;
  orderRef: string;
  eventName: string;
  eventDate: string;
  quantity: number;
  totalAmount: number;
  currency: string;
  status: string;
  createdAt: string;
}

export interface OrderTicket {
  id: string;
  barcode: string;
  qrCodeDataUrl: string | null;
  priceTierName: string;
  pricePaid: number;
  status: 'VALID' | 'REDEEMED' | 'EXPIRED' | 'VOIDED';
  redeemedAt: string | null;
  createdAt: string;
}

export interface OrderDetail {
  id: string;
  orderRef: string;
  event: {
    id: string;
    name: string;
    date: string;
    venue?: {
      id: string;
      name: string;
      address: string;
      /** IANA zone of the event's venue (spec 033). */
      timezone?: string | null;
    };
  };
  contact: {
    firstName: string;
    lastName: string;
    email: string;
  };
  quantity: number;
  totalAmount: number;
  currency: string;
  status: string;
  tickets: OrderTicket[];
  /** Add-on lines bought with the tickets (spec 012). */
  addOns?: OrderAddOnLine[];
  payment: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    failureReason: string | null;
    createdAt: string;
  } | null;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ===== Online Store Pages =====

export interface OnlineStorePage {
  id: string;
  title: string;
  /** URL handle, unique per organization: /organizations/:orgId/pages/:slug */
  slug: string;
  content: string;
  isVisible: boolean;
  /** Search engine listing overrides; null falls back to the title / no description */
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Body for POST /admin/pages and PUT /admin/pages/:id (PUT is partial). */
export interface OnlineStorePageInput {
  title: string;
  content: string;
  isVisible: boolean;
  /** Empty string: derive the handle from the title */
  slug: string;
  seoTitle: string | null;
  seoDescription: string | null;
}

// ===== Online Store Preferences =====

/** GET/PATCH /admin/online-store/preferences. The password itself is never returned. */
export interface StorefrontPreferences {
  /** Visitors need the store password to see the storefront. */
  storefrontPrivate: boolean;
  hasPassword: boolean;
  /** Shown on the password page; null falls back to a default line. */
  storefrontMessage: string | null;
  /** Homepage <title> / meta description; null falls back to the store name / none. */
  seoTitle: string | null;
  seoDescription: string | null;
  /** Redirect visitors to the language matching their browser when available. */
  autoRedirectLanguage: boolean;
}

/** Partial body for PATCH /admin/online-store/preferences. `password: null` clears it. */
export type StorefrontPreferencesInput = Partial<
  Omit<StorefrontPreferences, 'hasPassword'> & { password: string | null }
>;

// ===== Maps (spec 014 phase 1) =====

export type FloorMapStatus = 'DRAFT' | 'PUBLISHED';
export type BoothKind = 'BOOTH' | 'TABLE';
export type BoothStatus = 'AVAILABLE' | 'HELD' | 'SOLD' | 'RESERVED' | 'BLOCKED';

export interface AdminMap {
  id: string;
  eventId: string;
  name: string;
  status: FloorMapStatus;
  width: number;
  height: number;
  unit: string;
  boothCount: number;
  soldCount: number;
  reservedCount: number;
  blockedCount: number;
  event: { id: string; name: string; slug: string; date: string; timezone?: string | null };
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MapElement {
  id: string;
  kind: 'wall' | 'aisle' | 'stage' | 'entrance' | 'restroom' | 'food' | 'info' | 'firstAid' | 'programming' | 'label';
  x: number;
  y: number;
  w: number;
  h: number;
  caption?: string;
  text?: string;
  size?: 'S' | 'M' | 'L';
  orientation?: 'h' | 'v';
}

export interface MapBooth {
  id: string;
  mapId: string;
  label: string;
  kind: BoothKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  tierId: string | null;
  status: BoothStatus;
  applicationId: string | null;
  assignedById: string | null;
  createdAt: string;
  updatedAt: string;
  holder?: {
    id: string;
    status: string;
    paymentStatus: string;
    businessName: string | null;
  } | null;
}

export interface MapTier {
  id: string;
  name: string;
  price: number;
  mapBound: boolean;
  quantityTotal: number | null;
  form: { id: string; name: string; slug: string } | null;
  displayOrder: number;
}

export interface AdminMapDetail {
  id: string;
  organizationId: string;
  eventId: string;
  name: string;
  status: FloorMapStatus;
  unit: string;
  gridSize: number;
  width: number;
  height: number;
  underlayFileId: string | null;
  underlayOpacity: number;
  layout: { version: number; elements: MapElement[] };
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  booths: MapBooth[];
  tiers: MapTier[];
}

export interface LayoutBoothInput {
  id?: string;
  label: string;
  kind: BoothKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  tierId: string | null;
}

export interface LayoutInput {
  elements: Omit<MapElement, 'id'>[];
  booths: LayoutBoothInput[];
}

export interface AssignableApplication {
  id: string;
  businessName: string | null;
  contactName: string;
  email: string;
  tier: { id: string; name: string; price: number; mapBound: boolean } | null;
  tierMatch: boolean;
  status: string;
}

// Public map types
export interface PublicMapLegendTier {
  tierId: string;
  name: string;
  price: number; // all-in price in dollars (FeeService units)
  swatch: number; // 0-5
}

export interface PublicMapBooth {
  id: string;
  label: string;
  kind: BoothKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  status: BoothStatus;
  tier: { id: string; name: string; price: number } | null;
  vendorName: string | null;
}

export interface PublicMapVendor {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  socials: Record<string, string>;
  imageUrl: string | null;
  category: string;
  tier: { id: string; name: string } | null;
  booth: { id: string; label: string } | null;
}

export interface PublicMap {
  id: string;
  eventId: string;
  name: string;
  width: number;
  height: number;
  unit: string;
  gridSize: number;
  layout: { version: number; elements: MapElement[] };
  underlayFileId: string | null;
  underlayUrl: string | null;
  underlayOpacity: number;
  legend: PublicMapLegendTier[];
  vendors: PublicMapVendor[];
  booths: PublicMapBooth[];
  brandColor: string | null;
  themeMode: string;
  updatedAt: string;
  etag: string;
}

// ===== RSVP Events (spec 034) =====

export interface RsvpRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  partySize: number;
  status: 'GOING' | 'CANCELLED';
  subscribed: boolean;
  createdAt: string;
  cancelledAt: string | null;
}

export interface RsvpListResponse {
  headcount: number;
  rsvpCount: number;
  cancelledCount: number;
  data: RsvpRow[];
}

export interface RsvpCreatePayload {
  firstName: string;
  lastName: string;
  email: string;
  partySize?: number;
  marketing: boolean;
  acceptances: { document: string; version: string }[];
}

export interface RsvpCancelPayload {
  token: string;
}

export const rsvpApi = {
  create: (eventId: string, data: RsvpCreatePayload) =>
    api.post<{ status: string }>(`/events/${eventId}/rsvps`, data),
  cancel: (data: RsvpCancelPayload) =>
    api.post<RsvpRow>('/rsvps/cancel', data),
  listAdmin: (eventId: string) =>
    api.get<RsvpListResponse>(`/admin/events/${eventId}/rsvps`),
};

// ===== Vendor door check-in (spec 036) =====

export interface DoorVendor {
  id: string;
  shortId: string;
  businessName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  formName: string | null;
  tierName: string | null;
  booth: { id: string; mapId: string; label: string; status: string } | null;
  boothLabel: string | null;
  checkedInAt: string | null;
  checkedInById: string | null;
  checkedInVia: 'SEARCH' | 'SCAN' | 'TOGGLE' | null;
}

export interface DoorRoster {
  event: { id: string; name: string; date: string; venueName: string | null; timezone: string | null } | null;
  counts: { expected: number; arrived: number; awaiting: number };
  data: DoorVendor[];
}

/** Every write here is idempotent server-side, so the door page may retry freely. */
export const checkInApi = {
  roster: (eventId: string) => api.get<DoorRoster>(`/admin/events/${eventId}/check-in`),
  scan: (eventId: string, payload: string) =>
    api.post<DoorVendor>(`/admin/events/${eventId}/check-in/scan`, { payload }),
  checkIn: (eventId: string, applicationId: string, via: 'SEARCH' | 'SCAN' = 'SEARCH') =>
    api.post<{ alreadyCheckedIn: boolean; vendor: DoorVendor }>(`/admin/events/${eventId}/check-in/${applicationId}`, { via }),
  undo: (eventId: string, applicationId: string) =>
    api.delete<{ alreadyCheckedIn: boolean; vendor: DoorVendor }>(`/admin/events/${eventId}/check-in/${applicationId}`),
};

export const mapsApi = {
  list: () => api.get<AdminMap[]>('/admin/maps'),
  create: (data: { eventId: string; name?: string; width?: number; height?: number; unit?: string }) =>
    api.post<AdminMapDetail>('/admin/maps', data),
  get: (mapId: string) => api.get<AdminMapDetail>(`/admin/maps/${mapId}`),
  update: (mapId: string, data: Partial<Pick<AdminMapDetail, 'name' | 'width' | 'height' | 'unit' | 'gridSize' | 'underlayFileId' | 'underlayOpacity'>>) =>
    api.patch<AdminMapDetail>(`/admin/maps/${mapId}`, data),
  replaceLayout: (mapId: string, data: LayoutInput) =>
    api.put<AdminMapDetail>(`/admin/maps/${mapId}/layout`, data),
  publish: (mapId: string) => api.post<AdminMapDetail>(`/admin/maps/${mapId}/publish`, {}),
  unpublish: (mapId: string) => api.post<AdminMapDetail>(`/admin/maps/${mapId}/unpublish`, {}),
  remove: (mapId: string) => api.delete<void>(`/admin/maps/${mapId}`),
  assignableApplications: (mapId: string, boothId: string, q?: string) =>
    api.get<AssignableApplication[]>(`/admin/maps/${mapId}/booths/${boothId}/assignable${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  assignBooth: (mapId: string, boothId: string, applicationId: string, force?: boolean) =>
    api.post<{ boothId: string; label: string; status: string }>(`/admin/maps/${mapId}/booths/${boothId}/assign`, { applicationId, force }),
  unassignBooth: (mapId: string, boothId: string) =>
    api.post<{ boothId: string; label: string; status: string }>(`/admin/maps/${mapId}/booths/${boothId}/unassign`, {}),
  moveBooth: (mapId: string, boothId: string, targetBoothId: string) =>
    api.post<{ fromBooth: string; toBooth: string; label: string }>(`/admin/maps/${mapId}/booths/${boothId}/move`, { targetBoothId }),
  setBoothStatus: (mapId: string, boothId: string, status: 'AVAILABLE' | 'RESERVED' | 'BLOCKED') =>
    api.post<{ boothId: string; label: string; status: string }>(`/admin/maps/${mapId}/booths/${boothId}/status`, { status }),
  getEventMapId: (eventId: string) =>
    api.get<{ mapId: string } | null>(`/admin/events/${eventId}/map`),
  // Public map
  getPublicEventMap: (eventId: string, etag?: string) =>
    api.get<PublicMap>(`/events/${encodeURIComponent(eventId)}/map`, etag ? { headers: { 'If-None-Match': etag } } : {}),
  // Vendor booth purchase (spec 014 phase 2). Guest status links authenticate
  // with `?token=` like the other /applications/:id/* routes; the buyer-session
  // variant goes through the Next proxy so the httpOnly `jump_buyer` cookie is sent.
  chooseBooth: (applicationId: string, boothId: string, token: string) =>
    api.post<ChooseBoothResult>(
      `/applications/${encodeURIComponent(applicationId)}/booth?token=${encodeURIComponent(token)}`,
      { boothId }
    ),
  chooseBoothForContact: async (applicationId: string, boothId: string): Promise<ChooseBoothResult> => {
    const res = await fetch(`/api/buyer/me/applications/${encodeURIComponent(applicationId)}/booth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boothId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw { status: res.status, message: body.message || 'Could not choose that booth', error: body.error, code: body.code };
    return body as ChooseBoothResult;
  },
};

/**
 * What `POST …/booth` returns once the hold is taken: `status` is the booth's
 * state after any immediate off-session charge (HELD while Checkout or a
 * webhook settles it, SOLD when the card already went through, AVAILABLE when
 * the card was declined and the hold was released) and `paymentStatus` the
 * application's. Success is only ever `paymentStatus === 'PAID'`.
 */
export interface ChooseBoothResult {
  boothId: string;
  holdExpiresAt: string | null;
  status: BoothStatus;
  paymentStatus?: string;
}

// ===== Settings › Customer accounts (spec 031) =====

/** GET/PATCH /admin/settings/customer-accounts. */
export type SelfServeRefundFeeType = 'NONE' | 'FIXED' | 'PERCENT';
export type BuyerSignInMethod = 'LINK' | 'CODE';

export interface CustomerAccountSettings {
  /** Show the buyer sign-in link in the storefront header and at checkout. */
  buyerSignInLinks: boolean;
  /** Self-serve refund policy (phase 2), applied on top of each tier's isRefundable flag. */
  refundPolicy: {
    enabled: boolean;
    /** Hours before the event start after which buyers can no longer refund; null = until the event starts. */
    cutoffHours: number | null;
    feeType: SelfServeRefundFeeType;
    feeValue: number | null;
  };
  /** How buyers sign in: the email link alone, or a six-digit code typed on the account page (phase 3). */
  signInMethod: BuyerSignInMethod;
  /** Public buyer account URL: /account on the active custom domain, else the platform path. */
  accountUrl: string;
  domain: { hostname: string } | null;
}

export type CustomerAccountSettingsInput = Partial<{
  buyerSignInLinks: boolean;
  buyerSignInMethod: BuyerSignInMethod;
  selfServeRefundsEnabled: boolean;
  selfServeRefundCutoffHours: number | null;
  selfServeRefundFeeType: SelfServeRefundFeeType;
  selfServeRefundFeeValue: number | null;
}>;

// ===== Ticket Scanning & Redemption =====

export interface TicketPreview {
  ticketId: string;
  barcode: string;
  status: 'VALID' | 'REDEEMED' | 'EXPIRED' | 'VOIDED';
  priceTierName: string;
  contactName: string;
  contactEmail: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  redeemedAt: string | null;
}

export interface RedemptionResult {
  status: 'REDEEMED';
  ticketId: string;
  barcode: string;
  priceTierName: string;
  contactName: string;
  redeemedAt: string;
}

export interface RedemptionRejection {
  status: 'ALREADY_REDEEMED' | 'EXPIRED' | 'VOIDED' | 'WRONG_EVENT';
  ticketId: string;
  message: string;
  originalRedemptionTime?: string;
}

export interface RedemptionError {
  status: number;
  message: string;
  error?: string;
}

export interface OrderTicketPreview {
  ticketId: string;
  barcode: string;
  ticketNumber: number;
  status: 'VALID' | 'REDEEMED' | 'EXPIRED' | 'VOIDED';
  priceTierName: string;
  contactName: string;
  contactEmail: string;
  redeemedAt: string | null;
}

export interface OrderScanResult {
  scannedTicketId: string;
  orderRef: string;
  eventName: string;
  eventDate: string;
  eventId: string;
  totalTickets: number;
  /** Add-ons bought with the order (spec 012), for hand-over at the door */
  addOns?: { name: string; quantity: number }[];
  tickets: OrderTicketPreview[];
}

export const api = new ApiClient();
export default api;

/**
 * Download a CSV from the API as a file. Injects auth, X-Jump-Org headers
 * like `api.request`, but returns the response as a Blob for download rather
 * than parsing JSON. Triggers a browser download via a temporary anchor.
 * Prefers the server's Content-Disposition filename if present; falls back
 * to the provided `filename`.
 */
export async function downloadCsv(endpoint: string, filename: string): Promise<void> {
  const url = `${API_URL}${endpoint}`;
  const headers: Record<string, string> = {};

  if (activeOrganizationId) {
    headers['X-Jump-Org'] = activeOrganizationId;
  }

  if (typeof window !== 'undefined') {
    try {
      const session = (await (await import('next-auth/react')).getSession()) as any;
      if (session?.accessToken) {
        headers['Authorization'] = `Bearer ${session.accessToken}`;
      }
    } catch {
      // No session — proceed without auth
    }
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw { status: response.status, message: text || 'CSV download failed' };
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;

  // Prefer the server's Content-Disposition filename
  const cd = response.headers.get('Content-Disposition');
  const serverFilename = cd ? cd.match(/filename="?([^";]+)"?/)?.[1] : null;
  a.download = serverFilename || filename;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}
