// Application Form Service (spec 011)
// Forms, tiers and questions an organization configures per event, plus the
// public read shape applicants see. Validation of values lives here; route
// validators only check shape.
//
// Rules: PAID forms carry tiers and cannot OPEN without an active one (nor,
// until phase 2 ships, without APPLICATIONS_PAYMENTS_ENABLED); FREE forms
// cannot have tiers; questions with answers are archived, never deleted;
// slug is unique per event.

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { CHOICE_TYPES, MAX_OPTIONS, QUESTION_TYPES } from '../config/applications.js';
import feeService from './FeeService.js';
import logger from '../utils/logger.js';

const FORM_KINDS = new Set(['PAID', 'FREE']);
const FORM_STATUSES = new Set(['DRAFT', 'OPEN', 'CLOSED']);
const CHARGE_TIMINGS = new Set(['SUBMIT', 'APPROVAL']);
const FEE_MODES = new Set(['PASS', 'ABSORB']);
const OVERDUE_POLICIES = new Set(['WITHDRAW', 'HOLD']);

export function paymentsEnabled() {
  return String(process.env.APPLICATIONS_PAYMENTS_ENABLED || '').toLowerCase() === 'true';
}

export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * What the applicant pays and what the organization receives for a tier under
 * a form's fee mode. PASS: fees on top of the listed price. ABSORB: the listed
 * price is the total; fees come out of the organization's share.
 * Tax follows the event only when the form is taxable.
 */
export function tierAmounts(price, form, event, organization) {
  const listed = Number(price);
  const taxRate = form.taxable ? Number(event?.taxRate || 0) : 0;
  const taxInclusive = organization?.taxInclusivePricing === true;
  const fees = feeService.computeOrderFees([{ unitPrice: listed, quantity: 1 }], taxRate, { taxInclusive });
  const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
  if (form.feeMode === 'ABSORB') {
    return {
      subtotal: fees.subtotal,
      platformFee: fees.platformFee,
      processingFee: fees.processingFee,
      tax: fees.tax,
      applicantPays: round(fees.subtotal + fees.tax),
      orgReceives: round(fees.subtotal - fees.platformFee - fees.processingFee),
      feeMode: 'ABSORB',
    };
  }
  return {
    subtotal: fees.subtotal,
    platformFee: fees.platformFee,
    processingFee: fees.processingFee,
    tax: fees.tax,
    applicantPays: fees.total,
    orgReceives: fees.subtotal,
    feeMode: 'PASS',
  };
}

const FORM_INCLUDE = {
  tiers: { orderBy: { displayOrder: 'asc' } },
  questions: { where: { archivedAt: null }, orderBy: { displayOrder: 'asc' } },
  _count: { select: { applications: true } },
};

class ApplicationFormService {
  // ---------------------------------------------------------------------------
  // Event scoping
  // ---------------------------------------------------------------------------

