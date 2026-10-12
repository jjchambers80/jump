// Spec 055: the filters of an automatic contact list, and the source clauses
// the Contacts list shares with them. This is the one translator from contact
// filters to Prisma; never build a second one.

import { prisma } from '@jump/db';
import { PAID_ORDER_STATUSES } from './paidStatuses.js';
import { ValidationError } from '../middleware/errorHandler.js';

export const CONTACT_SOURCES = ['tickets', 'rsvp', 'subscribed', 'form'];

const PAID = { status: { in: PAID_ORDER_STATUSES } };

/** Contacts list Source filter (spec 044C); `eventId` narrows RSVPs, `formId` standing forms. */
export function sourceWhere(source, { formId, eventId } = {}) {
  switch (source) {
    case 'tickets':
      return { orders: { some: PAID } };
    case 'rsvp':
      return { rsvps: { some: { status: 'GOING', ...(eventId && { eventId }) } } };
    case 'subscribed':
      return { emailSubscribed: true };
    case 'form':
      return {
        applications: {
          some: { status: { not: 'DRAFT' }, form: { eventId: null, ...(formId && { id: formId }) } },
        },
      };
    default:
      return null;
  }
}

/** Has money been collected from this contact (an order in PAID_ORDER_STATUSES)? */
export const PAYING_WHERE = { orders: { some: PAID } };

const ID = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 64;

const RULES = {
  scope: (v) => v === 'customers' || 'scope must be customers',
  source: (v) => CONTACT_SOURCES.includes(v) || `source must be one of ${CONTACT_SOURCES.join(', ')}`,
  formId: (v) => ID(v) || 'formId must be an id',
  rsvpEventId: (v) => ID(v) || 'rsvpEventId must be an event id',
  ticketEventId: (v) => ID(v) || 'ticketEventId must be an event id',
  tag: (v) => (typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 50) || 'tag must be 1–50 characters',
  minSpent: (v) =>
    (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10_000_000) || 'minSpent must be a positive amount',
  activeWithinDays: (v) =>
    (Number.isInteger(v) && v >= 1 && v <= 3650) || 'activeWithinDays must be a whole number from 1 to 3650',
};

export const FILTER_KEYS = Object.keys(RULES);

/**
 * Validate and clean an automatic list's filters. Empty values are dropped;
 * unknown keys and bad values throw a 400 with one detail per field.
 */
export function normalizeFilters(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('Validation failed', [{ field: 'filters', message: 'filters must be an object' }]);
  }
  const errors = [];
  const clean = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!RULES[key]) {
      errors.push({ field: `filters.${key}`, message: `${key} is not a filter` });
      continue;
    }
    if (value === undefined || value === null || value === '') continue;
    const ok = RULES[key](value);
    if (ok !== true) errors.push({ field: `filters.${key}`, message: ok });
    else clean[key] = typeof value === 'string' ? value.trim() : value;
  }
  if (clean.formId && clean.source !== 'form') {
    errors.push({ field: 'filters.formId', message: 'formId requires source form' });
  }
  if (errors.length) throw new ValidationError('Validation failed', errors);
  if (clean.minSpent) clean.minSpent = Math.round(clean.minSpent * 100) / 100;
  return clean;
}

/** Prisma where for a list's filters at one organization; every filter is ANDed. */
export async function filtersWhere(organizationId, filters = {}, now = new Date()) {
  const clauses = [];
  if (filters.scope === 'customers') clauses.push(PAYING_WHERE);
  if (filters.source) clauses.push(sourceWhere(filters.source, { formId: filters.formId }));
  if (filters.rsvpEventId) clauses.push(sourceWhere('rsvp', { eventId: filters.rsvpEventId }));
  if (filters.tag) clauses.push({ tags: { has: filters.tag } });
  if (filters.ticketEventId) {
    clauses.push({ orders: { some: { ...PAID, kind: 'TICKET', eventId: filters.ticketEventId } } });
  }
  if (filters.activeWithinDays) {
    // Same date as the list's "Last activity": paidAt, else createdAt, of a paid order.
    const cutoff = new Date(now.getTime() - filters.activeWithinDays * 24 * 60 * 60 * 1000);
    clauses.push({
      orders: {
        some: { ...PAID, OR: [{ paidAt: { gte: cutoff } }, { paidAt: null, createdAt: { gte: cutoff } }] },
      },
    });
  }
  if (filters.minSpent) {
    // A sum is not a relation filter. ponytail: scans the org's paid orders;
    // keep a per-contact total if a store passes ~100k orders.
    const rows = await prisma.$queryRaw`
      SELECT "contactId" AS id FROM "Order"
      WHERE "organizationId" = ${organizationId}
        AND "status"::text = ANY(${PAID_ORDER_STATUSES})
      GROUP BY "contactId"
      HAVING SUM("totalAmount") >= ${String(filters.minSpent)}::numeric`;
    clauses.push({ id: { in: rows.map((row) => row.id) } });
  }
  return clauses.length ? { AND: clauses } : {};
}

/** Filters that point at an event or form this organization no longer has. */
export async function filterWarnings(organizationId, filters = {}) {
  const warnings = [];
  for (const key of ['rsvpEventId', 'ticketEventId']) {
    if (!filters[key]) continue;
    const event = await prisma.event.findFirst({
      where: { id: filters[key], venue: { organizationId } },
      select: { id: true },
    });
    if (!event) warnings.push({ field: key, message: 'This list filters on an event that no longer exists' });
  }
  if (filters.formId) {
    const form = await prisma.applicationForm.findFirst({
      where: { id: filters.formId, organizationId, eventId: null },
      select: { id: true },
    });
    if (!form) warnings.push({ field: 'formId', message: 'This list filters on a form that no longer exists' });
  }
  return warnings;
}
