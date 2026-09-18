// Application Form Template Service (spec 019 phase 2)
// Reusable form definitions per organization: a JSON snapshot of settings,
// tiers and questions — not a live ApplicationForm. One write path (`PUT`
// the whole definition, validated by the same functions the form editor
// uses) and one read path; materialisation into a form is
// ApplicationFormService.createForm({ templateId }) / _materialise.
//
// Not to be confused with ApplicationTemplateService (decision email
// templates).

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { MAX_TEMPLATE_QUESTIONS, MAX_TEMPLATE_TIERS } from '../config/applications.js';
import applicationFormService from './ApplicationFormService.js';
import logger from '../utils/logger.js';

const KINDS = new Set(['PAID', 'FREE']);
const SETTING_KEYS = ['intro', 'chargeTiming', 'feeMode', 'taxable', 'paymentDueDays', 'overduePolicy'];
const TIER_KEYS = new Set(['name', 'description', 'price', 'quantityTotal', 'isActive']);
const QUESTION_KEYS = new Set(['label', 'helpText', 'type', 'required', 'options', 'pinned']);

/** The settings a definition carries when the caller sends none. */
const EMPTY_DEFINITION = (kind) => ({
  intro: null,
  chargeTiming: kind === 'PAID' ? 'APPROVAL' : null,
  feeMode: kind === 'PAID' ? 'PASS' : null,
  taxable: kind === 'PAID' ? false : null,
  paymentDueDays: kind === 'PAID' ? 7 : null,
  overduePolicy: kind === 'PAID' ? 'WITHDRAW' : null,
  tiers: [],
  questions: [],
});

