'use client';

import { useMemo } from 'react';
import api from '@/services/api';
import type { Transaction, TransactionListResponse, TransactionQuery, TransactionRefund, TransactionType } from '@/lib/transactions';
import { transactionQueryString } from '@/lib/transactions';

export function describeError(err: unknown, fallback: string): string {
  const e = err as { message?: string } | undefined;
  return e?.message || fallback;
}

export function useTransactionsApi() {
  return useMemo(
    () => ({
      list: (query: TransactionQuery) => api.get<TransactionListResponse>(`/admin/transactions${transactionQueryString(query)}`),
      refunds: (type: TransactionType, id: string) => api.get<{ refunds: TransactionRefund[] }>(`/admin/transactions/${type}/${id}/refunds`),
      refund: (type: TransactionType, id: string, body: { amount?: number | null; reason?: string | null }) =>
        api.post<{ transaction: Transaction; refunds: TransactionRefund[] }>(`/admin/transactions/${type}/${id}/refund`, body),
      exportUrl: (query: TransactionQuery) => `/admin/transactions/export.csv${transactionQueryString({ ...query, page: undefined, pageSize: undefined })}`,
    }),
    []
  );
}
