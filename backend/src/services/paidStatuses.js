// Order and application statuses that count as money collected. The one
// definition shared by CustomerService, EventService.getEventAnalytics, the
// dashboard stats and TaxService.collectedReport.

/** Order statuses that count as money collected. */
export const PAID_ORDER_STATUSES = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
/** Application payment statuses that count as money collected. */
export const PAID_APPLICATION_STATUSES = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];
