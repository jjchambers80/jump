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
import {
  LIST_PAGE_SIZE,
  MAX_ANSWER_LENGTH,
  MAX_PROFILE_PHOTOS,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  STATUS_TOKEN_TTL_DAYS,
} from '../config/applications.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../middleware/errorHandler.js';
import applicationFormService, { paymentsEnabled } from './ApplicationFormService.js';
import addOnService from './AddOnService.js';
import applicantProfileService from './ApplicantProfileService.js';
import applicationTemplateService from './ApplicationTemplateService.js';
import applicationPaymentService from './ApplicationPaymentService.js';
import orderService from './OrderService.js';
import orderLineService, { ORDER_INCLUDE, adjustmentItems } from './OrderLineService.js';
import refundService from './RefundService.js';
import { moneyOf } from './applicationMoney.js';
import { orderStatusFor } from './applicationOrderStatus.js';
import {
  hashToken,
  statusToken,
  statusUrlFor,
  statusUrlWithBase,
  verifyStatusToken,
} from './applicationLinks.js';
import imageService from './ImageService.js';
import { absoluteAssetUrl } from '../utils/publicUrl.js';
import { storefrontFor } from '../utils/storefrontUrl.js';
import logger from '../utils/logger.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const ACTIVE_STATUSES = ['DRAFT', 'SUBMITTED', 'WAITLISTED', 'APPROVED'];
const STATUSES = new Set(['DRAFT', 'SUBMITTED', 'WAITLISTED', 'APPROVED', 'REJECTED', 'WITHDRAWN']);
const PAYMENT_STATUSES = new Set(['NOT_REQUIRED', 'AWAITING_CARD', 'CARD_ON_FILE', 'PROCESSING', 'PAID', 'PAYMENT_DUE', 'REFUNDED', 'PARTIALLY_REFUNDED']);
/** A search term that could be the tail of an application id (cuids are lowercase). */
const ID_FRAGMENT_RE = /^[a-z0-9]{6,25}$/;
/** Org-wide CSV cap (spec 019): beyond this the caller narrows the filter. */
const EXPORT_MAX_ROWS = 10_000;
/** Per-row list include, shared by the per-event and organization-wide lists (spec 019). */
const LIST_INCLUDE = {
  contact: { select: { email: true, firstName: true, lastName: true } },
  profile: { select: { businessName: true, images: { take: 1, orderBy: { displayOrder: 'asc' }, include: { image: { include: { file: true } } } } } },
  tier: { select: { id: true, name: true } },
  form: { select: { id: true, name: true, kind: true } },
  event: {
    select: {
      id: true,
      name: true,
      date: true,
      venue: { select: { organization: { select: { id: true, name: true } } } },
    },
  },
  // Spec 024: money and add-on lines come from the order.
  order: {
    select: {
      id: true,
      orderRef: true,
      status: true,
      totalAmount: true,
      dueAt: true,
      paidAt: true,
      feeMode: true,
      addOns: {
        include: { addOn: { select: { id: true, name: true, displayOrder: true } } },
        orderBy: { addOn: { displayOrder: 'asc' } },
      },
    },
  },
  // Pinned answer columns (spec 019 follow-up): only answers to pinned, live questions.
  answers: {
    where: { question: { pinned: true, archivedAt: null } },
    include: { question: { select: { id: true, label: true, type: true, displayOrder: true } }, image: { include: { file: true } } },
    orderBy: { question: { displayOrder: 'asc' } },
  },
};

/** Organizer decisions: which statuses they leave from and land on. */
export const DECISIONS = {
  APPROVE: { from: ['SUBMITTED', 'WAITLISTED'], to: 'APPROVED', action: 'APPROVED' },
  REJECT: { from: ['SUBMITTED', 'WAITLISTED'], to: 'REJECTED', action: 'REJECTED' },
  WAITLIST: { from: ['SUBMITTED'], to: 'WAITLISTED', action: 'WAITLISTED' },
  WITHDRAW: { from: ['SUBMITTED', 'WAITLISTED', 'APPROVED'], to: 'WITHDRAWN', action: 'WITHDRAWN' },
};

export { hashToken, statusToken };

/** The tail of the id shown on list rows and searchable as `q` (spec 019). */
export function shortId(id) {
  return String(id).slice(-8).toUpperCase();
}

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
  decisions: { orderBy: { createdAt: 'asc' } },
  // Spec 024: lines, payment and refunds live on the order.
  order: { include: ORDER_INCLUDE },
};

