'use client';

// Public event page container (spec 050 §8.2): fetches the event (forwarding
// 050-F's draft preview token), owns the cart, the checkout handoff and the
// dialogs, and renders the presentational EventPageView. Preview mode is on
// only when the backend answered `preview: true` for a verified token.

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import StorefrontPasswordGate from '@/components/StorefrontPasswordGate';
import { storefrontLockFrom, type StorefrontLock } from '@/lib/storefrontAccess';
import { api } from '@/services/api';
import { fetchLegalVersions, type LegalVersions } from '@/lib/legal';
import { EVENT_PREVIEW_HEADER } from '@/lib/eventPreview';
import EventPageView from './EventPageView';
import EventCartSheet from './EventCartSheet';
import { DescriptionDialog, ImageDialog, TierDescriptionDialog } from './EventDialogs';
import { EventPageError, EventPageLoading } from './EventPageStates';
import { useEventCart } from './useEventCart';
import { orgFromEvent, type EventPageEvent, type PriceTier } from './eventPage';

export default function EventDetailPage({
  params,
  chrome = true,
  previewToken,
}: {
  params: { eventId: string };
  /** False when the theme frame (spec 038) already renders the header and footer around this page. */
  chrome?: boolean;
  /** Draft preview token from the httpOnly cookie, forwarded unverified (spec 050 F). */
  previewToken?: string;
}) {
  const router = useRouter();
  const [event, setEvent] = useState<EventPageEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState<StorefrontLock | null>(null);
  const [legalVersions, setLegalVersions] = useState<LegalVersions | null>(null);
  const [rsvpSubmitted, setRsvpSubmitted] = useState(false);
  // Back from Stripe's cancel_url (?status=cancelled): the cart comes back.
  const [checkoutCancelled, setCheckoutCancelled] = useState(false);
  const [dialog, setDialog] = useState<'cart' | 'description' | 'image' | null>(null);
  const [tierDialog, setTierDialog] = useState<PriceTier | null>(null);
  const { cart, restore, updateQuantity, setAddOnQuantity, toggleLine, toggleAllLines } = useEventCart(event);

  const loadLegal = () => fetchLegalVersions().then(setLegalVersions).catch(() => {});

  const fetchEventDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<EventPageEvent>(
        `/events/${params.eventId}`,
        previewToken ? { headers: { [EVENT_PREVIEW_HEADER]: previewToken } } : undefined
      );
      setEvent(data);
      setLock(null);
      // Stripe's cancel_url brings the buyer back here: put their cart back.
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('status') === 'cancelled') {
        setCheckoutCancelled(true);
        restore(data);
      }
    } catch (err: any) {
      const locked = storefrontLockFrom(err);
      if (locked) {
        setLock(locked);
        return;
      }
      setError(err.message || 'Failed to load event details');
      console.error('Error fetching event:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEventDetails();
    loadLegal();
  }, [params.eventId]);

  if (lock) {
    return <StorefrontPasswordGate organization={lock.organization} message={lock.message} onUnlocked={fetchEventDetails} />;
  }
  if (loading) return <EventPageLoading />;
  if (error || !event) return <EventPageError message={error} />;

  // Only the backend's verified answer turns preview mode on.
  const preview = event.preview === true;
  const close = () => setDialog(null);

  const handleProceedToCheckout = () => {
    if (preview || cart.items.length === 0) return;
    const search = new URLSearchParams({ items: JSON.stringify(cart.items) });
    if (cart.addOnLines.length > 0) search.set('addOns', JSON.stringify(cart.addOnLines));
    router.push(`/checkout/${params.eventId}?${search.toString()}`);
  };

  return (
    <EventPageView
      event={event}
      org={orgFromEvent(event)}
      preview={preview}
      previewBar={preview}
      chrome={chrome}
      cart={cart}
      legalVersions={legalVersions}
      checkoutCancelled={checkoutCancelled}
      rsvpSubmitted={rsvpSubmitted}
      onQuantityChange={updateQuantity}
      onAddOnChange={setAddOnQuantity}
      onToggleLine={toggleLine}
      onToggleAllLines={toggleAllLines}
      onCheckout={handleProceedToCheckout}
      onRsvpSubmitted={() => setRsvpSubmitted(true)}
      onLegalStale={loadLegal}
      // Preview has no dialogs: without an opener their buttons do not render.
      onOpenCart={preview ? undefined : () => setDialog('cart')}
      onShowDescription={preview ? undefined : () => setDialog('description')}
      onShowImage={preview ? undefined : () => setDialog('image')}
      onShowTier={preview ? undefined : setTierDialog}
    >
      {dialog === 'cart' && event.admissionMode !== 'RSVP' && (
        <EventCartSheet cart={cart} onClose={close} onCheckout={handleProceedToCheckout} onToggleLine={toggleLine} onToggleAllLines={toggleAllLines} />
      )}
      {tierDialog && <TierDescriptionDialog name={tierDialog.name} description={tierDialog.description} onClose={() => setTierDialog(null)} />}
      {dialog === 'image' && event.logoUrl && <ImageDialog name={event.name} logoUrl={event.logoUrl} onClose={close} />}
      {dialog === 'description' && event.description && <DescriptionDialog description={event.description} onClose={close} />}
    </EventPageView>
  );
}
