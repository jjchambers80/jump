'use client';

// Vendor booth picker (spec 014 phase 2): an approved vendor on a map-bound
// tier chooses a booth on the public map and buys it. Mounted on the guest
// status page and in the buyer account; both hand in the API calls, so the
// picker never knows which session it runs under.
//
// The server is the only source of truth: a booth is "yours" when the
// application comes back PAID. Everything before that is a hold with a
// countdown, and a 409 BOOTH_TAKEN just refetches the map.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mapsApi, type ChooseBoothResult, type MapBooth, type MapElement, type PublicMap } from '@/services/api';
import type { ApplicantApplication } from '@/lib/applications';
import { formatPrice } from '@/lib/fees';
import MapCanvas from './MapCanvas';
import MapLegend, { type LegendTier } from './MapLegend';
import { describeBooth, formatCountdown, holdRemaining, nextStepAfterChoose, selectability } from './boothSelection';

interface BoothPickerProps {
  /** Event id (not slug): `GET /events/:id/map` resolves ids only. */
  eventId: string;
  application: ApplicantApplication;
  /** `POST …/booth { boothId }` under the caller's session. */
  chooseBooth: (boothId: string) => Promise<ChooseBoothResult>;
  /** The existing pay-now flow: returns the hosted Checkout URL for the held booth. */
  payNow: () => Promise<{ url: string }>;
  /** Reload the application; the picker polls this while a card charge settles. */
  refresh: () => Promise<ApplicantApplication | null>;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'holding' }
  | { kind: 'charging'; holdExpiresAt: string | null }
  | { kind: 'redirecting' }
  | { kind: 'paid'; label: string };

/** Poll the application every 2 s for up to a minute while Stripe settles the charge. */
const CHARGE_POLL_MS = 2000;
const CHARGE_POLL_LIMIT = 30;

