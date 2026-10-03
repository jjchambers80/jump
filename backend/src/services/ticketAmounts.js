// What one ticket actually cost the buyer.
//
// `Ticket.pricePaid` is the *listed* tier price. Under FTC all-in pricing the
// card is charged that plus the platform fee, the processing fee and tax, all
// of which are recorded per line on the ticket's `OrderItem`. Refunding
// `pricePaid` therefore returns less than was taken, and the difference
// includes sales tax the organizer owes back on a sale that did not happen.
//
// Fee and tax columns default to 0, so an order written before they existed
// falls back to `pricePaid` on its own.

const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Include this on a Ticket query to make `ticketAmountPaid` exact. */
const LINE_SELECT = { quantity: true, unitPrice: true, platformFee: true, processingFee: true, tax: true };

export const TICKET_AMOUNT_INCLUDE = {
  order: {
    select: {
      totalAmount: true,
      items: { select: { priceTierId: true, ...LINE_SELECT } },
      addOns: { select: LINE_SELECT },
      tickets: { select: { id: true, priceTierId: true, ticketNumber: true } },
    },
  },
};

const lineCharge = (l) =>
  Number(l.unitPrice) * l.quantity +
  (Number(l.platformFee) || 0) +
  (Number(l.processingFee) || 0) +
  (Number(l.tax) || 0);

/**
 * Was tax charged on top of the listed prices? Under tax-inclusive pricing
 * (spec 009 phase 3) the listed price already holds the tax and the line's
 * `tax` column is the share backed out of it, so adding it again would refund
 * the tax twice. The order total tells the two apart: it equals every line's
 * price + fees + tax only when the tax went on top.
 */
function taxOnTop(order) {
  if (order.totalAmount == null || !Array.isArray(order.addOns)) return true;
  const onTop = [...order.items, ...order.addOns].reduce((sum, l) => sum + lineCharge(l), 0);
  return Math.abs(Number(order.totalAmount) - onTop) < 0.01;
}

/**
 * Split `total` into `count` shares that sum back to `total` exactly.
 * Share `i` is the step between two running rounded subtotals, so a line of 3
 * tickets over $10.00 of fees yields 3.33 / 3.34 / 3.33 and never 3.33 × 3.
 */
function shareAt(total, count, index) {
  if (count <= 0) return 0;
  return round(round((total * (index + 1)) / count) - round((total * index) / count));
}

/**
 * The all-in amount the buyer paid for this one ticket.
 *
 * Needs `TICKET_AMOUNT_INCLUDE` on the query; without it, or for a line whose
 * fee columns are all zero, this is just `pricePaid`.
 *
 * @param {object} ticket - a Ticket row, ideally with `order.items` + `order.tickets`
 * @returns {number}
 */
export function ticketAmountPaid(ticket) {
  const base = round(Number(ticket.pricePaid) || 0);
  const items = ticket.order?.items;
  const siblings = ticket.order?.tickets;
  if (!Array.isArray(items) || !Array.isArray(siblings)) return base;

  const line = items.find((i) => i.priceTierId === ticket.priceTierId);
  if (!line) return base;

  const lineExtras =
    (Number(line.platformFee) || 0) +
    (Number(line.processingFee) || 0) +
    (taxOnTop(ticket.order) ? Number(line.tax) || 0 : 0);
  if (lineExtras === 0) return base;

  // Every ticket cut from this line, in a stable order, so each one gets the
  // same share on every call and the shares sum to the line's fees exactly.
  const lineTickets = siblings
    .filter((t) => t.priceTierId === ticket.priceTierId)
    .sort((a, b) => a.ticketNumber - b.ticketNumber || a.id.localeCompare(b.id));
  const index = lineTickets.findIndex((t) => t.id === ticket.id);
  if (index < 0) return base;

  return round(base + shareAt(lineExtras, lineTickets.length, index));
}
