// Ticket Scanning / Redemption Page — admin area (T015)
// Moved from scan/page.tsx
// AdminRoute guard provided by admin layout.tsx

'use client';

import React, { useState, useRef } from 'react';
import api, { RedemptionResult, RedemptionRejection } from '@/services/api';

type Verdict =
  | { type: 'success'; data: RedemptionResult }
  | { type: 'rejection'; data: RedemptionRejection }
  | { type: 'error'; message: string };

export default function ScanPage() {
  const [qrInput, setQrInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function handleScan() {
    const payload = qrInput.trim();
    if (!payload) return;

    setScanning(true);
    setVerdict(null);

    try {
      const result = await api.post<RedemptionResult>('/tickets/redeem', { qrPayload: payload });
      setVerdict({ type: 'success', data: result });
      setQrInput('');
    } catch (err: any) {
      if (err.status === 409 || err.status === 410 || err.status === 403) {
        setVerdict({
          type: 'rejection',
          data: {
            status: err.details?.status || err.error || mapStatusToRejection(err.status),
            ticketId: err.details?.ticketId || '',
            message: err.message,
            originalRedemptionTime: err.details?.originalRedemptionTime,
          },
        });
      } else if (err.status === 400) {
        setVerdict({ type: 'error', message: err.message || 'Invalid or forged QR code' });
      } else {
        setVerdict({ type: 'error', message: err.message || 'An unexpected error occurred' });
      }
    } finally {
      setScanning(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function mapStatusToRejection(httpStatus: number): string {
    switch (httpStatus) {
      case 409:
        return 'ALREADY_REDEEMED';
      case 410:
        return 'EXPIRED';
      case 403:
        return 'WRONG_EVENT';
      default:
        return 'INVALID';
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleScan();
    }
  }

  function clearVerdict() {
    setVerdict(null);
    setQrInput('');
    inputRef.current?.focus();
  }

  const rejectionLabel: Record<string, string> = {
    ALREADY_REDEEMED: 'Already Redeemed',
    EXPIRED: 'Ticket Expired',
    VOIDED: 'Ticket Voided',
    WRONG_EVENT: 'Wrong Event',
  };

  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Scan Tickets</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
        Paste or scan a ticket QR code to validate entry
      </p>

      {/* Input */}
      <div className="mb-4">
        <textarea
          ref={inputRef}
          value={qrInput}
          onChange={(e) => setQrInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste QR code payload here..."
          rows={3}
          className="w-full px-4 py-3 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm resize-none"
          autoFocus
        />
      </div>

      <div className="flex gap-3 mb-6">
        <button
          onClick={handleScan}
          disabled={scanning || !qrInput.trim()}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-slate-700 text-white font-medium py-2.5 px-4 rounded-lg transition"
        >
          {scanning ? 'Scanning...' : 'Validate Ticket'}
        </button>
        {verdict && (
          <button
            onClick={clearVerdict}
            className="px-4 py-2.5 border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg transition"
          >
            Clear
          </button>
        )}
      </div>

      {/* Verdict Display */}
      {verdict?.type === 'success' && (
        <div className="rounded-xl border-2 border-green-500 bg-green-50 dark:bg-green-900/20 p-6 animate-in fade-in">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
              <svg
                className="w-7 h-7 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-green-800 dark:text-green-300">
                Valid — Entry Approved
              </h2>
              <p className="text-sm text-green-600 dark:text-green-400">
                Ticket redeemed successfully
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-green-700 dark:text-green-400 font-medium">Name</dt>
            <dd className="text-green-900 dark:text-green-200">{verdict.data.contactName}</dd>

            <dt className="text-green-700 dark:text-green-400 font-medium">Tier</dt>
            <dd className="text-green-900 dark:text-green-200">{verdict.data.priceTierName}</dd>

            <dt className="text-green-700 dark:text-green-400 font-medium">Barcode</dt>
            <dd className="text-green-900 dark:text-green-200 font-mono">{verdict.data.barcode}</dd>

            <dt className="text-green-700 dark:text-green-400 font-medium">Redeemed At</dt>
            <dd className="text-green-900 dark:text-green-200">
              {new Date(verdict.data.redeemedAt).toLocaleTimeString()}
            </dd>
          </dl>
        </div>
      )}

      {verdict?.type === 'rejection' && (
        <div className="rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-900/20 p-6 animate-in fade-in">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-12 h-12 bg-red-500 rounded-full flex items-center justify-center">
              <svg
                className="w-7 h-7 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-red-800 dark:text-red-300">
                Rejected — {rejectionLabel[verdict.data.status] || verdict.data.status}
              </h2>
              <p className="text-sm text-red-600 dark:text-red-400">{verdict.data.message}</p>
            </div>
          </div>

          {verdict.data.status === 'ALREADY_REDEEMED' && verdict.data.originalRedemptionTime && (
            <div className="mt-3 p-3 bg-red-100 dark:bg-red-900/30 rounded-lg text-sm">
              <span className="text-red-700 dark:text-red-400 font-medium">
                First redeemed at:{' '}
              </span>
              <span className="text-red-900 dark:text-red-200">
                {new Date(verdict.data.originalRedemptionTime).toLocaleString()}
              </span>
            </div>
          )}

          {verdict.data.ticketId && (
            <p className="mt-2 text-xs text-red-500 dark:text-red-400 font-mono">
              Ticket: {verdict.data.ticketId}
            </p>
          )}
        </div>
      )}

      {verdict?.type === 'error' && (
        <div className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-6 animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center">
              <svg
                className="w-7 h-7 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-amber-800 dark:text-amber-300">
                Invalid QR Code
              </h2>
              <p className="text-sm text-amber-600 dark:text-amber-400">{verdict.message}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
