// Admin Service - API wrapper for admin operations
// Event creation, updates, publishing, and dashboard stats

import { api } from './api';

export interface EventCreateData {
  name: string;
  date: string;
  venue: string;
  capacity: number;
  ticketPrice: number;
}

export interface EventUpdateData {
  name?: string;
  date?: string;
  venue?: string;
  capacity?: number;
  ticketPrice?: number;
}

export interface AdminEvent {
  id: string;
  name: string;
  date: string;
  venue: { id: string; name: string };
  organization?: { id: string; name: string };
  capacity: number;
  status: 'DRAFT' | 'PUBLISHED';
  ticketsSold: number;
  priceTiers: {
    id: string;
    name: string;
    priceCents: number;
    quantityTotal: number;
    quantitySold: number;
  }[];
}

export interface DashboardStats {
  totalCapacity: number;
  ticketsSold: number;
  remainingCapacity: number;
  ticketsRedeemed: number;
  salesRate: number;
  paymentSuccessRate: number;
  /** Gross collected by source (spec 018 phase 2). */
  revenue?: { orders: number; applications: number; gross: number };
}

export type SetupTaskId = 'event' | 'design' | 'payments' | 'business' | 'domain' | 'applications' | 'checkin';

export interface SetupTask {
  id: SetupTaskId;
  done: boolean;
  href: string;
  shown: boolean;
  /** payments only: 'connect' when the org connects its own Stripe account */
  state?: 'connect' | 'platform';
}

/** Spec 022: dashboard setup guide for the active organization. */
export interface SetupGuide {
  dismissedAt: string | null;
  tasks: SetupTask[];
  onboarding: { goals: string[] } | null;
}

const adminService = {
  async getSetupGuide(): Promise<SetupGuide> {
    return api.get<SetupGuide>('/admin/setup-guide');
  },

  async dismissSetupGuide(): Promise<{ dismissedAt: string }> {
    return api.patch<{ dismissedAt: string }>('/admin/setup-guide', { dismissed: true });
  },

  /**
   * Create a new event (DRAFT status)
   */
  async createEvent(data: EventCreateData): Promise<{ event: AdminEvent }> {
    return api.post<{ event: AdminEvent }>('/admin/events', data);
  },

  /**
   * Update an existing event
   */
  async updateEvent(eventId: string, data: EventUpdateData): Promise<{ event: AdminEvent }> {
    return api.patch<{ event: AdminEvent }>(`/admin/events/${eventId}`, data);
  },

  /**
   * Publish an event (make visible to customers)
   */
  async publishEvent(eventId: string): Promise<{ event: AdminEvent }> {
    return api.post<{ event: AdminEvent }>(`/admin/events/${eventId}/publish`, {});
  },

  /**
   * Get admin's events list
   */
  async getEvents(): Promise<{ events: AdminEvent[] }> {
    return api.get<{ events: AdminEvent[] }>('/admin/events');
  },

  /**
   * Get dashboard statistics
   */
  async getDashboardStats(eventId?: string): Promise<DashboardStats> {
    const query = eventId ? `?eventId=${eventId}` : '';
    return api.get<DashboardStats>(`/admin/dashboard/stats${query}`);
  },
};

export default adminService;
