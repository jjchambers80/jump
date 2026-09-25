'use client';

// Admin › Event › Door check-in (spec 036)
//
// Designed for one situation: a staffer holding a phone at a loading dock,
// often one-handed, on venue wifi that comes and goes. That drives every
// choice here — large tap targets, a search box that filters what is already
// loaded rather than round-tripping per keystroke, an arrivals count readable
// at arm's length, and a per-vendor state that always says whether the
// check-in landed. The retry behaviour lives in useDoorQueue; it is only safe
// because the backend's check-in is idempotent.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, CheckCircle2, RotateCcw, Search, WifiOff, X } from 'lucide-react';
import { checkInApi, type DoorRoster, type DoorVendor } from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { useAccountFormat } from '@/lib/accountFormat';
import { formatEventDateTime } from '@/lib/eventTime';
import { useDoorQueue } from './useDoorQueue';

export default function DoorCheckInPage({ params }: { params: { eventId: string } }) {
  const { eventId } = params;
  const { selectedOrgId } = useOrg();
  const { formatDateTime } = useAccountFormat();
  const [roster, setRoster] = useState<DoorRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [scanning, setScanning] = useState(false);

  /** Merge one vendor back into the roster and recompute the counts locally. */
  const applyVendor = useCallback((vendor: DoorVendor) => {
    setRoster((prev) => {
      if (!prev) return prev;
      const data = prev.data.map((v) => (v.id === vendor.id ? vendor : v));
      const arrived = data.filter((v) => v.checkedInAt).length;
      return { ...prev, data, counts: { ...prev.counts, arrived, awaiting: Math.max(0, prev.counts.expected - arrived) } };
    });
  }, []);

  const queue = useDoorQueue(eventId, applyVendor, setError);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setRoster(await checkInApi.roster(eventId));
    } catch (err: any) {
      setError(err?.message || 'Could not load the vendor list');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  // Wait for OrgContext: until it sets X-Jump-Org a direct load resolves no
  // organization and the backend answers 404 (same rule as the RSVP page).
  useEffect(() => {
    if (!selectedOrgId) return;
    void load();
  }, [selectedOrgId, load]);

  // Filtering is local so it keeps working when the network does not. The
  // roster is one event's approved vendors, so it is small enough to hold.
  const visible = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q || !roster) return roster?.data ?? [];
    return roster.data.filter((v) =>
      [v.businessName, v.contactName, v.email, v.boothLabel, v.shortId].some((f) => f?.toLowerCase().includes(q))
    );
  }, [roster, term]);

  const onScanned = useCallback(
    async (payload: string) => {
      setScanning(false);
      setError(null);
      try {
        const vendor = await checkInApi.scan(eventId, payload);
        applyVendor(vendor);
        setTerm(vendor.businessName);
        if (vendor.checkedInAt) setNotice(`${vendor.businessName} already arrived`);
        else queue.enqueue(vendor.id, 'SCAN');
      } catch (err: any) {
        setError(err?.message || 'That pass did not match a vendor on this event');
      }
    },
    [eventId, applyVendor, queue]
  );

  const counts = roster?.counts ?? { expected: 0, arrived: 0, awaiting: 0 };
  const progress = counts.expected ? Math.round((counts.arrived / counts.expected) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link href={`/admin/events/${eventId}/applications`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
        ← Back to Applications
      </Link>

      <header className="mt-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Door check-in</h1>
        {roster?.event && (
          <p className="text-sm text-gray-600 dark:text-slate-400">
            {roster.event.name}
            {roster.event.venueName ? ` · ${roster.event.venueName}` : ''} ·{' '}
            {formatEventDateTime(roster.event.date, roster.event.timezone)}
          </p>
        )}
      </header>

      {/* Arrivals summary — the one number staff glance at between vendors. */}
      <section aria-label="Arrivals" className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-3xl font-bold tabular-nums text-gray-900 dark:text-white">
            <span data-testid="arrived-count">{counts.arrived}</span>
            <span className="text-gray-400 dark:text-slate-500"> / {counts.expected}</span>
          </p>
          <p className="text-sm font-medium text-gray-600 dark:text-slate-400">
            {counts.awaiting} still to arrive
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
          <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
        </div>
      </section>

      {!queue.online && (
        <p role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          Offline — check-ins will send as soon as the connection is back.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search vendor, booth or email"
            aria-label="Search vendors"
            autoComplete="off"
            // 16px minimum keeps iOS Safari from zooming the whole page on focus.
            className="w-full rounded-lg border border-gray-300 bg-white py-3 pl-10 pr-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
        </div>
        <button
          type="button"
          onClick={() => setScanning(true)}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-base font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          <Camera className="h-5 w-5" aria-hidden />
          Scan
        </button>
      </div>

      {error && (
        <p role="alert" data-testid="door-error" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="door-notice" className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
          {notice}
        </p>
      )}

      {scanning && <ScannerSheet onScanned={onScanned} onClose={() => setScanning(false)} />}

      <ul className="mt-4 space-y-2">
        {loading && <li className="rounded-xl border border-gray-200 p-4 text-sm text-gray-500 dark:border-slate-700 dark:text-slate-400">Loading vendors…</li>}
        {!loading && visible.length === 0 && (
          <li className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-slate-700 dark:text-slate-400">
            {roster?.data.length ? 'No vendor matches that search.' : 'No approved vendors for this event yet.'}
          </li>
        )}
        {visible.map((vendor) => (
          <VendorRow
            key={vendor.id}
            vendor={vendor}
            state={queue.states[vendor.id] ?? { kind: 'idle' }}
            onCheckIn={() => queue.enqueue(vendor.id, 'SEARCH')}
            onUndo={() => queue.undo(vendor.id)}
            formatDateTime={formatDateTime}
          />
        ))}
      </ul>
    </div>
  );
}

function VendorRow({
  vendor,
  state,
  onCheckIn,
  onUndo,
  formatDateTime,
}: {
  vendor: DoorVendor;
  state: { kind: 'idle' } | { kind: 'sending'; attempt: number } | { kind: 'failed'; message: string };
  onCheckIn: () => void;
  onUndo: () => void;
  formatDateTime: (value: string, options?: Intl.DateTimeFormatOptions) => string;
}) {
  const arrived = Boolean(vendor.checkedInAt);
  return (
    <li
      data-testid="vendor-row"
      data-arrived={arrived ? 'true' : 'false'}
      className={`flex items-center gap-3 rounded-xl border p-3 ${
        arrived
          ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-900/20'
          : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-gray-900 dark:text-white">{vendor.businessName}</p>
        <p className="truncate text-sm text-gray-600 dark:text-slate-400">
          {vendor.boothLabel ? (
            <span className="font-medium text-gray-900 dark:text-slate-200">Booth {vendor.boothLabel}</span>
          ) : (
            <span className="text-amber-700 dark:text-amber-400">No booth assigned</span>
          )}
          {vendor.contactName ? ` · ${vendor.contactName}` : ''}
        </p>
        {/* Arrival times are operational, so they render in the viewer's own
            account zone (spec 030) — not the venue's wall clock. */}
        {arrived && (
          <p className="mt-0.5 flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Arrived {formatDateTime(vendor.checkedInAt as string, { timeStyle: 'short' })}
          </p>
        )}
        {state.kind === 'sending' && (
          <p className="mt-0.5 text-sm text-gray-500 dark:text-slate-400">
            {state.attempt > 1 ? `Sending… (try ${state.attempt})` : 'Sending…'}
          </p>
        )}
        {state.kind === 'failed' && (
          <p className="mt-0.5 text-sm font-medium text-red-700 dark:text-red-400">{state.message}</p>
        )}
      </div>

      {arrived ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={state.kind === 'sending'}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Undo
        </button>
      ) : (
        <button
          type="button"
          onClick={onCheckIn}
          disabled={state.kind === 'sending'}
          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
        >
          {state.kind === 'failed' ? 'Retry' : 'Check in'}
        </button>
      )}
    </li>
  );
}

/**
 * Camera sheet. `html5-qrcode` is imported lazily for the same reason the
 * orders scanner does it: it is heavy, and most door shifts start with a
 * search rather than a scan. Manual entry is always available, because a
 * cracked phone camera at 8am cannot be the thing that stops a vendor
 * getting in.
 */
function ScannerSheet({ onScanned, onClose }: { onScanned: (payload: string) => void; onClose: () => void }) {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const scannerRef = useRef<any>(null);
  const handledRef = useRef(false);
  const elementId = 'vendor-qr-scanner';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;
        const scanner = new Html5Qrcode(elementId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decoded: string) => {
            if (handledRef.current) return;
            handledRef.current = true;
            onScanned(decoded);
          },
          () => {}
        );
      } catch (err: any) {
        if (!cancelled) setCameraError(err?.message || 'Camera unavailable — enter the code below');
      }
    })();
    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner) {
        try {
          if (scanner.getState() === 2) scanner.stop().then(() => scanner.clear()).catch(() => {});
        } catch {
          // already stopped
        }
      }
    };
  }, [onScanned]);

  return (
    <div role="dialog" aria-label="Scan a vendor pass" className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Scan a vendor pass</h2>
        <button type="button" onClick={onClose} aria-label="Close scanner" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div id={elementId} className="mt-3 overflow-hidden rounded-lg" />
      {cameraError && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{cameraError}</p>}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) onScanned(manual.trim());
        }}
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Or paste the vendor's status link"
          aria-label="Vendor pass code"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-3 text-base dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        />
        <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-3 text-base font-semibold text-white hover:bg-indigo-700">
          Look up
        </button>
      </form>
    </div>
  );
}
