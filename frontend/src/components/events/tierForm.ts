// Price tier form helpers shared by the event editor (/edit/sales) and the
// setup wizard's Tickets step (spec 050 §8.1): one mapping from the API tier to
// the form, one from the form back to the API, one capacity check. Sale
// windows are the venue's wall clock (spec 033, gotcha 28): read and written
// only through instantToZonedInput / zonedInputToIso.

import { instantToZonedInput, zonedInputToIso } from '@/lib/eventTime';
import type { TierFormData } from '@/components/TierEditDialog';
import type { TierPreset } from './TierPresetMenu';

/** A tier as the API returns it (overview, event list, price-tier routes). */
export interface ApiTier {
  id: string;
  name: string;
  description: string | null;
  price: number;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved?: number;
  displayOrder: number;
  minPerOrder: number | null;
  maxPerOrder: number | null;
  isActive: boolean;
  saleStartDate: string | null;
  saleEndDate: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
}

/** Form state of one tier; `key` is the tier id, or a temporary UUID for a new tier. */
export interface TierFormInput extends TierFormData {
  isNew: boolean;
  quantitySold: number;
  quantityReserved: number;
  isActive: boolean;
}

export function tierToForm(t: ApiTier, zone: string | null | undefined): TierFormInput {
  return {
    key: t.id,
    isNew: false,
    name: t.name,
    description: t.description || '',
    price: String(Number(t.price)),
    quantityTotal: String(t.quantityTotal),
    quantitySold: t.quantitySold ?? 0,
    quantityReserved: t.quantityReserved ?? 0,
    minPerOrder: t.minPerOrder != null ? String(t.minPerOrder) : '',
    maxPerOrder: t.maxPerOrder != null ? String(t.maxPerOrder) : '',
    saleStartDate: instantToZonedInput(t.saleStartDate ?? '', zone),
    saleEndDate: instantToZonedInput(t.saleEndDate ?? '', zone),
    visibility: t.visibility ?? 'PUBLIC',
    isRefundable: t.isRefundable,
    isActive: t.isActive,
  };
}

export function newTierForm(): TierFormInput {
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

/** A new tier from a saved tier (spec 037 D2); quantity is the organizer's to set. */
export function tierFromPreset(preset: TierPreset): TierFormInput {
  return {
    ...newTierForm(),
    name: preset.name,
    description: preset.description || '',
    price: String(preset.price),
    minPerOrder: preset.minPerOrder ? String(preset.minPerOrder) : '1',
    maxPerOrder: preset.maxPerOrder ? String(preset.maxPerOrder) : '10',
    visibility: preset.visibility,
    isRefundable: preset.isRefundable,
  };
}

/** A new, unsold copy of a tier: same settings, "(copy)" name, nothing sold. */
export function duplicateTierForm(tier: TierFormInput): TierFormInput {
  return {
    ...tier,
    key: crypto.randomUUID(),
    isNew: true,
    name: `${tier.name} (copy)`.slice(0, 255),
    quantitySold: 0,
    quantityReserved: 0,
    isActive: true,
  };
}

const intOrNull = (value: string) => (value ? parseInt(value) : null);

/** POST …/price-tiers body. */
export function tierCreateBody(tier: TierFormInput, zone: string | null | undefined) {
  return {
    name: tier.name,
    description: tier.description || undefined,
    price: parseFloat(tier.price),
    quantityTotal: parseInt(tier.quantityTotal),
    minPerOrder: tier.minPerOrder ? parseInt(tier.minPerOrder) : undefined,
    maxPerOrder: tier.maxPerOrder ? parseInt(tier.maxPerOrder) : undefined,
    saleStartDate: zonedInputToIso(tier.saleStartDate, zone),
    saleEndDate: zonedInputToIso(tier.saleEndDate, zone),
    visibility: tier.visibility,
    isRefundable: tier.isRefundable,
  };
}

/** PATCH …/price-tiers/:id body: only what differs from the saved tier. */
export function tierPatchBody(tier: TierFormInput, orig: ApiTier, zone: string | null | undefined): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (tier.name !== orig.name) patch.name = tier.name;
  if (tier.description !== (orig.description || '')) patch.description = tier.description || null;
  if (parseFloat(tier.price) !== Number(orig.price)) patch.price = parseFloat(tier.price);
  if (parseInt(tier.quantityTotal) !== orig.quantityTotal) patch.quantityTotal = parseInt(tier.quantityTotal);
  if (intOrNull(tier.minPerOrder) !== orig.minPerOrder) patch.minPerOrder = intOrNull(tier.minPerOrder);
  if (intOrNull(tier.maxPerOrder) !== orig.maxPerOrder) patch.maxPerOrder = intOrNull(tier.maxPerOrder);
  const start = zonedInputToIso(tier.saleStartDate, zone);
  if (start !== orig.saleStartDate) patch.saleStartDate = start;
  const end = zonedInputToIso(tier.saleEndDate, zone);
  if (end !== orig.saleEndDate) patch.saleEndDate = end;
  if (tier.visibility !== orig.visibility) patch.visibility = tier.visibility;
  if (tier.isRefundable !== orig.isRefundable) patch.isRefundable = tier.isRefundable;
  return patch;
}

/** What a tier dialog must have before it saves; the messages name the field. */
export function tierErrors(tier: TierFormData, zone: string | null | undefined): string[] {
  const errors: string[] = [];
  if (!tier.name.trim()) errors.push('Enter a tier name');
  const price = parseFloat(tier.price);
  if (tier.price === '' || isNaN(price) || price < 0) errors.push('Enter a price of 0 or more');
  const qty = parseInt(tier.quantityTotal);
  const floor = Math.max(1, (tier.quantitySold ?? 0) + (tier.quantityReserved ?? 0));
  if (isNaN(qty) || qty < floor) errors.push(floor > 1 ? `Quantity must be at least ${floor} (sold + reserved)` : 'Enter a quantity of 1 or more');
  const start = zonedInputToIso(tier.saleStartDate, zone);
  const end = zonedInputToIso(tier.saleEndDate, zone);
  if (start && end && new Date(end) <= new Date(start)) errors.push('Sale end must be after the sale start');
  return errors;
}

/** Sum of the tiers' quantities (blank counts as 0). */
export const tierSum = (tiers: { quantityTotal: string | number }[]) =>
  tiers.reduce((sum, t) => sum + (parseInt(String(t.quantityTotal)) || 0), 0);

/** Tier inventory over a set capacity: a warning while editing, a blocker at publish. */
export function capacityOverflow(capacity: string | number | null | undefined, tiers: { quantityTotal: string | number }[]) {
  const cap = parseInt(String(capacity ?? '')) || 0;
  const total = tierSum(tiers);
  return cap > 0 && total > cap ? { capacity: cap, total } : null;
}
