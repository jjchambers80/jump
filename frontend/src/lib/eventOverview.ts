// Shape of GET /organizations/:orgId/events/:eventId/overview (spec 037
// phase 1): everything the admin Event Details page reads, in one request.
// Amounts are dollars (Prisma Decimal), not cents.

import type { AddOnSales } from './addOns';

export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
export type AdmissionMode = 'TICKETED' | 'RSVP';

export interface OverviewTier {
  id: string;
  name: string;
  description: string | null;
  price: number;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  quantityAvailable: number;
  displayOrder: number;
  minPerOrder: number | null;
  maxPerOrder: number | null;
  isActive: boolean;
  saleStartDate: string | null;
  saleEndDate: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
  saleStatus: 'NOT_STARTED' | 'ON_SALE' | 'ENDED';
}

export interface OverviewEvent {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  date: string;
  capacity: number | null;
  /** Spec 050: optional end on the venue's wall clock. */
  endDate?: string | null;
  /** Spec 050 wizard: last step reached; `setupCompletedAt` null = create still running. */
  setupStep?: string | null;
  setupCompletedAt?: string | null;
  category: string | null;
  status: EventStatus;
  admissionMode: AdmissionMode;
  rsvpLimit: number | null;
  rsvpMaxPartySize: number;
  rsvpRemaining: number | null;
  tax: { rate: number; source: 'STRIPE' | 'MANUAL' | null; region: string | null };
  taxInclusivePricing: boolean;
  venue: { id: string; slug?: string; name: string; address: string; timezone?: string | null } | null;
  priceTiers: OverviewTier[];
  createdAt: string;
  updatedAt: string;
}

export type ApplicationState = 'SUBMITTED' | 'WAITLISTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

export interface OverviewForm {
  id: string;
  name: string;
  slug: string;
  kind: 'PAID' | 'FREE';
  status: 'DRAFT' | 'OPEN' | 'CLOSED';
  opensAt: string | null;
  closesAt: string | null;
  paid: boolean;
  counts: Record<ApplicationState, number>;
  total: number;
  approvedSettled: number;
  approvedAwaitingPayment: number;
  tiers: {
    id: string;
    name: string;
    price: number;
    quantityTotal: number;
    quantityApproved: number;
    quantityReserved: number;
    isActive: boolean;
    booths: number;
  }[];
}

export type BoothState = 'AVAILABLE' | 'HELD' | 'SOLD' | 'RESERVED' | 'BLOCKED';

export interface OverviewMap {
  id: string;
  name: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: string | null;
  updatedAt: string;
  booths: Record<BoothState, number>;
  boothTotal: number;
  unassignedBooths: number;
}

export interface EventOverview {
  event: OverviewEvent;
  money: {
    gross: number;
    orgReceives: number;
    refunded: number;
    net: number;
    tickets: { orders: number; gross: number };
    applications: { orders: number; gross: number };
  };
  tickets: { issued: number; checkedIn: number; voided: number } | null;
  rsvp: { going: number; headcount: number; cancelled: number; remaining: number | null } | null;
  addOns: AddOnSales;
  applications: { forms: OverviewForm[] };
  map: OverviewMap | null;
}

export const formatMoney = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

export const formatCount = (value: number) => value.toLocaleString('en-US');

/** "in 12 days" / "tomorrow" / "today" / "3 days ago", measured in whole days. */
export function relativeDays(iso: string, now: Date = new Date()): string {
  const days = Math.round((new Date(iso).getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
