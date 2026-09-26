'use client';

// Choose your space (spec 037 phase 5, apply-then-choose). An approved vendor
// on a PAID form picks extras, how to pay, then where: from the list (any open
// space in their category — the organizer places them) or on the floor map
// (a specific booth of their category, spec 014's BoothPicker). Choosing holds
// the space for 15 minutes and opens the order; paying goes through the saved
// card (off-session) or Stripe's hosted Checkout. The server is the only
// source of truth: nothing here treats a hold as a sale, and a 409 simply
// refreshes what is left.
//
// Mounted on the guest status page and in the buyer account; both hand in the
// API calls, so the component never knows which session it runs under.
// Storefront colours come from the org's brand tokens (BrandScope); motion is
// limited to a reduced-motion-safe spinner so nothing masks payment state.

import { KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CalendarClock, CreditCard, LayoutList, Map as MapIcon, MapPin, ShieldCheck } from 'lucide-react';
import AddOnPicker from '@/components/AddOnPicker';
import BoothPicker from '@/components/maps/BoothPicker';
import { formatCountdown, holdRemaining } from '@/components/maps/boothSelection';
import type { ChooseBoothResult } from '@/services/api';
import { formatDate, money, type AddOnLineInput, type ApplicantApplication, type SpaceSelection } from '@/lib/applications';

export interface SpaceApi {
  /** `POST …/select` — a booth (map) or the category (list), with add-ons; optionally charge the saved card. */
  select: (body: { boothId?: string | null; addOns: AddOnLineInput[]; useSavedCard?: boolean }) => Promise<ChooseBoothResult & { orderRef?: string | null }>;
  /** `POST …/pay` — the hosted Checkout URL for the held space. */
  pay: () => Promise<{ url: string }>;
  /** `POST …/release` — give the held space back to choose another. */
  release: () => Promise<unknown>;
}

interface ChooseSpaceProps {
  application: ApplicantApplication;
  spaceApi: SpaceApi;
  /** Reload the application (after a hold, a decline, an expiry, or while a charge settles). */
  refresh: () => Promise<ApplicantApplication | null>;
}

type Mode = 'list' | 'map';
type Notice = { tone: 'error' | 'info' | 'success'; text: string };

const POLL_MS = 2000;
const POLL_LIMIT = 30;

function cardName(card: SpaceSelection['savedCard']): string {
  if (!card) return 'your saved card';
  const brand = card.brand ? `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)}` : 'Card';
  return card.last4 ? `${brand} ending ${card.last4}` : 'your saved card';
}

