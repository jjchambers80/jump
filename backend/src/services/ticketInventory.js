// Put voided tickets' seats back on sale: one `quantitySold` decrement per
// tier, taken under the tier row's lock (the UPDATE). Shared by every path
// that voids sold tickets — refunds (RefundService) and erasure without a
// refund (ContactErasureService, spec 040 card D) — so the arithmetic lives
// in one place. Callers void the tickets in the same transaction.

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Array<{ priceTierId: string }>} tickets
 */
export async function returnTicketsToSale(tx, tickets) {
  const perTier = {};
  for (const ticket of tickets) {
    perTier[ticket.priceTierId] = (perTier[ticket.priceTierId] || 0) + 1;
  }
  for (const [tierId, qty] of Object.entries(perTier)) {
    await tx.$executeRaw`
      UPDATE "PriceTier"
      SET "quantitySold" = "quantitySold" - ${qty}
      WHERE "id" = ${tierId}
    `;
  }
}
