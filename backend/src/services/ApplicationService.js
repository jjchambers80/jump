// Application Service (spec 011)
// Submissions, the review state machine (approve / reject / waitlist /
// withdraw), tier capacity on approval, list / detail / export for organizers
// and the applicant's own views.
//
// Two independent columns: `status` (review) and `paymentStatus` (money).
// FREE forms run end to end here. PAID forms (behind
// APPLICATIONS_PAYMENTS_ENABLED) take their amount snapshot at submission and
// hand Stripe work to ApplicationPaymentService: Checkout at submission, the
// off-session charge at approval, pay-now, refunds.
//
// Capacity: submissions never consume a tier slot. Approval takes one with a
// conditional UPDATE … RETURNING (the PriceTier pattern); withdrawing an
// approved application releases it. Add-on lines (spec 012) follow the same
// slot: reserved / sold / released together with the tier, tier first so two
// concurrent approvals lock in one order.

import { prisma } from '@jump/db';
import { LIST_PAGE_SIZE, MAX_ANSWER_LENGTH, MAX_PROFILE_PHOTOS, STATUS_TOKEN_TTL_DAYS } from '../config/applications.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import applicationFormService, { applicationAmounts, applicationLines, paymentsEnabled } from './ApplicationFormService.js';
import addOnService from './AddOnService.js';
import applicantProfileService from './ApplicantProfileService.js';
import applicationTemplateService from './ApplicationTemplateService.js';
import applicationPaymentService from './ApplicationPaymentService.js';
import { hashToken, statusToken, statusUrlFor, verifyStatusToken } from './applicationLinks.js';
import imageService from './ImageService.js';
import { absoluteAssetUrl } from '../utils/publicUrl.js';
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

