// Application Service (spec 011)
// Submissions, the review state machine (approve / reject / waitlist /
// withdraw), tier capacity on approval, list / detail / export for organizers
// and the applicant's own views.
//
// Two independent columns: `status` (review) and `paymentStatus` (money).
// Phase 1 handles FREE forms end to end; PAID forms compute their amount
// snapshot here but cannot open until ApplicationPaymentService (phase 2)
// ships behind APPLICATIONS_PAYMENTS_ENABLED.
//
// Capacity: submissions never consume a tier slot. Approval takes one with a
// conditional UPDATE … RETURNING (the PriceTier pattern); withdrawing an
// approved application releases it.

import { createHash, randomBytes } from 'crypto';
import { prisma } from '@jump/db';
import { LIST_PAGE_SIZE, MAX_ANSWER_LENGTH, MAX_PROFILE_PHOTOS, STATUS_TOKEN_TTL_DAYS } from '../config/applications.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import applicationFormService, { paymentsEnabled, tierAmounts } from './ApplicationFormService.js';
import applicantProfileService from './ApplicantProfileService.js';
import applicationTemplateService from './ApplicationTemplateService.js';
import imageService from './ImageService.js';
import { storefrontFor } from '../utils/storefrontUrl.js';
import logger from '../utils/logger.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const ACTIVE_STATUSES = ['DRAFT', 'SUBMITTED', 'WAITLISTED', 'APPROVED'];
const STATUSES = new Set(['DRAFT', 'SUBMITTED', 'WAITLISTED', 'APPROVED', 'REJECTED', 'WITHDRAWN']);
const PAYMENT_STATUSES = new Set(['NOT_REQUIRED', 'AWAITING_CARD', 'CARD_ON_FILE', 'PROCESSING', 'PAID', 'PAYMENT_DUE', 'REFUNDED', 'PARTIALLY_REFUNDED']);

/** Organizer decisions: which statuses they leave from and land on. */
export const DECISIONS = {
  APPROVE: { from: ['SUBMITTED', 'WAITLISTED'], to: 'APPROVED', action: 'APPROVED' },
  REJECT: { from: ['SUBMITTED', 'WAITLISTED'], to: 'REJECTED', action: 'REJECTED' },
  WAITLIST: { from: ['SUBMITTED'], to: 'WAITLISTED', action: 'WAITLISTED' },
  WITHDRAW: { from: ['SUBMITTED', 'WAITLISTED', 'APPROVED'], to: 'WITHDRAWN', action: 'WITHDRAWN' },
};

