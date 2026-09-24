'use client';

// Event edit form — admin area
// Loads existing event data and allows updating fields
// Uses PATCH /organizations/:orgId/events/:eventId

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import api from '@/services/api';
import { resolveAssetUrl } from '@/lib/assets';
import { EventMediaCard } from '@/components/events/EventMediaCard';
import RichTextEditorField from '@/components/editor/RichTextEditorField';
import { TierCard, TierEditDialog, type TierFormData } from '@/components/TierEditDialog';
import AddOnsSection from './AddOnsSection';
import SlugField from '@/components/SlugField';
import VenueFlyout, { NEW_VENUE_OPTION, type CreatedVenue } from '@/components/VenueFlyout';
import { DEFAULT_ZONE, formatEventTime, instantToZonedInput, zonedInputToInstant, zonedInputToIso } from '@/lib/eventTime';
import { timeZoneLabel } from '@/lib/timeZones';
import {
  AdmissionModeField,
  EVENT_FORM_ID,
  EventFormActions,
  EventFormActionsCard,
  EventFormHeader,
  EventFormShell,
  FormAlert,
  FormCard,
  FormPanel,
  RsvpSettingsFields,
  TierHeaderActions,
  hintClass,
  inputClass,
  labelClass,
  type AdmissionMode,
} from '@/components/events/EventFormLayout';


interface Venue {
  id: string;
  name: string;
  address: string;
  /** IANA zone the venue's wall clock belongs to (spec 033). */
  timezone?: string | null;
}

interface TierPreset {
  id: string;
  name: string;
  description: string | null;
  price: number;
  minPerOrder: number | null;
  maxPerOrder: number | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
}

interface PriceTier {
  id: string;
  name: string;
  description: string | null;
  price: number;
  quantityTotal: number;
  quantitySold: number;
  quantityAvailable: number;
  quantityReserved: number;
  displayOrder: number;
  minPerOrder: number | null;
  maxPerOrder: number | null;
  isActive: boolean;
  saleStartDate: string | null;
  saleEndDate: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
  isOnSale: boolean;
  saleStatus: 'NOT_STARTED' | 'ON_SALE' | 'ENDED';
}

interface TierFormInput {
  key: string; // existing tier id or temp UUID for new tiers
  isNew: boolean;
  name: string;
  description: string;
  price: string;
  quantityTotal: string;
  quantitySold: number; // read-only, for existing tiers
  quantityReserved: number; // read-only, for existing tiers
  minPerOrder: string;
  maxPerOrder: string;
  saleStartDate: string;
  saleEndDate: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
  isActive: boolean;
}

function tierToForm(t: PriceTier, zone: string | null | undefined): TierFormInput {
  return {
    key: t.id,
    isNew: false,
    name: t.name,
    description: t.description || '',
    price: String(Number(t.price)),
    quantityTotal: String(t.quantityTotal),
    quantitySold: t.quantitySold,
    quantityReserved: t.quantityReserved ?? 0,
    minPerOrder: t.minPerOrder != null ? String(t.minPerOrder) : '',
    maxPerOrder: t.maxPerOrder != null ? String(t.maxPerOrder) : '',
    saleStartDate: toDatetimeLocal(t.saleStartDate ?? '', zone),
    saleEndDate: toDatetimeLocal(t.saleEndDate ?? '', zone),
    visibility: t.visibility,
    isRefundable: t.isRefundable,
    isActive: t.isActive,
  };
}

function newTierForm(): TierFormInput {
  return {
    key: crypto.randomUUID(),
    isNew: true,
    name: '',
    description: '',
    price: '',
    quantityTotal: '',
    quantitySold: 0,
    quantityReserved: 0,
    minPerOrder: '1',
    maxPerOrder: '10',
    saleStartDate: '',
    saleEndDate: '',
    visibility: 'PUBLIC',
    isRefundable: false,
    isActive: true,
  };
}

interface EventDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  date: string;
  capacity: number;
  category: string | null;
  status: string;
  admissionMode: AdmissionMode;
  rsvpLimit?: number | null;
  rsvpMaxPartySize?: number;
  venue: {
    id: string;
    name: string;
    address: string;
    /** IANA zone the venue's wall clock belongs to (spec 033). */
    timezone?: string | null;
  } | null;
  /** Cached sales tax for this event and where it came from (Settings › Tax). */
  tax?: { rate: number; source: 'STRIPE' | 'MANUAL' | null; region: string | null };
  /** Listed prices include tax (spec 009 phase 3). */
  taxInclusivePricing?: boolean;
  priceTiers: PriceTier[];
}

