// Order validators
// Request validation for order creation and lookup
// Per FR-052, contracts/api.yaml

import { ValidationError } from '../../middleware/errorHandler.js';

/**
 * Validate POST /orders body
 */
export const validateCreateOrder = (req, res, next) => {
  const errors = [];
  const { eventId, items, priceTierId, quantity, contact, addOns } = req.body;

  if (!eventId) {
    errors.push({ field: 'eventId', message: 'eventId is required' });
  }

  if (items !== undefined) {
    if (!Array.isArray(items) || items.length === 0) {
      errors.push({ field: 'items', message: 'items must contain at least one ticket type' });
    } else {
      const tierIds = new Set();
      items.forEach((item, index) => {
        if (!item?.priceTierId) {
          errors.push({
            field: `items[${index}].priceTierId`,
            message: 'priceTierId is required',
          });
        } else if (tierIds.has(item.priceTierId)) {
          errors.push({ field: 'items', message: 'price tiers must be unique' });
        } else {
          tierIds.add(item.priceTierId);
        }

        if (!Number.isInteger(item?.quantity) || item.quantity < 1) {
          errors.push({
            field: `items[${index}].quantity`,
            message: 'quantity must be an integer >= 1',
          });
        }
      });
    }
  } else {
    if (!priceTierId) {
      errors.push({ field: 'priceTierId', message: 'priceTierId is required' });
    }

    if (!quantity || parseInt(quantity) < 1) {
      errors.push({ field: 'quantity', message: 'quantity must be >= 1' });
    }
  }

  // Add-on lines (spec 012): optional, unique ids, positive integer quantities
  if (addOns !== undefined) {
    if (!Array.isArray(addOns)) {
      errors.push({ field: 'addOns', message: 'addOns must be an array' });
    } else {
      const addOnIds = new Set();
      addOns.forEach((line, index) => {
        if (!line?.addOnId || typeof line.addOnId !== 'string') {
          errors.push({ field: `addOns[${index}].addOnId`, message: 'addOnId is required' });
        } else if (addOnIds.has(line.addOnId)) {
          errors.push({ field: 'addOns', message: 'add-ons must be unique' });
        } else {
          addOnIds.add(line.addOnId);
        }
        if (!Number.isInteger(line?.quantity) || line.quantity < 1) {
          errors.push({ field: `addOns[${index}].quantity`, message: 'quantity must be an integer >= 1' });
        }
      });
    }
  }

  if (!contact) {
    errors.push({ field: 'contact', message: 'contact is required' });
  } else {
    if (!contact.email) {
      errors.push({ field: 'contact.email', message: 'contact.email is required' });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
      errors.push({ field: 'contact.email', message: 'contact.email must be a valid email' });
    }

    if (!contact.firstName || !contact.firstName.trim()) {
      errors.push({ field: 'contact.firstName', message: 'contact.firstName is required' });
    }

    if (!contact.lastName || !contact.lastName.trim()) {
      errors.push({ field: 'contact.lastName', message: 'contact.lastName is required' });
    }
  }

  // Checkout opt-ins (spec 007): optional, must be booleans when present
  for (const field of ['createAccount', 'emailSubscribed']) {
    if (req.body[field] !== undefined && typeof req.body[field] !== 'boolean') {
      errors.push({ field, message: `${field} must be a boolean` });
    }
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
};

/**
 * Validate POST /orders/lookup body
 */
export const validateOrderLookup = (req, res, next) => {
  const errors = [];
  const { email, orderRef } = req.body;

  if (!email) {
    errors.push({ field: 'email', message: 'email is required' });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ field: 'email', message: 'email must be a valid email' });
  }

  if (!orderRef) {
    errors.push({ field: 'orderRef', message: 'orderRef is required' });
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
};

// ─── Admin order list (spec 024 phase 2) ─────────────────────────────────────

const ORDER_KINDS = new Set(['TICKET', 'APPLICATION']);
const ORDER_STATUSES = new Set(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED']);
const ORDER_SORTS = new Set(['createdAt', 'totalAmount', 'paidAt']);
const MAX_LIMIT = 100;

/**
 * Validate and normalise `GET /admin/orders` / `GET /admin/orders/export.csv`
 * query parameters into `req.orderQuery`:
 * `{ page, limit, kind?, status?: string[], eventId?, from?, to?, search?, sort, dir }`.
 * An omitted `status` means every status except FAILED and CANCELLED (the
 * service applies that default). Dates accept ISO timestamps or YYYY-MM-DD
 * (`to` on a date-only value means the end of that day, UTC).
 */
export const validateOrderListQuery = (req, res, next) => {
  const q = req.query || {};
  const query = {};

  const page = q.page === undefined ? 1 : parseInt(q.page, 10);
  const limit = q.limit === undefined ? 20 : parseInt(q.limit, 10);
  if (!Number.isInteger(page) || page < 1) return next(new ValidationError('page must be a positive integer'));
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return next(new ValidationError(`limit must be an integer from 1 to ${MAX_LIMIT}`));
  query.page = page;
  query.limit = limit;

  if (q.kind !== undefined && q.kind !== '') {
    if (!ORDER_KINDS.has(q.kind)) return next(new ValidationError('kind must be TICKET or APPLICATION'));
    query.kind = q.kind;
  }
  if (q.status !== undefined && q.status !== '') {
    const list = String(q.status).split(',').map((s) => s.trim()).filter(Boolean);
    const bad = list.find((s) => !ORDER_STATUSES.has(s));
    if (bad) return next(new ValidationError(`Unknown order status: ${bad}`));
    if (list.length) query.status = [...new Set(list)];
  }
  if (q.eventId !== undefined && q.eventId !== '') {
    if (typeof q.eventId !== 'string' || q.eventId.length > 64) return next(new ValidationError('eventId must be an id'));
    query.eventId = q.eventId;
  }
  const parseDate = (value, endOfDay) => {
    if (value === undefined || value === '') return null;
    const s = String(value);
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
    const d = new Date(dateOnly ? `${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : s);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const from = parseDate(q.from, false);
  const to = parseDate(q.to, true);
  if (from === undefined || to === undefined) return next(new ValidationError('from and to must be ISO dates'));
  if (from && to && from > to) return next(new ValidationError('from must be on or before to'));
  if (from) query.from = from;
  if (to) query.to = to;

  if (q.search !== undefined && q.search !== '') {
    const search = String(q.search).trim();
    if (search.length > 200) return next(new ValidationError('search is too long'));
    if (search) query.search = search;
  }
  const sort = q.sort === undefined || q.sort === '' ? 'createdAt' : String(q.sort);
  if (!ORDER_SORTS.has(sort)) return next(new ValidationError('sort must be createdAt, totalAmount or paidAt'));
  query.sort = sort;
  const dir = q.dir === undefined || q.dir === '' ? 'desc' : String(q.dir);
  if (dir !== 'asc' && dir !== 'desc') return next(new ValidationError('dir must be asc or desc'));
  query.dir = dir;

  req.orderQuery = query;
  next();
};
