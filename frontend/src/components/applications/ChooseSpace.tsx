'use client';

// Choose your space (spec 037 phase 5, apply-then-choose; spec 039 modes). An
// approved vendor on a PAID form picks extras, how to pay, then what the form
// sells (`selection.mode`):
//   TIERS — a space type: the one the organizer approved them as, or, when
//           approved without one, their own pick from the form's tiers. The
//           organizer places them on the floor later.
//   MAP   — a spot of their category on the floor map (BoothPicker), or the
//           same spots as an accessible sortable list (SpotList). Spots can
//           carry their own price; other categories are faded and locked. Choosing holds
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
import SpotList from './SpotList';
import AddOnPicker from '@/components/AddOnPicker';
import BoothPicker from '@/components/maps/BoothPicker';
import { formatCountdown, holdRemaining } from '@/components/maps/boothSelection';
import type { ChooseBoothResult } from '@/services/api';
import { formatDate, money, type AddOnLineInput, type ApplicantApplication, type SpaceCategory, type SpaceSelection } from '@/lib/applications';

export interface SpaceApi {
  /** `POST …/select` — a booth (map) or the category (list), with add-ons; optionally charge the saved card. */
  select: (body: { boothId?: string | null; tierId?: string | null; addOns: AddOnLineInput[]; useSavedCard?: boolean }) => Promise<ChooseBoothResult & { orderRef?: string | null }>;
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

type Mode = 'map' | 'spots';
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
  const spotMode = sel.mode === 'MAP';
  // TIERS form approved without a category: the vendor picks one (spec 039 D6).
  const tierChoices = sel.categories ?? null;
  const [pickedTierId, setPickedTierId] = useState<string | null>(null);
  const picked = tierChoices?.find((c) => c.id === pickedTierId) ?? null;
  const category: SpaceCategory | null = tierChoices ? picked : sel.category;
  const offeredAddOns = tierChoices ? picked?.addOns ?? [] : sel.addOns;
  const choosingSpot = spotMode && !sel.placedBooth;
  const [mode, setMode] = useState<Mode>('map');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [payWith, setPayWith] = useState<'card' | 'checkout'>(sel.savedCard ? 'card' : 'checkout');
  const [busy, setBusy] = useState<null | 'holding' | 'charging' | 'redirecting' | 'releasing'>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseId = useId();
  const mapTab = `${baseId}-map-tab`;
  const spotsTab = `${baseId}-spots-tab`;
  const tabRefs = { map: useRef<HTMLButtonElement>(null), spots: useRef<HTMLButtonElement>(null) };

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const addOnLines: AddOnLineInput[] = useMemo(
    () => offeredAddOns.filter((a) => (qty[a.id] ?? 0) > 0).map((a) => ({ addOnId: a.id, quantity: qty[a.id] })),
    [offeredAddOns, qty]
  );
  // Estimates from per-unit figures: the order allocates fees across its lines to the cent.
  const extrasTotal = Math.round(offeredAddOns.reduce((s, a) => s + a.applicantPays * (qty[a.id] ?? 0), 0) * 100) / 100;
  const total = Math.round(((category?.applicantPays ?? 0) + extrasTotal) * 100) / 100;
  const useSavedCard = payWith === 'card' && Boolean(sel.savedCard);
  const soldOut = category ? !category.guaranteed && category.spacesLeft <= 0 : false;

  const pickTier = (tierId: string) => {
    if (tierId === pickedTierId) return;
    setPickedTierId(tierId);
    // Extras are offered per space type; start the new type's from zero.
    setQty({});
  };

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

