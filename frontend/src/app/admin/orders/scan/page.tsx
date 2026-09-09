// Ticket Check-In Scanner — admin area
// Eventeny-style order-level check-in:
// scan QR → show all tickets in order → check in individually

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import api, { OrderScanResult, OrderTicketPreview } from '@/services/api';

type ScanState =
  | { step: 'scanning' }
  | { step: 'order-view'; data: OrderScanResult }
  | { step: 'error'; status: string; message: string };

export default function ScanPage() {
  const [state, setState] = useState<ScanState>({ step: 'scanning' });
  const [cameraActive, setCameraActive] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState<Set<string>>(new Set());
  const [ticketError, setTicketError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerElementId = 'qr-scanner';
  const processingRef = useRef(false);

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const s = scannerRef.current.getState();
        if (s === 2) {
          await scannerRef.current.stop();
        }
      } catch {
        // Already stopped
      }
      setCameraActive(false);
    }
  }, []);

  const processPayload = useCallback(async (payload: string) => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      const result = await api.post<OrderScanResult>('/admin/tickets/scan-order', { payload });
      setState({ step: 'order-view', data: result });
      await stopCamera();
    } catch (err: any) {
      await stopCamera();
      setState({
        step: 'error',
        status: err.details?.status || 'INVALID',
        message: err.message || 'Invalid QR code',
      });
    } finally {
      processingRef.current = false;
    }
  }, [stopCamera]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(scannerElementId);
      }

      await scannerRef.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => processPayload(decodedText),
        () => {},
      );
      setCameraActive(true);
    } catch (err: any) {
      setCameraError(err?.message || 'Camera access denied');
    }
  }, [processPayload]);

  useEffect(() => {
    if (state.step === 'scanning' && !cameraActive) {
      startCamera();
    }
    return () => {
      if (scannerRef.current) {
        try {
          const s = scannerRef.current.getState();
          if (s === 2) {
            scannerRef.current.stop().then(() => {
              scannerRef.current?.clear();
            }).catch(() => {});
          }
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step]);

  async function handleCheckIn(ticketId: string) {
    setCheckingIn((prev) => new Set(prev).add(ticketId));
    setTicketError(null);
    try {
      const result = await api.post<{ status: string; redeemedAt: string }>(
        `/admin/tickets/${ticketId}/check-in`, {},
      );
      setState((prev) => {
        if (prev.step !== 'order-view') return prev;
        return {
          ...prev,
          data: {
            ...prev.data,
            tickets: prev.data.tickets.map((t) =>
              t.ticketId === ticketId
                ? { ...t, status: 'REDEEMED' as const, redeemedAt: result.redeemedAt }
                : t,
            ),
          },
        };
      });
    } catch (err: any) {
      if (err.status === 409) {
        setState((prev) => {
          if (prev.step !== 'order-view') return prev;
          return {
            ...prev,
            data: {
              ...prev.data,
              tickets: prev.data.tickets.map((t) =>
                t.ticketId === ticketId ? { ...t, status: 'REDEEMED' as const } : t,
              ),
            },
          };
        });
      } else {
        setTicketError(err.message || 'Check-in failed');
      }
    } finally {
      setCheckingIn((prev) => {
        const next = new Set(prev);
        next.delete(ticketId);
        return next;
      });
    }
  }

  async function handleUndoCheckIn(ticketId: string) {
    setCheckingIn((prev) => new Set(prev).add(ticketId));
    setTicketError(null);
    try {
      await api.post(`/admin/tickets/${ticketId}/undo-check-in`, {});
      setState((prev) => {
        if (prev.step !== 'order-view') return prev;
        return {
          ...prev,
          data: {
            ...prev.data,
            tickets: prev.data.tickets.map((t) =>
              t.ticketId === ticketId
                ? { ...t, status: 'VALID' as const, redeemedAt: null }
                : t,
            ),
          },
        };
      });
    } catch (err: any) {
      setTicketError(err.message || 'Undo check-in failed');
    } finally {
      setCheckingIn((prev) => {
        const next = new Set(prev);
        next.delete(ticketId);
        return next;
      });
    }
  }

  function handleScanNext() {
    setState({ step: 'scanning' });
    setManualInput('');
    setCheckingIn(new Set());
    setTicketError(null);
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = manualInput.trim();
    if (!input) return;
    processPayload(input);
  }

  const statusLabels: Record<string, string> = {
    ALREADY_REDEEMED: 'Already Checked In',
    EXPIRED: 'Ticket Expired',
    VOIDED: 'Ticket Voided',
    WRONG_EVENT: 'Wrong Event',
    INVALID: 'Invalid QR Code',
    ERROR: 'Error',
  };

  return (
    <div className="max-w-lg mx-auto py-6 px-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Check In</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
        Scan ticket QR code to check in attendees
      </p>

      {/* === SCANNING STATE === */}
      {state.step === 'scanning' && (
        <>
          <div className="relative rounded-xl overflow-hidden bg-black mb-4">
            <div id={scannerElementId} className="w-full" />
            {!cameraActive && !cameraError && (
              <div className="flex items-center justify-center h-64 text-white/60 text-sm">
                Starting camera...
              </div>
            )}
            {cameraError && (
              <div className="flex flex-col items-center justify-center h-64 gap-3 px-4">
                <p className="text-red-400 text-sm text-center">{cameraError}</p>
                <button
                  onClick={startCamera}
                  className="text-sm text-indigo-400 hover:text-indigo-300 underline"
                >
                  Retry camera
                </button>
              </div>
            )}
          </div>

          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Enter barcode manually..."
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!manualInput.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-slate-700 text-white text-sm font-medium rounded-lg transition"
            >
              Look Up
            </button>
          </form>
        </>
      )}

      {/* === ORDER VIEW STATE === */}
      {state.step === 'order-view' && (
        <div>
          {/* Order header */}
          <div className="mb-4 pb-4 border-b border-gray-200 dark:border-slate-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {state.data.eventName}
            </h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Order #{state.data.orderRef}
            </p>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Total tickets: {state.data.totalTickets}
            </p>
          </div>

          {/* Current ticket (the scanned one) */}
          {(() => {
            const scanned = state.data.tickets.find(
              (t) => t.ticketId === state.data.scannedTicketId,
            );
            const siblings = state.data.tickets.filter(
              (t) => t.ticketId !== state.data.scannedTicketId,
            );
            return (
              <>
                {scanned && (
                  <>
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                      Current ticket
                    </h3>
                    <TicketCard
                      ticket={scanned}
                      loading={checkingIn.has(scanned.ticketId)}
                      onCheckIn={() => handleCheckIn(scanned.ticketId)}
                      onUndoCheckIn={() => handleUndoCheckIn(scanned.ticketId)}
                    />
                  </>
                )}

                {siblings.length > 0 && (
                  <>
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mt-6 mb-2">
                      Other tickets in this order
                    </h3>
                    {siblings.map((ticket) => (
                      <TicketCard
                        key={ticket.ticketId}
                        ticket={ticket}
                        loading={checkingIn.has(ticket.ticketId)}
                        onCheckIn={() => handleCheckIn(ticket.ticketId)}
                        onUndoCheckIn={() => handleUndoCheckIn(ticket.ticketId)}
                      />
                    ))}
                  </>
                )}
              </>
            );
          })()}

          {/* Ticket-level error banner */}
          {ticketError && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 text-sm text-red-700 dark:text-red-400">
              {ticketError}
            </div>
          )}

          {/* Scan next */}
          <button
            onClick={handleScanNext}
            className="w-full mt-6 bg-teal-600 hover:bg-teal-700 text-white font-medium py-3 px-4 rounded-lg transition text-base"
          >
            Scan next QR code
          </button>
        </div>
      )}

      {/* === ERROR STATE === */}
      {state.step === 'error' && (
        <div className="rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-900/20 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-12 h-12 bg-red-500 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-red-800 dark:text-red-300">
                {statusLabels[state.status] || state.status}
              </h2>
              <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
            </div>
          </div>

          <button
            onClick={handleScanNext}
            className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-lg transition"
          >
            Scan Next
          </button>
        </div>
      )}
    </div>
  );
}

function TicketCard({
  ticket,
  loading,
  onCheckIn,
  onUndoCheckIn,
}: {
  ticket: OrderTicketPreview;
  loading: boolean;
  onCheckIn: () => void;
  onUndoCheckIn: () => void;
}) {
  const isRedeemed = ticket.status === 'REDEEMED';
  const isValid = ticket.status === 'VALID';
  const isInactive = ticket.status === 'EXPIRED' || ticket.status === 'VOIDED';

  const borderColor = isRedeemed
    ? 'border-green-400 dark:border-green-600'
    : isValid
      ? 'border-gray-200 dark:border-slate-600'
      : 'border-red-300 dark:border-red-700';

  const bgColor = isRedeemed
    ? 'bg-green-50 dark:bg-green-900/10'
    : isValid
      ? 'bg-white dark:bg-slate-800'
      : 'bg-red-50 dark:bg-red-900/10';

  return (
    <div className={`rounded-xl border-2 ${borderColor} ${bgColor} p-4 mb-3`}>
      <div className="flex items-center gap-2 mb-3">
        {/* Status badge */}
        {isValid && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300">
            Active
          </span>
        )}
        {isRedeemed && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
            Checked in
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}
        {ticket.status === 'EXPIRED' && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
            Expired
          </span>
        )}
        {ticket.status === 'VOIDED' && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
            Voided
          </span>
        )}
      </div>

      <p className="text-sm font-medium text-gray-500 dark:text-slate-400 mb-1">
        {ticket.priceTierName}
      </p>
      <p className="text-base font-semibold text-gray-900 dark:text-white">
        {ticket.contactName}
      </p>
      <p className="text-sm text-gray-500 dark:text-slate-400">{ticket.contactEmail}</p>
      <p className="text-xs text-gray-400 dark:text-slate-500 font-mono mt-1">
        Confirmation #: {ticket.barcode}
      </p>

      {isRedeemed && ticket.redeemedAt && (
        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
          Checked in at {new Date(ticket.redeemedAt).toLocaleTimeString()}
        </p>
      )}

      {/* Action buttons */}
      {!isInactive && (
        <div className="mt-3">
          {isValid && (
            <button
              onClick={onCheckIn}
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold py-3 px-4 rounded-lg transition text-base"
            >
              {loading ? 'Checking In...' : 'Check In'}
            </button>
          )}
          {isRedeemed && (
            <button
              onClick={onUndoCheckIn}
              disabled={loading}
              className="w-full border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 font-medium py-2 px-4 rounded-lg transition text-sm"
            >
              {loading ? 'Undoing...' : 'Undo Check-In'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
