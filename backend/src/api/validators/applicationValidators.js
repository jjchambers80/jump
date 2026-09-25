// Application validators (spec 011) — request shape only. Values (enums,
// ranges, question options, state transitions) are validated in the services.

import { ValidationError } from '../../middleware/errorHandler.js';

const FORM_FIELDS = new Set(['kind', 'name', 'slug', 'intro', 'status', 'opensAt', 'closesAt', 'chargeTiming', 'feeMode', 'taxable', 'paymentDueDays', 'overduePolicy', 'displayOrder', 'tiers', 'questions', 'templateId']);
const TIER_FIELDS = new Set(['name', 'description', 'price', 'quantityTotal', 'displayOrder', 'isActive']);
const QUESTION_FIELDS = new Set(['label', 'helpText', 'type', 'required', 'options', 'displayOrder', 'pinned']);
const DECISIONS = new Set(['APPROVE', 'REJECT', 'WAITLIST', 'WITHDRAW']);

function onlyFields(body, allowed, label) {
  const unknown = Object.keys(body || {}).filter((k) => !allowed.has(k));
  if (unknown.length) throw new ValidationError(`Unknown ${label} field(s): ${unknown.join(', ')}`);
}

export const validateFormBody = (req, res, next) => {
  try {
    const body = req.body || {};
    onlyFields(body, FORM_FIELDS, 'form');
    if (req.method === 'POST' && !body.kind) throw new ValidationError('kind is required');
    if (body.tiers !== undefined && !Array.isArray(body.tiers)) throw new ValidationError('tiers must be an array');
    if (body.questions !== undefined && !Array.isArray(body.questions)) throw new ValidationError('questions must be an array');
    for (const t of body.tiers || []) onlyFields(t, TIER_FIELDS, 'tier');
    for (const q of body.questions || []) onlyFields(q, QUESTION_FIELDS, 'question');
    if (req.method === 'PATCH' && Object.keys(body).length === 0) throw new ValidationError('Nothing to update');
    if (body.templateId !== undefined && (typeof body.templateId !== 'string' || !body.templateId)) throw new ValidationError('templateId must be an id');
    if (req.method === 'PATCH' && body.templateId !== undefined) throw new ValidationError('templateId applies when creating a form');
    next();
  } catch (error) {
    next(error);
  }
};

export const validateTierBody = (req, res, next) => {
  try {
    onlyFields(req.body, TIER_FIELDS, 'tier');
    if (Object.keys(req.body || {}).length === 0) throw new ValidationError('Nothing to update');
    next();
  } catch (error) {
    next(error);
  }
};

export const validateQuestionBody = (req, res, next) => {
  try {
    onlyFields(req.body, QUESTION_FIELDS, 'question');
    if (Object.keys(req.body || {}).length === 0) throw new ValidationError('Nothing to update');
    next();
  } catch (error) {
    next(error);
  }
};

export const validateDecisionBody = (req, res, next) => {
  try {
    const body = req.body || {};
    onlyFields(body, new Set(['decision', 'note', 'message', 'sendEmail']), 'decision');
    if (!DECISIONS.has(body.decision)) throw new ValidationError('decision must be APPROVE, REJECT, WAITLIST or WITHDRAW');
    if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') throw new ValidationError('note must be a string');
    if (body.sendEmail !== undefined && typeof body.sendEmail !== 'boolean') throw new ValidationError('sendEmail must be a boolean');
    if (body.message !== undefined && body.message !== null && typeof body.message !== 'object') throw new ValidationError('message must be an object');
    next();
  } catch (error) {
    next(error);
  }
};

export const validateBulkBody = (req, res, next) => {
  try {
    const body = req.body || {};
    onlyFields(body, new Set(['ids', 'decision', 'note']), 'bulk');
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string')) throw new ValidationError('ids must be an array of ids');
    if (!DECISIONS.has(body.decision)) throw new ValidationError('decision must be APPROVE, REJECT, WAITLIST or WITHDRAW');
    next();
  } catch (error) {
    next(error);
  }
};