function toMapBooth(pb: PublicMap['booths'][number]): MapBooth {
  return {
    id: pb.id,
    mapId: '',
    label: pb.label,
    kind: pb.kind,
    x: pb.x,
    y: pb.y,
    w: pb.w,
    h: pb.h,
    rotation: pb.rotation,
    tierId: pb.tier?.id || null,
    status: pb.status,
    applicationId: null,
    assignedById: null,
    createdAt: '',
    updatedAt: '',
    holder: pb.vendorName ? { id: '', status: '', paymentStatus: '', businessName: pb.vendorName } : null,
  };
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

/** "Held for 14:59", ticking once a second; null once the hold is gone. */
function HoldCountdown({ holdExpiresAt, onExpire }: { holdExpiresAt: string | null; onExpire?: () => void }) {
  const [remaining, setRemaining] = useState(() => holdRemaining(holdExpiresAt));
  const expiredRef = useRef(false);
  useEffect(() => {
    expiredRef.current = false;
    setRemaining(holdRemaining(holdExpiresAt));
    if (!holdExpiresAt) return;
    const id = setInterval(() => {
      const left = holdRemaining(holdExpiresAt);
      setRemaining(left);
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true;
        clearInterval(id);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt, onExpire]);
  if (!holdExpiresAt) return null;
  return (
    <span data-testid="booth-hold-countdown" className="font-mono text-sm text-gray-700 dark:text-slate-300" aria-live="off">
      {remaining > 0 ? `Held for ${formatCountdown(remaining)}` : 'Hold expired'}
    </span>
  );
}

export default function BoothPicker({ eventId, application, chooseBooth, payNow, refresh }: BoothPickerProps) {
  const reducedMotion = useReducedMotion();
  const [map, setMap] = useState<PublicMap | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const etagRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tierId = application.tier?.id ?? null;
  const heldBooth = application.booth?.status === 'HELD' ? application.booth : null;

  const fetchMap = useCallback(async () => {
    try {
      const data = await mapsApi.getPublicEventMap(eventId, etagRef.current ?? undefined);
      if (data) {
        setMap(data);
        etagRef.current = data.etag;
        setMapError(null);
      }
    } catch (err: any) {
      if (err?.status === 304) return;
      setMapError(err?.status === 404 ? 'The floor map is not open yet. Check back soon.' : err?.message || 'Could not load the floor map');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchMap();
  }, [fetchMap]);

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const booths = useMemo(() => map?.booths ?? [], [map]);
  const sets = useMemo(() => selectability(booths, tierId), [booths, tierId]);
  const legendTiers: LegendTier[] = useMemo(
    () => (map?.legend ?? []).map((l) => ({ id: l.tierId, name: l.name, price: l.price, swatch: l.swatch })),
    [map]
  );
  const tierSwatches = useMemo(() => Object.fromEntries((map?.legend ?? []).map((l) => [l.tierId, l.swatch])), [map]);
  const elements: MapElement[] = useMemo(
    () => (map?.layout?.elements ?? []).map((el) => ({ ...el, kind: el.kind as MapElement['kind'] })),
    [map]
  );
  const boothsForCanvas = useMemo(() => booths.map(toMapBooth), [booths]);

  // A held booth (back from a cancelled Checkout, or mid-charge) is the selection.
  const activeId = heldBooth?.id ?? selectedId;
  const activeBooth = booths.find((b) => b.id === activeId) ?? null;
  const selectedIds = useMemo(() => new Set(activeId ? [activeId] : []), [activeId]);
  const price = formatPrice(application.amounts.applicantPays);
  const busy = phase.kind !== 'idle' && phase.kind !== 'paid';

  const handleBoothClick = (booth: MapBooth) => {
    if (busy || heldBooth) return;
    if (!sets.selectable.has(booth.id)) return;
    setNotice(null);
    setSelectedId((current) => (current === booth.id ? null : booth.id));
  };

  const pollUntilSettled = useCallback(
    (attempt: number) => {
      pollRef.current = setTimeout(async () => {
        const next = await refresh().catch(() => null);
        if (next?.paymentStatus === 'PAID') {
          setPhase({ kind: 'paid', label: next.booth?.label ?? next.boothLabel ?? '' });
          fetchMap();
          return;
        }
        if (next && next.paymentStatus !== 'PROCESSING') {
          // Declined: the hold was released server-side; let the vendor choose again.
          setPhase({ kind: 'idle' });
          setSelectedId(null);
          setNotice({ tone: 'error', text: 'We could not charge your card. Choose a booth again, or update your card first.' });
          fetchMap();
          return;
        }
        if (attempt >= CHARGE_POLL_LIMIT) {
          setPhase({ kind: 'idle' });
          setNotice({ tone: 'info', text: 'Your payment is still being confirmed. We will email you as soon as it goes through.' });
          return;
        }
        pollUntilSettled(attempt + 1);
      }, CHARGE_POLL_MS);
    },
    [refresh, fetchMap]
  );

  const goToCheckout = async () => {
    setPhase({ kind: 'redirecting' });
    try {
      const { url } = await payNow();
      window.location.assign(url);
    } catch (err: any) {
      setPhase({ kind: 'idle' });
      setNotice({ tone: 'error', text: err?.message || 'Could not open checkout' });
      await Promise.all([refresh().catch(() => null), fetchMap()]);
    }
  };

  const buy = async () => {
    if (!activeBooth || busy) return;
    setNotice(null);
    // Already holding (e.g. back from a cancelled Checkout): pay for that booth.
    if (heldBooth) {
      await goToCheckout();
      return;
    }
    setPhase({ kind: 'holding' });
    let result: ChooseBoothResult;
    try {
      result = await chooseBooth(activeBooth.id);
    } catch (err: any) {
      setPhase({ kind: 'idle' });
      if (err?.status === 409 && err?.code === 'BOOTH_TAKEN') {
        setSelectedId(null);
        setNotice({ tone: 'error', text: 'That booth was just taken. Pick another one.' });
      } else {
        setNotice({ tone: 'error', text: err?.message || 'Could not hold that booth' });
      }
      await fetchMap();
      return;
    }
    switch (nextStepAfterChoose(result)) {
      case 'paid':
        setPhase({ kind: 'paid', label: activeBooth.label });
        await Promise.all([refresh().catch(() => null), fetchMap()]);
        return;
      case 'charging':
        setPhase({ kind: 'charging', holdExpiresAt: result.holdExpiresAt });
        pollUntilSettled(1);
        return;
      case 'checkout':
        await goToCheckout();
        return;
      default:
        setPhase({ kind: 'idle' });
        setSelectedId(null);
        setNotice({ tone: 'error', text: 'We could not charge your card. Choose a booth again, or update your card first.' });
        await Promise.all([refresh().catch(() => null), fetchMap()]);
    }
  };

  const onHoldExpired = useCallback(async () => {
    setNotice({ tone: 'info', text: 'Your hold expired. The booth is available again — pick one to continue.' });
    await Promise.all([refresh().catch(() => null), fetchMap()]);
  }, [refresh, fetchMap]);

  if (loading) {
    return (
      <p className="text-sm text-gray-600 dark:text-slate-400" data-testid="booth-picker-loading">
        Loading the floor map…
      </p>
    );
  }
  if (mapError || !map) {
    return (
      <p className="text-sm text-gray-600 dark:text-slate-400" data-testid="booth-picker-unavailable">
        {mapError || 'The floor map is not open yet.'}
      </p>
    );
  }

  if (phase.kind === 'paid') {
    return (
      <div role="status" data-testid="booth-picker-paid" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
        Payment received — booth <strong>{phase.label}</strong> is yours.
      </div>
    );
  }

  return (
    <div data-testid="booth-picker" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">
          {heldBooth ? 'Finish buying your booth' : 'Choose your booth'}
        </h3>
        <p className="text-xs text-gray-600 dark:text-slate-400">
          {heldBooth
            ? 'Your booth is held while you pay.'
            : `Tap an available ${application.tier?.name ?? 'booth'} spot, then Buy. Booths go to whoever pays first.`}
        </p>
      </div>

      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          data-testid="booth-picker-notice"
          className={
            notice.tone === 'error'
              ? 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
              : 'rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200'
          }
        >
          {notice.text}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-4">
        <div className="lg:col-span-3 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900/40" style={{ height: '24rem' }}>
          <MapCanvas
            width={map.width}
            height={map.height}
            gridSize={map.gridSize}
            unit={map.unit}
            underlayUrl={map.underlayUrl}
            underlayOpacity={map.underlayOpacity}
            elements={elements}
            booths={boothsForCanvas}
            interactive
            selectedIds={selectedIds}
            selectionHandles={false}
            dimmedIds={sets.dimmed}
            disabledIds={busy || heldBooth ? new Set(booths.map((b) => b.id)) : sets.disabled}
            tierSwatches={tierSwatches}
            onBoothClick={handleBoothClick}
            reducedMotion={reducedMotion}
          />
        </div>
        <div className="lg:col-span-1 rounded-lg border border-gray-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900/40">
          <MapLegend tiers={legendTiers} showStates selectedTierId={tierId} />
        </div>
      </div>

      {activeBooth ? (
        <div data-testid="booth-buy-sheet" className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-gray-900 dark:text-slate-100" data-testid="booth-buy-summary">
                {describeBooth(activeBooth, price)}
              </p>
              <p className="mt-0.5 text-xs text-gray-600 dark:text-slate-400">
                {phase.kind === 'charging' ? (
                  <span data-testid="booth-charging" className="inline-flex items-center gap-2">
                    <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin" />
                    Charging your card…
                  </span>
                ) : phase.kind === 'redirecting' ? (
                  'Opening secure checkout…'
                ) : phase.kind === 'holding' ? (
                  'Holding your booth…'
                ) : application.hasCardOnFile ? (
                  'Your card on file is charged as soon as you buy.'
                ) : (
                  'You will pay on a secure checkout page; the booth is held for you meanwhile.'
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {(heldBooth?.holdExpiresAt || (phase.kind === 'charging' && phase.holdExpiresAt)) && (
                <HoldCountdown holdExpiresAt={heldBooth?.holdExpiresAt ?? (phase.kind === 'charging' ? phase.holdExpiresAt : null)} onExpire={heldBooth ? onHoldExpired : undefined} />
              )}
              {!heldBooth && !busy && (
                <button type="button" onClick={() => setSelectedId(null)} className="text-sm font-semibold text-brand-link hover:underline">
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={buy}
                disabled={busy}
                data-testid="booth-buy"
                className="rounded-lg bg-brand px-4 py-2 font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60 transition-colors motion-reduce:transition-none"
              >
                {heldBooth ? `Pay ${price}` : busy ? 'Working…' : `Buy for ${price}`}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-slate-400" data-testid="booth-picker-hint">
          {sets.selectable.size === 0
            ? 'No booths are left in your tier right now. The organizer can still place you — reply to your approval email.'
            : `${sets.selectable.size} booth${sets.selectable.size === 1 ? '' : 's'} available in your tier.`}
        </p>
      )}
    </div>
  );
}