function formatTaxRate(rate: number): string {
  return `${(rate * 100).toFixed(3).replace(/\.?0+$/, '')}%`;
}

/** "Tax: 8.25% · Stripe Tax · NC" with a link to Settings › Tax. */
function EventTaxSummary({ tax }: { tax: NonNullable<EventDetail['tax']> }) {
  const parts = [formatTaxRate(tax.rate)];
  if (tax.source === 'STRIPE') parts.push('Stripe Tax');
  else if (tax.source === 'MANUAL') parts.push('Manual rate');
  else parts.push('Not collecting');
  if (tax.region) parts.push(tax.region);
  return (
    <p className="mt-1 text-xs text-gray-600 dark:text-slate-400" data-testid="event-tax-summary">
      Tax: {parts.join(' · ')}
      {' · '}
      <Link href="/admin/settings/tax" className="font-medium text-indigo-600 hover:underline dark:text-indigo-300">
        Settings › Tax
      </Link>
      {!tax.region && ' — set the venue\'s state to collect tax'}
    </p>
  );
}

// Spec 033: the form shows and reads the venue's wall clock, never the browser's.
function toDatetimeLocal(iso: string, zone: string | null | undefined): string {
  return instantToZonedInput(iso, zone);
}


function EditEventContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const eventId = params.eventId as string;
  const orgId = searchParams.get('orgId');

  const [venues, setVenues] = useState<Venue[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(false);
  const [showVenueDialog, setShowVenueDialog] = useState(false);
  const [presets, setPresets] = useState<TierPreset[]>([]);
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [eventData, setEventData] = useState<EventDetail | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(true);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [venueId, setVenueId] = useState('');
  // Spec 033: dates are typed in the selected venue's wall clock. Switching venue
  // keeps the typed time and re-anchors it, rather than sliding the clock.
  const venueZone = venues.find((v) => v.id === venueId)?.timezone ?? eventData?.venue?.timezone ?? null;
  const [date, setDate] = useState('');
  const [capacity, setCapacity] = useState('');
  const [category, setCategory] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [slug, setSlug] = useState('');
  const [slugError, setSlugError] = useState<string | null>(null);

  // Admission mode (spec 034)
  const [admissionMode, setAdmissionMode] = useState<AdmissionMode>('TICKETED');
  const [rsvpLimit, setRsvpLimit] = useState('');
  const [rsvpLimitEnabled, setRsvpLimitEnabled] = useState(false);
  const [rsvpMaxPartySize, setRsvpMaxPartySize] = useState('1');

  const [priceTiers, setPriceTiers] = useState<TierFormInput[]>([]);
  const [tiersInitialized, setTiersInitialized] = useState(false);
  // D11 lock: mode can't be changed once orders/RSVPs exist
  const [modeLocked, setModeLocked] = useState(false);
  const [modeLockReason, setModeLockReason] = useState<string | null>(null);
  const [loadedAdmissionMode, setLoadedAdmissionMode] = useState<AdmissionMode | null>(null);

  const [editingTierKey, setEditingTierKey] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    searchParams.get('imageUpload') === 'failed'
      ? 'The event was created, but its image failed to upload. Add it again under Media.'
      : null
  );
  const [success, setSuccess] = useState(false);

  // Load event data
  useEffect(() => {
    if (!orgId || !eventId) return;
    const fetchEvent = async () => {
      try {
        setLoadingEvent(true);
        const data = await api.get<{ events: EventDetail[] }>(
          `/organizations/${orgId}/events?limit=100`
        );
        const event = data.events.find((e) => e.id === eventId);
        if (!event) {
          setError('Event not found');
          return;
        }
        setEventData(event);
        setName(event.name);
        setDescription(event.description || '');
        setVenueId(event.venue?.id || '');
        setDate(toDatetimeLocal(event.date, event.venue?.timezone));
        setCapacity(String(event.capacity));
        setCategory(event.category || '');
        setLogoUrl(event.logoUrl || null);
        setSlug(event.slug || '');

        // Admission mode
        const mode = event.admissionMode || 'TICKETED';
        setAdmissionMode(mode);
        setLoadedAdmissionMode(mode);
        setRsvpLimit(event.rsvpLimit ? String(event.rsvpLimit) : '');
        setRsvpLimitEnabled(event.rsvpLimit != null && event.rsvpLimit > 0);
        setRsvpMaxPartySize(event.rsvpMaxPartySize ? String(event.rsvpMaxPartySize) : '1');

        // Initialize tier form state from loaded tiers
        const sorted = [...event.priceTiers].sort((a, b) => a.displayOrder - b.displayOrder);
        setPriceTiers(sorted.map((t) => tierToForm(t, event.venue?.timezone)));
        setTiersInitialized(true);
      } catch (err: any) {
        setError(err.message || 'Failed to load event');
      } finally {
        setLoadingEvent(false);
      }
    };
    fetchEvent();
  }, [orgId, eventId]);

  // D11 lock: check if mode can be changed after loading
  useEffect(() => {
    if (!eventData || !loadedAdmissionMode) return;
    if (loadedAdmissionMode === 'RSVP') {
      // RSVP → TICKETED is locked if there are any GOING RSVPs
      const checkLock = async () => {
        try {
          const rsvps = await api.get<{ rsvpCount: number }>(`/admin/events/${eventId}/rsvps`);
          if (rsvps.rsvpCount > 0) {
            setModeLocked(true);
            setModeLockReason('RSVPs have been submitted for this event. The admission mode cannot be changed.');
          }
        } catch {
          // If listing fails, don't lock — let the backend enforce it
        }
      };
      checkLock();
    } else {
      // TICKETED → RSVP is locked if there are any orders
      // We can't easily check orders from frontend, so let the backend enforce it
      setModeLocked(false);
      setModeLockReason(null);
    }
  }, [eventData, loadedAdmissionMode, eventId]);

  // Load venues for the org
  const fetchVenues = useCallback(async () => {
    if (!orgId) return;
    try {
      setVenuesLoading(true);
      const data = await api.get<Venue[]>(`/organizations/${orgId}/venues`);
      setVenues(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load venues');
    } finally {
      setVenuesLoading(false);
    }
  }, [orgId]);

  const fetchPresets = useCallback(async () => {
    if (!orgId) return;
    try {
      const data = await api.get<{ tierPresets: TierPreset[] }>(
        `/organizations/${orgId}/tier-presets`
      );
      setPresets(data.tierPresets);
    } catch {
      // Non-critical — presets are optional
    }
  }, [orgId]);

  useEffect(() => {
    fetchVenues();
    fetchPresets();
  }, [fetchVenues, fetchPresets]);

  // "+ Add new venue…" opens the flyout; the selection itself stays put.
  const handleVenueSelect = (value: string) => {
    if (value === NEW_VENUE_OPTION) {
      setShowVenueDialog(true);
      return;
    }
    setVenueId(value);
  };

  // Quick-add venue: append and select it, no refetch needed.
  const handleVenueCreated = (venue: CreatedVenue, warning?: string) => {
    setVenues((prev) => [...prev, { id: venue.id, name: venue.name, address: venue.address, timezone: venue.timezone }]);
    setVenueId(venue.id);
    setShowVenueDialog(false);
    if (warning) setError(warning);
  };

  const addTierFromPreset = (preset: TierPreset) => {
    const key = crypto.randomUUID();
    setPriceTiers([
      ...priceTiers,
      {
        key,
        isNew: true,
        name: preset.name,
        description: preset.description || '',
        price: String(preset.price),
        quantityTotal: '',
        quantitySold: 0,
        quantityReserved: 0,
        minPerOrder: preset.minPerOrder ? String(preset.minPerOrder) : '1',
        maxPerOrder: preset.maxPerOrder ? String(preset.maxPerOrder) : '10',
        saleStartDate: '',
        saleEndDate: '',
        visibility: preset.visibility,
        isRefundable: preset.isRefundable,
        isActive: true,
      },
    ]);
    setShowPresetMenu(false);
    setEditingTierKey(key);
  };

  const handleLogoUpload = async (file: File) => {
    if (!orgId) return;
    try {
      setLogoUploading(true);
      setError(null);
      const formData = new FormData();
      formData.append('logo', file);
      const result = await api.upload<EventDetail>(
        `/organizations/${orgId}/events/${eventId}/logo`,
        formData
      );
      setLogoUrl(result.logoUrl);
    } catch (err: any) {
      setError(err.message || 'Failed to upload logo');
    } finally {
      setLogoUploading(false);
    }
  };

  const handleLogoRemove = async () => {
    if (!orgId) return;
    try {
      setLogoUploading(true);
      setError(null);
      await api.delete(`/organizations/${orgId}/events/${eventId}/logo`);
      setLogoUrl(null);
    } catch (err: any) {
      setError(err.message || 'Failed to remove logo');
    } finally {
      setLogoUploading(false);
    }
  };

  // Tier helpers
  const addTier = () => {
    const tier = newTierForm();
    setPriceTiers([...priceTiers, tier]);
    setEditingTierKey(tier.key);
  };
  const removeTier = (key: string) => {
    const tier = priceTiers.find((t) => t.key === key);
    // Only allow removing new tiers or tiers with no sales
    if (tier && !tier.isNew && tier.quantitySold > 0) return;
    setPriceTiers(priceTiers.filter((t) => t.key !== key));
  };
  const updateTier = (key: string, field: keyof TierFormInput, value: string | boolean) => {
    setPriceTiers(priceTiers.map((t) => (t.key === key ? { ...t, [field]: value } : t)));
  };
  const moveTier = (index: number, direction: 'up' | 'down') => {
    const newTiers = [...priceTiers];
    const swap = direction === 'up' ? index - 1 : index + 1;
    if (swap < 0 || swap >= newTiers.length) return;
    [newTiers[index], newTiers[swap]] = [newTiers[swap], newTiers[index]];
    setPriceTiers(newTiers);
  };

  const saveTierEdit = (updated: TierFormData) => {
    setPriceTiers(priceTiers.map((t) => (t.key === updated.key ? { ...t, ...updated } : t)));
    setEditingTierKey(null);
  };

  const editingTier = editingTierKey ? priceTiers.find((t) => t.key === editingTierKey) : null;
  const editingTierIndex = editingTierKey ? priceTiers.findIndex((t) => t.key === editingTierKey) : -1;

  const totalTierQuantity = priceTiers.reduce(
    (sum, t) => sum + (parseInt(t.quantityTotal) || 0),
    0
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      const payload: Record<string, unknown> = {};

      if (name !== eventData?.name) payload.name = name;
      if (slug !== (eventData?.slug || '')) payload.slug = slug;
      if (description !== (eventData?.description || '')) payload.description = description || null;
      if (venueId !== eventData?.venue?.id) payload.venueId = venueId;
      if (date !== toDatetimeLocal(eventData?.date || '', venueZone))
        payload.date = zonedInputToIso(date, venueZone);
      if (category !== (eventData?.category || '')) payload.category = category || null;

      // Admission mode changes
      if (admissionMode !== loadedAdmissionMode) {
        payload.admissionMode = admissionMode;
      }

      if (admissionMode === 'RSVP') {
        if (capacity !== String(eventData?.capacity))
          payload.capacity = rsvpLimitEnabled && rsvpLimit ? parseInt(rsvpLimit) : 0;
        const newRsvpLimit = rsvpLimitEnabled && rsvpLimit ? parseInt(rsvpLimit) : null;
        if (newRsvpLimit !== eventData?.rsvpLimit) payload.rsvpLimit = newRsvpLimit;
        const newRsvpMax = parseInt(rsvpMaxPartySize) || 1;
        if (newRsvpMax !== eventData?.rsvpMaxPartySize) payload.rsvpMaxPartySize = newRsvpMax;
      } else {
        if (capacity !== String(eventData?.capacity)) payload.capacity = parseInt(capacity);
      }

      // Save tier changes
      const tierBase = `/organizations/${orgId}/events/${eventId}/price-tiers`;
      let tiersChanged = false;

      // Create new tiers
      for (const tier of priceTiers.filter((t) => t.isNew)) {
        if (!tier.name || !tier.price || !tier.quantityTotal) continue;
        await api.post(tierBase, {
          name: tier.name,
          description: tier.description || undefined,
          price: parseFloat(tier.price),
          quantityTotal: parseInt(tier.quantityTotal),
          minPerOrder: tier.minPerOrder ? parseInt(tier.minPerOrder) : undefined,
          maxPerOrder: tier.maxPerOrder ? parseInt(tier.maxPerOrder) : undefined,
          saleStartDate: zonedInputToIso(tier.saleStartDate, venueZone),
          saleEndDate: zonedInputToIso(tier.saleEndDate, venueZone),
          visibility: tier.visibility,
          isRefundable: tier.isRefundable,
        });
        tiersChanged = true;
      }

      // Update existing tiers
      const originalTiers = eventData?.priceTiers || [];
      for (const tier of priceTiers.filter((t) => !t.isNew)) {
        const orig = originalTiers.find((o) => o.id === tier.key);
        if (!orig) continue;
        const patch: Record<string, unknown> = {};
        if (tier.name !== orig.name) patch.name = tier.name;
        if (tier.description !== (orig.description || '')) patch.description = tier.description || null;
        if (parseFloat(tier.price) !== Number(orig.price)) patch.price = parseFloat(tier.price);
        if (parseInt(tier.quantityTotal) !== orig.quantityTotal) patch.quantityTotal = parseInt(tier.quantityTotal);
        if ((tier.minPerOrder ? parseInt(tier.minPerOrder) : null) !== orig.minPerOrder)
          patch.minPerOrder = tier.minPerOrder ? parseInt(tier.minPerOrder) : null;
        if ((tier.maxPerOrder ? parseInt(tier.maxPerOrder) : null) !== orig.maxPerOrder)
          patch.maxPerOrder = tier.maxPerOrder ? parseInt(tier.maxPerOrder) : null;
        const newStart = zonedInputToIso(tier.saleStartDate, venueZone);
        if (newStart !== orig.saleStartDate) patch.saleStartDate = newStart;
        const newEnd = zonedInputToIso(tier.saleEndDate, venueZone);
        if (newEnd !== orig.saleEndDate) patch.saleEndDate = newEnd;
        if (tier.visibility !== orig.visibility) patch.visibility = tier.visibility;
        if (tier.isRefundable !== orig.isRefundable) patch.isRefundable = tier.isRefundable;

        if (Object.keys(patch).length > 0) {
          await api.patch(`${tierBase}/${tier.key}`, patch);
          tiersChanged = true;
        }
      }

      // Reorder if order changed
      const origOrder = [...originalTiers].sort((a, b) => a.displayOrder - b.displayOrder).map((t) => t.id);
      const currentExistingOrder = priceTiers.filter((t) => !t.isNew).map((t) => t.key);
      if (JSON.stringify(origOrder) !== JSON.stringify(currentExistingOrder) && currentExistingOrder.length > 0) {
        await api.post(`${tierBase}/reorder`, { tierIds: currentExistingOrder });
        tiersChanged = true;
      }

      if (Object.keys(payload).length === 0 && !tiersChanged) {
        setError('No changes to save');
        return;
      }

      if (Object.keys(payload).length > 0) {
        await api.patch(`/organizations/${orgId}/events/${eventId}`, payload);
      }
      setSuccess(true);
      setTimeout(() => router.push('/admin/events'), 1000);
    } catch (err: any) {
      if (err?.status === 409) {
        setSlugError(err?.message || 'This slug is already taken. Please choose another.');
      } else {
        setError(err.message || 'Failed to update event');
      }
    } finally {
      setSaving(false);
    }
  };


  if (!orgId) {
    return (
      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 py-6 sm:py-8">
        <p className="text-red-600 dark:text-red-400">Missing organization context.</p>
        <button
          onClick={() => router.push('/admin/events')}
          className="mt-4 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          ← Back to Events
        </button>
      </div>
    );
  }

  if (loadingEvent) {
    return (
      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-12 bg-gray-200 dark:bg-slate-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!eventData) {
    return (
      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 py-6 sm:py-8">
        <p className="text-red-600 dark:text-red-400">{error || 'Event not found'}</p>
        <button
          onClick={() => router.push('/admin/events')}
          className="mt-4 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          ← Back to Events
        </button>
      </div>
    );
  }

  const isPublished = eventData.status === 'PUBLISHED';
  const capacityNum = parseInt(capacity) || 0;
  const capacityExceeded = capacityNum > 0 && totalTierQuantity > capacityNum;

  const logoSrc = resolveAssetUrl(logoUrl);

  const cancel = () => router.push('/admin/events');
  const actionProps = {
    submitLabel: 'Save Changes',
    savingLabel: 'Saving…',
    saving,
    disabled: saving || !venueId || (admissionMode === 'TICKETED' && capacityExceeded),
    onCancel: cancel,
  };
  const publishedNotice = isPublished && (
    <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-1">
      <span aria-hidden>⚠ </span>This event is published. Changes will be visible to customers immediately.
    </p>
  );

  return (
    <EventFormShell
      header={
        <EventFormHeader
          title="Edit Event"
          notice={publishedNotice}
          actions={
            <>
              <button
                type="button"
                onClick={cancel}
                className="text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white"
              >
                ← Back to Events
              </button>
              <a
                href={`/events/${eventId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                View event
                <ExternalLink className="h-4 w-4" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </>
          }
        />
      }
      alerts={
        <>
          {error && <FormAlert tone="error">{error}</FormAlert>}
          {success && <FormAlert tone="success">Event updated successfully! Redirecting…</FormAlert>}
        </>
      }
      main={
        <>
          <form id={EVENT_FORM_ID} onSubmit={handleSubmit} className="space-y-6">
            <FormCard id="event-details" title="Event Details">
              <div className="space-y-4">
                <div>
                  <label htmlFor="event-name" className={labelClass}>Name *</label>
                  <input
                    id="event-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Event name"
                    className={inputClass}
                    required
                    maxLength={255}
                  />
                </div>

                <SlugField
                  value={slug}
                  onChange={setSlug}
                  source={name}
                  prefix="/events/"
                  baseUrl={typeof window !== 'undefined' ? window.location.origin : undefined}
                  error={slugError}
                />

                <div>
                  <label htmlFor="event-description" className={labelClass}>Description</label>
                  <RichTextEditorField
                    value={description}
                    onChange={setDescription}
                    variant="full"
                    placeholder="Event description"
                    aria-label="Event description"
                  />
                </div>
              </div>
            </FormCard>

            <EventMediaCard
              preview={logoSrc}
              eventName={name}
              uploading={logoUploading}
              onFileSelect={handleLogoUpload}
              onRemove={handleLogoRemove}
            />

            {/* Price Tiers — only for ticketed events */}
            {admissionMode === 'TICKETED' && (
              <FormCard
                id="event-price-tiers"
                title="Price Tiers"
                actions={
                  <TierHeaderActions
                    presets={presets}
                    open={showPresetMenu}
                    onToggle={() => setShowPresetMenu(!showPresetMenu)}
                    onPick={addTierFromPreset}
                    onAdd={addTier}
                  />
                }
              >
                {capacityExceeded && (
                  <div className="mb-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3">
                    <p className="text-sm text-yellow-800 dark:text-yellow-300">
                      <span aria-hidden>⚠ </span>Total tier quantity ({totalTierQuantity}) exceeds event capacity ({capacityNum})
                    </p>
                  </div>
                )}

                {priceTiers.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-slate-400 py-4 text-center">
                    No price tiers. Click &quot;+ Add Tier&quot; to create one.
                  </p>
                )}

                <div className="space-y-2">
                  {priceTiers.map((tier, index) => (
                    <TierCard
                      key={tier.key}
                      tier={tier}
                      index={index}
                      total={priceTiers.length}
                      canDelete={tier.isNew || tier.quantitySold === 0}
                      deleteBlockedReason={!tier.isNew && tier.quantitySold > 0 ? "Can't delete a tier that has tickets sold" : undefined}
                      onEdit={() => setEditingTierKey(tier.key)}
                      onMove={(dir) => moveTier(index, dir)}
                      onDelete={() => removeTier(tier.key)}
                    />
                  ))}
                </div>

                {editingTier && (
                  <TierEditDialog
                    tier={editingTier}
                    index={editingTierIndex}
                    onSave={saveTierEdit}
                    onCancel={() => setEditingTierKey(null)}
                  />
                )}
              </FormCard>
            )}
          </form>

          {/* Add-ons (spec 012) — saved through their own API, outside the event form */}
          <FormPanel>
            <AddOnsSection
              orgId={orgId}
              eventId={eventId}
              priceTiers={eventData.priceTiers.map((t) => ({ id: t.id, name: t.name }))}
              taxRate={eventData.tax?.rate ?? 0}
              taxInclusive={eventData.taxInclusivePricing === true}
            />
          </FormPanel>
        </>
      }
      aside={
        <>
          <EventFormActionsCard {...actionProps} />

          <FormCard id="event-when-where" title="Date & Venue">
            <div className="space-y-4">
              <div>
                <label htmlFor="event-venue" className={labelClass}>
                  Venue *
                </label>
                {venuesLoading ? (
                  <div className="animate-pulse h-10 bg-gray-200 dark:bg-slate-700 rounded" />
                ) : (
                  <select
                    id="event-venue"
                    form={EVENT_FORM_ID}
                    value={venueId}
                    onChange={(e) => handleVenueSelect(e.target.value)}
                    className={inputClass}
                    required
                  >
                    <option value="">
                      {venues.length === 0 ? 'No venues yet' : 'Select a venue'}
                    </option>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} — {v.address}
                      </option>
                    ))}
                    <option value={NEW_VENUE_OPTION}>+ Add new venue…</option>
                  </select>
                )}
                {eventData.tax && venueId === eventData.venue?.id && <EventTaxSummary tax={eventData.tax} />}
              </div>

              <div>
                <label htmlFor="event-date" className={labelClass}>Date & Time *</label>
                <input
                  id="event-date"
                  type="datetime-local"
                  form={EVENT_FORM_ID}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputClass}
                  aria-describedby="event-date-zone"
                  required
                />
                <p id="event-date-zone" className={hintClass}>
                  {date
                    ? `${formatEventTime(zonedInputToInstant(date, venueZone), venueZone)} at the venue`
                    : `Entered in the venue's time zone (${timeZoneLabel(venueZone ?? DEFAULT_ZONE)})`}
                </p>
              </div>
            </div>
          </FormCard>

          {/* Admission Mode (spec 034) */}
          <FormCard id="event-admission" title="Admission">
            <AdmissionModeField
              value={admissionMode}
              onChange={(mode) => { if (!modeLocked) setAdmissionMode(mode); }}
              isDisabled={(mode) => modeLocked && mode !== admissionMode}
              describedBy={modeLocked && modeLockReason ? 'event-admission-lock' : undefined}
            />
            {modeLocked && modeLockReason && (
              <p id="event-admission-lock" className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                {modeLockReason}
              </p>
            )}

            {admissionMode === 'TICKETED' ? (
              <div className="mt-4">
                <label htmlFor="event-capacity" className={labelClass}>Capacity *</label>
                <input
                  id="event-capacity"
                  type="number"
                  form={EVENT_FORM_ID}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="1–100,000"
                  min={1}
                  max={100000}
                  className={inputClass}
                  aria-describedby={capacityExceeded ? 'event-capacity-warning' : undefined}
                  required
                />
                {capacityExceeded && (
                  <p id="event-capacity-warning" className="mt-1 text-xs text-yellow-700 dark:text-yellow-400">
                    <span aria-hidden>⚠ </span>Capacity is below total tier inventory ({totalTierQuantity})
                  </p>
                )}
              </div>
            ) : (
              <RsvpSettingsFields
                limitEnabled={rsvpLimitEnabled}
                onLimitEnabledChange={setRsvpLimitEnabled}
                limit={rsvpLimit}
                onLimitChange={setRsvpLimit}
                maxPartySize={rsvpMaxPartySize}
                onMaxPartySizeChange={setRsvpMaxPartySize}
              />
            )}
          </FormCard>

          <FormCard id="event-listing" title="Listing">
            <label htmlFor="event-category" className={labelClass}>Category</label>
            <input
              id="event-category"
              type="text"
              form={EVENT_FORM_ID}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Music, Sports, Conference"
              className={inputClass}
            />
          </FormCard>
        </>
      }
      mobileActions={<EventFormActions {...actionProps} layout="row" />}
    >
      {/* Rendered outside the event form: the flyout is its own <form> */}
      {showVenueDialog && (
        <VenueFlyout
          orgId={orgId}
          onClose={() => setShowVenueDialog(false)}
          onCreated={handleVenueCreated}
        />
      )}
    </EventFormShell>
  );
}

export default function EditEventPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-gray-500">Loading...</p>
        </div>
      }
    >
      <EditEventContent />
    </Suspense>
  );
}