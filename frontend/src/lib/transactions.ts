// Transactions (spec 018): the unified admin view of ticket orders and
// application payments. Types mirror backend/src/services/TransactionService.js.

export type TransactionType = 'ORDER' | 'APPLICATION';

export type TransactionStatus = 'PENDING' | 'PAID' | 'PAYMENT_DUE' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'FAILED';

export type TransactionSort = '-date' | 'date' | '-gross' | 'gross';

export interface Transaction {
  type: TransactionType;
  id: string;
  reference: string;
  occurredAt: string;
  contact: { id: string; name: string; email: string };
  businessName: string | null;
  event: { id: string; name: string; date: string | null };
  /** Present only for SYSTEM_ADMIN (unscoped) listings. */
  organization?: { id: string; name: string };
  description: string;
  subtotal: number;
  platformFee: number;
  processingFee: number;
  tax: number;
  gross: number;
  refunded: number;
  net: number;
  amountDue: number | null;
  dueAt: string | null;
  status: TransactionStatus;
  sourceStatus: string;
  paymentSource: 'stripe' | 'offline';
  stripeAccountId: string | null;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  detailUrl: string;
}

export interface TransactionRefund {
  id: string;
  amount: number;
  reason: string | null;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  stripeRefundId: string | null;
  initiatedBy: string | null;
  manual: boolean;
  detail: string | null;
  createdAt: string;
}

export interface TransactionListResponse {
  data: Transaction[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface TransactionQuery {
  type?: TransactionType | '';
  status?: TransactionStatus | '';
  eventId?: string;
  from?: string;
  to?: string;
  hasRefunds?: boolean;
  paymentSource?: 'stripe' | 'offline' | '';
  search?: string;
  sort?: TransactionSort;
  page?: number;
  pageSize?: number;
}

export const TRANSACTION_STATUS_OPTIONS: { value: TransactionStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'PAID', label: 'Paid' },
  { value: 'PARTIALLY_REFUNDED', label: 'Partially refunded' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'PAYMENT_DUE', label: 'Payment due' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'FAILED', label: 'Failed' },
];

export const transactionStatusDisplay: Record<TransactionStatus, { label: string; color: string }> = {
  PAID: { label: 'Paid', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  PARTIALLY_REFUNDED: { label: 'Partially refunded', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' },
  REFUNDED: { label: 'Refunded', color: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300' },
  PAYMENT_DUE: { label: 'Payment due', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' },
  PENDING: { label: 'Pending', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  FAILED: { label: 'Failed', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
};

/** Card-on-file applications: money expected, none charged yet. */
export function pendingLabel(t: Transaction): string {
  if (t.type !== 'APPLICATION' || t.status !== 'PENDING') return transactionStatusDisplay.PENDING.label;
  if (t.sourceStatus === 'CARD_ON_FILE') return 'Card on file';
  if (t.sourceStatus === 'PROCESSING') return 'Charging';
  return 'Awaiting card';
}

export function transactionStatusLabel(t: Transaction): string {
  return t.status === 'PENDING' ? pendingLabel(t) : transactionStatusDisplay[t.status]?.label ?? t.status;
}

/** Whether the row can be refunded from the list (the API enforces ADMIN). Offline rows record a manual refund. */
export function isRefundable(t: Transaction): boolean {
  return (t.status === 'PAID' || t.status === 'PARTIALLY_REFUNDED') && t.net > 0;
}

export function transactionQueryString(query: TransactionQuery): string {
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.status) params.set('status', query.status);
  if (query.eventId) params.set('eventId', query.eventId);
  if (query.from) params.set('from', new Date(query.from).toISOString());
  if (query.to) {
    // Inclusive day: the date picker gives a calendar date, the API compares timestamps.
    const end = new Date(query.to);
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) end.setUTCHours(23, 59, 59, 999);
    params.set('to', end.toISOString());
  }
  if (query.hasRefunds) params.set('hasRefunds', 'true');
  if (query.paymentSource) params.set('paymentSource', query.paymentSource);
  if (query.search) params.set('search', query.search);
  if (query.sort) params.set('sort', query.sort);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

/** Application ids are cuids; show the tail like Stripe shows object ids. */
export function shortReference(t: Transaction): string {
  return t.type === 'ORDER' ? t.reference : `APP-${t.reference.slice(-6).toUpperCase()}`;
}
