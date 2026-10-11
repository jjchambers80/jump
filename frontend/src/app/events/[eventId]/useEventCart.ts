'use client';

// Cart state of the event page: tier and add-on quantities, the all-in totals
// (lib/fees.ts, mirrors backend FeeService) and the open price breakdowns,
// which the desktop summary and the mobile sheet share so both always agree.

import { useState } from 'react';
import { computeOrderFees, type OrderFees } from '@/lib/fees';
import { loadCheckoutDraft } from '@/lib/checkoutDraft';
import { offeredAddOns, addOnMaxQuantity, type AddOn } from '@/lib/addOns';
import { tierMaximum, type EventPageEvent, type PriceTier } from './eventPage';

export interface EventCart {
  quantities: Record<string, number>;
  addOnQuantities: Record<string, number>;
  /** Add-ons offered by a tier in the cart (spec 012). */
  offered: AddOn[];
  items: { priceTierId: string; quantity: number }[];
  addOnLines: { addOnId: string; quantity: number }[];
  totalQuantity: number;
  totalAmount: number;
  fees: OrderFees;
  /** In `fees.lines` order: tiers first, then add-ons. */
  lines: { key: string; name: string }[];
  openLines: Record<string, boolean>;
  allLinesOpen: boolean;
}

export function useEventCart(event: EventPageEvent | null) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [addOnQuantities, setAddOnQuantities] = useState<Record<string, number>>({});
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({});

  const updateQuantity = (tier: PriceTier, direction: 1 | -1) =>
    setQuantities((current) => {
      const quantity = current[tier.id] ?? 0;
      const minimum = tier.minPerOrder ?? 1;
      const maximum = tierMaximum(tier);
      if (direction === 1 && maximum < minimum) return current;
      const next =
        direction === 1
          ? quantity === 0 ? Math.min(minimum, maximum) : Math.min(quantity + 1, maximum)
          : quantity <= minimum ? 0 : quantity - 1;
      return { ...current, [tier.id]: next };
    });

  const setAddOnQuantity = (addOnId: string, quantity: number) =>
    setAddOnQuantities((current) => ({ ...current, [addOnId]: quantity }));

  // Back from Stripe's cancel_url: put the saved cart back, within today's bounds.
  const restore = (data: EventPageEvent) => {
    const draft = loadCheckoutDraft(data.id);
    if (!draft) return;
    const restored: Record<string, number> = {};
    for (const line of draft.items) {
      const tier = data.priceTiers.find((candidate) => candidate.id === line.priceTierId && candidate.isActive);
      if (!tier) continue;
      const quantity = Math.min(line.quantity, tierMaximum(tier));
      if (quantity >= (tier.minPerOrder ?? 1)) restored[tier.id] = quantity;
    }
    setQuantities(restored);
    setAddOnQuantities(Object.fromEntries(draft.addOns.map((line) => [line.addOnId, line.quantity])));
  };

  const activeTiers = event?.priceTiers.filter((tier) => tier.isActive) ?? [];
  const items = activeTiers
    .map((tier) => ({ priceTierId: tier.id, quantity: quantities[tier.id] ?? 0 }))
    .filter((item) => item.quantity > 0);
  const cartTiers = activeTiers.filter((tier) => (quantities[tier.id] ?? 0) > 0);
  // A quantity left behind after its tier was removed is simply not a line.
  const offered = offeredAddOns(event?.addOns, cartTiers.map((tier) => tier.id));
  const cartAddOns = offered.filter((addOn) => Math.min(addOnQuantities[addOn.id] ?? 0, addOnMaxQuantity(addOn)) > 0);
  const addOnLines = cartAddOns.map((addOn) => ({
    addOnId: addOn.id,
    quantity: Math.min(addOnQuantities[addOn.id] ?? 0, addOnMaxQuantity(addOn)),
  }));
  const fees = computeOrderFees(
    [
      ...cartTiers.map((tier) => ({ price: tier.price ?? 0, quantity: quantities[tier.id] ?? 0 })),
      ...cartAddOns.map((addOn, i) => ({ price: addOn.price, quantity: addOnLines[i].quantity, taxable: addOn.taxable })),
    ],
    event?.taxRate ?? 0,
    event?.taxInclusivePricing === true
  );
  const lines = [
    ...cartTiers.map((tier) => ({ key: tier.id, name: tier.name })),
    ...cartAddOns.map((addOn) => ({ key: addOn.id, name: addOn.name })),
  ];
  const allLinesOpen = lines.length > 0 && lines.every((line) => openLines[line.key]);

  const cart: EventCart = {
    quantities,
    addOnQuantities,
    offered,
    items,
    addOnLines,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    totalAmount: cartTiers.length > 0 ? fees.total : 0,
    fees,
    lines,
    openLines,
    allLinesOpen,
  };

  return {
    cart,
    restore,
    updateQuantity,
    setAddOnQuantity,
    toggleLine: (key: string) => setOpenLines((current) => ({ ...current, [key]: !current[key] })),
    toggleAllLines: () => setOpenLines(Object.fromEntries(lines.map((line) => [line.key, !allLinesOpen]))),
  };
}

/** No cart (the wizard preview): nothing selected, nothing offered. */
export const EMPTY_CART: EventCart = {
  quantities: {},
  addOnQuantities: {},
  offered: [],
  items: [],
  addOnLines: [],
  totalQuantity: 0,
  totalAmount: 0,
  fees: computeOrderFees([], 0),
  lines: [],
  openLines: {},
  allLinesOpen: false,
};
