// Base HTTP client for API calls
// Error handling and Authorization header injection

import { getSession, signOut } from 'next-auth/react';
import type { OrderAddOnLine } from '@/lib/addOns';
import { allStorefrontAccessTokens } from '@/lib/storefrontAccess';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

let activeOrganizationId: string | null = null;
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
