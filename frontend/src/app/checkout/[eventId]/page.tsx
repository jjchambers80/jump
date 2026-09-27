'use client';

// Guest checkout page — collects contact info (name + email) and initiates order
// Uses order-based flow: POST /orders with contact, eventId, and price-tier items
// Returns stripeCheckoutUrl for redirect per FR-042, contracts/api.yaml
//
// Layout is conversion-first: the form sits beside a sticky order summary on
// desktop so the pay button is above the fold; below lg the summary collapses
// to one row and the pay button rides in a fixed bottom bar with the total.

import React, { Suspense, useState, useEffect, useRef } from 'react';
import StorefrontPasswordGate from '../../../components/StorefrontPasswordGate';
import { storefrontLockFrom, type StorefrontLock } from '../../../lib/storefrontAccess';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../services/api';
import CartLineItem from '../../../components/CartLineItem';
import ExpandCollapseAll from '../../../components/ExpandCollapseAll';
import { formatEventDate, formatEventTime } from '@/lib/eventTime';
import { computeOrderFees, formatPrice } from '../../../lib/fees';
import { parseAddOnLines, type AddOn } from '../../../lib/addOns';
import BrandScope from '../../../components/BrandScope';
import OrganizationHeader from '../../../components/OrganizationHeader';
import type { ThemeMode } from '../../../lib/theme';
import Link from 'next/link';
import { storefrontHref } from '../../../lib/storefrontPath';
import { useBuyer } from '../../../lib/useBuyer';
import { ChevronDown, ChevronLeft, Lock, Mail } from 'lucide-react';
import { loadContactDraft, saveCheckoutDraft, saveContactDraft } from '../../../lib/checkoutDraft';
import { suggestEmail } from '../../../lib/emailTypo';
import { acceptancesFor, fetchLegalVersions, LEGAL_PAGES_ENABLED, LEGAL_PATHS, type LegalVersions } from '../../../lib/legal';

interface EventVenue {
  id: string;
  name: string;
  address: string;
  /** IANA zone the show's wall clock belongs to (spec 033). */
  timezone?: string | null;
}

interface PriceTier {
  id: string;
  name: string;
  price: number;
  quantityAvailable: number;
  isActive: boolean;
}

interface Event {
  id: string;
  name: string;
  description?: string;
  date: string;
  taxRate: number;
  /** Listed tier prices already include tax (spec 009 phase 3). */
  taxInclusivePricing?: boolean;
  venue: EventVenue | null;
  priceTiers: PriceTier[];
  addOns?: AddOn[];
  organizationId?: string | null;
  organizationName?: string | null;
  organizationLogoUrl?: string | null;
  organizationBrandColor?: string | null;
  organizationThemeMode?: ThemeMode | null;
  /** Settings › Customer accounts › Show sign-in links (spec 031). */
  organizationSignInLinks?: boolean;
}

interface CreateOrderResponse {
  orderId: string;
  orderRef: string;
  stripeCheckoutUrl: string;
  totalAmount: number;
}

interface CartItem {
  priceTierId: string;
  quantity: number;
}

function parseCartItems(
  value: string | null,
  legacyTierId: string | null,
  legacyQuantity: string | null
): CartItem[] {
  if (value) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is CartItem =>
            typeof item?.priceTierId === 'string' &&
            Number.isInteger(item?.quantity) &&
            item.quantity > 0
        );
      }
    } catch {
      return [];
    }
  }

  const quantity = Number.parseInt(legacyQuantity || '1', 10);
  return legacyTierId && Number.isInteger(quantity) && quantity > 0
    ? [{ priceTierId: legacyTierId, quantity }]
    : [];
}

type FieldName = 'firstName' | 'lastName' | 'email';

const FIELD_ORDER: FieldName[] = ['firstName', 'lastName', 'email'];

const inputClass = (invalid: boolean) =>
  `block w-full rounded-lg border bg-white px-4 py-3 text-base text-gray-900 shadow-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand disabled:opacity-60 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400 ${
    invalid ? 'border-red-600 dark:border-red-400' : 'border-gray-300 dark:border-slate-600'
  }`;

function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin motion-reduce:animate-none ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

