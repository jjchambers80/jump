// Pure helpers over order lines (spec 024). No imports, safe from any module.

const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Signed total of ADJUSTMENT lines (a WAIVER line is a record, not an input). */
export function adjustmentTotal(items) {
  return round(
    (items || [])
      .filter((i) => i.kind === 'ADJUSTMENT')
      .reduce((sum, i) => sum + Number(i.unitPrice) * (i.quantity ?? 1), 0)
  );
}

/** ADJUSTMENT and WAIVER items of an order, oldest first. */
export function adjustmentItems(order) {
  return (order?.items || [])
    .filter((i) => i.kind === 'ADJUSTMENT' || i.kind === 'WAIVER')
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The single APPLICATION_TIER item of an application order. */
export function tierItem(order) {
  return (order?.items || []).find((i) => i.kind === 'APPLICATION_TIER') || null;
}

/**
 * What the applicant pays for one line. PASS: the all-in allocation
 * (listed price plus the line's fee and tax shares). ABSORB: the listed
 * price, plus tax on top unless the organization prices tax-inclusive.
 */
export function buyerLineTotal(line, feeMode, { taxInclusive = false } = {}) {
  const listed = round(Number(line.unitPrice) * (line.quantity ?? 1));
  if (feeMode === 'ABSORB') return round(listed + (taxInclusive ? 0 : Number(line.tax || 0)));
  return round(
    listed + Number(line.platformFee || 0) + Number(line.processingFee || 0) + Number(line.tax || 0)
  );
}
