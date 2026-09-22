export function formatEventSummary(event) {
  const ticketed = event.admissionMode !== 'RSVP';
  const activePrices = ticketed ? event.priceTiers.map((tier) => Number(tier.price)) : [];
  const availableTickets = ticketed ? event.priceTiers.reduce(
    (sum, tier) =>
      sum + (tier.quantityTotal - tier.quantitySold - tier.quantityReserved),
    0
  ) : 0;

  return {
    id: event.id,
    name: event.name,
    slug: event.slug,
    date: event.date,
    venue: event.venue,
    category: event.category,
    status: event.status,
    admissionMode: event.admissionMode || 'TICKETED',
    rsvpLimit: event.rsvpLimit ?? null,
    rsvpMaxPartySize: event.rsvpMaxPartySize ?? 1,
    priceRange:
      activePrices.length > 0
        ? { min: Math.min(...activePrices), max: Math.max(...activePrices) }
        : null,
    availableTickets,
  };
}
