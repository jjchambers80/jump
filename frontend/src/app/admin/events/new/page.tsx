'use client';

// Event creation form — admin area (T011)
// Moved from dashboard/events/new/page.tsx
// Links updated from /dashboard/* to /admin/*
// AdminRoute guard provided by admin layout.tsx

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { TierCard, TierEditDialog, type TierFormData } from '@/components/TierEditDialog';
import SlugField from '@/components/SlugField';
import VenueFlyout, { NEW_VENUE_OPTION, type CreatedVenue } from '@/components/VenueFlyout';
import { DEFAULT_ZONE, formatEventTime, zonedInputToInstant, zonedInputToIso } from '@/lib/eventTime';
import { timeZoneLabel } from '@/lib/timeZones';
import RichTextEditorField from '@/components/editor/RichTextEditorField';
import { EventMediaCard } from '@/components/events/EventMediaCard';
import {
  AdmissionModeField,
  EVENT_FORM_ID,
  EventFormActions,
  EventFormActionsCard,
  EventFormHeader,
  EventFormShell,
  FormAlert,
  FormCard,
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

interface PriceTierInput {
  key: string;
  name: string;
  description: string;
  price: string;
  quantityTotal: string;
  minPerOrder: string;
  maxPerOrder: string;
  saleStartDate: string;
  saleEndDate: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
}

function newTier(): PriceTierInput {
  return {
    key: crypto.randomUUID(),
    name: '',
    description: '',
    price: '',
    quantityTotal: '',
    minPerOrder: '1',
    maxPerOrder: '10',
    saleStartDate: '',
    saleEndDate: '',
    visibility: 'PUBLIC',
    isRefundable: false,
  };
}

export default function CreateEventPage() {
  const router = useRouter();

  const { selectedOrgId } = useOrg();

  const [venues, setVenues] = useState<Venue[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(false);
  const [presets, setPresets] = useState<TierPreset[]>([]);
  const [showPresetMenu, setShowPresetMenu] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [venueId, setVenueId] = useState('');
  // Spec 033: the date and the sale windows are typed in the venue's wall clock,
  // not the organizer's. Changing venue keeps the typed time and re-anchors it.
  const venueZone = venues.find((v) => v.id === venueId)?.timezone ?? null;
  const [date, setDate] = useState('');
  const [capacity, setCapacity] = useState('');
  const [category, setCategory] = useState('');
  const [slug, setSlug] = useState('');
  const [slugError, setSlugError] = useState<string | null>(null);

  // Admission mode (spec 034)
  const [admissionMode, setAdmissionMode] = useState<AdmissionMode>('TICKETED');
  const [rsvpLimit, setRsvpLimit] = useState('');
  const [rsvpLimitEnabled, setRsvpLimitEnabled] = useState(false);
  const [rsvpMaxPartySize, setRsvpMaxPartySize] = useState('1');

  const [priceTiers, setPriceTiers] = useState<PriceTierInput[]>([newTier()]);
  const [editingTierKey, setEditingTierKey] = useState<string | null>(null);
  const [showVenueDialog, setShowVenueDialog] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The image needs an event id, so it is held here and uploaded right after create.
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const fetchVenues = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setVenuesLoading(true);
      const data = await api.get<Venue[]>(`/organizations/${selectedOrgId}/venues`);
      setVenues(data);
      setVenueId('');
    } catch (err: any) {
      setError(err.message || 'Failed to load venues');
    } finally {
      setVenuesLoading(false);
    }
  }, [selectedOrgId]);

  const fetchPresets = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      const data = await api.get<{ tierPresets: TierPreset[] }>(
        `/organizations/${selectedOrgId}/tier-presets`
      );
      setPresets(data.tierPresets);
    } catch {
      // Non-critical — presets are optional
    }
  }, [selectedOrgId]);

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
        name: preset.name,
        description: preset.description || '',
        price: String(preset.price),
        quantityTotal: '',
        minPerOrder: preset.minPerOrder ? String(preset.minPerOrder) : '1',
        maxPerOrder: preset.maxPerOrder ? String(preset.maxPerOrder) : '10',
        saleStartDate: '',
        saleEndDate: '',
        visibility: preset.visibility,
        isRefundable: preset.isRefundable,
      },
    ]);
    setShowPresetMenu(false);
    setEditingTierKey(key);
  };

  const addTier = () => {
    const tier = newTier();
    setPriceTiers([...priceTiers, tier]);
    setEditingTierKey(tier.key);
  };
  const removeTier = (key: string) => {
    if (priceTiers.length > 1) {
      setPriceTiers(priceTiers.filter((t) => t.key !== key));
    }
  };
  const updateTier = (key: string, field: keyof PriceTierInput, value: string | boolean) => {
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
  const capacityNum = parseInt(capacity) || 0;
  const capacityExceeded = admissionMode === 'TICKETED' && capacityNum > 0 && totalTierQuantity > capacityNum;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !venueId) return;

    try {
      setSaving(true);
      setError(null);

      const payload: Record<string, unknown> = {
        venueId,
        name,
        slug: slug || undefined,
        description: description || undefined,
        date: zonedInputToIso(date, venueZone),
        category: category || undefined,
        admissionMode,
      };

      if (admissionMode === 'TICKETED') {
        payload.capacity = parseInt(capacity);
        payload.priceTiers = priceTiers.map((t, i) => ({
          name: t.name,
          description: t.description || undefined,
          price: parseFloat(t.price), // dollars - backend stores as Decimal
          quantityTotal: parseInt(t.quantityTotal),
          displayOrder: i,
          minPerOrder: t.minPerOrder ? parseInt(t.minPerOrder) : undefined,
          maxPerOrder: t.maxPerOrder ? parseInt(t.maxPerOrder) : undefined,
          saleStartDate: zonedInputToIso(t.saleStartDate, venueZone),
          saleEndDate: zonedInputToIso(t.saleEndDate, venueZone),
          visibility: t.visibility,
          isRefundable: t.isRefundable,
        }));
      } else {
        // RSVP mode: capacity is computed from rsvpLimit on the backend
        payload.capacity = rsvpLimitEnabled && rsvpLimit ? parseInt(rsvpLimit) : 0;
        payload.rsvpLimit = rsvpLimitEnabled && rsvpLimit ? parseInt(rsvpLimit) : null;
        payload.rsvpMaxPartySize = parseInt(rsvpMaxPartySize) || 1;
      }

      const created = await api.post<{ id: string }>(`/organizations/${selectedOrgId}/events`, payload);
      if (imageFile) {
        try {
          const formData = new FormData();
          formData.append('logo', imageFile);
          await api.upload(`/organizations/${selectedOrgId}/events/${created.id}/logo`, formData);
        } catch {
          // The event exists; send the organizer to its edit page to retry the image.
          router.push(`/admin/events/${created.id}/edit?orgId=${selectedOrgId}&imageUpload=failed`);
          return;
        }
      }
      router.push('/admin/events');
    } catch (err: any) {
      if (err?.status === 409) {
        setSlugError(err?.message || 'This slug is already taken. Please choose another.');
      } else {
        setError(err.message || 'Failed to create event');
      }
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => router.push('/admin/events');
  const submitDisabled = saving || !venueId || capacityExceeded;
  const actionProps = {
    submitLabel: 'Create Event',
    savingLabel: 'Creating…',
    saving,
    disabled: submitDisabled,
    onCancel: cancel,
  };

  return (
    <EventFormShell
      header={
        <EventFormHeader
          title="Create Event"
          actions={
            <button
              type="button"
              onClick={cancel}
              className="text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white"
            >
              ← Back to Events
            </button>
          }
        />
      }
      alerts={error && <FormAlert tone="error">{error}</FormAlert>}
      main={
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
            preview={imagePreview}
            eventName={name}
            uploading={saving && !!imageFile}
            onFileSelect={setImageFile}
            onRemove={() => setImageFile(null)}
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

              <div className="space-y-2">
                {priceTiers.map((tier, index) => (
                  <TierCard
                    key={tier.key}
                    tier={tier}
                    index={index}
                    total={priceTiers.length}
                    canDelete={priceTiers.length > 1}
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
                  {venueId
                    ? date
                      ? `${formatEventTime(zonedInputToInstant(date, venueZone), venueZone)} at the venue`
                      : `Entered in the venue's time zone (${timeZoneLabel(venueZone ?? DEFAULT_ZONE)})`
                    : 'Pick a venue first — the time is entered in the venue\u2019s own time zone.'}
                </p>
              </div>
            </div>
          </FormCard>

          {/* Admission Mode (spec 034) */}
          <FormCard id="event-admission" title="Admission">
            <AdmissionModeField
              value={admissionMode}
              onChange={(mode) => {
                setAdmissionMode(mode);
                if (mode === 'TICKETED') setPriceTiers([newTier()]);
              }}
            />

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
                  required
                />
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
      {showVenueDialog && selectedOrgId && (
        <VenueFlyout
          orgId={selectedOrgId}
          onClose={() => setShowVenueDialog(false)}
          onCreated={handleVenueCreated}
        />
      )}
    </EventFormShell>
  );
}