  /** Event with its organization, or 404. `organizationId` (staff) must match when given. */
  async requireEvent(eventId, organizationId = null) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { venue: { include: { organization: { select: { id: true, name: true, taxInclusivePricing: true, logoUrl: true } } } } },
    });
    if (!event || (organizationId && event.venue.organizationId !== organizationId)) {
      throw new NotFoundError('Event not found');
    }
    return event;
  }

  // ---------------------------------------------------------------------------
  // Forms (admin)
  // ---------------------------------------------------------------------------

  async listForms(eventId, organizationId) {
    const event = await this.requireEvent(eventId, organizationId);
    const forms = await prisma.applicationForm.findMany({
      where: { eventId },
      include: FORM_INCLUDE,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return forms.map((f) => this._serializeForm(f, event));
  }

  async getForm(eventId, formId, organizationId) {
    const event = await this.requireEvent(eventId, organizationId);
    const form = await prisma.applicationForm.findFirst({ where: { id: formId, eventId }, include: FORM_INCLUDE });
    if (!form) throw new NotFoundError('Application form not found');
    return this._serializeForm(form, event);
  }

  async createForm(eventId, organizationId, body) {
    const event = await this.requireEvent(eventId, organizationId);
    if (!FORM_KINDS.has(body.kind)) throw new ValidationError('kind must be PAID or FREE');
    const data = { eventId, kind: body.kind, ...this._validateFormFields(body, body.kind, null) };
    data.slug = await this._uniqueSlug(eventId, body.slug || data.name);
    if (body.tiers !== undefined) {
      if (body.kind === 'FREE' && body.tiers.length > 0) throw new ValidationError('FREE forms cannot have tiers');
      data.tiers = { create: body.tiers.map((t, i) => this._validateTier(t, i)) };
    }
    if (body.questions !== undefined) {
      data.questions = { create: body.questions.map((q, i) => this._validateQuestion(q, i)) };
    }
    const form = await prisma.applicationForm.create({ data, include: FORM_INCLUDE });
    logger.info('Application form created', { event: 'application_form_created', eventId, formId: form.id, kind: form.kind });
    return this._serializeForm(form, event);
  }

  async updateForm(eventId, formId, organizationId, body) {
    const event = await this.requireEvent(eventId, organizationId);
    const existing = await prisma.applicationForm.findFirst({ where: { id: formId, eventId }, include: { tiers: true } });
    if (!existing) throw new NotFoundError('Application form not found');
    if (body.kind !== undefined && body.kind !== existing.kind) throw new ValidationError('kind cannot be changed after creation');
    const data = this._validateFormFields(body, existing.kind, existing);
    if (body.slug !== undefined) data.slug = await this._uniqueSlug(eventId, body.slug, formId);
    if (data.status === 'OPEN') this._assertCanOpen({ ...existing, ...data });
    const form = await prisma.applicationForm.update({ where: { id: formId }, data, include: FORM_INCLUDE });
    return this._serializeForm(form, event);
  }

  async deleteForm(eventId, formId, organizationId) {
    await this.requireEvent(eventId, organizationId);
    const form = await prisma.applicationForm.findFirst({ where: { id: formId, eventId }, include: { _count: { select: { applications: true } } } });
    if (!form) throw new NotFoundError('Application form not found');
    if (form._count.applications > 0) throw new ConflictError('Close the form instead: it already has applications');
    await prisma.applicationForm.delete({ where: { id: formId } });
  }

  // ---------------------------------------------------------------------------
  // Tiers (admin)
  // ---------------------------------------------------------------------------

  async addTier(eventId, formId, organizationId, body) {
    const event = await this.requireEvent(eventId, organizationId);
    const form = await this._requireForm(eventId, formId);
    if (form.kind !== 'PAID') throw new ValidationError('Only PAID forms have tiers');
    const count = await prisma.applicationTier.count({ where: { formId } });
    const tier = await prisma.applicationTier.create({ data: { formId, ...this._validateTier(body, count) } });
    return this._serializeTier(tier, form, event);
  }

  async updateTier(eventId, formId, tierId, organizationId, body) {
    const event = await this.requireEvent(eventId, organizationId);
    const form = await this._requireForm(eventId, formId);
    const existing = await prisma.applicationTier.findFirst({ where: { id: tierId, formId } });
    if (!existing) throw new NotFoundError('Tier not found');
    const data = this._validateTier({ ...existing, price: Number(existing.price), ...body }, existing.displayOrder, true);
    if (data.quantityTotal < existing.quantityApproved + existing.quantityReserved) {
      throw new ValidationError(`quantityTotal cannot be below the ${existing.quantityApproved + existing.quantityReserved} slots already taken`);
    }
    const tier = await prisma.applicationTier.update({ where: { id: tierId }, data });
    return this._serializeTier(tier, form, event);
  }

  async deleteTier(eventId, formId, tierId, organizationId) {
    await this.requireEvent(eventId, organizationId);
    await this._requireForm(eventId, formId);
    const tier = await prisma.applicationTier.findFirst({ where: { id: tierId, formId }, include: { _count: { select: { applications: true } } } });
    if (!tier) throw new NotFoundError('Tier not found');
    if (tier._count.applications > 0) throw new ConflictError('Deactivate the tier instead: it already has applications');
    await prisma.applicationTier.delete({ where: { id: tierId } });
  }

  // ---------------------------------------------------------------------------
  // Questions (admin)
  // ---------------------------------------------------------------------------

  async addQuestion(eventId, formId, organizationId, body) {
    await this.requireEvent(eventId, organizationId);
    await this._requireForm(eventId, formId);
    const count = await prisma.applicationQuestion.count({ where: { formId, archivedAt: null } });
    return prisma.applicationQuestion.create({ data: { formId, ...this._validateQuestion(body, count) } });
  }

  async updateQuestion(eventId, formId, questionId, organizationId, body) {
    await this.requireEvent(eventId, organizationId);
    await this._requireForm(eventId, formId);
    const existing = await prisma.applicationQuestion.findFirst({ where: { id: questionId, formId, archivedAt: null } });
    if (!existing) throw new NotFoundError('Question not found');
    const merged = { ...existing, ...body };
    const answered = await prisma.applicationAnswer.count({ where: { questionId } });
    if (answered > 0 && body.type !== undefined && body.type !== existing.type) {
      throw new ConflictError('Type cannot change once the question has answers; archive it and add a new one');
    }
    return prisma.applicationQuestion.update({ where: { id: questionId }, data: this._validateQuestion(merged, merged.displayOrder) });
  }

  /** Archive (answers exist) or delete (none yet). */
  async removeQuestion(eventId, formId, questionId, organizationId) {
    await this.requireEvent(eventId, organizationId);
    await this._requireForm(eventId, formId);
    const existing = await prisma.applicationQuestion.findFirst({ where: { id: questionId, formId, archivedAt: null } });
    if (!existing) throw new NotFoundError('Question not found');
    const answered = await prisma.applicationAnswer.count({ where: { questionId } });
    if (answered > 0) {
      await prisma.applicationQuestion.update({ where: { id: questionId }, data: { archivedAt: new Date() } });
      return { archived: true };
    }
    await prisma.applicationQuestion.delete({ where: { id: questionId } });
    return { archived: false };
  }

  async reorderQuestions(eventId, formId, organizationId, ids) {
    await this.requireEvent(eventId, organizationId);
    await this._requireForm(eventId, formId);
    if (!Array.isArray(ids)) throw new ValidationError('ids must be an array');
    await prisma.$transaction(ids.map((id, i) => prisma.applicationQuestion.updateMany({ where: { id, formId }, data: { displayOrder: i } })));
    return prisma.applicationQuestion.findMany({ where: { formId, archivedAt: null }, orderBy: { displayOrder: 'asc' } });
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /** Forms a visitor can see for a published event: OPEN, and DRAFT-less upcoming windows. */
  async publicForms(eventId) {
    const event = await this.requireEvent(eventId);
    if (event.status !== 'PUBLISHED') throw new NotFoundError('Event not found');
    const forms = await prisma.applicationForm.findMany({
      where: { eventId, status: { in: ['OPEN', 'CLOSED'] } },
      include: FORM_INCLUDE,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return forms.map((f) => this._serializePublicForm(f, event));
  }

  async publicForm(eventId, slug) {
    const event = await this.requireEvent(eventId);
    if (event.status !== 'PUBLISHED') throw new NotFoundError('Event not found');
    const form = await prisma.applicationForm.findFirst({ where: { eventId, slug, status: { in: ['OPEN', 'CLOSED'] } }, include: FORM_INCLUDE });
    if (!form) throw new NotFoundError('Application form not found');
    return this._serializePublicForm(form, event);
  }

  /** Whether the form accepts submissions right now; reason when not. */
  acceptance(form, now = new Date()) {
    if (form.status === 'DRAFT') return { open: false, reason: 'not_published' };
    if (form.status === 'CLOSED') return { open: false, reason: 'closed' };
    if (form.opensAt && now < form.opensAt) return { open: false, reason: 'not_yet_open', opensAt: form.opensAt };
    if (form.closesAt && now > form.closesAt) return { open: false, reason: 'closed', closesAt: form.closesAt };
    return { open: true, reason: null };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  async _requireForm(eventId, formId) {
    const form = await prisma.applicationForm.findFirst({ where: { id: formId, eventId } });
    if (!form) throw new NotFoundError('Application form not found');
    return form;
  }

  async _uniqueSlug(eventId, raw, exceptFormId = null) {
    const base = slugify(raw);
    if (!base) throw new ValidationError('slug must contain letters or numbers');
    let slug = base;
    for (let i = 2; i < 100; i += 1) {
      const clash = await prisma.applicationForm.findFirst({ where: { eventId, slug, NOT: exceptFormId ? { id: exceptFormId } : undefined }, select: { id: true } });
      if (!clash) return slug;
      slug = `${base}-${i}`;
    }
    throw new ConflictError('Could not find a free slug');
  }

  _validateFormFields(body, kind, existing) {
    const data = {};
    if (body.name !== undefined || !existing) {
      const name = String(body.name ?? '').trim();
      if (name.length < 2 || name.length > 80) throw new ValidationError('name must be 2-80 characters');
      data.name = name;
    }
    if (body.intro !== undefined) {
      if (body.intro !== null && typeof body.intro !== 'string') throw new ValidationError('intro must be a string');
      if (body.intro && body.intro.length > 5000) throw new ValidationError('intro must be 5000 characters or fewer');
      data.intro = body.intro || null;
    }
    if (body.status !== undefined) {
      if (!FORM_STATUSES.has(body.status)) throw new ValidationError('status must be DRAFT, OPEN or CLOSED');
      data.status = body.status;
    }
    for (const key of ['opensAt', 'closesAt']) {
      if (body[key] !== undefined) {
        if (body[key] === null) data[key] = null;
        else {
          const d = new Date(body[key]);
          if (Number.isNaN(d.getTime())) throw new ValidationError(`${key} must be a date`);
          data[key] = d;
        }
      }
    }
    const opens = data.opensAt !== undefined ? data.opensAt : existing?.opensAt;
    const closes = data.closesAt !== undefined ? data.closesAt : existing?.closesAt;
    if (opens && closes && closes <= opens) throw new ValidationError('closesAt must be after opensAt');
    if (body.displayOrder !== undefined) {
      if (!Number.isInteger(body.displayOrder) || body.displayOrder < 0) throw new ValidationError('displayOrder must be a non-negative integer');
      data.displayOrder = body.displayOrder;
    }
    if (kind === 'PAID') {
      if (body.chargeTiming !== undefined) {
        if (!CHARGE_TIMINGS.has(body.chargeTiming)) throw new ValidationError('chargeTiming must be SUBMIT or APPROVAL');
        data.chargeTiming = body.chargeTiming;
      }
      if (body.feeMode !== undefined) {
        if (!FEE_MODES.has(body.feeMode)) throw new ValidationError('feeMode must be PASS or ABSORB');
        data.feeMode = body.feeMode;
      }
      if (body.taxable !== undefined) {
        if (typeof body.taxable !== 'boolean') throw new ValidationError('taxable must be a boolean');
        data.taxable = body.taxable;
      }
      if (body.paymentDueDays !== undefined) {
        if (!Number.isInteger(body.paymentDueDays) || body.paymentDueDays < 1 || body.paymentDueDays > 30) {
          throw new ValidationError('paymentDueDays must be 1-30');
        }
        data.paymentDueDays = body.paymentDueDays;
      }
      if (body.overduePolicy !== undefined) {
        if (!OVERDUE_POLICIES.has(body.overduePolicy)) throw new ValidationError('overduePolicy must be WITHDRAW or HOLD');
        data.overduePolicy = body.overduePolicy;
      }
    } else {
      for (const key of ['chargeTiming', 'feeMode', 'taxable', 'paymentDueDays', 'overduePolicy']) {
        if (body[key] !== undefined) throw new ValidationError(`${key} applies to PAID forms only`);
      }
    }
    return data;
  }

  _assertCanOpen(form) {
    if (form.kind !== 'PAID') return;
    if (!paymentsEnabled()) throw new ConflictError('Paid application forms cannot open until application payments are enabled');
    if (!(form.tiers || []).some((t) => t.isActive)) throw new ValidationError('A PAID form needs at least one active tier before it can open');
  }

  _validateTier(body, displayOrder, partial = false) {
    const data = {};
    const name = String(body.name ?? '').trim();
    if (name.length < 1 || name.length > 80) throw new ValidationError('tier name must be 1-80 characters');
    data.name = name;
    if (body.description !== undefined) data.description = body.description ? String(body.description).slice(0, 1000) : null;
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0 || price > 100000) throw new ValidationError('tier price must be between 0 and 100000');
    data.price = Math.round(price * 100) / 100;
    const qty = body.quantityTotal;
    if (!Number.isInteger(qty) || qty < 0 || qty > 100000) throw new ValidationError('quantityTotal must be a non-negative integer');
    data.quantityTotal = qty;
    data.displayOrder = Number.isInteger(body.displayOrder) ? body.displayOrder : displayOrder;
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') throw new ValidationError('isActive must be a boolean');
      data.isActive = body.isActive;
    } else if (!partial) data.isActive = true;
    return data;
  }

  _validateQuestion(body, displayOrder) {
    const label = String(body.label ?? '').trim();
    if (label.length < 1 || label.length > 200) throw new ValidationError('question label must be 1-200 characters');
    if (!QUESTION_TYPES.has(body.type)) throw new ValidationError(`question type must be one of ${[...QUESTION_TYPES].join(', ')}`);
    const data = {
      label,
      type: body.type,
      helpText: body.helpText ? String(body.helpText).slice(0, 500) : null,
      required: body.required === true,
      displayOrder: Number.isInteger(body.displayOrder) ? body.displayOrder : displayOrder,
      options: [],
    };
    if (CHOICE_TYPES.has(body.type)) {
      const options = Array.isArray(body.options) ? body.options.map((o) => String(o).trim()).filter(Boolean) : [];
      if (options.length < 2) throw new ValidationError('choice questions need at least two options');
      if (options.length > MAX_OPTIONS) throw new ValidationError(`at most ${MAX_OPTIONS} options`);
      if (new Set(options).size !== options.length) throw new ValidationError('options must be unique');
      data.options = options;
    }
    return data;
  }

  _serializeTier(tier, form, event) {
    const amounts = tierAmounts(tier.price, form, event, event.venue.organization);
    return {
      id: tier.id,
      name: tier.name,
      description: tier.description,
      price: Number(tier.price),
      quantityTotal: tier.quantityTotal,
      quantityApproved: tier.quantityApproved,
      quantityReserved: tier.quantityReserved,
      remaining: Math.max(0, tier.quantityTotal - tier.quantityApproved - tier.quantityReserved),
      displayOrder: tier.displayOrder,
      isActive: tier.isActive,
      amounts,
    };
  }

  _serializeQuestion(q) {
    return {
      id: q.id,
      label: q.label,
      helpText: q.helpText,
      type: q.type,
      required: q.required,
      options: q.options,
      displayOrder: q.displayOrder,
    };
  }

  _serializeForm(form, event) {
    return {
      id: form.id,
      eventId: form.eventId,
      kind: form.kind,
      name: form.name,
      slug: form.slug,
      intro: form.intro,
      status: form.status,
      opensAt: form.opensAt,
      closesAt: form.closesAt,
      chargeTiming: form.chargeTiming,
      feeMode: form.feeMode,
      taxable: form.taxable,
      paymentDueDays: form.paymentDueDays,
      overduePolicy: form.overduePolicy,
      displayOrder: form.displayOrder,
      acceptance: this.acceptance(form),
      paymentsEnabled: paymentsEnabled(),
      applicationCount: form._count?.applications ?? 0,
      tiers: (form.tiers || []).map((t) => this._serializeTier(t, form, event)),
      questions: (form.questions || []).map((q) => this._serializeQuestion(q)),
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
    };
  }

  /** Applicant-facing: no internal counters, only the applicant price and availability. */
  _serializePublicForm(form, event) {
    return {
      id: form.id,
      kind: form.kind,
      name: form.name,
      slug: form.slug,
      intro: form.intro,
      acceptance: this.acceptance(form),
      chargeTiming: form.kind === 'PAID' ? form.chargeTiming : null,
      feeMode: form.kind === 'PAID' ? form.feeMode : null,
      tiers: (form.tiers || [])
        .filter((t) => t.isActive)
        .map((t) => {
          const amounts = tierAmounts(t.price, form, event, event.venue.organization);
          return {
            id: t.id,
            name: t.name,
            description: t.description,
            price: Number(t.price),
            applicantPays: amounts.applicantPays,
            feesIncluded: amounts.feeMode === 'PASS' ? Math.round((amounts.applicantPays - amounts.subtotal - amounts.tax) * 100) / 100 : 0,
            tax: amounts.tax,
            soldOut: t.quantityTotal - t.quantityApproved - t.quantityReserved <= 0,
          };
        }),
      questions: (form.questions || []).map((q) => this._serializeQuestion(q)),
    };
  }
}

export default new ApplicationFormService();
