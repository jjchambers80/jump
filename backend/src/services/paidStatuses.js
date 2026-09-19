// Order statuses that count as money collected — for ticket orders and
// application orders alike (spec 024). The one definition shared by
// CustomerService, EventService.getEventAnalytics, the dashboard stats and
// TaxService.collectedReport.

/** Order statuses that count as money collected. */
export const PAID_ORDER_STATUSES = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