export { hashToken, statusToken };

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const DETAIL_INCLUDE = {
  contact: { select: { id: true, organizationId: true, email: true, firstName: true, lastName: true, accountCreatedAt: true, stripeCustomerId: true } },
  profile: { include: { images: { include: { image: { include: { file: true } } }, orderBy: { displayOrder: 'asc' } } } },
  tier: true,
  form: { select: { id: true, name: true, slug: true, kind: true, chargeTiming: true, feeMode: true, taxable: true, paymentDueDays: true, overduePolicy: true } },
  event: {
    select: {
      id: true,
      name: true,
      date: true,
      taxRate: true,
      venue: { select: { organizationId: true, organization: { select: { id: true, name: true, logoUrl: true, taxInclusivePricing: true, statementDescriptorSuffix: true, enabledPaymentMethods: true } } } },
    },
  },
  answers: { include: { question: true, image: { include: { file: true } } } },
  addOns: { include: { addOn: true }, orderBy: { addOn: { displayOrder: 'asc' } } },
  decisions: { orderBy: { createdAt: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
};

/** Statuses in which the organizer may still change add-on lines (no money has moved). */
function addOnsEditable(application) {
  if (application.form?.kind !== 'PAID' || !application.tierId) return { allowed: false, reason: 'This form has no add-ons' };
  if (['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(application.paymentStatus)) return { allowed: false, reason: 'Already paid — refund part of the amount instead' };
  if (application.paymentStatus === 'PROCESSING') return { allowed: false, reason: 'A payment is in progress' };
  if (['SUBMITTED', 'WAITLISTED'].includes(application.status)) return { allowed: true, reason: null };
  if (application.status === 'APPROVED' && application.paymentStatus === 'PAYMENT_DUE') return { allowed: true, reason: null };
  if (application.status === 'APPROVED') return { allowed: false, reason: 'Approved — the amount is locked once the charge starts' };
  return { allowed: false, reason: `Cannot change add-ons on a ${application.status.toLowerCase()} application` };
}

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

    // Add-ons (spec 012): validated against the tier's offer; nothing is held until approval.
    if (!tier && Array.isArray(body.addOns) && body.addOns.length > 0) throw new ValidationError('This form has no add-ons');
    const addOnLines = tier ? await addOnService.validateApplicationLines(eventId, body.addOns, tier.id) : [];
    const amounts = tier ? applicationAmounts(applicationLines(tier, form, addOnLines), form, event, event.venue.organization) : null;

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
      if (dup && dup.status !== 'DRAFT') throw new ConflictError('You already have an application on this form', { applicationId: dup.id, status: dup.status });
      // An abandoned checkout (DRAFT) is replaced by the new submission.
      if (dup) await tx.application.delete({ where: { id: dup.id } });

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
      const created = await tx.application.create({
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
          statusTokenHash: `pending-${Date.now()}-${Math.random()}`,
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
          addOns: { create: this._addOnRows(addOnLines, amounts) },
        },
        select: { id: true },
      });
      // The status token is derived from the id (applicationLinks.js); store its hash.
      return tx.application.update({ where: { id: created.id }, data: { statusTokenHash: hashToken(statusToken(created.id)) }, include: DETAIL_INCLUDE });
    });

    const statusUrl = await statusUrlFor(application);
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
      return { applicationId: application.id, statusUrl, next: 'done' };
    }

    // PAID: the applicant continues to Stripe Checkout (card on file, or pay
    // now). A Stripe failure leaves the DRAFT resumable from the status page.
    let checkoutUrl = null;
    try {
      checkoutUrl = await applicationPaymentService.checkoutForSubmission(application, statusUrl);
    } catch (error) {
      logger.error('Application checkout session failed', { applicationId: application.id, error: error.message });
    }
    return { applicationId: application.id, statusUrl, next: 'checkout', checkoutUrl };
  }

  /** Guest status page: token must match; returns the applicant-facing view. */
  async statusView(applicationId, rawToken) {
    const application = await this._requireByToken(applicationId, rawToken);
    return this._serializeApplicant(application);
  }

  /** Guest: a fresh Checkout URL for an unfinished (DRAFT) paid application. */
  async resumeCheckout(applicationId, rawToken) {
    const application = await this._requireByToken(applicationId, rawToken);
    if (application.status !== 'DRAFT') throw new ConflictError('This application has already been submitted');
    if (!paymentsEnabled()) throw new ConflictError('Paid applications are not available yet');
    const statusUrl = await statusUrlFor(application);
    return { url: await applicationPaymentService.checkoutForSubmission(application, statusUrl) };
  }

  /** Guest: pay an outstanding balance (APPROVED + PAYMENT_DUE). */
  async payNow(applicationId, rawToken) {
    const application = await this._requireByToken(applicationId, rawToken);
    return { url: await applicationPaymentService.payNowUrl(application, await statusUrlFor(application)) };
  }

  async statusUrl(application) {
    return statusUrlFor(application);
  }

  async _requireByToken(applicationId, rawToken) {
    if (!rawToken) throw new ForbiddenError('Missing token');
    const application = await prisma.application.findUnique({ where: { id: applicationId }, include: DETAIL_INCLUDE });
    if (!application || !verifyStatusToken(applicationId, rawToken)) throw new NotFoundError('Application not found');
    const ageDays = (Date.now() - application.createdAt.getTime()) / 86_400_000;
    if (ageDays > STATUS_TOKEN_TTL_DAYS) throw new ForbiddenError('This link has expired; sign in to see your application');
    return application;
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

  /** Buyer: pay-now Checkout URL for an outstanding balance. */
  async payNowForContact(organizationId, contactId, applicationId) {
    const application = await prisma.application.findFirst({ where: { id: applicationId, organizationId, contactId }, include: DETAIL_INCLUDE });
    if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
    return { url: await applicationPaymentService.payNowUrl(application, await statusUrlFor(application)) };
  }

  /** Buyer: replace the card on file (setup-mode Checkout). */
  async updateCardForContact(organizationId, contactId, applicationId) {
    const application = await prisma.application.findFirst({ where: { id: applicationId, organizationId, contactId }, include: DETAIL_INCLUDE });
    if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
    return { url: await applicationPaymentService.updateCardUrl(application, await statusUrlFor(application)) };
  }

  /** Applicants may withdraw while the organizer has not decided. */
  async withdrawByApplicant(organizationId, contactId, applicationId) {
    const application = await prisma.application.findFirst({ where: { id: applicationId, organizationId, contactId }, include: DETAIL_INCLUDE });
    if (!application) throw new NotFoundError('Application not found');
    if (!['SUBMITTED', 'WAITLISTED'].includes(application.status)) {
      throw new ConflictError('Only submitted or waitlisted applications can be withdrawn; contact the organizer otherwise');
    }
    if (application.paymentStatus === 'PROCESSING') throw new ConflictError('A payment is in progress; try again in a moment');
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
          addOns: { include: { addOn: { select: { id: true, name: true, displayOrder: true } } }, orderBy: { addOn: { displayOrder: 'asc' } } },
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
   * atomically; a full tier returns 409 with a Waitlist suggestion. Approving
   * a card-on-file application reserves the slot, then charges the saved card
   * off-session (phase 2): PAID confirms the slot, a decline leaves the
   * application APPROVED + PAYMENT_DUE with a pay-now link.
   *
   * @param {{ decision: 'APPROVE'|'REJECT'|'WAITLIST'|'WITHDRAW', note?: string, message?: { subject: string, body: string }|null, sendEmail?: boolean, byUserId: string }} input
   */
  async decide(eventId, applicationId, organizationId, input) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const spec = DECISIONS[input.decision];
    if (!spec) throw new ValidationError('decision must be APPROVE, REJECT, WAITLIST or WITHDRAW');
    const note = input.note ? String(input.note).slice(0, 5000) : null;
    const override = this._validateMessage(input.message);

    const { updated, charge } = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`SELECT * FROM "Application" WHERE "id" = ${applicationId} AND "eventId" = ${eventId} FOR UPDATE`;
      const application = rows[0];
      if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
      if (!spec.from.includes(application.status)) {
        throw new ConflictError(`Cannot ${input.decision.toLowerCase()} an application that is ${application.status.toLowerCase()}`);
      }
      if (application.paymentStatus === 'PROCESSING') throw new ConflictError('A payment is in progress for this application; try again in a moment');

      const data = { status: spec.to, decidedAt: new Date(), decidedById: input.byUserId };
      let chargeNow = false;
      if (spec.to === 'APPROVED') {
        if (application.paymentStatus === 'AWAITING_CARD') throw new ConflictError('The applicant has not saved a card yet');
        if (application.paymentStatus === 'CARD_ON_FILE') {
          if (!paymentsEnabled()) throw new ConflictError('Application payments are not enabled');
          // Hold the slot while the charge is in flight; PAID moves it to approved.
          if (application.tierId) {
            await this._takeCapacity(tx, application, 'RESERVED');
            data.capacitySlot = 'RESERVED';
          }
          data.paymentStatus = 'PROCESSING';
          data.chargeAttempts = application.chargeAttempts + 1;
          chargeNow = true;
        } else if (application.tierId) {
          await this._takeCapacity(tx, application, 'APPROVED');
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

      const row = await tx.application.update({
        where: { id: applicationId },
        data: { ...data, decisions: { create: { action: spec.action, byUserId: input.byUserId, note } } },
        include: DETAIL_INCLUDE,
      });
      return { updated: row, charge: chargeNow };
    });

    logger.info('Application decided', {
      event: 'application_decided',
      applicationId,
      eventId,
      action: spec.action,
      byUserId: input.byUserId,
    });

    let action = spec.action;
    let payNowUrl = null;
    if (charge) {
      const outcome = await applicationPaymentService.chargeOnApproval(applicationId);
      if (outcome === 'PAYMENT_DUE') {
        action = 'PAYMENT_DUE';
        payNowUrl = await statusUrlFor(updated);
      } else if (outcome === 'PROCESSING') {
        // Card charge still settling: the webhook sends the approval email.
        action = null;
      }
    }

    if (input.sendEmail !== false && action) {
      const current = action === spec.action ? updated : await prisma.application.findUnique({ where: { id: applicationId }, include: DETAIL_INCLUDE });
      const statusUrl = await statusUrlFor(current);
      const sent = await applicationTemplateService.send(organizationId, action, { ...current, statusUrl }, { override: action === spec.action ? override : null, payNowUrl: payNowUrl || statusUrl });
      if (sent) {
        const decision = updated.decisions[updated.decisions.length - 1];
        await prisma.applicationDecision.update({ where: { id: decision.id }, data: { emailSubject: sent.subject, emailBody: sent.body } }).catch(() => {});
      }
    }
    return this.get(eventId, applicationId, organizationId);
  }

  /**
   * Organizer: retry the saved card for an APPROVED + PAYMENT_DUE application
   * (after the applicant updated their card, for example).
   */
  async retryCharge(eventId, applicationId, organizationId) {
    await applicationFormService.requireEvent(eventId, organizationId);
    if (!paymentsEnabled()) throw new ConflictError('Application payments are not enabled');
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`SELECT * FROM "Application" WHERE "id" = ${applicationId} AND "eventId" = ${eventId} FOR UPDATE`;
      const application = rows[0];
      if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
      if (application.status !== 'APPROVED' || application.paymentStatus !== 'PAYMENT_DUE') throw new ConflictError('Only approved applications with a payment due can be charged');
      if (!application.stripePaymentMethodId) throw new ConflictError('No card on file; ask the applicant to pay from their status page');
      await tx.application.update({ where: { id: applicationId }, data: { paymentStatus: 'PROCESSING', chargeAttempts: application.chargeAttempts + 1 } });
    });
    const outcome = await applicationPaymentService.chargeOnApproval(applicationId);
    if (outcome === 'PAID') {
      const current = await prisma.application.findUnique({ where: { id: applicationId }, include: DETAIL_INCLUDE });
      await applicationTemplateService.send(organizationId, 'APPROVED', { ...current, statusUrl: await statusUrlFor(current) });
    }
    return this.get(eventId, applicationId, organizationId);
  }

  /** Organizer (ADMIN): refund a paid application, partially or in full. */
  async refund(eventId, applicationId, organizationId, { amount = null, reason = null, initiatedBy = null } = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const application = await prisma.application.findFirst({ where: { id: applicationId, eventId }, include: DETAIL_INCLUDE });
    if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
    if (reason !== null && reason !== undefined && (typeof reason !== 'string' || reason.length > 500)) throw new ValidationError('reason must be 500 characters or fewer');
    await applicationPaymentService.refund(application, { amount, reason: reason ? reason.trim() || null : null, initiatedBy });
    return this.get(eventId, applicationId, organizationId);
  }

  /**
   * Organizer (ORGANIZER+): replace the add-on lines before any money moves
   * (spec 012 §2.5). Allowed in SUBMITTED, WAITLISTED, and APPROVED +
   * PAYMENT_DUE. The snapshot is recomputed at today's prices (tier included,
   * so a price-changed note clears), reservations held for a PAYMENT_DUE
   * application move to the new lines, an open pay-now session is expired so
   * the next one carries the new amount, and the applicant is emailed the new
   * total (template ADD_ONS_CHANGED).
   *
   * @param {Array<{ addOnId: string, quantity: number }>} lines the full desired set (empty removes all)
   */
  async updateAddOns(eventId, applicationId, organizationId, lines, { byUserId, sendEmail = true } = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    if (!Array.isArray(lines)) throw new ValidationError('addOns must be an array of { addOnId, quantity }');

    const { updated, before, after, sessionId } = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${applicationId} AND "eventId" = ${eventId} FOR UPDATE`;
      if (!locked[0]) throw new NotFoundError('Application not found');
      const application = await tx.application.findUnique({ where: { id: applicationId }, include: DETAIL_INCLUDE });
      if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
      const editable = addOnsEditable(application);
      if (!editable.allowed) throw new ConflictError(editable.reason);

      const validated = await addOnService.validateApplicationLines(eventId, lines, application.tierId);
      const oldLines = application.addOns.map((r) => ({ addOn: r.addOn, addOnId: r.addOnId, quantity: r.quantity }));
      const unchanged =
        validated.length === oldLines.length && validated.every((l) => oldLines.some((o) => o.addOnId === l.addOn.id && o.quantity === l.quantity));
      if (unchanged) throw new ValidationError('Nothing changed');

      // A PAYMENT_DUE application holds its lines: move the hold to the new set (409 if one is sold out).
      if (application.capacitySlot === 'RESERVED') {
        if (oldLines.length) await addOnService.release(tx, oldLines);
        if (validated.length) await addOnService.reserve(tx, validated);
      }

      const amounts = applicationAmounts(applicationLines(application.tier, application.form, validated), application.form, application.event, application.event.venue.organization);
      const beforeText = addOnService.summarizeLines(application.addOns) || 'none';
      const afterText = addOnService.summarizeLines(validated.map((l) => ({ addOn: l.addOn, quantity: l.quantity }))) || 'none';
      const note = `Add-ons: ${beforeText} → ${afterText}. Total $${Number(application.applicantPays).toFixed(2)} → $${amounts.applicantPays.toFixed(2)}.`;

      await tx.applicationAddOn.deleteMany({ where: { applicationId } });
      const row = await tx.application.update({
        where: { id: applicationId },
        data: {
          subtotal: amounts.subtotal,
          platformFee: amounts.platformFee,
          processingFee: amounts.processingFee,
          tax: amounts.tax,
          applicantPays: amounts.applicantPays,
          orgReceives: amounts.orgReceives,
          feeMode: amounts.feeMode,
          addOns: { create: this._addOnRows(validated, amounts) },
          decisions: { create: { action: 'ADD_ONS_CHANGED', byUserId, note } },
        },
        include: DETAIL_INCLUDE,
      });
      return { updated: row, before: beforeText, after: afterText, sessionId: application.stripeCheckoutSessionId };
    });

    logger.info('Application add-ons changed', { event: 'application_add_ons_changed', applicationId, eventId, byUserId, before, after, applicantPays: Number(updated.applicantPays) });

    // A pending pay-now session carries the old amount; expire it so the status page mints a fresh one.
    if (sessionId && updated.status === 'APPROVED' && updated.paymentStatus === 'PAYMENT_DUE') {
      await applicationPaymentService.expireSession(updated, sessionId);
    }

    if (sendEmail !== false) {
      const statusUrl = await statusUrlFor(updated);
      const sent = await applicationTemplateService.send(organizationId, 'ADD_ONS_CHANGED', { ...updated, statusUrl }, { payNowUrl: statusUrl });
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
        profile: { select: { businessName: true, website: true, description: true, socials: true, images: { include: { image: { include: { file: true } } }, orderBy: { displayOrder: 'asc' } } } },
        tier: { select: { name: true } },
        form: { select: { name: true, kind: true } },
        answers: { include: { question: { select: { id: true, label: true, type: true } }, image: { include: { file: true } } } },
        addOns: { include: { addOn: { select: { id: true, name: true, displayOrder: true } } } },
      },
      orderBy: this._listOrder(query.sort),
    });
    const questions = new Map();
    for (const a of rows) for (const ans of a.answers) if (!questions.has(ans.question.id)) questions.set(ans.question.id, ans.question);
    const qList = [...questions.values()];
    // One column per add-on that is active for applications or appears on any row (spec 012).
    const addOns = new Map();
    const active = await prisma.addOn.findMany({ where: { eventId, isActive: true, scope: { in: ['APPLICATION', 'BOTH'] } }, select: { id: true, name: true, displayOrder: true } });
    for (const ad of active) addOns.set(ad.id, ad);
    for (const a of rows) for (const l of a.addOns) if (!addOns.has(l.addOn.id)) addOns.set(l.addOn.id, l.addOn);
    const addOnList = [...addOns.values()].sort((x, y) => x.displayOrder - y.displayOrder);
    const header = [
      'applicationId', 'form', 'status', 'paymentStatus', 'submittedAt', 'decidedAt', 'tier', 'businessName', 'firstName', 'lastName', 'email',
      'website', 'description', 'socials', 'profilePhotos', 'applicantPays', 'orgReceives', 'boothLabel', 'internalNote', 'stripePaymentIntentId',
      ...addOnList.map((ad) => `addon:${ad.name}`),
      ...qList.map((q) => q.label),
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const a of rows) {
      const byQ = new Map(a.answers.map((ans) => [ans.question.id, ans]));
      const byAddOn = new Map(a.addOns.map((l) => [l.addOnId, l.quantity]));
      const cells = [
        a.id, a.form.name, a.status, a.paymentStatus, a.submittedAt?.toISOString() ?? '', a.decidedAt?.toISOString() ?? '', a.tier?.name ?? '',
        a.profile.businessName, a.contact.firstName, a.contact.lastName, a.contact.email, a.profile.website ?? '', a.profile.description ?? '',
        a.profile.socials ? Object.entries(a.profile.socials).map(([k, v]) => `${k}: ${v}`).join('; ') : '',
        (a.profile.images || []).map((pi) => absoluteAssetUrl(imageService.formatImageResponse(pi.image).urls.original)).join('; '),
        Number(a.applicantPays).toFixed(2), Number(a.orgReceives).toFixed(2), a.boothLabel ?? '', a.internalNote ?? '', a.stripePaymentIntentId ?? '',
        ...addOnList.map((ad) => byAddOn.get(ad.id) ?? ''),
        ...qList.map((q) => this._answerText(byQ.get(q.id))),
      ];
      lines.push(cells.map(csvCell).join(','));
    }
    return lines.join('\r\n');
  }

  // ---------------------------------------------------------------------------
  // Capacity
  // ---------------------------------------------------------------------------

  /** Add-on lines of an application in lock order, shaped for AddOnService.reserve / release / commit. */
  async _addOnLines(tx, applicationId) {
    const rows = await tx.applicationAddOn.findMany({ where: { applicationId }, include: { addOn: true }, orderBy: { addOn: { displayOrder: 'asc' } } });
    return rows.map((r) => ({ addOn: r.addOn, addOnId: r.addOnId, quantity: r.quantity }));
  }

  /**
   * Take the tier slot, then hold every add-on line (spec 012) in display
   * order. A sold-out add-on throws 409 naming it; the transaction rolls the
   * tier slot back. APPROVED (no charge to wait for) moves add-ons straight
   * to sold.
   */
  async _takeCapacity(tx, application, slot) {
    const column = slot === 'APPROVED' ? 'quantityApproved' : 'quantityReserved';
    const rows = await tx.$queryRawUnsafe(
      `UPDATE "ApplicationTier" SET "${column}" = "${column}" + 1
       WHERE "id" = $1 AND ("quantityTotal" - "quantityApproved" - "quantityReserved") >= 1
       RETURNING "id"`,
      application.tierId
    );
    if (!rows || rows.length === 0) {
      throw new ConflictError('This tier is full. Waitlist the application or raise the tier quantity.', { tierId: application.tierId, suggestion: 'WAITLIST' });
    }
    const lines = await this._addOnLines(tx, application.id);
    if (lines.length === 0) return;
    try {
      await addOnService.reserve(tx, lines);
    } catch (error) {
      if (error instanceof ConflictError && error.details?.addOnId) {
        const { name, remaining, requested } = error.details;
        throw new ConflictError(`${name} is sold out: ${requested} requested, ${remaining} left. Raise its quantity or edit this application's add-ons.`, { ...error.details, suggestion: 'EDIT_ADD_ONS' });
      }
      throw error;
    }
    if (slot === 'APPROVED') await addOnService.commit(tx, lines);
  }

  async _releaseCapacity(tx, application) {
    if (!application.tierId || application.capacitySlot === 'NONE') return;
    const column = application.capacitySlot === 'APPROVED' ? 'quantityApproved' : 'quantityReserved';
    await tx.$executeRawUnsafe(`UPDATE "ApplicationTier" SET "${column}" = GREATEST("${column}" - 1, 0) WHERE "id" = $1`, application.tierId);
    const lines = await this._addOnLines(tx, application.id);
    if (lines.length === 0) return;
    if (application.capacitySlot === 'APPROVED') await addOnService.unsell(tx, lines);
    else await addOnService.release(tx, lines);
  }

  /** ApplicationAddOn rows for a validated line set and its amount snapshot. */
  _addOnRows(addOnLines, amounts) {
    // amounts.lines[0] is the tier; add-ons follow in the same order.
    return addOnLines.map((l, i) => ({
      addOnId: l.addOn.id,
      quantity: l.quantity,
      unitPrice: Number(l.addOn.price),
      applicantPays: amounts.lines[i + 1].applicantPays,
    }));
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
    if (query.addOn) where.addOns = { some: { addOnId: String(query.addOn) } };
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
    if (answer.imageId) return answer.image ? absoluteAssetUrl(imageService.formatImageResponse(answer.image).urls.original) : answer.imageId;
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

  /**
   * What the tier would cost if the applicant applied today versus the
   * snapshot taken at submission. The snapshot is the only amount ever
   * charged; this lets the organizer see the delta after a price, fee-mode
   * or tax edit (spec 011 phase 3).
   */
  _pricing(a) {
    if (!a.tier || a.form?.kind !== 'PAID') return null;
    const lines = (a.addOns || []).map((l) => ({ addOn: l.addOn, quantity: l.quantity }));
    const now = applicationAmounts(applicationLines(a.tier, a.form, lines), a.form, a.event, a.event?.venue?.organization);
    const snapshot = Number(a.applicantPays);
    return {
      currentApplicantPays: now.applicantPays,
      currentOrgReceives: now.orgReceives,
      changed: Math.abs(now.applicantPays - snapshot) >= 0.005,
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
      addOns: (a.addOns || []).map((l) => ({ addOnId: l.addOnId, name: l.addOn?.name ?? null, quantity: l.quantity })),
      submittedAt: a.submittedAt,
      decidedAt: a.decidedAt,
      paymentDueAt: a.paymentDueAt,
      overdue: a.overdue,
      boothLabel: a.boothLabel,
    };
  }

  _contact(c) {
    return c ? { id: c.id, email: c.email, firstName: c.firstName, lastName: c.lastName, accountCreatedAt: c.accountCreatedAt } : null;
  }

  _refundedTotal(a) {
    return (a.refunds || []).filter((r) => r.status === 'SUCCEEDED').reduce((sum, r) => sum + Number(r.amount), 0);
  }

  _serializeAdmin(a) {
    const refunded = this._refundedTotal(a);
    return {
      id: a.id,
      form: a.form,
      event: { id: a.event.id, name: a.event.name, date: a.event.date },
      status: a.status,
      paymentStatus: a.paymentStatus,
      capacitySlot: a.capacitySlot,
      contact: this._contact(a.contact),
      profile: applicantProfileService.serialize(a.profile),
      tier: a.tier ? { id: a.tier.id, name: a.tier.name, price: Number(a.tier.price) } : null,
      amounts: this._amounts(a),
      pricing: this._pricing(a),
      addOns: (a.addOns || []).map((l) => addOnService.serializeApplicationLine(l)),
      addOnsEditable: addOnsEditable(a),
      payment: {
        stripePaymentIntentId: a.stripePaymentIntentId,
        stripePaymentMethodId: a.stripePaymentMethodId ? 'on_file' : null,
        stripeAccountId: a.stripeAccountId,
        applicationFee: a.applicationFee == null ? null : Number(a.applicationFee),
        chargeAttempts: a.chargeAttempts,
        paidAt: a.paidAt,
        paymentDueAt: a.paymentDueAt,
        overdue: a.overdue,
        refundedTotal: refunded,
        refundable: Math.max(0, Math.round((Number(a.applicantPays) - refunded) * 100) / 100),
        stripeDashboardUrl: applicationPaymentService.dashboardPaymentUrl(a.stripePaymentIntentId),
        canRefund: ['PAID', 'PARTIALLY_REFUNDED'].includes(a.paymentStatus) && Boolean(a.stripePaymentIntentId),
        canRetryCharge: a.status === 'APPROVED' && a.paymentStatus === 'PAYMENT_DUE' && Boolean(a.stripePaymentMethodId),
      },
      answers: this._serializeAnswers(a),
      decisions: (a.decisions || []).map((d) => ({ id: d.id, action: d.action, byUserId: d.byUserId, note: d.note, emailSubject: d.emailSubject, emailBody: d.emailBody, createdAt: d.createdAt })),
      refunds: (a.refunds || []).map((r) => ({ id: r.id, amount: Number(r.amount), status: r.status, reason: r.reason, stripeRefundId: r.stripeRefundId, initiatedBy: r.initiatedBy, createdAt: r.createdAt })),
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
      addOns: (a.addOns || []).map((l) => addOnService.serializeApplicationLine(l)),
      paymentDueAt: a.paymentDueAt,
      profile: applicantProfileService.serialize(a.profile),
      answers: this._serializeAnswers(a).filter((ans) => !ans.archived),
      boothLabel: a.boothLabel,
      submittedAt: a.submittedAt,
      decidedAt: a.decidedAt,
      paidAt: a.paidAt,
      refundedTotal: this._refundedTotal(a),
      canWithdraw: ['SUBMITTED', 'WAITLISTED'].includes(a.status) && a.paymentStatus !== 'PROCESSING',
      canResume: a.status === 'DRAFT' && a.form.kind === 'PAID',
      canPay: a.status === 'APPROVED' && a.paymentStatus === 'PAYMENT_DUE',
      canUpdateCard: ['SUBMITTED', 'WAITLISTED', 'APPROVED'].includes(a.status) && ['CARD_ON_FILE', 'PAYMENT_DUE'].includes(a.paymentStatus),
    };
  }
}

export default new ApplicationService();