export const validateTemplateBody = (req, res, next) => {
  try {
    onlyFields(req.body, new Set(['subject', 'body']), 'template');
    if (typeof req.body?.subject !== 'string' || typeof req.body?.body !== 'string') throw new ValidationError('subject and body are required strings');
    next();
  } catch (error) {
    next(error);
  }
};

/** PATCH organizer metadata, including the spec 014 public-directory opt-in. */
export const validateMetaBody = (req, res, next) => {
  try {
    const body = req.body || {};
    onlyFields(body, new Set(['boothLabel', 'internalNote', 'tags', 'checkedIn', 'checkedOut', 'publicProfile']), 'application');
    if (Object.keys(body).length === 0) throw new ValidationError('Nothing to update');
    if (body.tags !== undefined && !Array.isArray(body.tags)) throw new ValidationError('tags must be an array of strings');
    for (const key of ['checkedIn', 'checkedOut', 'publicProfile']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new ValidationError(`${key} must be a boolean`);
    next();
  } catch (error) {
    next(error);
  }
};

/** Spec 019: form templates. POST { name, kind, definition? }; PUT { name?, definition? }. Values are validated in the service. */
export const validateFormTemplateBody = (req, res, next) => {
  try {
    const body = req.body || {};
    onlyFields(body, new Set(['name', 'kind', 'definition']), 'template');
    if (req.method === 'POST' && !body.kind) throw new ValidationError('kind is required');
    if (req.method === 'PUT' && body.kind !== undefined) throw new ValidationError('kind cannot change');
    if (body.definition !== undefined && (typeof body.definition !== 'object' || body.definition === null || Array.isArray(body.definition))) throw new ValidationError('definition must be an object');
    if (req.method === 'PUT' && body.name === undefined && body.definition === undefined) throw new ValidationError('Nothing to update');
    next();
  } catch (error) {
    next(error);
  }
};

/** Spec 019: { name } for a new template, or { replaceTemplateId, name? } to overwrite one. */
export const validateSaveAsTemplateBody = (req, res, next) => {
  try {
    const body = req.body || {};
    onlyFields(body, new Set(['name', 'replaceTemplateId']), 'save-as-template');
    if (body.replaceTemplateId !== undefined && (typeof body.replaceTemplateId !== 'string' || !body.replaceTemplateId)) throw new ValidationError('replaceTemplateId must be an id');
    if (!body.replaceTemplateId && typeof body.name !== 'string') throw new ValidationError('name is required for a new template');
    next();
  } catch (error) {
    next(error);
  }
};

/** Phase 2: { amount?: number (dollars, omit for the remaining balance), reason?: string } */
export const validateRefundBody = (req, res, next) => {
  try {
    const body = req.body || {};
    onlyFields(body, new Set(['amount', 'reason']), 'refund');
    if (body.amount !== undefined && body.amount !== null) {
      if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
        throw new ValidationError('amount must be a positive number');
      }
      // Money is whole cents. A sub-cent amount has no correct refund — it
      // rounds one way into the Stripe call and could round another way into
      // anything else that re-derives cents from it. Refuse it at the edge.
      if (Math.abs(body.amount * 100 - Math.round(body.amount * 100)) > 1e-6) {
        throw new ValidationError('amount must be a whole number of cents');
      }
    }
    if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') throw new ValidationError('reason must be a string');
    next();
  } catch (error) {
    next(error);
  }
};

/** Spec 012: { addOns: [{ addOnId, quantity }], sendEmail?: boolean } — the full desired line set. */
export const validateAddOnLinesBody = (req, res, next) => {
  try {
    const body = req.body || {};
    onlyFields(body, new Set(['addOns', 'sendEmail']), 'add-ons');
    if (!Array.isArray(body.addOns)) throw new ValidationError('addOns must be an array');
    for (const line of body.addOns) {
      if (!line || typeof line !== 'object') throw new ValidationError('addOns[] must be objects');
      onlyFields(line, new Set(['addOnId', 'quantity']), 'add-on line');
      if (typeof line.addOnId !== 'string') throw new ValidationError('addOns[].addOnId must be a string');
      if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new ValidationError('addOns[].quantity must be a positive integer');
    }
    if (body.sendEmail !== undefined && typeof body.sendEmail !== 'boolean') throw new ValidationError('sendEmail must be a boolean');
    next();
  } catch (error) {
    next(error);
  }
};

