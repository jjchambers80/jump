// Add-ons (spec 012): products sold alongside a ticket tier or an application
// tier. Pure helpers shared by the storefront cart, checkout and admin pages.

import { FEE_CONFIG, roundCurrency } from './fees';

/** Public add-on as returned on `GET /events/:id` (`addOns[]`). */
export interface AddOn {
  id: string;
  name: string;
  description: string | null;
  price: number;
  taxable: boolean;
  maxPerOrder: number | null;
  /** null = unlimited */
  remaining: number | null;
  soldOut: boolean;
  allTiers: boolean;
  /** null when `allTiers`; otherwise the tiers that offer it */
  priceTierIds: string[] | null;
}

/** Admin view (`GET /organizations/:orgId/events/:eventId/add-ons`). */
export interface AdminAddOn extends Omit<AddOn, 'priceTierIds'> {
  scope: 'TICKET' | 'APPLICATION' | 'BOTH';
  /** Always an array in the admin view (empty when `allTiers`). */
  priceTierIds: string[];
  applicationTierIds: string[];
  quantityTotal: number | null;
  quantitySold: number;
  quantityReserved: number;
  isActive: boolean;
  displayOrder: number;
  orderLineCount: number;
  applicationLineCount: number;
}

/** A purchased add-on line on an order. */
export interface OrderAddOnLine {
  id: string;
  addOnId: string;
  name: string | null;
  quantity: number;
  unitPrice: number;
  platformFee: number;
  processingFee: number;
  tax: number;
  lineTotal: number;
  refundedAt: string | null;
}

export interface AddOnCartLine {
  addOnId: string;
  quantity: number;
}

/** Add-ons offered on at least one of the cart's tiers. */
export function offeredAddOns(addOns: AddOn[] | undefined, cartTierIds: string[]): AddOn[] {
  if (!addOns || cartTierIds.length === 0) return [];
  return addOns.filter((a) => a.allTiers || (a.priceTierIds ?? []).some((id) => cartTierIds.includes(id)));
}

/** Upper bound of the quantity stepper: per-order max, remaining stock, hard cap 10. */
export function addOnMaxQuantity(addOn: AddOn): number {
  const caps = [10, addOn.maxPerOrder ?? 10, addOn.remaining ?? 10];
  return Math.max(0, Math.min(...caps));
}

/**
 * All-in price of one unit as if it were the whole order — the figure shown on
 * the picker before a cart exists. Mirrors `computeTierAllInPrice` but honours
 * the add-on's `taxable` flag.
 */
export function addOnAllInPrice(addOn: Pick<AddOn, 'price' | 'taxable'>, taxRate = 0, taxInclusive = false) {
  const listed = addOn.price;
  const rate = addOn.taxable ? taxRate : 0;
  const base = taxInclusive ? roundCurrency(listed / (1 + rate)) : roundCurrency(listed);
  const tax = taxInclusive ? roundCurrency(listed - base) : roundCurrency(base * rate);
  const platformFee = roundCurrency(base * FEE_CONFIG.platformFeePercent);
  const processingFee = roundCurrency((base + platformFee) * FEE_CONFIG.stripeFeePercent + FEE_CONFIG.stripeFeeFixed);
  const fees = roundCurrency(platformFee + processingFee);
  return { listedPrice: listed, basePrice: base, platformFee, processingFee, fees, tax, total: roundCurrency(base + fees + tax), taxInclusive };
}

/** Parse the `addOns` search param written by the event page. */
export function parseAddOnLines(raw: string | null): AddOnCartLine[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (line): line is AddOnCartLine =>
        typeof line?.addOnId === 'string' && Number.isInteger(line?.quantity) && line.quantity > 0
    );
  } catch {
    return [];
  }
}