  /** Hold a space: the category (TIERS / a placed booth), a picked tier, or a spot from the list. */
  const hold = async (choice: { boothId?: string; tierId?: string } = {}) => {
    if (busy) return;
    setNotice(null);
    setBusy('holding');
    try {
      const result = await spaceApi.select({ ...choice, addOns: addOnLines, useSavedCard });
      await afterHold(result);
    } catch (err) {
      setBusy(null);
      const e = err as { code?: string; message?: string };
      const text =
        e.code === 'SOLD_OUT'
          ? category
            ? `No ${category.name} spaces are left right now.`
            : 'That space type just sold out. Choose another.'
          : e.code === 'BOOTH_TAKEN'
            ? 'That spot was just taken. Pick another one.'
            : e.message || 'Could not hold your space';
      setNotice({ tone: 'error', text });
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
    const next: Mode = e.key === 'Home' ? 'map' : e.key === 'End' ? 'spots' : mode === 'map' ? 'spots' : 'map';
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
        : sel.category
          ? `A ${sel.category.name} space — the organizer places you`
          : 'Your space — the organizer places you';
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
                <span>{heldBooth ? `${sel.category?.name ?? 'Spot'} · ${heldBooth.label}` : sel.category?.name ?? 'Space'}</span>
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

  // ─── Choose: what, extras, how to pay, then where ─────────────────────────
  const payLabel = (amount: number) => (useSavedCard ? `Pay ${money(amount)} with ${cardName(sel.savedCard)}` : `Hold this space and pay ${money(amount)}`);
  const due = sel.dueAt ? ` by ${formatDate(sel.dueAt)}` : '';
  const holdBusyLabel =
    busy === 'holding' ? 'Holding your space…' : busy === 'charging' ? 'Charging your card…' : busy === 'redirecting' ? 'Opening secure checkout…' : null;
  const holdButton = (onClick: () => void, disabled: boolean, idleLabel: string) => (
    <button
      type="button"
      onClick={onClick}
      disabled={Boolean(busy) || disabled}
      data-testid="space-hold"
      className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-brand-fg transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 disabled:opacity-60 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800"
    >
      {holdBusyLabel ?? idleLabel}
    </button>
  );
  const totalLine = (
    <p className="text-sm text-gray-600 dark:text-slate-400" data-testid="space-total">
      Total <strong className="ml-1 text-lg font-extrabold tabular-nums text-gray-900 dark:text-slate-50">{money(total)}</strong>
      {addOnLines.length > 0 && <span className="ml-1 text-xs">(extras included)</span>}
    </p>
  );

  return (
    <section aria-labelledby={`${baseId}-title`} data-testid="choose-space" data-state="CHOOSE" data-mode={spotMode ? 'MAP' : 'TIERS'} className="space-y-6">
      <header className="space-y-1.5">
        <h3 id={`${baseId}-title`} className="text-xl font-bold tracking-tight text-gray-900 dark:text-slate-100">
          {choosingSpot ? 'Choose your spot' : 'Choose your space'}
        </h3>
        <p className="text-sm leading-relaxed text-gray-600 dark:text-slate-400" data-testid="space-intro">
          {tierChoices ? (
            <>
              You are approved. Pick the space type that fits you and pay{due} to confirm it. Spaces go to whoever pays first; the organizer places you on the floor.
            </>
          ) : (
            <>
              You are approved as <strong className="text-gray-900 dark:text-slate-100">{category?.name}</strong>.
              {choosingSpot
                ? ` Pick your spot on the floor map and pay${due} to confirm it. Each spot shows its price.`
                : ` Choose and pay${due} to confirm your spot.`}
              {category?.guaranteed
                ? choosingSpot
                  ? ' A space in your category is reserved for you; specific spots go to whoever pays first.'
                  : ' Your place in this category is reserved; specific spots go to whoever pays first.'
                : ' Spaces go to whoever pays first.'}
            </>
          )}
        </p>
      </header>

      {notice && <NoticeBox notice={notice} />}

      {sel.placedBooth && (
        <p className="flex items-start gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" data-testid="space-placed-booth">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-link" aria-hidden />
          <span>
            The organizer has placed you at <strong>booth {sel.placedBooth.label}</strong>
            {sel.placedBooth.w && sel.placedBooth.h ? ` (${sel.placedBooth.w}×${sel.placedBooth.h})` : ''}. Pay for it to confirm it.
          </span>
        </p>
      )}

      {tierChoices && (
        <fieldset className="space-y-2" data-testid="space-tier-choice">
          <legend className="mb-1 text-sm font-semibold text-gray-900 dark:text-slate-100">Space type</legend>
          {tierChoices.map((tier) => {
            const tierSoldOut = tier.spacesLeft <= 0;
            return (
              <label
                key={tier.id}
                data-testid="space-tier-option"
                className={`flex items-start gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-sm transition-colors has-[:checked]:border-brand-link has-[:checked]:ring-1 has-[:checked]:ring-brand-link motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-800 ${
                  tierSoldOut ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-gray-300 dark:hover:border-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name={`${baseId}-tier`}
                  value={tier.id}
                  checked={pickedTierId === tier.id}
                  onChange={() => pickTier(tier.id)}
                  disabled={tierSoldOut || Boolean(busy)}
                  className="mt-1 h-4 w-4 accent-brand"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-gray-900 dark:text-slate-100">{tier.name}</span>
                  {tier.description && <span className="mt-0.5 block text-gray-600 dark:text-slate-400">{tier.description}</span>}
                  <span className={`mt-1 block text-xs font-semibold ${tierSoldOut ? 'text-red-700 dark:text-red-400' : 'text-gray-600 dark:text-slate-400'}`}>
                    {tierSoldOut ? 'Sold out' : `${tier.spacesLeft} space${tier.spacesLeft === 1 ? '' : 's'} left`}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-lg font-extrabold tabular-nums tracking-tight text-gray-900 dark:text-slate-50">{money(tier.applicantPays)}</span>
                  {tier.feesIncluded > 0 ? (
                    <span className="block text-xs text-gray-500 dark:text-slate-400">incl. {money(tier.feesIncluded)} fees</span>
                  ) : tier.tax > 0 ? (
                    <span className="block text-xs text-gray-500 dark:text-slate-400">incl. tax</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      {offeredAddOns.length > 0 && (
        <AddOnPicker
          addOns={offeredAddOns}
          quantities={qty}
          onChange={(id, quantity) => setQty((prev) => ({ ...prev, [id]: quantity }))}
          unitPrice={(a) => offeredAddOns.find((x) => x.id === a.id)?.applicantPays ?? a.price}
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

      {tierChoices ? (
        // TIERS, vendor picks: the radio cards above are the choice.
        <div className="space-y-2" data-testid="space-list">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {picked ? totalLine : <p className="text-sm text-gray-600 dark:text-slate-400">Pick a space type to see your total.</p>}
            {holdButton(() => picked && hold({ tierId: picked.id }), !picked || soldOut, picked ? payLabel(total) : 'Pick a space type')}
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400">Your space is held for 15 minutes while you pay.</p>
        </div>
      ) : choosingSpot ? (
        sel.map.pending ? (
          <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300" role="status" data-testid="space-map-pending">
            The floor plan is being updated. Check back soon to pick your spot{due}.
          </p>
        ) : !sel.map.available || !category ? (
          <p className="text-sm text-gray-600 dark:text-slate-400" data-testid="space-map-empty">
            No spots are open in your category right now. The organizer can still place you — reply to your approval email.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="tablist" aria-label="How to choose your spot" className="inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-slate-700 dark:bg-slate-900/60">
                {(
                  [
                    ['map', 'Map', MapIcon, mapTab],
                    ['spots', 'Spots', LayoutList, spotsTab],
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
              {typeof sel.map.priceFrom === 'number' && typeof sel.map.priceTo === 'number' && (
                <p className="text-sm text-gray-600 dark:text-slate-400" data-testid="space-price-range">
                  {sel.map.boothsAvailable} spot{sel.map.boothsAvailable === 1 ? '' : 's'} open ·{' '}
                  {sel.map.priceFrom === sel.map.priceTo ? money(sel.map.priceFrom) : `${money(sel.map.priceFrom)}–${money(sel.map.priceTo)}`}
                </p>
              )}
            </div>
            {mode === 'map' ? (
              <div role="tabpanel" id={`${mapTab}-panel`} aria-labelledby={mapTab} data-testid="space-map">
                <BoothPicker
                  eventId={application.event.id}
                  application={application}
                  price={total}
                  extrasTotal={extrasTotal}
                  chargesSavedCard={useSavedCard}
                  chooseBooth={(boothId) => spaceApi.select({ boothId, addOns: addOnLines, useSavedCard })}
                  payNow={spaceApi.pay}
                  refresh={refresh}
                />
              </div>
            ) : (
              <div role="tabpanel" id={`${spotsTab}-panel`} aria-labelledby={spotsTab} data-testid="space-spots">
                <SpotList
                  eventId={application.event.id}
                  tierId={category.id}
                  fallbackPrice={category.applicantPays}
                  extrasTotal={extrasTotal}
                  busy={Boolean(busy)}
                  actionLabel={payLabel}
                  onHold={(boothId) => hold({ boothId })}
                />
              </div>
            )}
          </div>
        )
      ) : category ? (
        // TIERS with the organizer's category, or a booth staff placed the vendor on.
        <div data-testid="space-list">
          <div className="tier-stub-shadow">
            <div className="tier-stub relative grid grid-cols-1 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brand" />
              <div className="min-w-0 py-4 pl-5 pr-4 sm:py-5">
                <p className="text-[17px] font-semibold leading-snug tracking-tight text-gray-900 dark:text-slate-100">{category.name}</p>
                {category.description && <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-slate-400">{category.description}</p>}
                <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                  {sel.placedBooth ? `Booth ${sel.placedBooth.label}, placed by the organizer.` : 'The organizer assigns your exact spot.'}
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
            {totalLine}
            {holdButton(() => hold(), soldOut, soldOut ? 'Sold out' : payLabel(total))}
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Your space is held for 15 minutes while you pay.</p>
        </div>
      ) : null}
    </section>
  );
}
