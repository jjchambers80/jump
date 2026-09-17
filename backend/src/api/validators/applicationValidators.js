// Application validators (spec 011) — request shape only. Values (enums,
// ranges, question options, state transitions) are validated in the services.

import { ValidationError } from '../../middleware/errorHandler.js';

const FORM_FIELDS = new Set(['kind', 'name', 'slug', 'intro', 'status', 'opensAt', 'closesAt', 'chargeTiming', 'feeMode', 'taxable', 'paymentDueDays', 'overduePolicy', 'displayOrder', 'tiers', 'questions']);
const TIER_FIELDS = new Set(['name', 'description', 'price', 'quantityTotal', 'displayOrder', 'isActive']);
const QUESTION_FIELDS = new Set(['label', 'helpText', 'type', 'required', 'options', 'displayOrder']);
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