/** Tickets → Details → Payment. The buyer is always on step 2 here. */
function CheckoutSteps({ eventHref }: { eventHref: string }) {
  const steps = [
    { label: 'Tickets', state: 'done' as const },
    { label: 'Details', state: 'current' as const },
    { label: 'Payment', state: 'next' as const },
  ];
  return (
    <nav aria-label="Checkout progress">
      <ol className="flex items-center gap-2 text-xs font-semibold sm:text-sm" data-testid="checkout-steps">
        {steps.map((step, index) => (
          <li key={step.label} className="flex items-center gap-2" aria-current={step.state === 'current' ? 'step' : undefined}>
            {index > 0 && <span aria-hidden="true" className="h-px w-4 bg-gray-300 dark:bg-slate-600 sm:w-8" />}
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                step.state === 'next'
                  ? 'border border-gray-300 text-gray-500 dark:border-slate-600 dark:text-slate-400'
                  : 'bg-brand text-brand-fg'
              }`}
            >
              {step.state === 'done' ? '✓' : index + 1}
            </span>
            {step.state === 'done' ? (
              <Link href={eventHref} className="text-gray-600 underline-offset-2 hover:underline dark:text-slate-300">
                {step.label}
                <span className="sr-only"> (completed, edit)</span>
              </Link>
            ) : (
              <span className={step.state === 'current' ? 'text-gray-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}>
                {step.label}
                {step.state === 'next' && <span className="sr-only"> (next)</span>}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function CheckoutContent({ params }: { params: { eventId: string } }) {
  const searchParams = useSearchParams();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [soldOut, setSoldOut] = useState(false);
  const [lock, setLock] = useState<StorefrontLock | null>(null);
  const [processing, setProcessing] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  // Contact form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  // Spec 007: account opt-in is pre-checked (contract basis for a purchased
  // ticket); marketing consent is never pre-checked (GDPR / ePrivacy / CASL).
  const [createAccount, setCreateAccount] = useState(true);
  const [emailSubscribed, setEmailSubscribed] = useState(false);
  // Details typed earlier in this tab (e.g. before backing out of Stripe) come
  // back first; a signed-in buyer's profile then fills whatever is still blank.
  // Scoped to the organization, so it waits for the event to load.
  const [draftScope, setDraftScope] = useState<string | null>(null);
  const loadedScope = event ? event.organizationId || event.id : null;
  useEffect(() => {
    if (!loadedScope) return;
    const draft = loadContactDraft(loadedScope);
    if (draft) {
      setFirstName((current) => current || draft.firstName);
      setLastName((current) => current || draft.lastName);
      setEmail((current) => current || draft.email);
    }
    setDraftScope(loadedScope);
  }, [loadedScope]);
  useEffect(() => {
    if (draftScope) saveContactDraft(draftScope, { firstName, lastName, email });
  }, [draftScope, firstName, lastName, email]);
  // Spec 031: a buyer signed in at this organization gets their details
  // prefilled (still editable) and no "create an account" box — they have one.
  const { buyer } = useBuyer(event?.organizationId ?? null);
  useEffect(() => {
    if (!buyer) return;
    setFirstName((current) => current || buyer.firstName || '');
    setLastName((current) => current || buyer.lastName || '');
    setEmail((current) => current || buyer.email || '');
  }, [buyer]);
  const showSignInLink = event?.organizationSignInLinks !== false && !buyer;
  const signInHref =
    event?.organizationId && typeof window !== 'undefined'
      ? `${storefrontHref(`/organizations/${event.organizationId}/account`, event.organizationId)}?next=${encodeURIComponent(
          `${window.location.pathname}${window.location.search}`
        )}`
      : null;
  // Spec 024 phase 3: the versions of the terms and privacy policy this page
  // shows, echoed on the order so the consent trail names them.
  const [legalVersions, setLegalVersions] = useState<LegalVersions | null>(null);
  useEffect(() => {
    fetchLegalVersions()
      .then(setLegalVersions)
      .catch(() => setLegalVersions(null));
  }, []);
  const [formErrors, setFormErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({});

  // Legacy single-tier params remain supported for existing checkout links.
  const cartItems = parseCartItems(
    searchParams.get('items'),
    searchParams.get('tierId'),
    searchParams.get('quantity')
  );
  // Add-on lines (spec 012) chosen on the event page; unknown ids are dropped
  const addOnLines = parseAddOnLines(searchParams.get('addOns'));

  useEffect(() => {
    fetchEventDetails();
  }, [params.eventId]);

  // Move focus to a submit error so screen reader and keyboard users hear it.
  useEffect(() => {
    if (error && event) errorRef.current?.focus();
  }, [error, event]);

  const fetchEventDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<Event>(`/events/${params.eventId}`);
      setEvent(data);
      setLock(null);
    } catch (err: any) {
      const locked = storefrontLockFrom(err);
      if (locked) {
        setLock(locked);
        return;
      }
      setError(err.message || 'Failed to load event details');
    } finally {
      setLoading(false);
    }
  };

  const selectedItems = cartItems
    .map((item) => {
      const tier = event?.priceTiers?.find((candidate) => candidate.id === item.priceTierId);
      return tier ? { ...item, tier } : null;
    })
    .filter((item): item is CartItem & { tier: PriceTier } => item !== null);
  const selectedAddOns = addOnLines
    .map((line) => {
      const addOn = event?.addOns?.find((candidate) => candidate.id === line.addOnId);
      return addOn ? { ...line, addOn } : null;
    })
    .filter((line): line is (typeof addOnLines)[number] & { addOn: AddOn } => line !== null);

  const fieldError = (field: FieldName, value: string): string | undefined => {
    const trimmed = value.trim();
    if (field === 'firstName') return trimmed ? undefined : 'Enter your first name';
    if (field === 'lastName') return trimmed ? undefined : 'Enter your last name';
    if (!trimmed) return 'Enter your email address';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? undefined : 'Enter an email address like name@example.com';
  };
  const values: Record<FieldName, string> = { firstName, lastName, email };

  const validateForm = (): boolean => {
    const errors: Partial<Record<FieldName, string>> = {};
    for (const field of FIELD_ORDER) {
      const message = fieldError(field, values[field]);
      if (message) errors[field] = message;
    }
    setFormErrors(errors);
    const firstInvalid = FIELD_ORDER.find((field) => errors[field]);
    if (firstInvalid) document.getElementById(firstInvalid)?.focus();
    return !firstInvalid;
  };

  // Validate on blur only once a field has content, so tabbing through an empty
  // form does not paint it red before the buyer has typed anything.
  const handleBlur = (field: FieldName) => {
    const value = values[field];
    if (value.trim()) setFormErrors((prev) => ({ ...prev, [field]: fieldError(field, value) }));
    if (field === 'email') setEmailSuggestion(suggestEmail(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (processing || !validateForm() || selectedItems.length === 0 || !event) return;

    try {
      setProcessing(true);
      setError(null);
      setSoldOut(false);

      const versions = legalVersions ?? (await fetchLegalVersions().catch(() => null));
      const items = selectedItems.map(({ priceTierId, quantity }) => ({ priceTierId, quantity }));
      const addOns = selectedAddOns.map(({ addOnId, quantity }) => ({ addOnId, quantity }));
      const response = await api.post<CreateOrderResponse>('/orders', {
        eventId: params.eventId,
        items,
        ...(addOns.length > 0 && { addOns }),
        contact: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
        },
        // An existing account is never "created" again; the backend only turns the flag on anyway.
        createAccount: buyer ? false : createAccount,
        emailSubscribed,
        ...(versions && { acceptances: acceptancesFor(versions) }),
      });

      // Stripe's cancel_url lands on the event page; it restores this cart.
      saveCheckoutDraft(event.id, { items, addOns });
      window.location.href = response.stripeCheckoutUrl;
    } catch (err: any) {
      const locked = storefrontLockFrom(err);
      if (locked) {
        setLock(locked);
        return;
      }
      if (err.status === 409) {
        // 409 is either inventory ("Insufficient inventory for VIP") or the open-hold cap (spec 020).
        const message: string = err.message || 'Some of these tickets are no longer available.';
        setSoldOut(/inventory|available|sold out/i.test(message));
        setError(message);
      } else {
        setError(err.message || 'We could not start your payment. Please try again.');
      }
      setProcessing(false);
    }
  };

  if (lock) {
    return <StorefrontPasswordGate organization={lock.organization} message={lock.message} onUnlocked={fetchEventDetails} />;
  }

  if (loading) {
    return <CheckoutLoading />;
  }

  const eventHref = `/events/${params.eventId}`;

  if ((error && !event) || !event) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div role="alert" className="bg-white dark:bg-slate-800 rounded-xl shadow-md dark:shadow-black/20 p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">We couldn&apos;t load checkout</h1>
          <p className="text-gray-600 dark:text-slate-400 mb-6">{error || 'Event not found'}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={fetchEventDetails}
              className="rounded-lg bg-gray-900 px-6 py-3 font-semibold text-white hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 dark:bg-slate-100 dark:text-slate-900"
            >
              Try again
            </button>
            <Link href={eventHref} className="rounded-lg px-6 py-3 font-semibold text-gray-700 underline-offset-2 hover:underline dark:text-slate-300">
              Back to event
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const shell = (children: React.ReactNode) => (
    <BrandScope
      color={event.organizationBrandColor}
      themeMode={event.organizationThemeMode}
      className="min-h-screen bg-gray-50 dark:bg-slate-900"
    >
      {event.organizationName && (
        <OrganizationHeader
          organization={{ id: event.organizationId, name: event.organizationName, logoUrl: event.organizationLogoUrl }}
        />
      )}
      {children}
    </BrandScope>
  );

  if (selectedItems.length === 0 || selectedItems.length !== cartItems.length) {
    return shell(
      <main className="flex items-center justify-center p-4 py-16">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md dark:shadow-black/20 p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">Your cart is empty</h1>
          <p className="text-gray-600 dark:text-slate-400 mb-6">
            {cartItems.length > 0
              ? 'Some of the tickets you picked are no longer on sale. Choose your tickets again to continue.'
              : 'Choose your tickets to continue to checkout.'}
          </p>
          <Link
            href={eventHref}
            className="inline-flex items-center justify-center rounded-lg bg-brand px-6 py-3 font-bold text-brand-fg hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2"
          >
            Choose tickets
          </Link>
        </div>
      </main>
    );
  }

  // Spec 033: the venue's zone owns the show's wall clock.
  const zone = event.venue?.timezone;
  const formattedDate = formatEventDate(event.date, zone, { weekday: 'long', month: 'long' });
  const formattedTime = formatEventTime(event.date, zone);

  const totalQuantity = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
  const ticketLabel = `${totalQuantity} ${totalQuantity === 1 ? 'ticket' : 'tickets'}`;
  const feeItems = [
    ...selectedItems.map((item) => ({ price: item.tier.price, quantity: item.quantity })),
    ...selectedAddOns.map((line) => ({ price: line.addOn.price, quantity: line.quantity, taxable: line.addOn.taxable })),
  ];
  const fees = computeOrderFees(feeItems, event?.taxRate ?? 0, event?.taxInclusivePricing === true);
  const totalAmount = fees.total;
  const ctaLabel = `Continue to payment — ${formatPrice(totalAmount)}`;
  const organizerName = event.organizationName || 'the organizer';
  // Tiers first, then add-ons — same order as `fees.lines`
  const cartLines = [
    ...selectedItems.map((item) => ({ key: item.priceTierId, name: item.tier.name })),
    ...selectedAddOns.map((line) => ({ key: line.addOnId, name: line.addOn.name })),
  ];

  const allLinesOpen = cartLines.every((line) => openLines[line.key]);
  const toggleLine = (key: string) =>
    setOpenLines((current) => ({ ...current, [key]: !current[key] }));
  const toggleAllLines = () => {
    const next = !allLinesOpen;
    setOpenLines(Object.fromEntries(cartLines.map((line) => [line.key, next])));
  };

  const describedBy = (field: FieldName, hint?: string) =>
    [formErrors[field] ? `${field}-error` : null, hint].filter(Boolean).join(' ') || undefined;

  const submitButton = (extra: string) => (
    <button
      type="submit"
      form="checkout-form"
      disabled={processing}
      className={`flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-base font-bold text-brand-fg shadow-sm transition-colors duration-200 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-80 dark:focus-visible:ring-offset-slate-900 sm:text-lg ${extra}`}
    >
      {processing ? (
        <>
          <Spinner />
          Opening secure payment…
        </>
      ) : (
        <>
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          {ctaLabel}
        </>
      )}
    </button>
  );

  return shell(
    <main className="mx-auto max-w-6xl px-4 pb-40 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pb-16">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
        <Link
          href={eventHref}
          className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-brand-link hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Back to event
        </Link>
        <CheckoutSteps eventHref={eventHref} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-10">
        {/* Order summary — right rail on desktop, one collapsible row on mobile */}
        <aside
          aria-labelledby="order-summary-heading"
          className="lg:sticky lg:top-6 lg:order-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-black/20"
        >
          <button
            type="button"
            onClick={() => setSummaryOpen((open) => !open)}
            aria-expanded={summaryOpen}
            aria-controls="order-summary-body"
            data-testid="order-summary-toggle"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand lg:hidden"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-brand-link">
              {summaryOpen ? 'Hide' : 'Show'} order summary
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${summaryOpen ? 'rotate-180' : ''}`} aria-hidden />
            </span>
            <span className="text-right">
              <span className="block text-base font-bold text-gray-900 dark:text-slate-100">{formatPrice(totalAmount)}</span>
              <span className="block text-xs text-gray-500 dark:text-slate-400">{ticketLabel}</span>
            </span>
          </button>

          <div
            id="order-summary-body"
            className={`${summaryOpen ? 'block' : 'hidden'} border-t border-gray-200 p-5 dark:border-slate-700 lg:block lg:border-t-0 lg:p-6`}
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 id="order-summary-heading" className="text-lg font-bold tracking-tight text-gray-900 dark:text-slate-100">
                Order summary
              </h2>
              <ExpandCollapseAll allOpen={allLinesOpen} onToggle={toggleAllLines} />
            </div>

            <div className="mb-4 rounded-xl bg-gray-50 p-4 dark:bg-slate-900/60">
              <p className="font-semibold text-gray-900 dark:text-slate-100">{event.name}</p>
              <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">
                <time dateTime={event.date}>
                  {formattedDate} · {formattedTime}
                </time>
              </p>
              {event.venue && <p className="text-sm text-gray-600 dark:text-slate-300">{event.venue.name}</p>}
            </div>

            <div data-testid="cart-lines-checkout">
              {cartLines.map((line, index) => (
                <CartLineItem
                  key={line.key}
                  id={`checkout-${line.key}`}
                  name={line.name}
                  line={fees.lines[index]}
                  open={!!openLines[line.key]}
                  onToggle={() => toggleLine(line.key)}
                  variant="drawer"
                />
              ))}
            </div>

            <dl className="mt-3 space-y-1.5 border-t border-gray-200 pt-3 text-sm dark:border-slate-700" data-testid="checkout-fees">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600 dark:text-slate-300">{selectedAddOns.length > 0 ? 'Tickets & add-ons' : 'Tickets'}</dt>
                <dd className="tabular-nums text-gray-900 dark:text-slate-100">{formatPrice(fees.subtotal)}</dd>
              </div>
              {fees.platformFee > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-600 dark:text-slate-300">Service fee</dt>
                  <dd className="tabular-nums text-gray-900 dark:text-slate-100">{formatPrice(fees.platformFee)}</dd>
                </div>
              )}
              {fees.processingFee > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-600 dark:text-slate-300">Processing fee</dt>
                  <dd className="tabular-nums text-gray-900 dark:text-slate-100">{formatPrice(fees.processingFee)}</dd>
                </div>
              )}
              {fees.tax > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-600 dark:text-slate-300">{fees.taxInclusive ? 'Tax (included in price)' : 'Tax'}</dt>
                  <dd className="tabular-nums text-gray-900 dark:text-slate-100">{formatPrice(fees.tax)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-4 border-t border-gray-200 pt-3 dark:border-slate-700">
                <dt className="font-semibold text-gray-900 dark:text-slate-100">
                  Total <span className="font-normal text-gray-500 dark:text-slate-400">({ticketLabel}, USD)</span>
                </dt>
                <dd className="text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-100" data-testid="checkout-total">
                  {formatPrice(totalAmount)}
                </dd>
              </div>
            </dl>
          </div>
        </aside>

        {/* Buyer details */}
        <section aria-labelledby="checkout-heading" className="lg:order-1 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-black/20 sm:p-8">
          <h1 id="checkout-heading" className="text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-3xl">
            Your details
          </h1>
          <p className="mt-1 mb-6 text-sm text-gray-600 dark:text-slate-300">
            {buyer ? (
              <>
                Signed in as <span className="font-semibold">{buyer.email}</span>.
              </>
            ) : (
              <>
                Checking out as a guest — no account needed.
                {showSignInLink && signInHref && (
                  <>
                    {' '}
                    <Link href={signInHref} data-testid="checkout-sign-in-link" className="font-semibold text-brand-link underline-offset-2 hover:underline">
                      Sign in
                    </Link>{' '}
                    for faster checkout.
                  </>
                )}
              </>
            )}
          </p>

          {error && (
            <div
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              data-testid="checkout-error"
              className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
            >
              <p className="font-semibold">{soldOut ? 'Those tickets just sold out' : 'Payment could not start'}</p>
              <p className="mt-1 text-sm">{error}</p>
              {soldOut && (
                <Link href={eventHref} className="mt-2 inline-block text-sm font-semibold underline underline-offset-2">
                  Choose other tickets
                </Link>
              )}
            </div>
          )}

          <form id="checkout-form" onSubmit={handleSubmit} noValidate aria-busy={processing}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="firstName" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-slate-200">
                  First name
                </label>
                <input
                  type="text"
                  id="firstName"
                  name="given-name"
                  autoComplete="given-name"
                  autoCapitalize="words"
                  required
                  aria-invalid={!!formErrors.firstName}
                  aria-describedby={describedBy('firstName')}
                  value={firstName}
                  onChange={(e) => {
                    setFirstName(e.target.value);
                    if (formErrors.firstName) setFormErrors((prev) => ({ ...prev, firstName: undefined }));
                  }}
                  onBlur={() => handleBlur('firstName')}
                  className={inputClass(!!formErrors.firstName)}
                  disabled={processing}
                />
                {formErrors.firstName && (
                  <p id="firstName-error" className="mt-1.5 text-sm text-red-700 dark:text-red-300">
                    {formErrors.firstName}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="lastName" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-slate-200">
                  Last name
                </label>
                <input
                  type="text"
                  id="lastName"
                  name="family-name"
                  autoComplete="family-name"
                  autoCapitalize="words"
                  required
                  aria-invalid={!!formErrors.lastName}
                  aria-describedby={describedBy('lastName')}
                  value={lastName}
                  onChange={(e) => {
                    setLastName(e.target.value);
                    if (formErrors.lastName) setFormErrors((prev) => ({ ...prev, lastName: undefined }));
                  }}
                  onBlur={() => handleBlur('lastName')}
                  className={inputClass(!!formErrors.lastName)}
                  disabled={processing}
                />
                {formErrors.lastName && (
                  <p id="lastName-error" className="mt-1.5 text-sm text-red-700 dark:text-red-300">
                    {formErrors.lastName}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-slate-200">
                Email address
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-slate-500" aria-hidden />
                <input
                  type="email"
                  id="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  aria-invalid={!!formErrors.email}
                  aria-describedby={describedBy('email', 'email-hint')}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailSuggestion(null);
                    if (formErrors.email) setFormErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  onBlur={() => handleBlur('email')}
                  className={`${inputClass(!!formErrors.email)} pl-11`}
                  placeholder="you@example.com"
                  disabled={processing}
                />
              </div>
              {formErrors.email && (
                <p id="email-error" className="mt-1.5 text-sm text-red-700 dark:text-red-300">
                  {formErrors.email}
                </p>
              )}
              <div aria-live="polite">
                {emailSuggestion && (
                  <p className="mt-1.5 text-sm text-gray-700 dark:text-slate-200" data-testid="email-suggestion">
                    Did you mean{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setEmail(emailSuggestion);
                        setEmailSuggestion(null);
                        setFormErrors((prev) => ({ ...prev, email: undefined }));
                        document.getElementById('email')?.focus();
                      }}
                      className="font-semibold text-brand-link underline underline-offset-2"
                    >
                      {emailSuggestion}
                    </button>
                    ?
                  </p>
                )}
              </div>
              <p id="email-hint" className="mt-1.5 text-sm text-gray-600 dark:text-slate-400">
                Your tickets and receipt go here.
              </p>
            </div>

            {/* Account + marketing opt-ins — independent; neither implies the other */}
            <fieldset className="mt-6 space-y-3">
              <legend className="sr-only">Account and email preferences</legend>
              {!buyer && (
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="createAccount"
                    checked={createAccount}
                    onChange={(e) => setCreateAccount(e.target.checked)}
                    disabled={processing}
                    aria-describedby="createAccount-hint"
                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-400 text-brand focus:ring-brand dark:border-slate-500 dark:bg-slate-900"
                  />
                  <label htmlFor="createAccount" className="cursor-pointer text-sm text-gray-800 dark:text-slate-200">
                    Save my tickets to an account with {organizerName}
                    <span id="createAccount-hint" className="block text-gray-600 dark:text-slate-400">
                      No password — we&apos;ll email you a sign-in link.
                    </span>
                  </label>
                </div>
              )}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="emailSubscribed"
                  checked={emailSubscribed}
                  onChange={(e) => setEmailSubscribed(e.target.checked)}
                  disabled={processing}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-400 text-brand focus:ring-brand dark:border-slate-500 dark:bg-slate-900"
                />
                <label htmlFor="emailSubscribed" className="cursor-pointer text-sm text-gray-800 dark:text-slate-200">
                  Email me about future events from {organizerName}
                </label>
              </div>
            </fieldset>

            {/* Inline pay button from lg; below lg the fixed bar carries it */}
            <div className="mt-8 hidden lg:block">{submitButton('')}</div>
          </form>

          <div className="mt-4 space-y-2 text-center">
            <p className="flex items-center justify-center gap-1.5 text-sm text-gray-600 dark:text-slate-300">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Next: pay securely with Stripe. Your card details never touch our servers.
            </p>
            {/* Terms — recorded as a LegalAcceptance on the order (spec 024 phase 3); the pages link once they exist (spec 023) */}
            <p className="text-xs text-gray-600 dark:text-slate-400" data-testid="checkout-terms">
              By continuing, you agree to our{' '}
              {LEGAL_PAGES_ENABLED ? (
                <a href={LEGAL_PATHS.terms} className="text-brand-link underline underline-offset-2">
                  Terms of Service
                </a>
              ) : (
                <span>Terms of Service</span>
              )}{' '}
              and{' '}
              {LEGAL_PAGES_ENABLED ? (
                <a href={LEGAL_PATHS.privacy} className="text-brand-link underline underline-offset-2">
                  Privacy Policy
                </a>
              ) : (
                <span>Privacy Policy</span>
              )}
              .
            </p>
          </div>
        </section>
      </div>

      {/* Mobile / tablet pay bar: the call to action never scrolls out of view */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur supports-[backdrop-filter]:bg-white/85 dark:border-slate-700 dark:bg-slate-800/95 dark:shadow-[0_-4px_16px_rgba(0,0,0,0.35)] lg:hidden"
        data-testid="checkout-mobile-bar"
      >
        <div className="mx-auto max-w-xl">{submitButton('')}</div>
      </div>
    </main>
  );
}

function CheckoutLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center" role="status">
      <div className="text-center text-gray-500 dark:text-slate-400">
        <Spinner className="h-10 w-10 mx-auto mb-4" />
        <p>Loading checkout…</p>
      </div>
    </div>
  );
}

export default function CheckoutPage({ params }: { params: { eventId: string } }) {
  return (
    <Suspense fallback={<CheckoutLoading />}>
      <CheckoutContent params={params} />
    </Suspense>
  );
}