class ApplicationFormTemplateService {
  async list(organizationId) {
    const rows = await prisma.applicationFormTemplate.findMany({
      where: organizationId ? { organizationId } : {},
      include: { organization: { select: { id: true, name: true } } },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map((t) => this._serializeSummary(t, !organizationId));
  }

  async get(templateId, organizationId) {
    return this._serialize(await this.requireInScope(templateId, organizationId));
  }

  async create(organizationId, { name, kind, definition }, { byUserId = null } = {}) {
    if (!organizationId) throw new ValidationError('organizationId is required');
    if (!KINDS.has(kind)) throw new ValidationError('kind must be PAID or FREE');
    const data = {
      organizationId,
      name: this._validateName(name),
      kind,
      definition: this.validateDefinition(kind, definition ?? EMPTY_DEFINITION(kind)),
      createdById: byUserId,
    };
    const created = await this._write(() => prisma.applicationFormTemplate.create({ data }));
    logger.info('Application form template created', { event: 'application_form_template_created', organizationId, templateId: created.id, kind });
    return this._serialize(created);
  }

  async update(templateId, organizationId, { name, definition }) {
    const existing = await this.requireInScope(templateId, organizationId);
    const data = {};
    if (name !== undefined) data.name = this._validateName(name);
    if (definition !== undefined) data.definition = this.validateDefinition(existing.kind, definition);
    if (Object.keys(data).length === 0) throw new ValidationError('Nothing to update');
    const updated = await this._write(() => prisma.applicationFormTemplate.update({ where: { id: existing.id }, data }));
    return this._serialize(updated);
  }

  async remove(templateId, organizationId) {
    const existing = await this.requireInScope(templateId, organizationId);
    await prisma.applicationFormTemplate.delete({ where: { id: existing.id } });
    logger.info('Application form template deleted', { event: 'application_form_template_deleted', templateId: existing.id });
  }

  /**
   * Snapshot a form into a template: a new one named `name`, or — with
   * `replaceTemplateId` — overwrite that template's definition (same kind).
   */
  async saveFrom(form, organizationId, { name, replaceTemplateId = null }, { byUserId = null } = {}) {
    const definition = this.validateDefinition(form.kind, applicationFormService.snapshotForm(form));
    if (replaceTemplateId) {
      const target = await this.requireInScope(replaceTemplateId, organizationId);
      if (target.kind !== form.kind) throw new ValidationError(`Template "${target.name}" is for ${target.kind} forms`);
      const data = { definition, sourceFormId: form.id };
      if (name !== undefined) data.name = this._validateName(name);
      const updated = await this._write(() => prisma.applicationFormTemplate.update({ where: { id: target.id }, data }));
      logger.info('Application form template replaced from form', { event: 'application_form_template_replaced', templateId: target.id, formId: form.id });
      return this._serialize(updated);
    }
    const created = await this._write(() =>
      prisma.applicationFormTemplate.create({
        data: { organizationId, name: this._validateName(name), kind: form.kind, definition, sourceFormId: form.id, createdById: byUserId },
      })
    );
    logger.info('Application form template saved from form', { event: 'application_form_template_saved', templateId: created.id, formId: form.id });
    return this._serialize(created);
  }

  /** The template, or 404 when missing or outside `organizationId` (null = unscoped). */
  async requireInScope(templateId, organizationId) {
    const template = await prisma.applicationFormTemplate.findFirst({ where: { id: String(templateId), ...(organizationId ? { organizationId } : {}) } });
    if (!template) throw new NotFoundError('Application form template not found');
    return template;
  }

  /**
   * Validate a whole definition with the form validators, so a template can
   * never hold a value the form editor would refuse. Returns the normalised
   * definition to store.
   */
  validateDefinition(kind, definition) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new ValidationError('definition must be an object');
    for (const key of Object.keys(definition)) {
      if (!SETTING_KEYS.includes(key) && key !== 'tiers' && key !== 'questions') throw new ValidationError(`Unknown definition field: ${key}`);
    }
    const settingsBody = {};
    for (const key of SETTING_KEYS) if (definition[key] !== undefined && definition[key] !== null) settingsBody[key] = definition[key];
    // `name` is validated separately; give the form validator one it accepts.
    const settings = applicationFormService._validateFormFields({ name: 'Template', ...settingsBody }, kind, null);
    delete settings.name;

    const tiers = definition.tiers ?? [];
    const questions = definition.questions ?? [];
    if (!Array.isArray(tiers)) throw new ValidationError('tiers must be an array');
    if (!Array.isArray(questions)) throw new ValidationError('questions must be an array');
    if (kind === 'FREE' && tiers.length > 0) throw new ValidationError('FREE forms cannot have tiers');
    if (tiers.length > MAX_TEMPLATE_TIERS) throw new ValidationError(`at most ${MAX_TEMPLATE_TIERS} tiers`);
    if (questions.length > MAX_TEMPLATE_QUESTIONS) throw new ValidationError(`at most ${MAX_TEMPLATE_QUESTIONS} questions`);

    const out = { ...EMPTY_DEFINITION(kind), ...settings };
    out.tiers = tiers.map((t, i) => {
      if (!t || typeof t !== 'object') throw new ValidationError(`tier ${i + 1} must be an object`);
      for (const key of Object.keys(t)) if (!TIER_KEYS.has(key)) throw new ValidationError(`Unknown tier field: ${key}`);
      const { displayOrder: _o, ...data } = applicationFormService._validateTier(t, i);
      return { description: null, ...data };
    });
    out.questions = questions.map((q, i) => {
      if (!q || typeof q !== 'object') throw new ValidationError(`question ${i + 1} must be an object`);
      for (const key of Object.keys(q)) if (!QUESTION_KEYS.has(key)) throw new ValidationError(`Unknown question field: ${key}`);
      const { displayOrder: _o, ...data } = applicationFormService._validateQuestion(q, i);
      return data;
    });
    applicationFormService._assertPinnedCap(out.questions.filter((q) => q.pinned).length);
    return out;
  }

  _validateName(name) {
    const value = String(name ?? '').trim();
    if (value.length < 2 || value.length > 80) throw new ValidationError('name must be 2-80 characters');
    return value;
  }

  /** Unique (organizationId, name) → 409 with a friendly message. */
  async _write(fn) {
    try {
      return await fn();
    } catch (error) {
      if (error?.code === 'P2002') throw new ConflictError('A template with that name already exists');
      throw error;
    }
  }

  _serializeSummary(t, withOrganization = false) {
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      tierCount: (t.definition?.tiers || []).length,
      questionCount: (t.definition?.questions || []).length,
      sourceFormId: t.sourceFormId,
      ...(withOrganization && t.organization ? { organization: t.organization } : {}),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  _serialize(t) {
    return {
      id: t.id,
      organizationId: t.organizationId,
      name: t.name,
      kind: t.kind,
      definition: t.definition,
      sourceFormId: t.sourceFormId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}

export default new ApplicationFormTemplateService();
