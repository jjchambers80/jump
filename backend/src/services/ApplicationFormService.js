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
import { slugify, uniqueSlug } from '../utils/slug.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { CHOICE_TYPES, MAX_OPTIONS, MAX_PINNED_QUESTIONS, QUESTION_TYPES } from '../config/applications.js';
import feeService from './FeeService.js';
import applicationFormTemplateService from './ApplicationFormTemplateService.js';
import logger from '../utils/logger.js';

const FORM_KINDS = new Set(['PAID', 'FREE']);
const FORM_STATUSES = new Set(['DRAFT', 'OPEN', 'CLOSED']);
const CHARGE_TIMINGS = new Set(['SUBMIT', 'APPROVAL']);
const FEE_MODES = new Set(['PASS', 'ABSORB']);
const OVERDUE_POLICIES = new Set(['WITHDRAW', 'HOLD']);

export function paymentsEnabled() {
  return String(process.env.APPLICATIONS_PAYMENTS_ENABLED || '').toLowerCase() === 'true';
}

export { slugify };

/**
 * What the applicant pays and what the organization receives for a set of
 * lines (the tier plus any add-ons, spec 012) under a form's fee mode.
 * PASS: fees on top of the listed prices. ABSORB: the listed prices are the
 * total; fees come out of the organization's share. Tax follows the event
 * only for taxable lines: the tier line is taxable when the form is, each
 * add-on carries its own flag.
 *
 * @param {Array<{ price: number, quantity: number, taxable: boolean, addOnId?: string }>} lines
 * @returns {{ subtotal, platformFee, processingFee, tax, applicantPays, orgReceives, feeMode, lines: Array<{ applicantPays }> }}
 */