export function hashToken(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const DETAIL_INCLUDE = {
  contact: { select: { id: true, email: true, firstName: true, lastName: true, accountCreatedAt: true } },
  profile: { include: { images: { include: { image: { include: { file: true } } }, orderBy: { displayOrder: 'asc' } } } },
  tier: true,
  form: { select: { id: true, name: true, slug: true, kind: true, chargeTiming: true, feeMode: true } },
  event: { select: { id: true, name: true, date: true, venue: { select: { organizationId: true, organization: { select: { id: true, name: true, logoUrl: true } } } } } },
  answers: { include: { question: true, image: { include: { file: true } } } },
  decisions: { orderBy: { createdAt: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
};

class ApplicationService {
  // ---------------------------------------------------------------------------
  // Public: submit
  // ---------------------------------------------------------------------------

  /**
   * Submit an application.
   * @param {string} eventId
   * @param {{ formSlug: string, tierId?: string, contact: { email, firstName, lastName }, profile: object, answers: Record<string, unknown>, optInMarketing?: boolean }} body
   * @param {{ profilePhotos: File[], answerPhotos: Record<string, File> }} files
   * @returns {Promise<{ applicationId: string, statusUrl: string, next: 'done'|'checkout', checkoutUrl?: string }>}
   */
  async submit(eventId, body, files = { profilePhotos: [], answerPhotos: {} }) {
    const event = await applicationFormService.requireEvent(eventId);
    if (event.status !== 'PUBLISHED') throw new NotFoundError('Event not found');
    const form = await prisma.applicationForm.findFirst({
      where: { eventId, slug: String(body.formSlug || '') },
      include: { tiers: true, questions: { where: { archivedAt: null }, orderBy: { displayOrder: 'asc' } } },
    });
    if (!form) throw new NotFoundError('Application form not found');
    const acceptance = applicationFormService.acceptance(form);
    if (!acceptance.open) throw new ConflictError(`This form is not accepting applications (${acceptance.reason})`);
    if (form.kind === 'PAID' && !paymentsEnabled()) throw new ConflictError('Paid applications are not available yet');

    const contact = this._validateContact(body.contact);
    const organizationId = event.venue.organizationId;

    let tier = null;
    if (form.kind === 'PAID') {
      if (!body.tierId) throw new ValidationError('tierId is required for this form');
      tier = form.tiers.find((t) => t.id === body.tierId && t.isActive);
      if (!tier) throw new NotFoundError('Tier not found');
    } else if (body.tierId) {
      throw new ValidationError('This form has no tiers');
    }

    const profileData = applicantProfileService.validate(body.profile || {});
    if ((files.profilePhotos || []).length > MAX_PROFILE_PHOTOS) throw new ValidationError(`At most ${MAX_PROFILE_PHOTOS} profile photos`);
    const answers = this._validateAnswers(form.questions, body.answers || {}, files.answerPhotos || {});

    const rawToken = randomBytes(24).toString('hex');
    const amounts = tier ? tierAmounts(tier.price, form, event, event.venue.organization) : null;

    const application = await prisma.$transaction(async (tx) => {
      const contactRecord = await tx.contact.upsert({
        where: { organizationId_email: { organizationId, email: contact.email } },
        update: { firstName: contact.firstName, lastName: contact.lastName, ...(body.optInMarketing === true && { emailSubscribed: true }) },
        create: { organizationId, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, emailSubscribed: body.optInMarketing === true },
      });

      const dup = await tx.application.findFirst({
        where: { formId: form.id, contactId: contactRecord.id, status: { in: ACTIVE_STATUSES } },
        select: { id: true, status: true },
      });
      if (dup) throw new ConflictError('You already have an application on this form', { applicationId: dup.id, status: dup.status });

      const profile = await applicantProfileService.upsert(organizationId, contactRecord.id, profileData, tx);
      await applicantProfileService.addPhotos(profile.id, files.profilePhotos, tx);

      const answerRows = [];
      for (const a of answers) {
        if (a.file) {
          const image = await imageService.processUpload(a.file.buffer, a.file.originalname, a.file.mimetype, 'application_answer');
          answerRows.push({ questionId: a.questionId, imageId: image.id });
        } else {
          answerRows.push({ questionId: a.questionId, valueText: a.valueText ?? null, valueJson: a.valueJson ?? undefined });
        }
      }

      const isFree = form.kind === 'FREE';
      return tx.application.create({
        data: {
          formId: form.id,
          eventId,
          organizationId,
          contactId: contactRecord.id,
          profileId: profile.id,
          tierId: tier?.id ?? null,
          status: isFree ? 'SUBMITTED' : 'DRAFT',
          paymentStatus: isFree ? 'NOT_REQUIRED' : form.chargeTiming === 'APPROVAL' ? 'AWAITING_CARD' : 'NOT_REQUIRED',
          submittedAt: isFree ? new Date() : null,
          statusTokenHash: hashToken(rawToken),
          ...(amounts && {
            subtotal: amounts.subtotal,
            platformFee: amounts.platformFee,
            processingFee: amounts.processingFee,
            tax: amounts.tax,
            applicantPays: amounts.applicantPays,
            orgReceives: amounts.orgReceives,
            feeMode: amounts.feeMode,
          }),
          answers: { create: answerRows },
        },
        include: DETAIL_INCLUDE,
      });
    });

    const statusUrl = await this.statusUrl(application, rawToken);
    logger.info('Application submitted', {
      event: 'application_submitted',
      applicationId: application.id,
      formId: form.id,
      eventId,
      kind: form.kind,
      status: application.status,
    });

    if (application.status === 'SUBMITTED') {
      // send() never throws; a failed email is logged and must not fail the submission.
      await applicationTemplateService.send(organizationId, 'RECEIVED', { ...application, statusUrl });
    }

    return { applicationId: application.id, statusUrl, next: application.status === 'SUBMITTED' ? 'done' : 'checkout' };
  }

  /** Guest status page: token must match; returns the applicant-facing view. */
  async statusView(applicationId, rawToken) {
    if (!rawToken) throw new ForbiddenError('Missing token');
    const application = await prisma.application.findUnique({ where: { id: applicationId }, include: DETAIL_INCLUDE });
    if (!application || application.statusTokenHash !== hashToken(String(rawToken))) throw new NotFoundError('Application not found');
    const ageDays = (Date.now() - application.createdAt.getTime()) / 86_400_000;
    if (ageDays > STATUS_TOKEN_TTL_DAYS) throw new ForbiddenError('This link has expired; sign in to see your application');
    return this._serializeApplicant(application);
  }

  async statusUrl(application, rawToken) {
    const { base } = await storefrontFor(application.organizationId);
    return `${base}/events/${application.eventId}/apply/status/${application.id}?token=${rawToken}`;
  }

  // ---------------------------------------------------------------------------
  // Applicant (buyer session)
  // ---------------------------------------------------------------------------

  async listForContact(organizationId, contactId) {
    const rows = await prisma.application.findMany({
      where: { organizationId, contactId, status: { not: 'DRAFT' } },
      include: DETAIL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((a) => this._serializeApplicant(a));
  }

  async getForContact(organizationId, contactId, applicationId) {
    const application = await prisma.application.findFirst({ where: { id: applicationId, organizationId, contactId }, include: DETAIL_INCLUDE });
    if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
    return this._serializeApplicant(application);
  }

  /** Applicants may withdraw while the organizer has not decided. */
  async withdrawByApplicant(organizationId, contactId, applicationId) {
    const application = await prisma.application.findFirst({ where: { id: applicationId, organizationId, contactId }, include: DETAIL_INCLUDE });
    if (!application) throw new NotFoundError('Application not found');
    if (!['SUBMITTED', 'WAITLISTED'].includes(application.status)) {
      throw new ConflictError('Only submitted or waitlisted applications can be withdrawn; contact the organizer otherwise');
    }
    const updated = await prisma.$transaction(async (tx) => {
      await this._releaseCapacity(tx, application);
      return tx.application.update({
        where: { id: application.id },
        data: { status: 'WITHDRAWN', withdrawnBy: 'APPLICANT', decidedAt: new Date(), capacitySlot: 'NONE', decisions: { create: { action: 'WITHDRAWN', byUserId: null, note: 'Withdrawn by applicant' } } },
        include: DETAIL_INCLUDE,
      });
    });
    logger.info('Application withdrawn by applicant', { event: 'application_decided', applicationId: application.id, action: 'WITHDRAWN', by: 'applicant' });
    return this._serializeApplicant(updated);
  }

  // ---------------------------------------------------------------------------
  // Organizer: list, detail, decisions
  // ---------------------------------------------------------------------------

  async list(eventId, organizationId, query = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const where = this._listWhere(eventId, query);
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(query.pageSize, 10) || LIST_PAGE_SIZE));
    const orderBy = this._listOrder(query.sort);
    const [rows, total, statusGroups] = await Promise.all([
      prisma.application.findMany({
        where,
        include: {
          contact: { select: { email: true, firstName: true, lastName: true } },
          profile: { select: { businessName: true } },
          tier: { select: { id: true, name: true } },
          form: { select: { id: true, name: true, kind: true } },
        },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.application.count({ where }),
      prisma.application.groupBy({ by: ['status'], where: { eventId, status: { not: 'DRAFT' } }, _count: { _all: true } }),
    ]);
    const summary = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all]));
    return {
      data: rows.map((a) => this._serializeRow(a)),
      total,
      page,
      pageSize,
      summary,
    };
  }

  async summary(eventId, organizationId) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const groups = await prisma.application.groupBy({ by: ['status'], where: { eventId, status: { not: 'DRAFT' } }, _count: { _all: true } });
    return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  }

  async get(eventId, applicationId, organizationId) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const application = await prisma.application.findFirst({ where: { id: applicationId, eventId }, include: DETAIL_INCLUDE });
    if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
    return this._serializeAdmin(application);
  }

  async updateNotes(eventId, applicationId, organizationId, { boothLabel, internalNote }) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const data = {};
    if (boothLabel !== undefined) {
      if (boothLabel !== null && (typeof boothLabel !== 'string' || boothLabel.length > 60)) throw new ValidationError('boothLabel must be 60 characters or fewer');
      data.boothLabel = boothLabel ? boothLabel.trim() : null;
    }
    if (internalNote !== undefined) {
      if (internalNote !== null && (typeof internalNote !== 'string' || internalNote.length > 5000)) throw new ValidationError('internalNote must be 5000 characters or fewer');
      data.internalNote = internalNote ? internalNote.trim() : null;
    }
    if (Object.keys(data).length === 0) throw new ValidationError('Nothing to update');
    const existing = await prisma.application.findFirst({ where: { id: applicationId, eventId }, select: { id: true } });
    if (!existing) throw new NotFoundError('Application not found');
    const application = await prisma.application.update({ where: { id: applicationId }, data, include: DETAIL_INCLUDE });
    return this._serializeAdmin(application);
  }

  /** Rendered template for the decision dialog preview. */
  async previewMessage(eventId, applicationId, organizationId, decision) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const spec = DECISIONS[decision];
    if (!spec) throw new ValidationError('decision must be APPROVE, REJECT, WAITLIST or WITHDRAW');
    const application = await prisma.application.findFirst({ where: { id: applicationId, eventId }, include: DETAIL_INCLUDE });
    if (!application) throw new NotFoundError('Application not found');
    return applicationTemplateService.render(organizationId, spec.action, application);
  }

  /**
   * Organizer decision. Approving a tiered application takes a capacity slot
   * atomically; a full tier returns 409 with a Waitlist suggestion.
   *
   * @param {{ decision: 'APPROVE'|'REJECT'|'WAITLIST'|'WITHDRAW', note?: string, message?: { subject: string, body: string }|null, sendEmail?: boolean, byUserId: string }} input
   */
  async decide(eventId, applicationId, organizationId, input) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const spec = DECISIONS[input.decision];
    if (!spec) throw new ValidationError('decision must be APPROVE, REJECT, WAITLIST or WITHDRAW');
    const note = input.note ? String(input.note).slice(0, 5000) : null;
    const override = this._validateMessage(input.message);

    const updated = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`SELECT * FROM "Application" WHERE "id" = ${applicationId} AND "eventId" = ${eventId} FOR UPDATE`;
      const application = rows[0];
      if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
      if (!spec.from.includes(application.status)) {
        throw new ConflictError(`Cannot ${input.decision.toLowerCase()} an application that is ${application.status.toLowerCase()}`);
      }

      const data = { status: spec.to, decidedAt: new Date(), decidedById: input.byUserId };
      if (spec.to === 'APPROVED') {
        if (application.tierId) {
          await this._takeCapacity(tx, application.tierId, 'APPROVED');
          data.capacitySlot = 'APPROVED';
        }
      } else if (application.capacitySlot !== 'NONE') {
        await this._releaseCapacity(tx, application);
        data.capacitySlot = 'NONE';
      }
      if (spec.to === 'WITHDRAWN') {
        data.withdrawnBy = 'ORGANIZER';
        data.withdrawReason = note;
      }

      return tx.application.update({
        where: { id: applicationId },
        data: { ...data, decisions: { create: { action: spec.action, byUserId: input.byUserId, note } } },
        include: DETAIL_INCLUDE,
      });
    });

    logger.info('Application decided', {
      event: 'application_decided',
      applicationId,
      eventId,
      action: spec.action,
      byUserId: input.byUserId,
    });

    if (input.sendEmail !== false) {
      const sent = await applicationTemplateService.send(organizationId, spec.action, updated, { override });
      if (sent) {
        const decision = updated.decisions[updated.decisions.length - 1];
        await prisma.applicationDecision.update({ where: { id: decision.id }, data: { emailSubject: sent.subject, emailBody: sent.body } }).catch(() => {});
      }
    }
    return this.get(eventId, applicationId, organizationId);
  }

  /**
   * Bulk decision. APPROVE is limited to FREE forms (each paid approval is an
   * individual charge). Returns per-id outcomes; never throws for one failure.
   */
  async bulkDecide(eventId, organizationId, { ids, decision, note, byUserId }) {
    await applicationFormService.requireEvent(eventId, organizationId);
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) throw new ValidationError('ids must be 1-200 application ids');
    if (!DECISIONS[decision]) throw new ValidationError('decision must be APPROVE, REJECT, WAITLIST or WITHDRAW');
    const results = [];
    for (const id of ids) {
      try {
        if (decision === 'APPROVE') {
          const app = await prisma.application.findFirst({ where: { id, eventId }, select: { form: { select: { kind: true } } } });
          if (app?.form.kind === 'PAID') throw new ConflictError('Approve paid applications one at a time');
        }
        await this.decide(eventId, id, organizationId, { decision, note, byUserId });
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: error.message });
      }
    }
    return { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }

  /** CSV with one column per (unarchived or answered) question. */
  async exportCsv(eventId, organizationId, query = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const where = this._listWhere(eventId, query);
    const rows = await prisma.application.findMany({
      where,
      include: {
        contact: { select: { email: true, firstName: true, lastName: true } },
        profile: { select: { businessName: true, website: true, description: true, socials: true } },
        tier: { select: { name: true } },
        form: { select: { name: true, kind: true } },
        answers: { include: { question: { select: { id: true, label: true, type: true } }, image: { include: { file: true } } } },
      },
      orderBy: this._listOrder(query.sort),
    });
    const questions = new Map();
    for (const a of rows) for (const ans of a.answers) if (!questions.has(ans.question.id)) questions.set(ans.question.id, ans.question);
    const qList = [...questions.values()];
    const header = [
      'applicationId', 'form', 'status', 'paymentStatus', 'submittedAt', 'decidedAt', 'tier', 'businessName', 'firstName', 'lastName', 'email',
      'website', 'description', 'socials', 'applicantPays', 'orgReceives', 'boothLabel', 'internalNote', 'stripePaymentIntentId',
      ...qList.map((q) => q.label),
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const a of rows) {
      const byQ = new Map(a.answers.map((ans) => [ans.question.id, ans]));
      const cells = [
        a.id, a.form.name, a.status, a.paymentStatus, a.submittedAt?.toISOString() ?? '', a.decidedAt?.toISOString() ?? '', a.tier?.name ?? '',
        a.profile.businessName, a.contact.firstName, a.contact.lastName, a.contact.email, a.profile.website ?? '', a.profile.description ?? '',
        a.profile.socials ? Object.entries(a.profile.socials).map(([k, v]) => `${k}: ${v}`).join('; ') : '',
        Number(a.applicantPays).toFixed(2), Number(a.orgReceives).toFixed(2), a.boothLabel ?? '', a.internalNote ?? '', a.stripePaymentIntentId ?? '',
        ...qList.map((q) => this._answerText(byQ.get(q.id))),
      ];
      lines.push(cells.map(csvCell).join(','));
    }
    return lines.join('\r\n');
  }

  // ---------------------------------------------------------------------------
  // Capacity
  // ---------------------------------------------------------------------------

  async _takeCapacity(tx, tierId, slot) {
    const column = slot === 'APPROVED' ? 'quantityApproved' : 'quantityReserved';
    const rows = await tx.$queryRawUnsafe(
      `UPDATE "ApplicationTier" SET "${column}" = "${column}" + 1
       WHERE "id" = $1 AND ("quantityTotal" - "quantityApproved" - "quantityReserved") >= 1
       RETURNING "id"`,
      tierId
    );
    if (!rows || rows.length === 0) {
      throw new ConflictError('This tier is full. Waitlist the application or raise the tier quantity.', { tierId, suggestion: 'WAITLIST' });
    }
  }

  async _releaseCapacity(tx, application) {
    if (!application.tierId || application.capacitySlot === 'NONE') return;
    const column = application.capacitySlot === 'APPROVED' ? 'quantityApproved' : 'quantityReserved';
    await tx.$executeRawUnsafe(`UPDATE "ApplicationTier" SET "${column}" = GREATEST("${column}" - 1, 0) WHERE "id" = $1`, application.tierId);
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  _validateContact(contact) {
    if (!contact || typeof contact !== 'object') throw new ValidationError('contact is required');
    const email = String(contact.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) throw new ValidationError('contact.email must be a valid email');
    const firstName = String(contact.firstName || '').trim();
    const lastName = String(contact.lastName || '').trim();
    if (!firstName || firstName.length > 80) throw new ValidationError('contact.firstName is required (max 80)');
    if (!lastName || lastName.length > 80) throw new ValidationError('contact.lastName is required (max 80)');
    return { email, firstName, lastName };
  }

  _validateMessage(message) {
    if (message === undefined || message === null) return null;
    if (typeof message !== 'object') throw new ValidationError('message must be an object');
    const subject = String(message.subject ?? '').trim();
    const body = String(message.body ?? '').trim();
    if (!subject || subject.length > 200) throw new ValidationError('message.subject must be 1-200 characters');
    if (!body || body.length > 10000) throw new ValidationError('message.body must be 1-10000 characters');
    return { subject, body };
  }

  /**
   * Validate answers against the form's questions. `answers` is keyed by
   * question id; `answerPhotos` holds multer files keyed by question id.
   * @returns {Array<{ questionId, valueText?, valueJson?, file? }>}
   */
  _validateAnswers(questions, answers, answerPhotos) {
    if (typeof answers !== 'object' || Array.isArray(answers)) throw new ValidationError('answers must be an object keyed by question id');
    const known = new Set(questions.map((q) => q.id));
    for (const key of Object.keys(answers)) if (!known.has(key)) throw new ValidationError(`Unknown question: ${key}`);
    const out = [];
    for (const q of questions) {
      const raw = answers[q.id];
      const file = answerPhotos[q.id];
      const label = `"${q.label}"`;
      if (q.type === 'PHOTO') {
        if (!file) {
          if (q.required) throw new ValidationError(`${label} needs a photo`);
          continue;
        }
        out.push({ questionId: q.id, file });
        continue;
      }
      const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
      if (empty) {
        if (q.required && q.type !== 'CHECKBOX') throw new ValidationError(`${label} is required`);
        if (q.required && q.type === 'CHECKBOX' && raw !== true) throw new ValidationError(`${label} must be checked`);
        continue;
      }
      switch (q.type) {
        case 'SHORT_TEXT':
        case 'LONG_TEXT': {
          const text = String(raw).trim();
          const max = q.type === 'SHORT_TEXT' ? 500 : MAX_ANSWER_LENGTH;
          if (text.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer`);
          out.push({ questionId: q.id, valueText: text });
          break;
        }
        case 'URL': {
          let text = String(raw).trim();
          if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
          if (!URL_RE.test(text) || text.length > 500) throw new ValidationError(`${label} must be a valid URL`);
          out.push({ questionId: q.id, valueText: text });
          break;
        }
        case 'EMAIL': {
          const text = String(raw).trim().toLowerCase();
          if (!EMAIL_RE.test(text)) throw new ValidationError(`${label} must be a valid email`);
          out.push({ questionId: q.id, valueText: text });
          break;
        }
        case 'PHONE': {
          const text = String(raw).trim();
          if (text.replace(/\D/g, '').length < 7 || text.length > 30) throw new ValidationError(`${label} must be a phone number`);
          out.push({ questionId: q.id, valueText: text });
          break;
        }
        case 'NUMBER': {
          const n = Number(raw);
          if (!Number.isFinite(n)) throw new ValidationError(`${label} must be a number`);
          out.push({ questionId: q.id, valueText: String(n) });
          break;
        }
        case 'CHECKBOX': {
          if (typeof raw !== 'boolean') throw new ValidationError(`${label} must be true or false`);
          out.push({ questionId: q.id, valueText: raw ? 'true' : 'false' });
          break;
        }
        case 'SINGLE_CHOICE': {
          const text = String(raw);
          if (!q.options.includes(text)) throw new ValidationError(`${label}: choose one of the options`);
          out.push({ questionId: q.id, valueText: text });
          break;
        }
        case 'MULTI_CHOICE': {
          const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
          if (list.some((v) => !q.options.includes(v))) throw new ValidationError(`${label}: choose from the options`);
          out.push({ questionId: q.id, valueJson: [...new Set(list)] });
          break;
        }
        default:
          throw new ValidationError(`Unsupported question type ${q.type}`);
      }
    }
    return out;
  }

  _listWhere(eventId, query) {
    const where = { eventId, status: { not: 'DRAFT' } };
    if (query.form) where.formId = String(query.form);
    if (query.tier) where.tierId = String(query.tier);
    if (query.status) {
      const list = String(query.status).split(',').filter((s) => STATUSES.has(s) && s !== 'DRAFT');
      if (list.length) where.status = { in: list };
    }
    if (query.payment) {
      const list = String(query.payment).split(',').filter((s) => PAYMENT_STATUSES.has(s));
      if (list.length) where.paymentStatus = { in: list };
    }
    if (query.q) {
      const q = String(query.q).trim();
      if (q) {
        where.OR = [
          { profile: { businessName: { contains: q, mode: 'insensitive' } } },
          { contact: { email: { contains: q, mode: 'insensitive' } } },
          { contact: { firstName: { contains: q, mode: 'insensitive' } } },
          { contact: { lastName: { contains: q, mode: 'insensitive' } } },
        ];
      }
    }
    return where;
  }

  _listOrder(sort) {
    switch (sort) {
      case 'submitted_asc':
        return [{ submittedAt: 'asc' }];
      case 'business':
        return [{ profile: { businessName: 'asc' } }];
      case 'status':
        return [{ status: 'asc' }, { submittedAt: 'desc' }];
      default:
        return [{ submittedAt: 'desc' }];
    }
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  _answerText(answer) {
    if (!answer) return '';
    if (answer.imageId) return answer.image ? imageService.formatImageResponse(answer.image).urls.original : answer.imageId;
    if (answer.valueJson) return Array.isArray(answer.valueJson) ? answer.valueJson.join('; ') : JSON.stringify(answer.valueJson);
    return answer.valueText ?? '';
  }

  _serializeAnswers(application) {
    return (application.answers || [])
      .slice()
      .sort((a, b) => a.question.displayOrder - b.question.displayOrder)
      .map((a) => ({
        questionId: a.questionId,
        label: a.question.label,
        type: a.question.type,
        archived: Boolean(a.question.archivedAt),
        value: a.valueJson ?? a.valueText ?? null,
        image: a.image ? imageService.formatImageResponse(a.image) : null,
      }));
  }

  _amounts(a) {
    return {
      subtotal: Number(a.subtotal),
      platformFee: Number(a.platformFee),
      processingFee: Number(a.processingFee),
      tax: Number(a.tax),
      applicantPays: Number(a.applicantPays),
      orgReceives: Number(a.orgReceives),
      feeMode: a.feeMode,
      currency: a.currency,
    };
  }

  _serializeRow(a) {
    return {
      id: a.id,
      formId: a.formId,
      formName: a.form?.name,
      formKind: a.form?.kind,
      status: a.status,
      paymentStatus: a.paymentStatus,
      businessName: a.profile?.businessName,
      contact: a.contact,
      tier: a.tier ? { id: a.tier.id, name: a.tier.name } : null,
      applicantPays: Number(a.applicantPays),
      submittedAt: a.submittedAt,
      decidedAt: a.decidedAt,
      paymentDueAt: a.paymentDueAt,
      overdue: a.overdue,
      boothLabel: a.boothLabel,
    };
  }

  _serializeAdmin(a) {
    return {
      id: a.id,
      form: a.form,
      event: { id: a.event.id, name: a.event.name, date: a.event.date },
      status: a.status,
      paymentStatus: a.paymentStatus,
      capacitySlot: a.capacitySlot,
      contact: a.contact,
      profile: applicantProfileService.serialize(a.profile),
      tier: a.tier ? { id: a.tier.id, name: a.tier.name, price: Number(a.tier.price) } : null,
      amounts: this._amounts(a),
      payment: {
        stripePaymentIntentId: a.stripePaymentIntentId,
        stripePaymentMethodId: a.stripePaymentMethodId ? 'on_file' : null,
        stripeAccountId: a.stripeAccountId,
        applicationFee: a.applicationFee == null ? null : Number(a.applicationFee),
        chargeAttempts: a.chargeAttempts,
        paidAt: a.paidAt,
        paymentDueAt: a.paymentDueAt,
        overdue: a.overdue,
      },
      answers: this._serializeAnswers(a),
      decisions: (a.decisions || []).map((d) => ({ id: d.id, action: d.action, byUserId: d.byUserId, note: d.note, emailSubject: d.emailSubject, emailBody: d.emailBody, createdAt: d.createdAt })),
      refunds: (a.refunds || []).map((r) => ({ id: r.id, amount: Number(r.amount), status: r.status, reason: r.reason, createdAt: r.createdAt })),
      submittedAt: a.submittedAt,
      decidedAt: a.decidedAt,
      decidedById: a.decidedById,
      withdrawnBy: a.withdrawnBy,
      withdrawReason: a.withdrawReason,
      boothLabel: a.boothLabel,
      internalNote: a.internalNote,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  _serializeApplicant(a) {
    return {
      id: a.id,
      form: { id: a.form.id, name: a.form.name, kind: a.form.kind },
      event: { id: a.event.id, name: a.event.name, date: a.event.date },
      organization: a.event.venue?.organization ? { id: a.event.venue.organization.id, name: a.event.venue.organization.name } : null,
      status: a.status,
      paymentStatus: a.paymentStatus,
      tier: a.tier ? { id: a.tier.id, name: a.tier.name } : null,
      amounts: this._amounts(a),
      paymentDueAt: a.paymentDueAt,
      profile: applicantProfileService.serialize(a.profile),
      answers: this._serializeAnswers(a).filter((ans) => !ans.archived),
      boothLabel: a.boothLabel,
      submittedAt: a.submittedAt,
      decidedAt: a.decidedAt,
      canWithdraw: ['SUBMITTED', 'WAITLISTED'].includes(a.status),
    };
  }
}

export default new ApplicationService();
