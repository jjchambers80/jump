// Base HTTP client for API calls
// Error handling and Authorization header injection

import { getSession } from 'next-auth/react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>;
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
        throw {
          status: response.status,
          message: data?.message || 'Request failed',
          error: data?.error,
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
      throw {
        status: response.status,
        message: data.message || 'Upload failed',
        error: data.error,
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

// ===== Ticket Redemption =====

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

export const api = new ApiClient();
export default api;