export function applicationAmounts(lines, form, event, organization) {
  const taxRate = Number(event?.taxRate || 0);
  const taxInclusive = organization?.taxInclusivePricing === true;
  const items = lines.map((l) => ({ unitPrice: Number(l.price), quantity: l.quantity, taxable: l.taxable !== false }));
  const fees = feeService.computeOrderFees(items, taxRate, { taxInclusive });
  const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
  const absorb = form.feeMode === 'ABSORB';
  const perLine = fees.itemBreakdowns.map((b, i) => {
    const listed = round(b.unitPrice * b.quantity);
    // ABSORB: the applicant pays the listed price (plus tax on top unless it
    // is already inside the price); PASS: the allocated all-in line total.
    const applicantPays = absorb ? round(listed + (taxInclusive ? 0 : b.tax)) : b.lineTotal;
    // Per-line fee and tax shares (spec 024): written to the order lines.
    return {
      ...lines[i],
      applicantPays,
      platformFee: b.platformFee,
      processingFee: b.processingFee,
      tax: b.tax,
    };
  });
  if (absorb) {
    return {
      subtotal: fees.subtotal,
      platformFee: fees.platformFee,
      processingFee: fees.processingFee,
      tax: fees.tax,
      applicantPays: round(fees.subtotal + fees.tax),
      orgReceives: round(fees.subtotal - fees.platformFee - fees.processingFee),
      feeMode: 'ABSORB',
      lines: perLine,
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
    lines: perLine,
  };
}

/** Amounts for a bare tier (no add-ons). */
export function tierAmounts(price, form, event, organization) {
  const { lines: _lines, ...amounts } = applicationAmounts([{ price, quantity: 1, taxable: form.taxable }], form, event, organization);
  return amounts;
}

/**
 * Lines for `applicationAmounts`: the tier first, then add-ons in display
 * order. Manual adjustments (spec 018 phase 3) fold into the tier line so the
 * fee math never sees a negative item and every add-on line keeps its exact
 * share; callers guarantee `tier.price + adjustmentTotal >= 0`.
 */
export function applicationLines(tier, form, addOnLines = [], adjustmentTotal = 0) {
  return [
    { price: Math.round((Number(tier.price) + Number(adjustmentTotal || 0)) * 100) / 100, quantity: 1, taxable: form.taxable },
    ...addOnLines.map((l) => ({ addOnId: l.addOn.id, price: Number(l.addOn.price), quantity: l.quantity, taxable: l.addOn.taxable })),
  ];
}

const FORM_INCLUDE = {
  tiers: { orderBy: { displayOrder: 'asc' }, include: { addOns: { select: { addOnId: true } } } },
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

  /**
   * Forms across every event in scope (spec 019): a light row per form with
   * its event and the event's application add-ons, for the Participants
   * filters and the Applications tab. `organizationId` null = all
   * organizations (SYSTEM_ADMIN); rows then carry `organization`.
   */
  async listFormsInScope(organizationId) {
    const forms = await prisma.applicationForm.findMany({
      where: organizationId ? { event: { venue: { organizationId } } } : {},
      include: {
        _count: { select: { applications: { where: { status: { not: 'DRAFT' } } } } },
        event: { select: { id: true, name: true, date: true, status: true, venue: { select: { timezone: true, organization: { select: { id: true, name: true } } } } } },
        questions: { where: { pinned: true, archivedAt: null }, select: { id: true, label: true, type: true }, orderBy: { displayOrder: 'asc' } },
      },
      orderBy: [{ event: { date: 'desc' } }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const eventIds = [...new Set(forms.map((f) => f.eventId))];
    const addOns = eventIds.length
      ? await prisma.addOn.findMany({
          where: { eventId: { in: eventIds }, scope: { in: ['APPLICATION', 'BOTH'] }, isActive: true },
          select: { id: true, eventId: true, name: true },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        })
      : [];
    return forms.map((f) => ({
      id: f.id,
      eventId: f.eventId,
      event: { id: f.event.id, name: f.event.name, date: f.event.date, status: f.event.status, timezone: f.event.venue?.timezone ?? null },
      ...(organizationId ? {} : { organization: f.event.venue.organization }),
      kind: f.kind,
      name: f.name,
      slug: f.slug,
      status: f.status,
      opensAt: f.opensAt,
      closesAt: f.closesAt,
      acceptance: this.acceptance(f),
      applicationCount: f._count.applications,
      pinnedQuestions: f.questions.map((q) => ({ id: q.id, label: q.label, type: q.type })),
      addOns: addOns.filter((a) => a.eventId === f.eventId).map((a) => ({ id: a.id, name: a.name })),
      updatedAt: f.updatedAt,
    }));
  }

  async listForms(eventId, organizationId) {
    const event = await this.requireEvent(eventId, organizationId);
    const forms = await prisma.applicationForm.findMany({
      where: { eventId },
      include: FORM_INCLUDE,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const addOns = await this._addOnsForEvent(eventId);
    return forms.map((f) => this._serializeForm(f, event, addOns));
  }

  async getForm(eventId, formId, organizationId) {
    const event = await this.requireEvent(eventId, organizationId);
    const form = await prisma.applicationForm.findFirst({ where: { id: formId, eventId }, include: FORM_INCLUDE });
    if (!form) throw new NotFoundError('Application form not found');
    return this._serializeForm(form, event, await this._addOnsForEvent(eventId));
  }

  /**
   * Create a form. With `body.templateId` (spec 019 phase 2) the template's
   * definition supplies settings, tiers and questions — `kind` must match
   * and the template must be in the caller's scope; explicit body fields
   * still win over the template's settings.
   */
  async createForm(eventId, organizationId, body) {
    const event = await this.requireEvent(eventId, organizationId);
    if (!FORM_KINDS.has(body.kind)) throw new ValidationError('kind must be PAID or FREE');
    let template = null;
    if (body.templateId) {
      template = await applicationFormTemplateService.requireInScope(body.templateId, organizationId ?? event.venue.organizationId);
      if (template.kind !== body.kind) throw new ValidationError(`Template "${template.name}" is for ${template.kind} forms`);
      if (body.tiers !== undefined || body.questions !== undefined) throw new ValidationError('tiers and questions come from the template');
    }
    const { templateId: _templateId, ...fields } = body;
    const settings = template ? { ...this._templateSettings(template.definition, body.kind), ...fields } : fields;
    const data = { eventId, kind: body.kind, ...this._validateFormFields(settings, body.kind, null) };
    data.slug = await this._uniqueSlug(eventId, body.slug || data.name);
    if (body.tiers !== undefined) {
      if (body.kind === 'FREE' && body.tiers.length > 0) throw new ValidationError('FREE forms cannot have tiers');
      data.tiers = { create: body.tiers.map((t, i) => this._validateTier(t, i)) };
    }
    if (body.questions !== undefined) {
      data.questions = { create: body.questions.map((q, i) => this._validateQuestion(q, i)) };
      this._assertPinnedCap(data.questions.create.filter((q) => q.pinned).length);
    }
    if (template) data.createdFromTemplateId = template.id;
    const form = await prisma.$transaction(async (tx) => {
      const created = await tx.applicationForm.create({ data, select: { id: true } });
      if (template) await this._materialise(tx, created.id, template.definition);
      return tx.applicationForm.findUnique({ where: { id: created.id }, include: FORM_INCLUDE });
    });
    logger.info('Application form created', { event: 'application_form_created', eventId, formId: form.id, kind: form.kind, templateId: template?.id });
    return this._serializeForm(form, event, await this._addOnsForEvent(eventId));
  }

  /** The settings half of a template definition, shaped like a create body (PAID keys only on PAID). */
  _templateSettings(definition, kind) {
    const out = { intro: definition.intro ?? null };
    if (kind === 'PAID') {
      for (const key of ['chargeTiming', 'feeMode', 'taxable', 'paymentDueDays', 'overduePolicy']) {
        if (definition[key] !== undefined && definition[key] !== null) out[key] = definition[key];
      }
    }
    return out;
  }

  /**
   * Create tiers and questions on `formId` from a plain definition
   * `{ tiers: [...], questions: [...] }` in list order, inside `tx`. Shared by
   * `copyForms` (event duplication) and create-from-template. Returns the
   * created tiers in order.
   */
  async _materialise(tx, formId, definition) {
    const tiers = [];
    for (const [i, t] of (definition.tiers || []).entries()) {
      tiers.push(
        await tx.applicationTier.create({
          data: {
            formId,
            name: t.name,
            description: t.description ?? null,
            price: t.price,
            quantityTotal: t.quantityTotal,
            displayOrder: Number.isInteger(t.displayOrder) ? t.displayOrder : i,
            isActive: t.isActive !== false,
          },
        })
      );
    }
    for (const [i, q] of (definition.questions || []).entries()) {
      await tx.applicationQuestion.create({
        data: {
          formId,
          label: q.label,
          helpText: q.helpText ?? null,
          type: q.type,
          required: q.required === true,
          options: q.options ?? [],
          displayOrder: Number.isInteger(q.displayOrder) ? q.displayOrder : i,
          pinned: q.pinned === true,
        },
      });
    }
    return tiers;
  }

  /**
   * A form as a template definition (spec 019): settings, tiers without
   * add-on attachments, non-archived questions in order. No status / window /
   * slug — those belong to an event.
   */
  snapshotForm(form) {
    // FREE forms carry the column defaults for the PAID settings; a template
    // definition holds null there (and the validator refuses them on FREE).
    const paid = form.kind === 'PAID';
    return {
      intro: form.intro ?? null,
      chargeTiming: paid ? form.chargeTiming : null,
      feeMode: paid ? form.feeMode : null,
      taxable: paid ? form.taxable : null,
      paymentDueDays: paid ? form.paymentDueDays : null,
      overduePolicy: paid ? form.overduePolicy : null,
      tiers: (form.tiers || []).map((t) => ({ name: t.name, description: t.description ?? null, price: Number(t.price), quantityTotal: t.quantityTotal, isActive: t.isActive })),
      questions: (form.questions || []).filter((q) => !q.archivedAt).map((q) => ({ label: q.label, helpText: q.helpText ?? null, type: q.type, required: q.required, options: q.options ?? [], pinned: q.pinned ?? false })),
    };
  }

  /**
   * Copy every form on `fromEventId` to `toEventId` (event duplication, spec
   * 011 phase 3). Copies land as DRAFT with no open/close window; tiers keep
   * price and quantity but start empty; archived questions are skipped.
   * Runs inside the caller's transaction. Returns the count and a map of
   * source tier id → copied tier id so add-on attachments can follow (spec 012).
   */
  async copyForms(fromEventId, toEventId, tx = prisma) {
    const forms = await tx.applicationForm.findMany({
      where: { eventId: fromEventId },
      include: {
        tiers: { orderBy: { displayOrder: 'asc' } },
        questions: { where: { archivedAt: null }, orderBy: { displayOrder: 'asc' } },
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    let copied = 0;
    const tierIdMap = new Map();
    for (const f of forms) {
      const created = await tx.applicationForm.create({
        data: {
          eventId: toEventId,
          kind: f.kind,
          name: f.name,
          slug: f.slug,
          intro: f.intro,
          status: 'DRAFT',
          opensAt: null,
          closesAt: null,
          chargeTiming: f.chargeTiming,
          feeMode: f.feeMode,
          taxable: f.taxable,
          paymentDueDays: f.paymentDueDays,
          overduePolicy: f.overduePolicy,
          displayOrder: f.displayOrder,
          createdFromTemplateId: f.createdFromTemplateId,
        },
        select: { id: true },
      });
      const tiers = await this._materialise(tx, created.id, {
        tiers: f.tiers.map((t) => ({ name: t.name, description: t.description, price: t.price, quantityTotal: t.quantityTotal, displayOrder: t.displayOrder, isActive: t.isActive })),
        questions: f.questions.map((q) => ({ label: q.label, helpText: q.helpText, type: q.type, required: q.required, options: q.options, displayOrder: q.displayOrder, pinned: q.pinned })),
      });
      // Tiers were created in source order, so index i of each list is the same tier.
      f.tiers.forEach((t, i) => tierIdMap.set(t.id, tiers[i]?.id));
      copied += 1;
    }
    return { copied, tierIdMap };
  }

  async updateForm(eventId, formId, organizationId, body) {
    const event = await this.requireEvent(eventId, organizationId);
    const existing = await prisma.applicationForm.findFirst({ where: { id: formId, eventId }, include: { tiers: true } });
    if (!existing) throw new NotFoundError('Application form not found');
    if (body.kind !== undefined && body.kind !== existing.kind) throw new ValidationError('kind cannot be changed after creation');
    const data = this._validateFormFields(body, existing.kind, existing);
    if (body.slug !== undefined) data.slug = await this._uniqueSlug(eventId, body.slug, formId);
    if (data.status === 'OPEN') this._assertCanOpen({ ...existing, ...data });
    // A map-bound tier sells its booth after approval (spec 014 §4.2): the
    // vendor picks a spot, then pays. Charging at submission has no spot yet.
    if (data.chargeTiming === 'SUBMIT' && existing.tiers.some((t) => t.mapBound)) {
      throw new ValidationError('Forms with tiers bound to a floor map must charge on approval');
    }
    const form = await prisma.applicationForm.update({ where: { id: formId }, data, include: FORM_INCLUDE });
    return this._serializeForm(form, event, await this._addOnsForEvent(eventId));
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
    const tier = await prisma.applicationTier.create({ data: { formId, ...this._validateTier(body, count) }, include: { addOns: { select: { addOnId: true } } } });
    return this._serializeTier(tier, form, event, await this._addOnsForEvent(eventId));
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
    const tier = await prisma.applicationTier.update({ where: { id: tierId }, data, include: { addOns: { select: { addOnId: true } } } });
    return this._serializeTier(tier, form, event, await this._addOnsForEvent(eventId));
  }

  /**
   * Which restricted add-ons a tier offers (spec 012 phase 2). `allTiers`
   * add-ons are offered everywhere and cannot be toggled here; ids of those
   * are ignored. ADMIN.
   */
  async setTierAddOns(eventId, formId, tierId, organizationId, addOnIds) {
    const event = await this.requireEvent(eventId, organizationId);
    const form = await this._requireForm(eventId, formId);
    const existing = await prisma.applicationTier.findFirst({ where: { id: tierId, formId } });
    if (!existing) throw new NotFoundError('Tier not found');
    if (!Array.isArray(addOnIds) || addOnIds.some((id) => typeof id !== 'string')) throw new ValidationError('addOnIds must be an array of ids');
    const ids = [...new Set(addOnIds)];
    const known = await prisma.addOn.findMany({ where: { id: { in: ids }, eventId, scope: { in: ['APPLICATION', 'BOTH'] } }, select: { id: true, allTiers: true } });
    if (known.length !== ids.length) throw new ValidationError('addOnIds must be application add-ons of this event');
    const restricted = known.filter((a) => !a.allTiers).map((a) => a.id);
    const tier = await prisma.$transaction(async (tx) => {
      await tx.applicationTierAddOn.deleteMany({ where: { applicationTierId: tierId } });
      if (restricted.length) await tx.applicationTierAddOn.createMany({ data: restricted.map((addOnId) => ({ applicationTierId: tierId, addOnId })) });
      return tx.applicationTier.findUnique({ where: { id: tierId }, include: { addOns: { select: { addOnId: true } } } });
    });
    return this._serializeTier(tier, form, event, await this._addOnsForEvent(eventId));
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
    const data = this._validateQuestion(body, count);
    if (data.pinned) this._assertPinnedCap((await prisma.applicationQuestion.count({ where: { formId, archivedAt: null, pinned: true } })) + 1);
    return prisma.applicationQuestion.create({ data: { formId, ...data } });
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
    const data = this._validateQuestion(merged, merged.displayOrder);
    if (data.pinned && !existing.pinned) this._assertPinnedCap((await prisma.applicationQuestion.count({ where: { formId, archivedAt: null, pinned: true } })) + 1);
    return prisma.applicationQuestion.update({ where: { id: questionId }, data });
  }

  /** At most MAX_PINNED_QUESTIONS questions per form show as list columns (spec 019). */
  _assertPinnedCap(pinnedCount) {
    if (pinnedCount > MAX_PINNED_QUESTIONS) throw new ValidationError(`At most ${MAX_PINNED_QUESTIONS} questions can be pinned to the list`);
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
    const addOns = await this._addOnsForEvent(eventId, { activeOnly: true });
    return forms.map((f) => this._serializePublicForm(f, event, addOns));
  }

  async publicForm(eventId, slug) {
    const event = await this.requireEvent(eventId);
    if (event.status !== 'PUBLISHED') throw new NotFoundError('Event not found');
    const form = await prisma.applicationForm.findFirst({ where: { eventId, slug, status: { in: ['OPEN', 'CLOSED'] } }, include: FORM_INCLUDE });
    if (!form) throw new NotFoundError('Application form not found');
    return this._serializePublicForm(form, event, await this._addOnsForEvent(eventId, { activeOnly: true }));
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

  /** Add-ons an application tier may offer (scope APPLICATION or BOTH), spec 012. */
  async _addOnsForEvent(eventId, { activeOnly = false } = {}) {
    return prisma.addOn.findMany({
      where: { eventId, scope: { in: ['APPLICATION', 'BOTH'] }, ...(activeOnly && { isActive: true }) },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Add-ons offered on one tier: every `allTiers` add-on plus the ones attached to it. */
  _offeredOnTier(tier, addOns) {
    const attached = new Set((tier.addOns || []).map((a) => a.addOnId));
    return (addOns || []).filter((a) => a.allTiers || attached.has(a.id));
  }

  async _requireForm(eventId, formId) {
    const form = await prisma.applicationForm.findFirst({ where: { id: formId, eventId } });
    if (!form) throw new NotFoundError('Application form not found');
    return form;
  }

  async _uniqueSlug(eventId, raw, exceptFormId = null) {
    return uniqueSlug(prisma.applicationForm, {
      scope: { eventId },
      raw,
      exceptId: exceptFormId,
    });
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
      pinned: body.pinned === true,
      options: [],
    };
    if (body.pinned !== undefined && typeof body.pinned !== 'boolean') throw new ValidationError('pinned must be a boolean');
    if (CHOICE_TYPES.has(body.type)) {
      const options = Array.isArray(body.options) ? body.options.map((o) => String(o).trim()).filter(Boolean) : [];
      if (options.length < 2) throw new ValidationError('choice questions need at least two options');
      if (options.length > MAX_OPTIONS) throw new ValidationError(`at most ${MAX_OPTIONS} options`);
      if (new Set(options).size !== options.length) throw new ValidationError('options must be unique');
      data.options = options;
    }
    return data;
  }

  _serializeTier(tier, form, event, addOns = []) {
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
      // Spec 012: add-ons this tier offers (`allTiers` ones implicitly), priced per unit like the public form.
      addOns: this._offeredOnTier(tier, addOns).map((a) => ({ ...this._serializePublicAddOn(a, form, event, event.venue.organization), allTiers: a.allTiers, isActive: a.isActive })),
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
      pinned: q.pinned ?? false,
    };
  }

  _serializeForm(form, event, addOns = []) {
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
      createdFromTemplateId: form.createdFromTemplateId ?? null,
      acceptance: this.acceptance(form),
      paymentsEnabled: paymentsEnabled(),
      applicationCount: form._count?.applications ?? 0,
      tiers: (form.tiers || []).map((t) => this._serializeTier(t, form, event, addOns)),
      questions: (form.questions || []).map((q) => this._serializeQuestion(q)),
      // Spec 012: every application add-on of the event, so the tier dialog can offer restricted ones.
      addOns: addOns.map((a) => ({ id: a.id, name: a.name, price: Number(a.price), allTiers: a.allTiers, isActive: a.isActive, scope: a.scope })),
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
    };
  }

  /** Applicant-facing: no internal counters, only the applicant price and availability. */
  _serializePublicForm(form, event, addOns = []) {
    const organization = event.venue.organization;
    return {
      id: form.id,
      kind: form.kind,
      name: form.name,
      slug: form.slug,
      intro: form.intro,
      acceptance: this.acceptance(form),
      chargeTiming: form.kind === 'PAID' ? form.chargeTiming : null,
      feeMode: form.kind === 'PAID' ? form.feeMode : null,
      // Spec 024 phase 3: the card-authorization label names the pay-now window.
      paymentDueDays: form.kind === 'PAID' ? form.paymentDueDays : null,
      organizationName: organization?.name ?? null,
      tiers: (form.tiers || [])
        .filter((t) => t.isActive)
        .map((t) => {
          const amounts = tierAmounts(t.price, form, event, organization);
          return {
            id: t.id,
            name: t.name,
            description: t.description,
            price: Number(t.price),
            applicantPays: amounts.applicantPays,
            feesIncluded: amounts.feeMode === 'PASS' ? Math.round((amounts.applicantPays - amounts.subtotal - amounts.tax) * 100) / 100 : 0,
            tax: amounts.tax,
            soldOut: t.quantityTotal - t.quantityApproved - t.quantityReserved <= 0,
            // Spec 014: sold from the floor map, so approval opens the booth
            // picker instead of charging the saved card. The apply form needs
            // this to show the card-authorization label that matches.
            mapBound: t.mapBound === true,
            // Spec 012: optional extras with the per-unit applicant price under this form's fee mode.
            addOns: this._offeredOnTier(t, addOns).map((a) => this._serializePublicAddOn(a, form, event, organization)),
          };
        }),
      questions: (form.questions || []).map((q) => this._serializeQuestion(q)),
    };
  }

  /**
   * Per-unit applicant price of an add-on as if it were the only line: the
   * figure the picker shows before a tier is chosen. The submission snapshot
   * allocates fees across the real lines, so totals can differ by cents.
   */
  _serializePublicAddOn(a, form, event, organization) {
    const unit = applicationAmounts([{ price: a.price, quantity: 1, taxable: a.taxable }], form, event, organization);
    const remaining = a.quantityTotal == null ? null : Math.max(0, a.quantityTotal - a.quantitySold - a.quantityReserved);
    return {
      id: a.id,
      name: a.name,
      description: a.description || null,
      price: Number(a.price),
      taxable: a.taxable,
      applicantPays: unit.applicantPays,
      maxPerOrder: a.maxPerOrder,
      remaining,
      soldOut: remaining === 0,
    };
  }
}

export default new ApplicationFormService();