/** "Held for 14:59", ticking once a second; calls `onExpire` once when it reaches zero. */
function HoldTimer({ until, onExpire }: { until: string | null; onExpire: () => void }) {
  const [left, setLeft] = useState(() => holdRemaining(until));
  const fired = useRef(false);
  useEffect(() => {
    fired.current = false;
    setLeft(holdRemaining(until));
    if (!until) return;
    const id = setInterval(() => {
      const next = holdRemaining(until);
      setLeft(next);
      if (next === 0 && !fired.current) {
        fired.current = true;
        clearInterval(id);
        onExpire();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [until, onExpire]);
  if (!until) return null;
  const minutes = Math.ceil(left / 60_000);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold tabular-nums text-gray-800 dark:bg-slate-700 dark:text-slate-100" data-testid="space-hold-countdown">
      <CalendarClock className="h-4 w-4" aria-hidden />
      <span aria-hidden>{left > 0 ? `Held for ${formatCountdown(left)}` : 'Hold expired'}</span>
      {/* Screen readers hear the minute, not every second. */}
      <span className="sr-only">{left > 0 ? `Your space is held for about ${minutes} more minute${minutes === 1 ? '' : 's'}` : 'Your hold has expired'}</span>
    </span>
  );
}

function NoticeBox({ notice }: { notice: Notice }) {
  const tone =
    notice.tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
      : notice.tone === 'success'
        ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
        : 'border-gray-200 bg-gray-50 text-gray-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200';
  return (
    <p role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="space-notice" className={`rounded-lg border px-3.5 py-2.5 text-sm ${tone}`}>
      {notice.text}
    </p>
  );
}

export default function ChooseSpace({ application, spaceApi, refresh }: ChooseSpaceProps) {
  const sel = application.selection as SpaceSelection;
  const category = sel.category;
  const mapAvailable = sel.map.available && !sel.placedBooth;
  const [mode, setMode] = useState<Mode>(mapAvailable ? 'map' : 'list');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [payWith, setPayWith] = useState<'card' | 'checkout'>(sel.savedCard ? 'card' : 'checkout');
  const [busy, setBusy] = useState<null | 'holding' | 'charging' | 'redirecting' | 'releasing'>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseId = useId();
  const listTab = `${baseId}-list-tab`;
  const mapTab = `${baseId}-map-tab`;
  const tabRefs = { list: useRef<HTMLButtonElement>(null), map: useRef<HTMLButtonElement>(null) };

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const addOnLines: AddOnLineInput[] = useMemo(
    () => sel.addOns.filter((a) => (qty[a.id] ?? 0) > 0).map((a) => ({ addOnId: a.id, quantity: qty[a.id] })),
    [sel.addOns, qty]
  );
  // An estimate from per-unit figures: the order allocates fees across its lines to the cent.
  const total = Math.round((category.applicantPays + sel.addOns.reduce((s, a) => s + a.applicantPays * (qty[a.id] ?? 0), 0)) * 100) / 100;
  const useSavedCard = payWith === 'card' && Boolean(sel.savedCard);
  const soldOut = !category.guaranteed && category.spacesLeft <= 0;

  const pollUntilSettled = useCallback(
    (attempt: number) => {
      pollRef.current = setTimeout(async () => {
        const next = await refresh().catch(() => null);
        if (!next || next.paymentStatus === 'PROCESSING') {
          if (attempt >= POLL_LIMIT) {
            setBusy(null);
            setNotice({ tone: 'info', text: 'Your payment is still being confirmed. We will email you as soon as it goes through.' });
            return;
          }
          pollUntilSettled(attempt + 1);
          return;
        }
        setBusy(null);
        if (next.paymentStatus === 'PAID') setNotice({ tone: 'success', text: 'Payment received. Your space is confirmed.' });
        else setNotice({ tone: 'error', text: 'We could not charge your card. Choose again and pay on the secure checkout page.' });
      }, POLL_MS);
    },
    [refresh]
  );

  const goToCheckout = async () => {
    setBusy('redirecting');
    try {
      const { url } = await spaceApi.pay();
      window.location.assign(url);
    } catch (err) {
      setBusy(null);
      const e = err as { code?: string; message?: string };
      setNotice({ tone: 'error', text: e.code === 'HOLD_EXPIRED' ? 'Your hold expired. Choose your space again.' : e.message || 'Could not open checkout' });
      await refresh().catch(() => null);
    }
  };

  /** After a hold: pay on Checkout, or follow the saved-card charge. */
  const afterHold = async (result: { paymentStatus?: string }) => {
    if (result.paymentStatus === 'PAID') {
      setBusy(null);
      setNotice({ tone: 'success', text: 'Payment received. Your space is confirmed.' });
      await refresh().catch(() => null);
      return;
    }
    if (result.paymentStatus === 'PROCESSING') {
      setBusy('charging');
      pollUntilSettled(1);
      return;
    }
    if (result.paymentStatus === 'AWAITING_SELECTION') {
      setBusy(null);
      setPayWith('checkout');
      setNotice({ tone: 'error', text: `We could not charge ${cardName(sel.savedCard)}. Choose again and pay on the secure checkout page.` });
      await refresh().catch(() => null);
      return;
    }
    await goToCheckout();
  };

  const holdFromList = async () => {
    if (busy) return;
    setNotice(null);
    setBusy('holding');
    try {
      const result = await spaceApi.select({ addOns: addOnLines, useSavedCard });
      await afterHold(result);
    } catch (err) {
      setBusy(null);
      const e = err as { code?: string; message?: string };
      setNotice({ tone: 'error', text: e.code === 'SOLD_OUT' ? `No ${category.name} spaces are left right now.` : e.message || 'Could not hold your space' });
      await refresh().catch(() => null);
    }
  };

  const release = async () => {
    if (busy) return;
    setBusy('releasing');
    setNotice(null);
    try {
      await spaceApi.release();
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message || 'Could not release your space' });
    }
    setBusy(null);
    await refresh().catch(() => null);
  };

  const onHoldExpired = useCallback(async () => {
    setNotice({ tone: 'info', text: 'Your hold expired and the space went back. Choose again to continue.' });
    await refresh().catch(() => null);
  }, [refresh]);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next: Mode = e.key === 'Home' ? 'list' : e.key === 'End' ? 'map' : mode === 'list' ? 'map' : 'list';
    setMode(next);
    tabRefs[next].current?.focus();
  };

  // ─── Held: finish paying, or give it back ────────────────────────────────
  if (sel.state === 'HELD') {
    const processing = application.paymentStatus === 'PROCESSING';
    const heldBooth = application.booth?.status === 'HELD' ? application.booth : null;
    const where = heldBooth
      ? `Booth ${heldBooth.label}${heldBooth.w && heldBooth.h ? ` · ${heldBooth.w}×${heldBooth.h}` : ''}`
      : sel.placedBooth
        ? `Booth ${sel.placedBooth.label} (placed by the organizer)`
        : `A ${category.name} space — the organizer places you`;
    const addOnTotal = (application.addOns ?? []).reduce((s, l) => s + l.applicantPays, 0);
    return (
      <section aria-labelledby={`${baseId}-held`} data-testid="choose-space" data-state="HELD" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id={`${baseId}-held`} className="text-lg font-bold tracking-tight text-gray-900 dark:text-slate-100">
            {processing ? 'Confirming your payment' : 'Your space is held'}
          </h3>
          {!processing && <HoldTimer until={sel.heldUntil} onExpire={onHoldExpired} />}
        </div>
        {notice && <NoticeBox notice={notice} />}
        <div className="tier-stub-shadow">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:p-5">
            <p className="flex items-start gap-2 font-semibold text-gray-900 dark:text-slate-100" data-testid="space-held-where">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-link" aria-hidden />
              {where}
            </p>
            <ul className="mt-3 space-y-1.5 text-sm tabular-nums text-gray-700 dark:text-slate-300" data-testid="space-held-lines">
              <li className="flex justify-between gap-3">
                <span>{category.name}</span>
                <span>{money(application.amounts.applicantPays - addOnTotal)}</span>
              </li>
              {(application.addOns ?? []).map((l) => (
                <li key={l.id} className="flex justify-between gap-3">
                  <span>{l.name} ×{l.quantity}</span>
                  <span>{money(l.applicantPays)}</span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-3 border-t border-gray-200 pt-2 dark:border-slate-700">
                <span className="font-semibold text-gray-900 dark:text-slate-100">Total</span>
                <span className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-slate-50">{money(application.amounts.applicantPays)}</span>
              </li>
            </ul>
          </div>
        </div>
        {processing ? (
          <p className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300" role="status">
            <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin" />
            Your payment is being confirmed. This page updates when it goes through.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={goToCheckout}
              disabled={Boolean(busy)}
              data-testid="space-pay"
              className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-brand-fg transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 disabled:opacity-60 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800"
            >
              {busy === 'redirecting' ? 'Opening secure checkout…' : `Pay ${money(application.amounts.applicantPays)}`}
            </button>
            <button type="button" onClick={release} disabled={Boolean(busy)} data-testid="space-release" className="text-sm font-semibold text-brand-link hover:underline disabled:opacity-60">
              {busy === 'releasing' ? 'Releasing…' : 'Change my choice'}
            </button>
          </div>
        )}
      </section>
    );
  }

  // ─── Choose: extras, payment method, then where ──────────────────────────
  const payLabel = useSavedCard ? `Pay ${money(total)} with ${cardName(sel.savedCard)}` : `Hold this space and pay ${money(total)}`;
  return (
    <section aria-labelledby={`${baseId}-title`} data-testid="choose-space" data-state="CHOOSE" className="space-y-6">
      <header className="space-y-1.5">
        <h3 id={`${baseId}-title`} className="text-xl font-bold tracking-tight text-gray-900 dark:text-slate-100">
          Choose your space
        </h3>
        <p className="text-sm leading-relaxed text-gray-600 dark:text-slate-400">
          You are approved as <strong className="text-gray-900 dark:text-slate-100">{category.name}</strong>.
          {sel.dueAt ? ` Choose and pay by ${formatDate(sel.dueAt)} to confirm your spot.` : ' Choose and pay to confirm your spot.'}
          {category.guaranteed ? ' Your place in this category is reserved; specific spots go to whoever pays first.' : ' Spaces go to whoever pays first.'}
        </p>
      </header>

      {notice && <NoticeBox notice={notice} />}

      {sel.placedBooth && (
        <p className="flex items-start gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" data-testid="space-placed-booth">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-link" aria-hidden />
          <span>
            The organizer has placed you at <strong>booth {sel.placedBooth.label}</strong>
            {sel.placedBooth.w && sel.placedBooth.h ? ` (${sel.placedBooth.w}×${sel.placedBooth.h})` : ''}. Pay for your {category.name} space to confirm it.
          </span>
        </p>
      )}

      {sel.addOns.length > 0 && (
        <AddOnPicker
          addOns={sel.addOns}
          quantities={qty}
          onChange={(id, quantity) => setQty((prev) => ({ ...prev, [id]: quantity }))}
          unitPrice={(a) => sel.addOns.find((x) => x.id === a.id)?.applicantPays ?? a.price}
          title="Extras"
          hint="Optional. Charged with your space."
        />
      )}

      {sel.savedCard && (
        <fieldset className="space-y-2" data-testid="space-pay-with">
          <legend className="mb-1 text-sm font-semibold text-gray-900 dark:text-slate-100">How you pay</legend>
          {(
            [
              ['card', `Pay with ${cardName(sel.savedCard)}`, 'Charged as soon as you choose.'],
              ['checkout', 'Pay on a secure checkout page', 'Card, and other methods your organizer accepts.'],
            ] as const
          ).map(([value, title, detail]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 px-3.5 py-3 text-sm transition-colors hover:border-gray-300 has-[:checked]:border-brand-link has-[:checked]:bg-gray-50 motion-reduce:transition-none dark:border-slate-700 dark:hover:border-slate-600 dark:has-[:checked]:bg-slate-900/50"
            >
              <input type="radio" name={`${baseId}-pay`} value={value} checked={payWith === value} onChange={() => setPayWith(value)} className="mt-0.5 h-4 w-4 accent-brand" />
              <span>
                <span className="flex items-center gap-1.5 font-semibold text-gray-900 dark:text-slate-100">
                  {value === 'card' && <CreditCard className="h-4 w-4" aria-hidden />}
                  {title}
                </span>
                <span className="block text-gray-500 dark:text-slate-400">{detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="space-y-3">
        {mapAvailable && (
          <div role="tablist" aria-label="How to choose your space" className="inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-slate-700 dark:bg-slate-900/60">
            {(
              [
                ['list', 'List', LayoutList, listTab],
                ['map', 'Map', MapIcon, mapTab],
              ] as const
            ).map(([value, text, Icon, id]) => (
              <button
                key={value}
                ref={tabRefs[value]}
                id={id}
                type="button"
                role="tab"
                aria-selected={mode === value}
                aria-controls={`${id}-panel`}
                tabIndex={mode === value ? 0 : -1}
                onClick={() => setMode(value)}
                onKeyDown={onTabKey}
                data-testid={`space-mode-${value}`}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link motion-reduce:transition-none ${
                  mode === value ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-slate-50' : 'text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {text}
              </button>
            ))}
          </div>
        )}

        {(!mapAvailable || mode === 'list') && (
          <div role={mapAvailable ? 'tabpanel' : undefined} id={`${listTab}-panel`} aria-labelledby={mapAvailable ? listTab : undefined} data-testid="space-list">
            <div className="tier-stub-shadow">
              <div className="tier-stub relative grid grid-cols-1 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brand" />
                <div className="min-w-0 py-4 pl-5 pr-4 sm:py-5">
                  <p className="text-[17px] font-semibold leading-snug tracking-tight text-gray-900 dark:text-slate-100">{category.name}</p>
                  {category.description && <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-slate-400">{category.description}</p>}
                  <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                    {sel.placedBooth
                      ? `Booth ${sel.placedBooth.label}, placed by the organizer.`
                      : mapAvailable
                        ? 'Any open space in this category. The organizer assigns your exact spot.'
                        : 'The organizer assigns your exact spot.'}
                  </p>
                  <p className="mt-2 text-xs font-semibold" data-testid="space-left">
                    {category.guaranteed ? (
                      <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Your space is reserved
                      </span>
                    ) : soldOut ? (
                      <span className="text-red-700 dark:text-red-400">Sold out</span>
                    ) : (
                      <span className="text-gray-700 dark:text-slate-300">
                        {category.spacesLeft} space{category.spacesLeft === 1 ? '' : 's'} left
                      </span>
                    )}
                  </p>
                </div>
                <div className="relative flex h-16 items-center justify-between gap-3 border-t-2 border-dashed border-gray-200 pl-5 pr-4 dark:border-slate-700 sm:h-auto sm:flex-col sm:justify-center sm:gap-0.5 sm:border-l-2 sm:border-t-0 sm:px-2 sm:py-4 sm:text-center">
                  <span className="text-xl font-extrabold tabular-nums tracking-tight text-gray-900 dark:text-slate-50 sm:text-2xl">{money(category.applicantPays)}</span>
                  {category.feesIncluded > 0 ? (
                    <span className="text-xs text-gray-500 dark:text-slate-400">incl. {money(category.feesIncluded)} fees</span>
                  ) : category.tax > 0 ? (
                    <span className="text-xs text-gray-500 dark:text-slate-400">incl. tax</span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-600 dark:text-slate-400" data-testid="space-total">
                Total <strong className="ml-1 text-lg font-extrabold tabular-nums text-gray-900 dark:text-slate-50">{money(total)}</strong>
                {addOnLines.length > 0 && <span className="ml-1 text-xs">(extras included)</span>}
              </p>
              <button
                type="button"
                onClick={holdFromList}
                disabled={Boolean(busy) || soldOut}
                data-testid="space-hold"
                className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-brand-fg transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 disabled:opacity-60 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800"
              >
                {busy === 'holding'
                  ? 'Holding your space…'
                  : busy === 'charging'
                    ? 'Charging your card…'
                    : busy === 'redirecting'
                      ? 'Opening secure checkout…'
                      : soldOut
                        ? 'Sold out'
                        : payLabel}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Your space is held for 15 minutes while you pay.</p>
          </div>
        )}

        {mapAvailable && mode === 'map' && (
          <div role="tabpanel" id={`${mapTab}-panel`} aria-labelledby={mapTab} data-testid="space-map">
            <BoothPicker
              eventId={application.event.id}
              application={application}
              price={total}
              chargesSavedCard={useSavedCard}
              chooseBooth={(boothId) => spaceApi.select({ boothId, addOns: addOnLines, useSavedCard })}
              payNow={spaceApi.pay}
              refresh={refresh}
            />
          </div>
        )}
      </div>
    </section>
  );
}