const OFFLINE_METHODS = new Set(['CHEQUE', 'CASH', 'BANK_TRANSFER', 'COMPED', 'OTHER']);
const OFFLINE_METHOD_LABEL = { CHEQUE: 'Cheque', CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', COMPED: 'Comped', OTHER: 'Other' };
const money = (n) => `$${Number(n).toFixed(2)}`;

/**
 * Statuses in which the organizer may still change what the applicant owes
 * — add-on lines (spec 012), tier and adjustments (spec 018): no money has
 * moved. One rule: money that has moved is only ever refunded, never
 * re-priced.
 */
function amountEditable(application, what = 'the amount') {
  if (application.form?.kind !== 'PAID' || !application.tierId)
    return { allowed: false, reason: 'This form has no amount to change' };
  if (
    moneyOf(application).paymentSource === 'OFFLINE' ||
    application.paymentStatus === 'NOT_REQUIRED'
  )
    return { allowed: false, reason: 'Settled outside Stripe — the amount is final' };
  if (['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(application.paymentStatus))
    return { allowed: false, reason: 'Already paid — refund part of the amount instead' };
  if (application.paymentStatus === 'PROCESSING')
    return { allowed: false, reason: 'A payment is in progress' };
  if (['SUBMITTED', 'WAITLISTED'].includes(application.status))
    return { allowed: true, reason: null };
  if (application.status === 'APPROVED' && application.paymentStatus === 'PAYMENT_DUE')
    return { allowed: true, reason: null };
  if (application.status === 'APPROVED')
    return { allowed: false, reason: 'Approved — the amount is locked once the charge starts' };
  return {
    allowed: false,
    reason: `Cannot change ${what} on a ${application.status.toLowerCase()} application`,
  };
}

/** Statuses in which the organizer may still change add-on lines (no money has moved). */
function addOnsEditable(application) {
  if (application.form?.kind !== 'PAID' || !application.tierId) return { allowed: false, reason: 'This form has no add-ons' };
  return amountEditable(application, 'add-ons');
}

/** A pay-now Checkout session minted for the old amount (only APPROVED + PAYMENT_DUE rows hold one). */
function pendingPayNowSession(application) {
  return application.status === 'APPROVED' && application.paymentStatus === 'PAYMENT_DUE' ? application.stripeCheckoutSessionId : null;
}

/** ADMIN may settle an APPROVED + PAYMENT_DUE application outside Stripe. */
function canSettleOffline(application) {
  return (
    application.form?.kind === 'PAID' &&
    application.status === 'APPROVED' &&
    application.paymentStatus === 'PAYMENT_DUE' &&
    moneyOf(application).paymentSource !== 'OFFLINE'
  );
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
    if (!tier && Array.isArray(body.addOns) && body.addOns.length > 0)
      throw new ValidationError('This form has no add-ons');
    const addOnLines = tier
      ? await addOnService.validateApplicationLines(eventId, body.addOns, tier.id)
      : [];
    // Spec 024: the amount snapshot is the application's order (PAID forms only).
    const orderData = tier
      ? orderLineService.applicationOrderData(
          tier,
          form,
          addOnLines,
          [],
          event,
          event.venue.organization
        )
      : null;

    const application = await prisma.$transaction(async (tx) => {
      const contactRecord = await tx.contact.upsert({
        where: { organizationId_email: { organizationId, email: contact.email } },
        update: { firstName: contact.firstName, lastName: contact.lastName, ...(body.optInMarketing === true && { emailSubscribed: true }) },
        create: { organizationId, email: contact.email, firstName: contact.firstName, lastName: contact.lastName, emailSubscribed: body.optInMarketing === true },
      });

      const dup = await tx.application.findFirst({
        where: { formId: form.id, contactId: contactRecord.id, status: { in: ACTIVE_STATUSES } },
        select: { id: true, status: true, paymentStatus: true },
      });
      if (dup && dup.status !== 'DRAFT')
        throw new ConflictError('You already have an application on this form', {
          applicationId: dup.id,
          status: dup.status,
        });
      // An abandoned checkout (DRAFT) is replaced by the new submission: it is
      // withdrawn, never deleted, so its order stays in the ledger as CANCELLED.
      if (dup) {
        await this._transition(
          tx,
          dup.id,
          {
            status: 'WITHDRAWN',
            withdrawnBy: 'SYSTEM',
            withdrawReason: 'replaced',
            decidedAt: new Date(),
          },
          { include: null }
        );
      }

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
          answers: { create: answerRows },
        },
        select: { id: true, eventId: true, contactId: true },
      });
      if (orderData)
        await orderService.createApplicationOrder(tx, { application: created, data: orderData });
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

    const orderRef = application.order?.orderRef ?? null;
    if (application.status === 'SUBMITTED') {
      // send() never throws; a failed email is logged and must not fail the submission.
      await applicationTemplateService.send(organizationId, 'RECEIVED', {
        ...application,
        statusUrl,
      });
      return { applicationId: application.id, orderRef, statusUrl, next: 'done' };
    }

    // PAID: the applicant continues to Stripe Checkout (card on file, or pay
    // now). A Stripe failure leaves the DRAFT resumable from the status page.
    let checkoutUrl = null;
    try {
      checkoutUrl = await applicationPaymentService.checkoutForSubmission(application, statusUrl);
    } catch (error) {
      logger.error('Application checkout session failed', { applicationId: application.id, error: error.message });
    }
    return { applicationId: application.id, orderRef, statusUrl, next: 'checkout', checkoutUrl };
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
      return this._transition(tx, application.id, {
        status: 'WITHDRAWN',
        withdrawnBy: 'APPLICANT',
        decidedAt: new Date(),
        capacitySlot: 'NONE',
        decisions: {
          create: { action: 'WITHDRAWN', byUserId: null, note: 'Withdrawn by applicant' },
        },
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
    return this.listInScope({ eventId, organizationId }, query);
  }

  async summary(eventId, organizationId) {
    await applicationFormService.requireEvent(eventId, organizationId);
    return this.summaryInScope({ eventId, organizationId });
  }

  /**
   * Submissions in a scope (spec 019). `scope.eventId` for the per-event tab,
   * `scope.organizationId` for members; both null = SYSTEM_ADMIN across all
   * organizations, in which case rows carry `organization`.
   */
  async listInScope(scope, query = {}) {
    const where = await this._scopedWhere(scope, query);
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(query.pageSize, 10) || LIST_PAGE_SIZE));
    const orderBy = this._listOrder(query.sort);
    const [rows, total, summary] = await Promise.all([
      prisma.application.findMany({ where, include: LIST_INCLUDE, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.application.count({ where }),
      this.summaryInScope(scope),
    ]);
    const bases = await this._storefrontBases(rows);
    return {
      data: rows.map((a) => this._serializeRow(a, { unscoped: !scope.organizationId && !scope.eventId, statusBase: bases.get(a.organizationId) })),
      total,
      page,
      pageSize,
      summary,
    };
  }

  /** Status counts over the scope alone, so the chips stay stable while filtering. */
  async summaryInScope(scope) {
    const groups = await prisma.application.groupBy({ by: ['status'], where: this._scopeWhere(scope), _count: { _all: true } });
    return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  }

  /** One storefront base per organization present in the rows, for `statusUrl`. */
  async _storefrontBases(rows) {
    const ids = [...new Set(rows.map((a) => a.organizationId))];
    const bases = await Promise.all(ids.map((id) => storefrontFor(id).then((s) => s.base)));
    return new Map(ids.map((id, i) => [id, bases[i]]));
  }

  _scopeWhere({ eventId = null, organizationId = null }) {
    const where = { status: { not: 'DRAFT' } };
    if (eventId) where.eventId = eventId;
    if (organizationId) where.organizationId = organizationId;
    return where;
  }

  /** Scope + query filters; an `event` filter outside the scope is a 404 like `requireEvent`. */
  async _scopedWhere(scope, query) {
    const where = this._listWhere(scope, query);
    if (query.event && !scope.eventId) {
      await applicationFormService.requireEvent(String(query.event), scope.organizationId);
      where.eventId = String(query.event);
    }
    return where;
  }

  async get(eventId, applicationId, organizationId) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const application = await prisma.application.findFirst({ where: { id: applicationId, eventId }, include: DETAIL_INCLUDE });
    if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
    return this._serializeAdmin(application);
  }

  /** Kept for callers of the phase 1 name; `updateMeta` is the full version. */
  async updateNotes(eventId, applicationId, organizationId, fields) {
    return this.updateMeta(eventId, applicationId, organizationId, fields);
  }

  /**
   * Organizer-only metadata (spec 019 phase 3 generalises the notes patch):
   * `boothLabel`, `internalNote`, `tags` (trimmed, deduped case-insensitively
   * — first spelling wins — at most MAX_TAGS × MAX_TAG_LENGTH), and
   * `checkedIn` / `checkedOut` booleans that stamp or clear the timestamps.
   * Check-in is refused (409) unless the application is APPROVED.
   */
  async updateMeta(eventId, applicationId, organizationId, { boothLabel, internalNote, tags, checkedIn, checkedOut }) {
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
    if (tags !== undefined) data.tags = this._normaliseTags(tags);
    for (const [key, column] of [['checkedIn', 'checkedInAt'], ['checkedOut', 'checkedOutAt']]) {
      const value = key === 'checkedIn' ? checkedIn : checkedOut;
      if (value === undefined) continue;
      if (typeof value !== 'boolean') throw new ValidationError(`${key} must be a boolean`);
      data[column] = value;
    }
    if (Object.keys(data).length === 0) throw new ValidationError('Nothing to update');
    const existing = await prisma.application.findFirst({ where: { id: applicationId, eventId }, select: { id: true, status: true, checkedInAt: true, checkedOutAt: true } });
    if (!existing || existing.status === 'DRAFT') throw new NotFoundError('Application not found');
    const now = new Date();
    for (const column of ['checkedInAt', 'checkedOutAt']) {
      if (data[column] === undefined) continue;
      if (existing.status !== 'APPROVED') throw new ConflictError('Only approved applications can be checked in');
      // true keeps an existing stamp; false clears it.
      data[column] = data[column] ? existing[column] ?? now : null;
    }
    const application = await prisma.application.update({ where: { id: applicationId }, data, include: DETAIL_INCLUDE });
    return this._serializeAdmin(application);
  }

  _normaliseTags(tags) {
    if (!Array.isArray(tags)) throw new ValidationError('tags must be an array of strings');
    const seen = new Set();
    const out = [];
    for (const raw of tags) {
      if (typeof raw !== 'string') throw new ValidationError('tags must be an array of strings');
      const tag = raw.trim().replace(/\s+/g, ' ');
      if (!tag) continue;
      if (tag.length > MAX_TAG_LENGTH) throw new ValidationError(`tags must be ${MAX_TAG_LENGTH} characters or fewer`);
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
    if (out.length > MAX_TAGS) throw new ValidationError(`at most ${MAX_TAGS} tags`);
    return out;
  }

  /** Distinct tags used in a scope (spec 019 phase 3), for autocomplete and the filter. */
  async distinctTags({ eventId = null, organizationId = null } = {}) {
    const clauses = [`status <> 'DRAFT'`];
    const params = [];
    if (organizationId) {
      params.push(organizationId);
      clauses.push(`"organizationId" = $${params.length}`);
    }
    if (eventId) {
      params.push(eventId);
      clauses.push(`"eventId" = $${params.length}`);
    }
    const rows = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT ON (lower(tag)) tag FROM "Application", unnest(tags) AS tag WHERE ${clauses.join(' AND ')} ORDER BY lower(tag), tag`,
      ...params
    );
    return rows.map((r) => r.tag);
  }

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

      const row = await this._transition(tx, applicationId, {
        ...data,
        decisions: { create: { action: spec.action, byUserId: input.byUserId, note } },
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
      if (!application || application.status === 'DRAFT')
        throw new NotFoundError('Application not found');
      if (application.status !== 'APPROVED' || application.paymentStatus !== 'PAYMENT_DUE')
        throw new ConflictError('Only approved applications with a payment due can be charged');
      if (!application.stripePaymentMethodId)
        throw new ConflictError('No card on file; ask the applicant to pay from their status page');
      await this._transition(
        tx,
        applicationId,
        { paymentStatus: 'PROCESSING', chargeAttempts: application.chargeAttempts + 1 },
        { include: null }
      );
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
    const application = await prisma.application.findFirst({
      where: { id: applicationId, eventId },
      include: DETAIL_INCLUDE,
    });
    if (!application || application.status === 'DRAFT')
      throw new NotFoundError('Application not found');
    if (
      reason !== null &&
      reason !== undefined &&
      (typeof reason !== 'string' || reason.length > 500)
    )
      throw new ValidationError('reason must be 500 characters or fewer');
    if (!application.order) throw new ConflictError('Only paid applications can be refunded');
    // Spec 024: one refund path for every order kind. The organizer's decision
    // log records a manual refund (no Stripe call) like spec 018 did.
    const refund = await refundService.refundOrder(application.order.id, {
      amount,
      reason: reason ? reason.trim() || null : null,
      initiatedBy,
    });
    if (refund.manual) {
      await prisma.applicationDecision.create({
        data: {
          applicationId,
          action: 'MANUAL_REFUND',
          byUserId: initiatedBy,
          note: `Recorded refund of $${Number(refund.amount).toFixed(2)}${refund.reason ? `: ${refund.reason}` : ''}`,
        },
      });
    }
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

      const validated = await addOnService.validateApplicationLines(
        eventId,
        lines,
        application.tierId
      );
      const money = moneyOf(application);
      const oldLines = money.addOns.map((r) => ({
        addOn: r.addOn,
        addOnId: r.addOnId,
        quantity: r.quantity,
      }));
      const unchanged =
        validated.length === oldLines.length && validated.every((l) => oldLines.some((o) => o.addOnId === l.addOn.id && o.quantity === l.quantity));
      if (unchanged) throw new ValidationError('Nothing changed');

      // A PAYMENT_DUE application holds its lines: move the hold to the new set (409 if one is sold out).
      if (application.capacitySlot === 'RESERVED') {
        if (oldLines.length) await addOnService.release(tx, oldLines);
        if (validated.length) await addOnService.reserve(tx, validated);
      }

      const data = this._orderData(application, { addOnLines: validated });
      const beforeText = addOnService.summarizeLines(money.addOns) || 'none';
      const afterText =
        addOnService.summarizeLines(
          validated.map((l) => ({ addOn: l.addOn, quantity: l.quantity }))
        ) || 'none';
      const note = `Add-ons: ${beforeText} → ${afterText}. Total $${money.applicantPays.toFixed(2)} → $${data.amounts.applicantPays.toFixed(2)}.`;

      const row = await this._rewriteOrder(tx, application, data, {
        decisions: { create: { action: 'ADD_ONS_CHANGED', byUserId, note } },
      });
      return { updated: row, before: beforeText, after: afterText, sessionId: application.stripeCheckoutSessionId };
    });

    logger.info('Application add-ons changed', {
      event: 'application_add_ons_changed',
      applicationId,
      eventId,
      byUserId,
      before,
      after,
      applicantPays: moneyOf(updated).applicantPays,
    });

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

  // ---------------------------------------------------------------------------
  // Organizer: corrections before money moves (spec 018 phase 3)
  // ---------------------------------------------------------------------------

  /**
   * Move the application to another tier of the same form. Add-on lines the
   * new tier does not offer are dropped (named in the note); a PAYMENT_DUE
   * application's holds move to the new tier and lines inside one
   * transaction, so a full tier is a 409 that changes nothing. The snapshot
   * is recomputed at today's prices with any adjustments.
   */
  async changeTier(eventId, applicationId, organizationId, tierId, { byUserId, sendEmail = true } = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    if (typeof tierId !== 'string' || !tierId) throw new ValidationError('tierId is required');

    const { updated, note, sessionId } = await prisma.$transaction(async (tx) => {
      const application = await this._lockForEdit(tx, eventId, applicationId, 'the tier');
      if (application.tierId === tierId) throw new ValidationError('The application is already on that tier');
      const newTier = await tx.applicationTier.findFirst({ where: { id: tierId, formId: application.formId } });
      if (!newTier) throw new NotFoundError('Tier not found on this form');
      if (!newTier.isActive) throw new ValidationError(`${newTier.name} is not active`);

      // Reconcile add-on lines to the new tier's offer.
      const current = moneyOf(application);
      const addOns = await tx.addOn.findMany({
        where: { id: { in: current.addOns.map((l) => l.addOnId) } },
        include: { applicationTiers: { select: { applicationTierId: true } } },
      });
      const offered = new Set(
        addOns
          .filter((a) => a.isActive && addOnService.offeredOnApplicationTier(a, newTier.id))
          .map((a) => a.id)
      );
      const kept = current.addOns
        .filter((l) => offered.has(l.addOnId))
        .map((l) => ({ addOn: l.addOn, addOnId: l.addOnId, quantity: l.quantity }));
      const dropped = current.addOns.filter((l) => !offered.has(l.addOnId));

      // A PAYMENT_DUE application holds its slot and lines: release them, rewrite, then hold again on the new tier.
      const held = application.capacitySlot === 'RESERVED';
      if (held) await this._releaseCapacity(tx, application);

      const data = this._orderData(application, { tier: newTier, addOnLines: kept });
      const droppedText = dropped.length
        ? ` Dropped add-ons: ${addOnService.summarizeLines(dropped)}.`
        : '';
      const noteText = `Tier: ${application.tier.name} → ${newTier.name}. Total ${money(current.applicantPays)} → ${money(data.amounts.applicantPays)}.${droppedText}`;

      const row = await this._rewriteOrder(tx, application, data, {
        tierId: newTier.id,
        decisions: { create: { action: 'TIER_CHANGED', byUserId, note: noteText } },
      });
      if (held) {
        await this._takeCapacity(tx, { ...application, tierId: newTier.id }, 'RESERVED');
      }
      return { updated: row, note: noteText, sessionId: pendingPayNowSession(application) };
    });

    logger.info('Application tier changed', {
      event: 'application_tier_changed',
      applicationId,
      eventId,
      byUserId,
      tierId,
      applicantPays: moneyOf(updated).applicantPays,
    });
    await this._afterAmountChange(organizationId, updated, sessionId, 'TIER_CHANGED', sendEmail);
    return this.get(eventId, applicationId, organizationId);
  }

  /**
   * Add a signed manual adjustment line (discount, late fee). Folded into the
   * tier line for fee math, so the tier price plus every adjustment may not
   * go below zero — deeper discounts remove add-ons or waive the balance.
   */
  async addAdjustment(eventId, applicationId, organizationId, { amount, reason }, { byUserId } = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const value = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(value) || value === 0 || Math.abs(value) > 10_000) throw new ValidationError('amount must be a non-zero number up to 10,000');
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (!text || text.length > 200) throw new ValidationError('reason is required (200 characters or fewer)');

    const { updated, sessionId } = await prisma.$transaction(async (tx) => {
      const application = await this._lockForEdit(tx, eventId, applicationId, 'the amount');
      const adjustments = [
        ...adjustmentItems(application.order),
        { kind: 'ADJUSTMENT', unitPrice: value, description: text, createdById: byUserId ?? null },
      ];
      const total = adjustments
        .filter((a) => a.kind === 'ADJUSTMENT')
        .reduce((sum, a) => sum + Number(a.unitPrice), 0);
      if (Number(application.tier.price) + total < -1e-9) {
        throw new ValidationError(`Adjustment exceeds the tier price (${money(application.tier.price)}); edit add-ons or waive the balance instead`);
      }
      const row = await this._rewriteOrder(
        tx,
        application,
        this._orderData(application, { adjustments }),
        {
          decisions: {
            create: {
              action: 'ADJUSTED',
              byUserId,
              note: `${value < 0 ? '−' : '+'}${money(Math.abs(value))} ${text}`,
            },
          },
        }
      );
      return { updated: row, sessionId: pendingPayNowSession(application) };
    });

    logger.info('Application adjusted', {
      event: 'application_adjusted',
      applicationId,
      eventId,
      byUserId,
      amount: value,
      applicantPays: moneyOf(updated).applicantPays,
    });
    await this._afterAmountChange(organizationId, updated, sessionId, null, false);
    return this.get(eventId, applicationId, organizationId);
  }

  /** Remove an adjustment line and recompute. */
  async removeAdjustment(eventId, applicationId, organizationId, adjustmentId, { byUserId } = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const { updated, sessionId } = await prisma.$transaction(async (tx) => {
      const application = await this._lockForEdit(tx, eventId, applicationId, 'the amount');
      const items = adjustmentItems(application.order);
      const adjustment = items.find((a) => a.id === adjustmentId);
      if (!adjustment) throw new NotFoundError('Adjustment not found');
      if (adjustment.kind === 'WAIVER') throw new ConflictError('A waiver cannot be removed');
      const row = await this._rewriteOrder(
        tx,
        application,
        this._orderData(application, { adjustments: items.filter((a) => a.id !== adjustmentId) }),
        {
          decisions: {
            create: {
              action: 'ADJUSTED',
              byUserId,
              note: `Removed ${Number(adjustment.unitPrice) < 0 ? '−' : '+'}${money(Math.abs(adjustment.unitPrice))} ${adjustment.description}`,
            },
          },
        }
      );
      return { updated: row, sessionId: pendingPayNowSession(application) };
    });

    logger.info('Application adjustment removed', { event: 'application_adjustment_removed', applicationId, eventId, byUserId, adjustmentId });
    await this._afterAmountChange(organizationId, updated, sessionId, null, false);
    return this.get(eventId, applicationId, organizationId);
  }

  /**
   * ADMIN: waive the outstanding balance on an APPROVED + PAYMENT_DUE
   * application. Records the waived amount as a WAIVER line, zeroes the
   * snapshot, confirms the slot and marks the row settled offline.
   */
  async waiveBalance(eventId, applicationId, organizationId, { reason }, { byUserId, sendEmail = true } = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (!text || text.length > 200) throw new ValidationError('reason is required (200 characters or fewer)');

    const { updated, sessionId } = await prisma.$transaction(async (tx) => {
      const application = await this._lockForSettlement(tx, eventId, applicationId);
      const waived = moneyOf(application).applicantPays;
      await this._confirmHeldSlot(tx, application);
      // The order keeps its lines and gains a WAIVER line; every total becomes 0.
      // No PaymentTransaction: nothing was paid. The order is COMPLETED via the mapping.
      await tx.orderItem.create({
        data: {
          orderId: application.order.id,
          kind: 'WAIVER',
          description: text,
          quantity: 1,
          unitPrice: -waived,
          createdById: byUserId ?? null,
        },
      });
      await tx.order.update({
        where: { id: application.order.id },
        data: {
          totalAmount: 0,
          subtotalAmount: 0,
          platformFeeAmount: 0,
          processingFeeAmount: 0,
          taxAmount: 0,
          orgReceives: 0,
        },
      });
      await this._transition(
        tx,
        applicationId,
        {
          paymentStatus: 'NOT_REQUIRED',
          overdue: false,
          capacitySlot: application.tierId ? 'APPROVED' : application.capacitySlot,
          stripeCheckoutSessionId: null,
          decisions: { create: { action: 'WAIVED', byUserId, note: `Waived ${money(waived)}: ${text}` } },
        },
        { include: null, orderData: { dueAt: null, paidAt: new Date() } }
      );
      return {
        updated: await this._reload(tx, applicationId),
        sessionId: application.stripeCheckoutSessionId,
      };
    });

    logger.info('Application balance waived', { event: 'application_waived', applicationId, eventId, byUserId });
    await this._afterAmountChange(organizationId, updated, sessionId, 'WAIVED', sendEmail);
    return this.get(eventId, applicationId, organizationId);
  }

  /**
   * ADMIN: record a payment taken outside Stripe (cheque, cash, transfer,
   * comped) on an APPROVED + PAYMENT_DUE application. The amount must equal
   * the snapshot; the slot is confirmed like a Stripe payment. No Stripe call.
   */
  async recordOfflinePayment(eventId, applicationId, organizationId, { method, amount, reference, paidAt }, { byUserId, sendEmail = true } = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    if (!OFFLINE_METHODS.has(method)) throw new ValidationError(`method must be one of ${[...OFFLINE_METHODS].join(', ')}`);
    const value = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(value) || value < 0) throw new ValidationError('amount must be a number');
    const ref = reference == null ? null : String(reference).trim().slice(0, 120) || null;
    const when = paidAt ? new Date(paidAt) : new Date();
    if (Number.isNaN(when.getTime())) throw new ValidationError('paidAt must be a date');
    if (when.getTime() > Date.now() + 86_400_000) throw new ValidationError('paidAt cannot be in the future');

    const { updated, sessionId } = await prisma.$transaction(async (tx) => {
      const application = await this._lockForSettlement(tx, eventId, applicationId);
      const due = moneyOf(application).applicantPays;
      if (Math.abs(value - due) > 0.005)
        throw new ValidationError(
          `amount must equal the balance due (${money(due)}); add an adjustment first to change what is owed`
        );
      await this._confirmHeldSlot(tx, application);
      // Spec 024: the payment row is the offline record; no Stripe object exists.
      await tx.paymentTransaction.upsert({
        where: { orderId: application.order.id },
        create: {
          orderId: application.order.id,
          amount: value,
          currency: application.order.currency,
          status: 'SUCCEEDED',
          source: 'OFFLINE',
          offlineMethod: method,
          offlineReference: ref,
          recordedById: byUserId ?? null,
          createdAt: when,
        },
        update: {
          amount: value,
          status: 'SUCCEEDED',
          failureReason: null,
          stripePaymentIntentId: null,
          source: 'OFFLINE',
          offlineMethod: method,
          offlineReference: ref,
          recordedById: byUserId ?? null,
        },
      });
      await this._transition(
        tx,
        applicationId,
        {
          paymentStatus: 'PAID',
          overdue: false,
          capacitySlot: application.tierId ? 'APPROVED' : application.capacitySlot,
          stripeCheckoutSessionId: null,
          decisions: { create: { action: 'OFFLINE_PAID', byUserId, note: `${OFFLINE_METHOD_LABEL[method]}${ref ? ` ${ref}` : ''}, ${money(value)}` } },
        },
        { include: null, orderData: { paidAt: when, dueAt: null } }
      );
      return {
        updated: await this._reload(tx, applicationId),
        sessionId: application.stripeCheckoutSessionId,
      };
    });

    logger.info('Application paid offline', { event: 'application_paid_offline', applicationId, eventId, byUserId, method, amount: value });
    await this._afterAmountChange(organizationId, updated, sessionId, 'OFFLINE_PAID', sendEmail);
    return this.get(eventId, applicationId, organizationId);
  }

  /**
   * Spec 024: every write that changes `status` or `paymentStatus` goes
   * through here so the application's order carries the mapped money state in
   * the same transaction. `orderData` adds order columns (paidAt, dueAt…).
   * `include: null` returns only the id, status and paymentStatus.
   */
  async _transition(tx, applicationId, data, { include = DETAIL_INCLUDE, orderData = {} } = {}) {
    const row = await tx.application.update({
      where: { id: applicationId },
      data,
      ...(include
        ? { include }
        : {
            select: {
              id: true,
              status: true,
              paymentStatus: true,
              order: { select: { id: true } },
            },
          }),
    });
    if (row.order) {
      const status = orderStatusFor(row);
      await tx.order.update({ where: { id: row.order.id }, data: { status, ...orderData } });
      if (include) Object.assign(row.order, { status }, orderData);
    }
    return row;
  }

  /** Lock the row and check the money can still change (add-ons, tier, adjustments). */
  async _lockForEdit(tx, eventId, applicationId, what) {
    const locked = await tx.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${applicationId} AND "eventId" = ${eventId} FOR UPDATE`;
    if (!locked[0]) throw new NotFoundError('Application not found');
    const application = await tx.application.findUnique({ where: { id: applicationId }, include: DETAIL_INCLUDE });
    if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
    const editable = amountEditable(application, what);
    if (!editable.allowed) throw new ConflictError(editable.reason);
    return application;
  }

  /** Lock the row and check it is APPROVED + PAYMENT_DUE (waive, offline payment). */
  async _lockForSettlement(tx, eventId, applicationId) {
    const locked = await tx.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${applicationId} AND "eventId" = ${eventId} FOR UPDATE`;
    if (!locked[0]) throw new NotFoundError('Application not found');
    const application = await tx.application.findUnique({ where: { id: applicationId }, include: DETAIL_INCLUDE });
    if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
    if (!canSettleOffline(application)) throw new ConflictError('Only an approved application with a payment due can be settled outside Stripe');
    return application;
  }

  /** RESERVED → APPROVED for the tier and add-on holds, as `_markPaid` does after a Stripe payment. */
  async _confirmHeldSlot(tx, application) {
    if (!application.tierId || application.capacitySlot !== 'RESERVED') return;
    await tx.$executeRaw`UPDATE "ApplicationTier" SET "quantityReserved" = GREATEST("quantityReserved" - 1, 0), "quantityApproved" = "quantityApproved" + 1 WHERE "id" = ${application.tierId}`;
    const lines = await this._addOnLines(tx, application.id);
    if (lines.length) await addOnService.commit(tx, lines);
  }

  /**
   * Spec 024: order lines and totals for the application's current tier,
   * add-on lines and adjustments, with any of the three replaced.
   */
  _orderData(application, { tier = application.tier, addOnLines = null, adjustments = null } = {}) {
    const current = moneyOf(application);
    const lines =
      addOnLines ??
      current.addOns.map((l) => ({ addOn: l.addOn, addOnId: l.addOnId, quantity: l.quantity }));
    const adj = adjustments ?? adjustmentItems(application.order);
    return orderLineService.applicationOrderData(
      tier,
      application.form,
      lines,
      adj,
      application.event,
      application.event.venue.organization
    );
  }

  /** Rewrite the order's lines and totals, apply `data` to the application, return the detail row. */
  async _rewriteOrder(tx, application, orderData, data = {}) {
    await orderLineService.rewriteApplicationOrder(tx, application.order.id, orderData);
    return tx.application.update({ where: { id: application.id }, data, include: DETAIL_INCLUDE });
  }

  async _reload(tx, applicationId) {
    return tx.application.findUnique({ where: { id: applicationId }, include: DETAIL_INCLUDE });
  }

  /**
   * After the amount changed: a pending pay-now session carries the old
   * amount, so expire it; optionally email the applicant with `action`'s
   * template and pin the rendered email to the latest decision row.
   */
  async _afterAmountChange(organizationId, updated, sessionId, action, sendEmail) {
    if (sessionId) await applicationPaymentService.expireSession(updated, sessionId);
    if (!action || sendEmail === false) return;
    const statusUrl = await statusUrlFor(updated);
    const sent = await applicationTemplateService.send(organizationId, action, { ...updated, statusUrl }, { payNowUrl: statusUrl });
    if (sent) {
      const decision = updated.decisions[updated.decisions.length - 1];
      await prisma.applicationDecision.update({ where: { id: decision.id }, data: { emailSubject: sent.subject, emailBody: sent.body } }).catch(() => {});
    }
  }

  /**
   * Bulk decision. APPROVE is limited to FREE forms (each paid approval is an
   * individual charge). Returns per-id outcomes; never throws for one failure.
   */
  async bulkDecide(eventId, organizationId, { ids, decision, note, byUserId }) {
    await applicationFormService.requireEvent(eventId, organizationId);
    this._validateBulk(ids, decision);
    const results = await this._bulkDecideRows(eventId, organizationId, ids, { decision, note, byUserId });
    return this._bulkResult(results);
  }

  /**
   * Organization-wide bulk (spec 019): ids are grouped by event and run
   * through the per-event path so every rule (PAID approve refused, state
   * machine, capacity) is the same. Ids outside the scope come back not found.
   */
  async bulkDecideInScope(organizationId, { ids, decision, note, byUserId }) {
    this._validateBulk(ids, decision);
    const rows = await prisma.application.findMany({
      where: { id: { in: ids }, ...(organizationId ? { organizationId } : {}) },
      select: { id: true, eventId: true, organizationId: true },
    });
    const byEvent = new Map();
    for (const r of rows) {
      if (!byEvent.has(r.eventId)) byEvent.set(r.eventId, { organizationId: r.organizationId, ids: [] });
      byEvent.get(r.eventId).ids.push(r.id);
    }
    const found = new Map();
    for (const [eventId, group] of byEvent) {
      for (const r of await this._bulkDecideRows(eventId, group.organizationId, group.ids, { decision, note, byUserId })) found.set(r.id, r);
    }
    // Keep the caller's order; unknown ids fail like a per-event 404.
    const results = ids.map((id) => found.get(id) ?? { id, ok: false, error: 'Application not found' });
    return this._bulkResult(results);
  }

  _validateBulk(ids, decision) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) throw new ValidationError('ids must be 1-200 application ids');
    if (!DECISIONS[decision]) throw new ValidationError('decision must be APPROVE, REJECT, WAITLIST or WITHDRAW');
  }

  _bulkResult(results) {
    return { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }

  async _bulkDecideRows(eventId, organizationId, ids, { decision, note, byUserId }) {
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
    return results;
  }

  /** CSV with one column per (unarchived or answered) question. */
  async exportCsv(eventId, organizationId, query = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    return this.exportCsvInScope({ eventId, organizationId }, query);
  }

  /**
   * Same builder over a scope (spec 019). Organization-wide exports prepend
   * `event` / `eventDate` (and `organization` when unscoped) and cap at
   * EXPORT_MAX_ROWS with a 413 that asks for a narrower filter.
   */
  async exportCsvInScope(scope, query = {}) {
    const where = await this._scopedWhere(scope, query);
    const orgWide = !scope.eventId;
    const unscoped = !scope.eventId && !scope.organizationId;
    if (orgWide) {
      const count = await prisma.application.count({ where });
      if (count > EXPORT_MAX_ROWS) {
        const error = new ValidationError(`Export is limited to ${EXPORT_MAX_ROWS} applications; narrow the filter`);
        error.statusCode = 413;
        throw error;
      }
    }
    const rows = await prisma.application.findMany({
      where,
      include: {
        contact: { select: { email: true, firstName: true, lastName: true } },
        profile: { select: { businessName: true, website: true, description: true, socials: true, images: { include: { image: { include: { file: true } } }, orderBy: { displayOrder: 'asc' } } } },
        tier: { select: { name: true } },
        form: { select: { name: true, kind: true } },
        event: {
          select: {
            id: true,
            name: true,
            date: true,
            venue: { select: { organization: { select: { name: true } } } },
          },
        },
        answers: {
          include: {
            question: { select: { id: true, label: true, type: true } },
            image: { include: { file: true } },
          },
        },
        order: {
          select: {
            orderRef: true,
            totalAmount: true,
            orgReceives: true,
            payment: { select: { stripePaymentIntentId: true } },
            addOns: {
              include: { addOn: { select: { id: true, name: true, displayOrder: true } } },
            },
          },
        },
      },
      orderBy: this._listOrder(query.sort),
    });
    const questions = new Map();
    for (const a of rows) for (const ans of a.answers) if (!questions.has(ans.question.id)) questions.set(ans.question.id, ans.question);
    const qList = [...questions.values()];
    // One column per add-on that is active for applications on any event in
    // the export or appears on any row (spec 012).
    const addOns = new Map();
    const eventIds = scope.eventId ? [scope.eventId] : [...new Set(rows.map((a) => a.eventId))];
    const active = eventIds.length
      ? await prisma.addOn.findMany({ where: { eventId: { in: eventIds }, isActive: true, scope: { in: ['APPLICATION', 'BOTH'] } }, select: { id: true, name: true, displayOrder: true } })
      : [];
    for (const ad of active) addOns.set(ad.id, ad);
    for (const a of rows)
      for (const l of a.order?.addOns || [])
        if (!addOns.has(l.addOn.id)) addOns.set(l.addOn.id, l.addOn);
    const addOnList = [...addOns.values()].sort((x, y) => x.displayOrder - y.displayOrder);
    const header = [
      ...(unscoped ? ['organization'] : []),
      ...(orgWide ? ['event', 'eventDate'] : []),
      'applicationId',
      'form',
      'status',
      'paymentStatus',
      'orderRef',
      'submittedAt',
      'decidedAt',
      'tier',
      'businessName',
      'firstName',
      'lastName',
      'email',
      'website',
      'description',
      'socials',
      'profilePhotos',
      'applicantPays',
      'orgReceives',
      'boothLabel',
      'tags',
      'checkedInAt',
      'checkedOutAt',
      'internalNote',
      'stripePaymentIntentId',
      ...addOnList.map((ad) => `addon:${ad.name}`),
      ...qList.map((q) => q.label),
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const a of rows) {
      const byQ = new Map(a.answers.map((ans) => [ans.question.id, ans]));
      const byAddOn = new Map((a.order?.addOns || []).map((l) => [l.addOnId, l.quantity]));
      const cells = [
        ...(unscoped ? [a.event.venue.organization.name] : []),
        ...(orgWide ? [a.event.name, a.event.date?.toISOString() ?? ''] : []),
        a.id,
        a.form.name,
        a.status,
        a.paymentStatus,
        a.order?.orderRef ?? '',
        a.submittedAt?.toISOString() ?? '',
        a.decidedAt?.toISOString() ?? '',
        a.tier?.name ?? '',
        a.profile.businessName,
        a.contact.firstName,
        a.contact.lastName,
        a.contact.email,
        a.profile.website ?? '',
        a.profile.description ?? '',
        a.profile.socials
          ? Object.entries(a.profile.socials)
              .map(([k, v]) => `${k}: ${v}`)
              .join('; ')
          : '',
        (a.profile.images || [])
          .map((pi) => absoluteAssetUrl(imageService.formatImageResponse(pi.image).urls.original))
          .join('; '),
        Number(a.order?.totalAmount ?? 0).toFixed(2),
        Number(a.order?.orgReceives ?? 0).toFixed(2),
        a.boothLabel ?? '',
        (a.tags || []).join('; '),
        a.checkedInAt?.toISOString() ?? '',
        a.checkedOutAt?.toISOString() ?? '',
        a.internalNote ?? '',
        a.order?.payment?.stripePaymentIntentId ?? '',
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
    const rows = await tx.orderAddOn.findMany({
      where: { order: { applicationId } },
      include: { addOn: true },
      orderBy: { addOn: { displayOrder: 'asc' } },
    });
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

  _listWhere(scope, query) {
    const where = this._scopeWhere(scope);
    if (query.form) where.formId = String(query.form);
    if (query.tier) where.tierId = String(query.tier);
    if (query.addOn) where.order = { addOns: { some: { addOnId: String(query.addOn) } } };
    if (query.tag) where.tags = { has: String(query.tag) };
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
          { form: { name: { contains: q, mode: 'insensitive' } } },
          { boothLabel: { contains: q, mode: 'insensitive' } },
          { tags: { has: q } },
          { id: q },
        ];
        // "ID: XNKNHSCH" on a row is the tail of the cuid; cuids are lowercase.
        const tail = q.toLowerCase();
        if (ID_FRAGMENT_RE.test(tail)) where.OR.push({ id: { endsWith: tail } });
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
      case 'business_desc':
        return [{ profile: { businessName: 'desc' } }];
      case 'status':
        return [{ status: 'asc' }, { submittedAt: 'desc' }];
      case 'status_desc':
        return [{ status: 'desc' }, { submittedAt: 'desc' }];
      case 'event':
        return [{ event: { date: 'desc' } }, { submittedAt: 'desc' }];
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
    const m = moneyOf(a);
    return {
      subtotal: m.subtotal,
      platformFee: m.platformFee,
      processingFee: m.processingFee,
      tax: m.tax,
      applicantPays: m.applicantPays,
      orgReceives: m.orgReceives,
      feeMode: m.feeMode,
      currency: m.currency,
    };
  }

  /**
   * What the tier would cost if the applicant applied today versus the
   * snapshot taken at submission. The snapshot is the only amount ever
   * charged; this lets the organizer see the delta after a price, fee-mode
   * or tax edit (spec 011 phase 3).
   */
  _pricing(a) {
    if (!a.tier || a.form?.kind !== 'PAID' || !a.order) return null;
    const m = moneyOf(a);
    const lines = m.addOns.map((l) => ({ addOn: l.addOn, quantity: l.quantity }));
    const now = orderLineService.applicationOrderData(
      a.tier,
      a.form,
      lines,
      adjustmentItems(a.order),
      a.event,
      a.event?.venue?.organization
    ).amounts;
    const snapshot = m.applicantPays;
    return {
      currentApplicantPays: now.applicantPays,
      currentOrgReceives: now.orgReceives,
      changed: Math.abs(now.applicantPays - snapshot) >= 0.005,
    };
  }

  /**
   * List row. `unscoped` adds `organization` (SYSTEM_ADMIN across orgs);
   * `statusBase` is the organization's storefront base for `statusUrl`.
   */
  _serializeRow(a, { unscoped = false, statusBase = null } = {}) {
    const firstImage = a.profile?.images?.[0]?.image;
    return {
      id: a.id,
      shortId: shortId(a.id),
      eventId: a.eventId,
      event: a.event ? { id: a.event.id, name: a.event.name, date: a.event.date } : null,
      ...(unscoped && a.event?.venue?.organization ? { organization: { id: a.event.venue.organization.id, name: a.event.venue.organization.name } } : {}),
      formId: a.formId,
      formName: a.form?.name,
      formKind: a.form?.kind,
      status: a.status,
      paymentStatus: a.paymentStatus,
      businessName: a.profile?.businessName,
      logoUrl: firstImage?.file ? imageService.formatImageResponse(firstImage).urls.thumb : null,
      contact: a.contact,
      tier: a.tier ? { id: a.tier.id, name: a.tier.name } : null,
      orderId: a.order?.id ?? null,
      orderRef: a.order?.orderRef ?? null,
      applicantPays: Number(a.order?.totalAmount ?? 0),
      addOns: (a.order?.addOns || []).map((l) => ({
        addOnId: l.addOnId,
        name: l.addOn?.name ?? null,
        quantity: l.quantity,
      })),
      submittedAt: a.submittedAt,
      decidedAt: a.decidedAt,
      paymentDueAt: a.order?.dueAt ?? null,
      overdue: a.overdue,
      boothLabel: a.boothLabel,
      tags: a.tags ?? [],
      checkedInAt: a.checkedInAt ?? null,
      checkedOutAt: a.checkedOutAt ?? null,
      pinnedAnswers: (a.answers || []).map((ans) => ({ questionId: ans.question.id, label: ans.question.label, type: ans.question.type, value: this._answerText(ans) })),
      statusUrl: statusBase ? statusUrlWithBase(statusBase, a) : null,
    };
  }

  _contact(c) {
    return c ? { id: c.id, email: c.email, firstName: c.firstName, lastName: c.lastName, accountCreatedAt: c.accountCreatedAt } : null;
  }

  _refundedTotal(a) {
    return moneyOf(a).refundedTotal;
  }

  _serializeAdmin(a) {
    const m = moneyOf(a);
    const refunded = m.refundedTotal;
    return {
      id: a.id,
      orderId: m.orderId,
      orderRef: m.orderRef,
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
      addOns: m.addOns.map(({ addOn: _addOn, ...l }) => l),
      addOnsEditable: addOnsEditable(a),
      // Spec 018 phase 3 (lines on the order since spec 024)
      adjustments: m.adjustments,
      amountEditable: amountEditable(a),
      canSettleOffline: canSettleOffline(a),
      paymentSource: m.paymentSource === 'OFFLINE' ? 'offline' : 'stripe',
      offlinePayment: m.offlinePayment,
      payment: {
        stripePaymentIntentId: m.stripePaymentIntentId,
        stripePaymentMethodId: a.stripePaymentMethodId ? 'on_file' : null,
        stripeAccountId: m.stripeAccountId,
        applicationFee: m.applicationFee,
        chargeAttempts: a.chargeAttempts,
        paidAt: m.paidAt,
        paymentDueAt: m.paymentDueAt,
        overdue: a.overdue,
        refundedTotal: refunded,
        refundable: Math.max(0, Math.round((m.applicantPays - refunded) * 100) / 100),
        stripeDashboardUrl: applicationPaymentService.dashboardPaymentUrl(m.stripePaymentIntentId),
        canRefund:
          ['PAID', 'PARTIALLY_REFUNDED'].includes(a.paymentStatus) &&
          (Boolean(m.stripePaymentIntentId) || m.paymentSource === 'OFFLINE'),
        manualRefund: m.paymentSource === 'OFFLINE',
        canRetryCharge:
          a.status === 'APPROVED' &&
          a.paymentStatus === 'PAYMENT_DUE' &&
          Boolean(a.stripePaymentMethodId),
      },
      answers: this._serializeAnswers(a),
      decisions: (a.decisions || []).map((d) => ({
        id: d.id,
        action: d.action,
        byUserId: d.byUserId,
        note: d.note,
        emailSubject: d.emailSubject,
        emailBody: d.emailBody,
        createdAt: d.createdAt,
      })),
      refunds: m.refunds.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        status: r.status,
        reason: r.reason,
        stripeRefundId: r.stripeRefundId,
        initiatedBy: r.initiatedBy,
        manual: r.manual === true,
        createdAt: r.createdAt,
      })),
      submittedAt: a.submittedAt,
      decidedAt: a.decidedAt,
      decidedById: a.decidedById,
      withdrawnBy: a.withdrawnBy,
      withdrawReason: a.withdrawReason,
      boothLabel: a.boothLabel,
      internalNote: a.internalNote,
      tags: a.tags ?? [],
      checkedInAt: a.checkedInAt ?? null,
      checkedOutAt: a.checkedOutAt ?? null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  _serializeApplicant(a) {
    const m = moneyOf(a);
    return {
      id: a.id,
      orderRef: m.orderRef,
      form: { id: a.form.id, name: a.form.name, kind: a.form.kind },
      event: { id: a.event.id, name: a.event.name, date: a.event.date },
      organization: a.event.venue?.organization ? { id: a.event.venue.organization.id, name: a.event.venue.organization.name } : null,
      status: a.status,
      paymentStatus: a.paymentStatus,
      tier: a.tier ? { id: a.tier.id, name: a.tier.name } : null,
      amounts: this._amounts(a),
      addOns: m.addOns.map(({ addOn: _addOn, ...l }) => l),
      adjustments: m.adjustments
        .filter((adj) => adj.kind !== 'WAIVER')
        .map((adj) => ({ id: adj.id, amount: adj.amount, reason: adj.reason })),
      paymentSource: m.paymentSource === 'OFFLINE' ? 'offline' : 'stripe',
      paymentDueAt: m.paymentDueAt,
      profile: applicantProfileService.serialize(a.profile),
      answers: this._serializeAnswers(a).filter((ans) => !ans.archived),
      boothLabel: a.boothLabel,
      submittedAt: a.submittedAt,
      decidedAt: a.decidedAt,
      paidAt: m.paidAt,
      refundedTotal: m.refundedTotal,
      canWithdraw:
        ['SUBMITTED', 'WAITLISTED'].includes(a.status) && a.paymentStatus !== 'PROCESSING',
      canResume: a.status === 'DRAFT' && a.form.kind === 'PAID',
      canPay: a.status === 'APPROVED' && a.paymentStatus === 'PAYMENT_DUE',
      canUpdateCard: ['SUBMITTED', 'WAITLISTED', 'APPROVED'].includes(a.status) && ['CARD_ON_FILE', 'PAYMENT_DUE'].includes(a.paymentStatus),
    };
  }
}

export default new ApplicationService();
