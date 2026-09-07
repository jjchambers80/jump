export function formatEventSummary(event) {
  const activePrices = event.priceTiers.map((tier) => Number(tier.price));
  const availableTickets = event.priceTiers.reduce(
    (sum, tier) =>
      sum + (tier.quantityTotal - tier.quantitySold - tier.quantityReserved),
    0
  );

  return {
    id: event.id,
    name: event.name,
    date: event.date,
    venue: event.venue,
    category: event.category,
    status: event.status,
    priceRange:
      activePrices.length > 0
        ? { min: Math.min(...activePrices), max: Math.max(...activePrices) }
        : null,
    availableTickets,
  };
}
