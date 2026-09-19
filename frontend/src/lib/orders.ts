// Org-wide orders (spec 024 phase 2): one list for ticket orders and
// application orders, the row shape `GET /admin/orders` returns, and the
// helpers the Orders page and the order detail share.

export type OrderKind = 'TICKET' | 'APPLICATION';
export type OrderStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type OrderItemKind = 'TICKET_TIER' | 'APPLICATION_TIER' | 'ADJUSTMENT' | 'WAIVER';

/** Fine-grained state of a PENDING (or waived) application order. */
export interface OrderStatusDetail {
  paymentStatus: string;
  label: string;
  dueAt: string | null;
}

export interface OrderRow {
  id: string;
  orderRef: string;
  kind: OrderKind;
  applicationId: string | null;
  eventId: string;
  eventName: string;
  eventDate: string;
  quantity: number;
  description: string;
  businessName: string | null;
  subtotalAmount: number;
  platformFeeAmount: number;
  processingFeeAmount: number;
  taxAmount: number;
  totalAmount: number;
  refunded: number;
  net: number;
  currency: string;
  status: OrderStatus;
  statusDetail: OrderStatusDetail | null;
  paymentSource: 'stripe' | 'offline';
  contact?: { firstName: string; lastName: string; email: string };
  application: { id: string; status: string; paymentStatus: string; formName: string | null; tierName: string | null } | null;
  /** SYSTEM_ADMIN only (unscoped list). */
  organization?: { id: string; name: string };
  paidAt: string | null;
  createdAt: string;
}

export interface OrderListResponse {
  data: OrderRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface OrderListQuery {
  page?: number;
  limit?: number;
  kind?: OrderKind | '';
  status?: string;
  eventId?: string;
  from?: string;
  to?: string;
  search?: string;
  sort?: 'createdAt' | 'totalAmount' | 'paidAt';
  dir?: 'asc' | 'desc';
}

export function orderListQueryString(query: OrderListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  COMPLETED: 'Paid',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially refunded',
};

export const ORDER_STATUS_CLASS: Record<OrderStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  CANCELLED: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
  REFUNDED: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  PARTIALLY_REFUNDED: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
};

/** "Paid", "Payment due · Sep 26", "Card on file"… — the chip text for a row. */
export function orderStatusLabel(row: Pick<OrderRow, 'status' | 'statusDetail'>): string {
  if (row.statusDetail) {
    if (row.statusDetail.dueAt) {
      const due = new Date(row.statusDetail.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${row.statusDetail.label} · ${due}`;
    }
    return row.statusDetail.label;
  }
  return ORDER_STATUS_LABEL[row.status] ?? row.status;
}

export const ORDER_KIND_LABEL: Record<OrderKind, string> = { TICKET: 'Tickets', APPLICATION: 'Application' };

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}
