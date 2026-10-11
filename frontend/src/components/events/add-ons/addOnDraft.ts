// The add-on dialog's form state and its mapping to and from the add-ons API
// (spec 012). Shared by AddOnsSection and AddOnDialog.

import type { AdminAddOn } from '@/lib/addOns';

export type AddOnScope = AdminAddOn['scope'];
export interface TierOption {
  id: string;
  name: string;
}

export interface DraftAddOn {
  id?: string;
  name: string;
  description: string;
  price: string;
  scope: AddOnScope;
  allTiers: boolean;
  priceTierIds: string[];
  quantityTotal: string;
  maxPerOrder: string;
  taxable: boolean;
}

export const emptyDraft = (name = ''): DraftAddOn => ({
  name, description: '', price: '', scope: 'BOTH', allTiers: true, priceTierIds: [], quantityTotal: '', maxPerOrder: '', taxable: true,
});

export const toDraft = (a: AdminAddOn): DraftAddOn => ({
  id: a.id,
  name: a.name,
  description: a.description ?? '',
  price: String(a.price),
  scope: a.scope,
  allTiers: a.allTiers,
  priceTierIds: a.priceTierIds ?? [],
  quantityTotal: a.quantityTotal == null ? '' : String(a.quantityTotal),
  maxPerOrder: a.maxPerOrder == null ? '' : String(a.maxPerOrder),
  taxable: a.taxable,
});

/** The add-ons API body for a draft (POST or PATCH). */
export const draftBody = (d: DraftAddOn) => ({
  name: d.name.trim(),
  description: d.description.trim() || null,
  price: Number(d.price),
  scope: d.scope,
  allTiers: d.allTiers,
  priceTierIds: d.allTiers ? [] : d.priceTierIds,
  quantityTotal: d.quantityTotal.trim() === '' ? null : Number(d.quantityTotal),
  maxPerOrder: d.maxPerOrder.trim() === '' ? null : Number(d.maxPerOrder),
  taxable: d.taxable,
});