// ─── Spec 018 phase 3: corrections ──────────────────────────────────────────

/** { tierId, sendEmail? } */
export const validateTierChangeBody = (req, res, next) => {
  try {
    const body = req.body || {};
    onlyFields(body, new Set(['tierId', 'sendEmail']), 'tier change');
    if (typeof body.tierId !== 'string' || !body.tierId) throw new ValidationError('tierId is required');
    if (body.sendEmail !== undefined && typeof body.sendEmail !== 'boolean') throw new ValidationError('sendEmail must be a boolean');
    next();
  } catch (error) {
    next(error);
  }
};

/** { amount (signed, non-zero), reason } */
export const validateAdjustmentBody = (req, res, next) => {
  try {
    const body = req.body || {};
    onlyFields(body, new Set(['amount', 'reason']), 'adjustment');
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount === 0) throw new ValidationError('amount must be a non-zero number');
    if (Math.abs(body.amount) > 10_000) throw new ValidationError('amount must be 10,000 or less');
    if (typeof body.reason !== 'string' || !body.reason.trim()) throw new ValidationError('reason is required');
    if (body.reason.length > 200) throw new ValidationError('reason must be 200 characters or fewer');
    next();
  } catch (error) {
    next(error);
  }
};

/** { reason, sendEmail? } */
export const validateWaiveBody = (req, res, next) => {
  try {
    const body = req.body || {};
    onlyFields(body, new Set(['reason', 'sendEmail']), 'waive');
    if (typeof body.reason !== 'string' || !body.reason.trim()) throw new ValidationError('reason is required');
    if (body.reason.length > 200) throw new ValidationError('reason must be 200 characters or fewer');
    if (body.sendEmail !== undefined && typeof body.sendEmail !== 'boolean') throw new ValidationError('sendEmail must be a boolean');
    next();
  } catch (error) {
    next(error);
  }
};

const OFFLINE_METHODS = new Set(['CHEQUE', 'CASH', 'BANK_TRANSFER', 'COMPED', 'OTHER']);

/** { method, amount, reference?, paidAt?, sendEmail? } */
export const validateOfflinePaymentBody = (req, res, next) => {
  try {
    const body = req.body || {};
    onlyFields(body, new Set(['method', 'amount', 'reference', 'paidAt', 'sendEmail']), 'offline payment');
    if (!OFFLINE_METHODS.has(body.method)) throw new ValidationError(`method must be one of ${[...OFFLINE_METHODS].join(', ')}`);
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount < 0) throw new ValidationError('amount must be a number');
    if (body.reference !== undefined && body.reference !== null && (typeof body.reference !== 'string' || body.reference.length > 120)) throw new ValidationError('reference must be 120 characters or fewer');
    if (body.paidAt !== undefined && body.paidAt !== null && (typeof body.paidAt !== 'string' || Number.isNaN(new Date(body.paidAt).getTime()))) throw new ValidationError('paidAt must be an ISO 8601 date');
    if (body.sendEmail !== undefined && typeof body.sendEmail !== 'boolean') throw new ValidationError('sendEmail must be a boolean');
    next();
  } catch (error) {
    next(error);
  }
};

/** Spec 012: { addOnIds: string[] } — restricted add-ons a tier offers. */
export const validateTierAddOnsBody = (req, res, next) => {
  try {
    onlyFields(req.body, new Set(['addOnIds']), 'tier add-ons');
    if (!Array.isArray(req.body?.addOnIds) || req.body.addOnIds.some((id) => typeof id !== 'string')) throw new ValidationError('addOnIds must be an array of ids');
    next();
  } catch (error) {
    next(error);
  }
};
