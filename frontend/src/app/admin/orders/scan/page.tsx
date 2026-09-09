// Ticket Check-In Scanner — admin area
// Camera-based QR scanning with Eventeny-style two-step flow:
// scan → preview → confirm check-in → result

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import api, { TicketPreview, RedemptionResult, RedemptionRejection } from '@/services/api';

type ScanState =
  | { step: 'scanning' }
  | { step: 'preview'; ticket: TicketPreview }
  | { step: 'checking-in'; ticket: TicketPreview }
  | { step: 'checked-in'; result: RedemptionResult }
  | { step: 'already-checked-in'; ticket: TicketPreview }
  | { step: 'error'; status: string; message: string; ticketId?: string; originalRedemptionTime?: string };

export default function ScanPage() {
  const [state, setState] = useState<ScanState>({ step: 'scanning' });
  const [cameraActive, setCameraActive] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerElementId = 'qr-scanner';
  const processingRef = useRef(false);

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        if (state === 2) { // SCANNING
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
      const result = await api.post<TicketPreview>('/tickets/scan', { payload });

      if (result.status === 'REDEEMED') {
        setState({
          step: 'already-checked-in',
          ticket: result,
        });
      } else if (result.status === 'EXPIRED') {
        setState({ step: 'error', status: 'EXPIRED', message: 'Ticket has expired' });
      } else if (result.status === 'VOIDED') {
        setState({ step: 'error', status: 'VOIDED', message: 'Ticket has been voided' });
      } else {
        setState({ step: 'preview', ticket: result });
      }

      await stopCamera();
    } catch (err: any) {
      await stopCamera();
      if (err.status === 409 || err.status === 410 || err.status === 403) {
        setState({
          step: 'error',
          status: err.details?.status || mapStatusCode(err.status),
          message: err.message,
          ticketId: err.details?.ticketId,
          originalRedemptionTime: err.details?.originalRedemptionTime,
        });
      } else {
        setState({ step: 'error', status: 'INVALID', message: err.message || 'Invalid QR code' });
      }
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
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          processPayload(decodedText);
        },
        () => {
          // ignore scan failures (no QR in frame)
        }
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
      // Cleanup on unmount — fire-and-forget but ensure camera releases
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

  async function handleCheckIn(ticket: TicketPreview) {
    setState({ step: 'checking-in', ticket });
    try {
      const result = await api.post<RedemptionResult>('/tickets/redeem', {
        barcode: ticket.barcode,
        eventId: ticket.eventId,
      });
      setState({ step: 'checked-in', result });
    } catch (err: any) {
      if (err.details?.status === 'ALREADY_REDEEMED' || err.status === 409) {
        setState({ step: 'already-checked-in', ticket });
      } else {
        setState({
          step: 'error',
          status: err.details?.status || 'ERROR',
          message: err.message || 'Check-in failed',
        });
      }
    }
  }

  function handleScanNext() {
    setState({ step: 'scanning' });
    setManualInput('');
  }

  function handleCancel() {
    setState({ step: 'scanning' });
    setManualInput('');
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = manualInput.trim();
    if (!input) return;
    processPayload(input);
  }

  function mapStatusCode(code: number): string {
    switch (code) {
      case 409: return 'ALREADY_REDEEMED';
      case 410: return 'EXPIRED';
      case 403: return 'WRONG_EVENT';
      default: return 'INVALID';
    }
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
          {/* Camera viewfinder */}
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

          {/* Manual entry fallback */}
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

      {/* === PREVIEW STATE === */}
      {(state.step === 'preview' || state.step === 'checking-in') && (
        <div className="rounded-xl border-2 border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-shrink-0 w-12 h-12 bg-indigo-500 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-indigo-800 dark:text-indigo-300">
                Ticket Found
              </h2>
              <p className="text-sm text-indigo-600 dark:text-indigo-400">
                Review and confirm check-in
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm mb-6">
            <dt className="text-indigo-700 dark:text-indigo-400 font-medium">Attendee</dt>
            <dd className="text-indigo-900 dark:text-indigo-200 font-semibold">
              {state.ticket.contactName}
            </dd>

            <dt className="text-indigo-700 dark:text-indigo-400 font-medium">Ticket Type</dt>
            <dd className="text-indigo-900 dark:text-indigo-200">{state.ticket.priceTierName}</dd>

            <dt className="text-indigo-700 dark:text-indigo-400 font-medium">Event</dt>
            <dd className="text-indigo-900 dark:text-indigo-200">{state.ticket.eventName}</dd>

            <dt className="text-indigo-700 dark:text-indigo-400 font-medium">Barcode</dt>
            <dd className="text-indigo-900 dark:text-indigo-200 font-mono">{state.ticket.barcode}</dd>
          </dl>

          <div className="flex gap-3">
            <button
              onClick={() => handleCheckIn(state.ticket)}
              disabled={state.step === 'checking-in'}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold py-3 px-4 rounded-lg transition text-base"
            >
              {state.step === 'checking-in' ? 'Checking In...' : 'Check In'}
            </button>
            <button
              onClick={handleCancel}
              disabled={state.step === 'checking-in'}
              className="px-4 py-3 border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* === CHECKED IN STATE === */}
      {state.step === 'checked-in' && (
        <div className="rounded-xl border-2 border-green-500 bg-green-50 dark:bg-green-900/20 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-shrink-0 w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-green-800 dark:text-green-300">
                Checked In
              </h2>
              <p className="text-sm text-green-600 dark:text-green-400">
                Ticket redeemed successfully
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm mb-6">
            <dt className="text-green-700 dark:text-green-400 font-medium">Name</dt>
            <dd className="text-green-900 dark:text-green-200">{state.result.contactName}</dd>

            <dt className="text-green-700 dark:text-green-400 font-medium">Tier</dt>
            <dd className="text-green-900 dark:text-green-200">{state.result.priceTierName}</dd>

            <dt className="text-green-700 dark:text-green-400 font-medium">Barcode</dt>
            <dd className="text-green-900 dark:text-green-200 font-mono">{state.result.barcode}</dd>

            <dt className="text-green-700 dark:text-green-400 font-medium">Checked In At</dt>
            <dd className="text-green-900 dark:text-green-200">
              {new Date(state.result.redeemedAt).toLocaleTimeString()}
            </dd>
          </dl>

          <button
            onClick={handleScanNext}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-lg transition"
          >
            Scan Next
          </button>
        </div>
      )}

      {/* === ALREADY CHECKED IN STATE === */}
      {state.step === 'already-checked-in' && (
        <div className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-shrink-0 w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-amber-800 dark:text-amber-300">
                Already Checked In
              </h2>
              <p className="text-sm text-amber-600 dark:text-amber-400">
                This ticket was already redeemed
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm mb-4">
            <dt className="text-amber-700 dark:text-amber-400 font-medium">Name</dt>
            <dd className="text-amber-900 dark:text-amber-200">{state.ticket.contactName}</dd>

            <dt className="text-amber-700 dark:text-amber-400 font-medium">Tier</dt>
            <dd className="text-amber-900 dark:text-amber-200">{state.ticket.priceTierName}</dd>

            <dt className="text-amber-700 dark:text-amber-400 font-medium">Barcode</dt>
            <dd className="text-amber-900 dark:text-amber-200 font-mono">{state.ticket.barcode}</dd>

            {state.ticket.redeemedAt && (
              <>
                <dt className="text-amber-700 dark:text-amber-400 font-medium">Checked In At</dt>
                <dd className="text-amber-900 dark:text-amber-200">
                  {new Date(state.ticket.redeemedAt).toLocaleString()}
                </dd>
              </>
            )}
          </dl>

          <button
            onClick={handleScanNext}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-lg transition"
          >
            Scan Next
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

          {state.originalRedemptionTime && (
            <div className="mt-3 p-3 bg-red-100 dark:bg-red-900/30 rounded-lg text-sm">
              <span className="text-red-700 dark:text-red-400 font-medium">First checked in at: </span>
              <span className="text-red-900 dark:text-red-200">
                {new Date(state.originalRedemptionTime).toLocaleString()}
              </span>
            </div>
          )}

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
