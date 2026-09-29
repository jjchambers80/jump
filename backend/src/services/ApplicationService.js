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
//
// Spec 037 phase 5 (apply-then-choose) — every PAID form:
//   submit   → SUBMITTED + NOT_DUE: no category, no add-ons, no order, no card
//   approve  → the organizer assigns the category (ApplicationTier); the form's
//              `reserveOnApproval` takes a slot in it (409 when full) or not;
//              AWAITING_SELECTION + the CHOOSE_SPACE email; nothing is charged
//   select   → the vendor picks a booth (map) or the category (list) plus
//              add-ons: a 15-minute hold (`selectionHeldUntil`), the slot and
//              add-ons reserved, the order created (or the cancelled one
//              reopened) PENDING + PAYMENT_DUE
//   pay      → saved card off-session or hosted Checkout; the webhook's
//              `_markPaid` commits the slot, add-ons and booth
//   lapse    → `releaseSelection` (sweep, decline, cancelled Checkout) puts
//              everything back and returns to AWAITING_SELECTION
// The payment clock (`paymentDueDays`) starts at approval.

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
import boothService from './BoothService.js';
import orderService from './OrderService.js';
import orderLineService, { ORDER_INCLUDE, adjustmentItems, spacePriceFor } from './OrderLineService.js';
import refundService from './RefundService.js';
import { moneyOf } from './applicationMoney.js';
import { hasLiveOrder, orderStatusFor } from './applicationOrderStatus.js';
import { selectionDueAt } from './applicationSelection.js';
import legalAcceptanceService from './LegalAcceptanceService.js';
import contactOptInService from './ContactOptInService.js';
import { applyConsentText } from '../config/legal.js';
import { BOOTH_HOLD_MS } from '../config/applications.js';
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
import { normalizeEmail } from '../utils/normalizeEmail.js';
import { upsertContactFillBlanks } from './contactRecord.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const ACTIVE_STATUSES = ['DRAFT', 'SUBMITTED', 'WAITLISTED', 'APPROVED'];
const STATUSES = new Set(['DRAFT', 'SUBMITTED', 'WAITLISTED', 'APPROVED', 'REJECTED', 'WITHDRAWN']);
const PAYMENT_STATUSES = new Set(['NOT_REQUIRED', 'NOT_DUE', 'AWAITING_SELECTION', 'AWAITING_CARD', 'CARD_ON_FILE', 'PROCESSING', 'PAID', 'PAYMENT_DUE', 'REFUNDED', 'PARTIALLY_REFUNDED']);
/** A search term that could be the tail of an application id (cuids are lowercase). */
const ID_FRAGMENT_RE = /^[a-z0-9]{6,25}$/;
/** Org-wide CSV cap (spec 019): beyond this the caller narrows the filter. */
const EXPORT_MAX_ROWS = 10_000;
/** Per-row list include, shared by the per-event and organization-wide lists (spec 019). */
const LIST_INCLUDE = {
  contact: { select: { email: true, firstName: true, lastName: true } },
  profile: { select: { businessName: true, images: { take: 1, orderBy: { displayOrder: 'asc' }, include: { image: { include: { file: true } } } } } },
  tier: { select: { id: true, name: true } },
  form: { select: { id: true, name: true, kind: true, paymentDueDays: true } },
  event: {
    select: {
      id: true,
      name: true,
      date: true,
      venue: { select: { timezone: true, organization: { select: { id: true, name: true } } } },
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
  form: {
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      chargeTiming: true,
      feeMode: true,
      taxable: true,
      paymentDueDays: true,
      overduePolicy: true,
      reserveOnApproval: true,
      spaceSelection: true, // spec 039
      // Spec 037 phase 5: the categories the organizer can assign on approval.
      tiers: {
        orderBy: { displayOrder: 'asc' },
        select: { id: true, name: true, description: true, price: true, quantityTotal: true, quantityApproved: true, quantityReserved: true, isActive: true },
      },
    },
  },
  event: {
    select: {
      id: true,
      name: true,
      date: true,
      taxRate: true,
      venue: { select: { organizationId: true, timezone: true, organization: { select: { id: true, name: true, email: true, logoUrl: true, taxInclusivePricing: true, statementDescriptorSuffix: true, enabledPaymentMethods: true } } } },
    },
  },
  answers: { include: { question: true, image: { include: { file: true } } } },
  decisions: { orderBy: { createdAt: 'asc' } },
  // Spec 024: lines, payment and refunds live on the order.
  order: { include: ORDER_INCLUDE },
  // Spec 014: booth assignment for map-bound applications.
  booth: { select: { id: true, label: true, mapId: true } },
};

const OFFLINE_METHODS = new Set(['CHEQUE', 'CASH', 'BANK_TRANSFER', 'COMPED', 'OTHER']);
const OFFLINE_METHOD_LABEL = { CHEQUE: 'Cheque', CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', COMPED: 'Comped', OTHER: 'Other' };
const money = (n) => `$${Number(n).toFixed(2)}`;

/**
 * Spec 014 phase 2: the booth each application owns (SOLD / RESERVED via
 * `Booth.applicationId`) or is holding while paying (HELD via
 * `holdApplicationId`, which has no Prisma relation), in one query. Attached
 * as `row.mapBooth` so the sync serializers can read it.
 */
async function attachBooths(rows) {
  const ids = rows.map((a) => a.id);
  if (ids.length === 0) return rows;
  const booths = await prisma.booth.findMany({
    where: { OR: [{ applicationId: { in: ids } }, { holdApplicationId: { in: ids } }] },
    select: { id: true, mapId: true, label: true, status: true, w: true, h: true, price: true, holdExpiresAt: true, applicationId: true, holdApplicationId: true },
  });
  const owned = new Map(booths.filter((b) => b.applicationId).map((b) => [b.applicationId, b]));
  const held = new Map(booths.filter((b) => b.status === 'HELD' && b.holdApplicationId).map((b) => [b.holdApplicationId, b]));
  for (const a of rows) a.mapBooth = owned.get(a.id) ?? held.get(a.id) ?? null;
  return rows;
}

/**
 * Spec 037 phase 5: whether each row's category is sold from the event's
 * published floor map (booths bound to it), attached as `row.tierMapBound`.
 * Replaces the never-settable `ApplicationTier.mapBound` column.
 */
async function attachMapBound(rows) {
  const tierIds = [...new Set(rows.map((a) => a.tierId).filter(Boolean))];
  const bound = tierIds.length
    ? new Set(
        (
          await prisma.booth.findMany({
            where: { tierId: { in: tierIds }, map: { status: 'PUBLISHED' } },
            select: { tierId: true },
            distinct: ['tierId'],
          })
        ).map((b) => b.tierId)
      )
    : new Set();
  for (const a of rows) a.tierMapBound = Boolean(a.tierId && bound.has(a.tierId));
  return rows;
}

/** An error the API answers with a machine-readable `code` (the storefront branches on it). */
function coded(error, code) {
  error.code = code;
  return error;
}

/** Booth as the applicant and organizer see it; null when none is owned or held. */
function boothView(a) {
  const b = a.mapBooth;
  if (!b) return null;
  return { id: b.id, mapId: b.mapId, label: b.label, status: b.status, w: b.w, h: b.h, holdExpiresAt: b.status === 'HELD' ? b.holdExpiresAt : null };
}

/**
 * Statuses in which the organizer may still change what the applicant owes
 * — add-on lines (spec 012), tier and adjustments (spec 018): no money has
 * moved. One rule: money that has moved is only ever refunded, never
 * re-priced.
 */
function amountEditable(application, what = 'the amount') {
  if (application.form?.kind !== 'PAID' || !application.tierId)
    return { allowed: false, reason: 'This form has no amount to change' };
  // Spec 037 phase 5: until the vendor chooses a space there is no order to edit.
  if (!hasLiveOrder(application))
    return { allowed: false, reason: 'The amount is set when the vendor chooses a space' };
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

/**
 * Spec 037 phase 5: whether the organizer may change the category. Before the
 * vendor chooses a space there is no order, so the category moves freely
 * (with the approval slot when the form reserves one); once an order exists
 * the spec 018 amount rules apply. Never while a chosen space is being paid for.
 */
function tierEditable(application) {
  if (application.form?.kind !== 'PAID') return { allowed: false, reason: 'This form has no categories' };
  if (application.selectionHeldUntil && ['PAYMENT_DUE', 'PROCESSING'].includes(application.paymentStatus))
    return { allowed: false, reason: 'The vendor is paying for a space; try again once the hold ends' };
  if (!hasLiveOrder(application)) {
    if (['SUBMITTED', 'WAITLISTED'].includes(application.status)) return { allowed: true, reason: null };
    if (application.status === 'APPROVED' && application.paymentStatus === 'AWAITING_SELECTION') return { allowed: true, reason: null };
    return { allowed: false, reason: `Cannot change the category on a ${application.status.toLowerCase()} application` };
  }
  return amountEditable(application, 'the tier');
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

/**
 * ADMIN may settle an APPROVED application outside Stripe: one with a payment
 * due, or (spec 037 phase 5) one still choosing a space — the category is
 * then what they pay for, and staff place them afterwards.
 */
function canSettleOffline(application) {
  if (application.form?.kind !== 'PAID' || application.status !== 'APPROVED') return false;
  if (application.paymentStatus === 'AWAITING_SELECTION') return Boolean(application.tierId);
  return application.paymentStatus === 'PAYMENT_DUE' && moneyOf(application).paymentSource !== 'OFFLINE';
}

class ApplicationService {
  // ---------------------------------------------------------------------------
  // Public: submit
  // ---------------------------------------------------------------------------

  /**
   * Submit an application.
   * @param {string} eventId
   * @param {{ formSlug: string, tierId?: string, contact: { email, firstName, lastName }, profile: object, answers: Record<string, unknown>, optInAccount?: boolean, optInMarketing?: boolean, acceptances: Array<{ document: string, version: string }> }} body
   * @param {{ profilePhotos: File[], answerPhotos: Record<string, File> }} files
   * @param {{ requestMeta?: { ipHash: string|null, userAgent: string|null } }} [options]
   * @returns {Promise<{ applicationId: string, orderRef: null, statusUrl: string, next: 'done' }>}
   */
  async submit(eventId, body, files = { profilePhotos: [], answerPhotos: {} }, { requestMeta = { ipHash: null, userAgent: null } } = {}) {
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

    // Spec 037 phase 5 (apply-then-choose): nobody picks a category, add-ons
    // or a space when applying. The organizer assigns the category on approval
    // and the vendor chooses and pays afterwards. A PAID-form submission still
    // carrying `tierId` / `addOns` (a tab opened before the change) is accepted
    // and those fields are ignored; on FREE forms they were always an error.
    if (form.kind === 'FREE') {
      if (body.tierId) throw new ValidationError('This form has no tiers');
      if (Array.isArray(body.addOns) && body.addOns.length > 0) throw new ValidationError('This form has no add-ons');
    }

    const profileData = applicantProfileService.validate(body.profile || {});
    if ((files.profilePhotos || []).length > MAX_PROFILE_PHOTOS) throw new ValidationError(`At most ${MAX_PROFILE_PHOTOS} profile photos`);
    const answers = this._validateAnswers(form.questions, body.answers || {}, files.answerPhotos || {});

    // Spec 024 phase 3: the consent trail. Terms and privacy; no card is saved
    // at submission any more, so there is no card-on-file authorization.
    const optInAccount = body.optInAccount === true;
    const optInMarketing = body.optInMarketing === true;
    const acceptances = legalAcceptanceService.assertCurrent(body.acceptances, ['TERMS', 'PRIVACY']);
    const organizationName = event.venue.organization?.name;
    const presentedText = { PRIVACY: applyConsentText({ organizationName }) };

    const application = await prisma.$transaction(async (tx) => {
      // Opt-ins are recorded on the application and applied by
      // ContactOptInService once it reaches SUBMITTED, never here (spec 024 phase 3).
      // Fill in a missing name only; never overwrite one (spec 037 D12).
      const contactRecord = await upsertContactFillBlanks(tx, {
        organizationId,
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
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

      // Every form is SUBMITTED on creation (spec 037 phase 5): FREE forms owe
      // nothing ever, PAID forms owe nothing until the vendor chooses a space.
      const created = await tx.application.create({
        data: {
          formId: form.id,
          eventId,
          organizationId,
          contactId: contactRecord.id,
          profileId: profile.id,
          tierId: null,
          status: 'SUBMITTED',
          paymentStatus: form.kind === 'FREE' ? 'NOT_REQUIRED' : 'NOT_DUE',
          submittedAt: new Date(),
          optInAccount,
          optInMarketing,
          statusTokenHash: `pending-${Date.now()}-${Math.random()}`,
          answers: { create: answerRows },
        },
        select: { id: true, eventId: true, contactId: true },
      });
      await legalAcceptanceService.record(
        tx,
        { subjectType: 'CONTACT', subjectId: contactRecord.id, email: contact.email, organizationId, source: 'APPLY', referenceType: 'Application', referenceId: created.id, ...requestMeta, presentedText },
        acceptances
      );
      // SUBMITTED on creation: the opt-ins apply now (spec 024 phase 3).
      const optIns = await contactOptInService.applyForApplication(tx, created.id);
      // The status token is derived from the id (applicationLinks.js); store its hash.
      const row = await tx.application.update({ where: { id: created.id }, data: { statusTokenHash: hashToken(statusToken(created.id)) }, include: DETAIL_INCLUDE });
      row.optIns = optIns;
      return row;
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

    // send() never throws; a failed email is logged and must not fail the submission.
    // A just-created account gets its first sign-in link in the same email (spec 024 phase 3).
    const accountUrl = application.optIns?.accountJustCreated ? await contactOptInService.welcomeUrl(application.contactId) : null;
    await applicationTemplateService.send(organizationId, 'RECEIVED', { ...application, statusUrl }, { accountUrl, accountCreated: Boolean(accountUrl) });
    return { applicationId: application.id, orderRef: null, statusUrl, next: 'done' };
  }

  /** Guest status page: token must match; returns the applicant-facing view. */
  async statusView(applicationId, rawToken) {
    const application = await this._requireByToken(applicationId, rawToken);
    return this._applicantView(application);
  }

  /** Applicant view with the booth, map binding and (spec 037 phase 5) the choose-your-space data. */
  async _applicantView(application) {
    await attachBooths([application]);
    await attachMapBound([application]);
    application.selectionView = await this._selectionView(application);
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
    return this._payNow(application);
  }

  /**
   * Guest status-link path for the spec 014 booth picker: choosing a booth is
   * a space selection (spec 037 phase 5) without add-ons. A saved card is
   * charged at once, as the picker has always done.
   */
  async chooseBooth(applicationId, rawToken, boothId) {
    await this._requireByToken(applicationId, rawToken);
    return this.select(applicationId, { boothId, useSavedCard: true });
  }

  /** Guest: choose a space (spec 037 phase 5). */
  async selectByToken(applicationId, rawToken, input) {
    await this._requireByToken(applicationId, rawToken);
    return this.select(applicationId, input);
  }

  /** Guest: give back a held space to choose another. */
  async releaseByToken(applicationId, rawToken) {
    await this._requireByToken(applicationId, rawToken);
    return this._releaseByVendor(applicationId);
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
    return Promise.all(rows.map((a) => this._applicantView(a)));
  }

  async getForContact(organizationId, contactId, applicationId) {
    const application = await prisma.application.findFirst({ where: { id: applicationId, organizationId, contactId }, include: DETAIL_INCLUDE });
    if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
    return this._applicantView(application);
  }

  /** Buyer: pay-now Checkout URL for an outstanding balance. */
  async payNowForContact(organizationId, contactId, applicationId) {
    const application = await prisma.application.findFirst({ where: { id: applicationId, organizationId, contactId }, include: DETAIL_INCLUDE });
    if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
    return this._payNow(application);
  }

  async _payNow(application) {
    // Guard before anything moves: a replayed Pay on a settled application
    // must be a plain 409, never a state change (it used to rewrite PAID rows).
    if (application.status !== 'APPROVED' || application.paymentStatus !== 'PAYMENT_DUE') {
      throw new ConflictError('There is no outstanding balance on this application');
    }
    // Spec 037 phase 5: paying for a chosen space. The hold must still run;
    // PROCESSING protects it (booth and category slot) from the sweep while
    // the vendor is on Stripe's page.
    const held = Boolean(application.selectionHeldUntil);
    if (held) {
      if (new Date(application.selectionHeldUntil) <= new Date()) {
        await this.releaseSelection(application.id, { reason: 'Hold expired before payment' });
        throw coded(new ConflictError('Your hold on this space expired. Choose your space again.'), 'HOLD_EXPIRED');
      }
      const booth = await boothService.boothForApplication(application.id);
      if (booth?.status === 'HELD') await boothService.beginPayment(application.id);
      else await prisma.$transaction((tx) => this._transition(tx, application.id, { paymentStatus: 'PROCESSING' }, { include: null }));
    }
    try {
      return { url: await applicationPaymentService.payNowUrl({ ...application, paymentStatus: 'PAYMENT_DUE' }, await statusUrlFor(application)) };
    } catch (error) {
      // Only a failure to mint the Checkout session undoes the PROCESSING
      // guard; the space stays held so the vendor can try again.
      if (held && !(error instanceof ConflictError)) {
        await prisma
          .$transaction((tx) => this._transition(tx, application.id, { paymentStatus: 'PAYMENT_DUE' }, { include: null }))
          .catch(() => {});
      }
      throw error;
    }
  }

  /**
   * The vendor backed out of hosted Checkout: expire the Stripe session so a
   * late completion cannot land, and hand the space back to the vendor. While
   * the hold still runs they keep it (PAYMENT_DUE: pay again or change it);
   * once it has lapsed the selection is released. A no-op unless a pay-now
   * session is in flight.
   */
  async cancelCheckout(applicationId, rawToken) {
    const application = await this._requireByToken(applicationId, rawToken);
    return this._cancelCheckout(application);
  }

  async cancelCheckoutForContact(organizationId, contactId, applicationId) {
    const application = await prisma.application.findFirst({
      where: { id: applicationId, organizationId, contactId, status: { not: 'DRAFT' } },
      include: DETAIL_INCLUDE,
    });
    if (!application) throw new NotFoundError('Application not found');
    return this._cancelCheckout(application);
  }

  async _cancelCheckout(application) {
    if (application.status !== 'APPROVED' || application.paymentStatus !== 'PROCESSING' || !application.stripeCheckoutSessionId) {
      return { cancelled: false, paymentStatus: application.paymentStatus };
    }
    await applicationPaymentService.expireCheckoutSession(application.stripeCheckoutSessionId);
    if (application.selectionHeldUntil && new Date(application.selectionHeldUntil) > new Date()) {
      await prisma.$transaction((tx) =>
        this._transition(tx, application.id, { paymentStatus: 'PAYMENT_DUE', stripeCheckoutSessionId: null }, { include: null })
      );
      return { cancelled: true, paymentStatus: 'PAYMENT_DUE' };
    }
    const paymentStatus = await applicationPaymentService._markPaymentDue(application, 'Checkout cancelled by the vendor');
    return { cancelled: true, paymentStatus: paymentStatus === 'AWAITING_SELECTION' ? 'AWAITING_SELECTION' : 'PAYMENT_DUE' };
  }

  /** Buyer-session path for the spec 014 booth picker: a space selection without add-ons. */
  async chooseBoothForContact(organizationId, contactId, applicationId, boothId) {
    await this._requireForContact(organizationId, contactId, applicationId);
    return this.select(applicationId, { boothId, useSavedCard: true });
  }

  /** Buyer: choose a space (spec 037 phase 5). */
  async selectForContact(organizationId, contactId, applicationId, input) {
    await this._requireForContact(organizationId, contactId, applicationId);
    return this.select(applicationId, input);
  }

  /** Buyer: give back a held space to choose another. */
  async releaseForContact(organizationId, contactId, applicationId) {
    await this._requireForContact(organizationId, contactId, applicationId);
    return this._releaseByVendor(applicationId);
  }

  async _requireForContact(organizationId, contactId, applicationId) {
    const application = await prisma.application.findFirst({
      where: { id: applicationId, organizationId, contactId, status: { not: 'DRAFT' } },
      select: { id: true },
    });
    if (!application) throw new NotFoundError('Application not found');
    return application;
  }

  // ---------------------------------------------------------------------------
  // Spec 037 phase 5: choose a space
  // ---------------------------------------------------------------------------

  /**
   * An approved vendor chooses their space: a booth on the published map
   * (`boothId`, which must be bound to their category) or, from the list, the
   * category itself (staff place them later). Add-on lines are chosen here.
   *
   * One transaction: lock the application → the category slot (already held
   * when the form reserves on approval; taken now, 409 `SOLD_OUT` when full,
   * when it does not) → the booth hold → add-on reservations (409 names the
   * sold-out add-on) → the order, created or the cancelled one reopened with
   * the new lines → PAYMENT_DUE with `selectionHeldUntil` = now + 15 min.
   * The order's `dueAt` is the approval clock (`selectionDueAt`).
   *
   * Then, with `useSavedCard` and a card on file, the card is charged
   * off-session (the spec 011 path); otherwise the vendor continues to
   * hosted Checkout through `payNow`.
   *
   * @param {{ boothId?: string|null, addOns?: Array<{ addOnId: string, quantity: number }>, useSavedCard?: boolean }} input
   * @returns {Promise<{ boothId: string|null, holdExpiresAt: Date, status: string, paymentStatus: string, orderRef: string|null }>}
   */
  async select(applicationId, { boothId = null, tierId = null, addOns = [], useSavedCard = false } = {}) {
    if (!paymentsEnabled()) throw new ConflictError('Paid applications are not available yet');
    if (boothId !== null && boothId !== undefined && (typeof boothId !== 'string' || !boothId)) {
      throw new ValidationError('boothId must be an id');
    }
    if (tierId !== null && tierId !== undefined && (typeof tierId !== 'string' || !tierId)) {
      throw new ValidationError('tierId must be an id');
    }
    if (addOns !== undefined && addOns !== null && !Array.isArray(addOns)) {
      throw new ValidationError('addOns must be an array of { addOnId, quantity }');
    }
    const holdExpiresAt = new Date(Date.now() + BOOTH_HOLD_MS);
    let supersededSessionId = null;

    const { booth, orderRef } = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${applicationId} FOR UPDATE`;
      if (!locked[0]) throw new NotFoundError('Application not found');
      const application = await tx.application.findUnique({ where: { id: applicationId }, include: DETAIL_INCLUDE });
      supersededSessionId = application?.stripeCheckoutSessionId ?? null;
      if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
      if (application.form.kind !== 'PAID') throw new ConflictError('This form has no spaces to choose');
      if (application.status !== 'APPROVED') {
        throw coded(new ConflictError('Only an approved application can choose a space'), 'APPLICATION_NOT_APPROVED');
      }
      if (application.paymentStatus !== 'AWAITING_SELECTION') {
        throw coded(new ConflictError('This application is not choosing a space; refresh the page'), 'NOT_AWAITING_SELECTION');
      }
      // A booth placed by staff is the space: the vendor pays for it (its own
      // price when set, spec 039 D10) and cannot pick another.
      const placed = await tx.booth.findFirst({ where: { applicationId }, select: { id: true, label: true, price: true } });
      if (boothId && placed) throw coded(new ConflictError('The organizer has already placed you; pay for your category instead'), 'ALREADY_HAS_BOOTH');

      // Spec 039: what the form lets the vendor choose.
      //   MAP   — a spot of their category on the floor map (D2, D7); no
      //           category-only purchase unless staff already placed them.
      //   TIERS — no map; one of the form's tiers, or the one the organizer
      //           locked at approval (D4, D6).
      const mode = application.form.spaceSelection === 'MAP' ? 'MAP' : 'TIERS';
      if (mode === 'MAP' && !boothId && !placed) {
        throw coded(new ValidationError('Choose your spot on the floor map'), 'BOOTH_REQUIRED');
      }
      if (mode === 'TIERS' && boothId) {
        throw coded(new ValidationError('This form sells spaces by tier; the organizer places you on the floor'), 'BOOTH_NOT_OFFERED');
      }
      let tier = application.tier;
      let vendorPicked = false;
      if (!application.tierId || !tier) {
        if (mode === 'MAP') throw coded(new ConflictError('The organizer has not assigned a category yet'), 'NO_TIER');
        if (!tierId) throw coded(new ValidationError('Choose a tier'), 'TIER_REQUIRED');
        tier = application.form.tiers.find((t) => t.id === tierId && t.isActive) ?? null;
        if (!tier) throw coded(new ValidationError('That tier is not offered on this form'), 'TIER_NOT_OFFERED');
        vendorPicked = true;
      } else if (tierId && tierId !== application.tierId) {
        throw coded(new ConflictError(`The organizer approved you as ${tier.name}`), 'TIER_LOCKED');
      }

      // Category slot (spec 037 D5). A vendor-picked tier always takes its
      // slot here: the approval took none (spec 039 D6).
      if (application.capacitySlot === 'NONE') {
        await this._takeTierSlot(tx, tier, 'RESERVED');
      }
      if (vendorPicked) {
        await tx.application.update({ where: { id: applicationId }, data: { tierId: tier.id, tierChosenByVendor: true } });
        application.tierId = tier.id;
        application.tier = tier;
      }

      let held = null;
      if (boothId) held = await boothService.chooseBooth(applicationId, boothId, { tx, holdExpiresAt });

      // Add-on lines: validated against the category's offer, then held.
      const lines = await addOnService.validateApplicationLines(application.eventId, addOns || [], tier.id);
      if (lines.length) {
        try {
          await addOnService.reserve(tx, lines);
        } catch (error) {
          if (error instanceof ConflictError && error.details?.addOnId) {
            const { name, remaining, requested } = error.details;
            throw coded(new ConflictError(`${name} is sold out: ${requested} requested, ${remaining} left.`, error.details), 'ADD_ON_SOLD_OUT');
          }
          throw error;
        }
      }

      // The order: created here, or the cancelled one (an expired selection,
      // or one from before apply-then-choose) reopened with the new lines.
      // Organizer adjustments on it are kept; the order number never changes.
      const dueAt = selectionDueAt(application) ?? new Date(Date.now() + (application.form.paymentDueDays ?? 7) * 86_400_000);
      const adjustments = application.order ? adjustmentItems(application.order).filter((i) => i.kind === 'ADJUSTMENT') : [];
      const data = orderLineService.applicationOrderData(tier, application.form, lines, adjustments, application.event, application.event.venue.organization, {
        booth: held ?? placed,
      });
      let order;
      if (application.order) {
        order = await orderLineService.rewriteApplicationOrder(tx, application.order.id, data, { status: 'PENDING', dueAt, paidAt: null });
      } else {
        order = await orderService.createApplicationOrder(tx, { application, data });
        await tx.order.update({ where: { id: order.id }, data: { dueAt } });
      }

      await this._transition(
        tx,
        applicationId,
        {
          paymentStatus: 'PAYMENT_DUE',
          capacitySlot: 'RESERVED',
          selectionHeldUntil: holdExpiresAt,
          stripeCheckoutSessionId: null,
        },
        { include: null, orderData: { dueAt } }
      );
      return { booth: held, orderRef: order.orderRef };
    });

    // A session left from an earlier selection must not stay payable.
    if (supersededSessionId) await applicationPaymentService.expireSupersededSession(applicationId, supersededSessionId);

    logger.info('Application space selected', {
      event: 'application_space_selected',
      applicationId,
      boothId: booth?.boothId ?? null,
      holdExpiresAt,
    });

    const current = await prisma.application.findUnique({ where: { id: applicationId }, select: { stripePaymentMethodId: true, chargeAttempts: true } });
    let paymentStatus = 'PAYMENT_DUE';
    if (useSavedCard === true && current?.stripePaymentMethodId) {
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw`SELECT * FROM "Application" WHERE "id" = ${applicationId} FOR UPDATE`;
        const locked = rows[0];
        if (!locked || locked.status !== 'APPROVED' || locked.paymentStatus !== 'PAYMENT_DUE') {
          throw new ConflictError('The application payment state changed; refresh and try again');
        }
        await this._transition(tx, applicationId, { paymentStatus: 'PROCESSING', chargeAttempts: locked.chargeAttempts + 1 }, { include: null });
      });
      // A decline releases the selection (AWAITING_SELECTION): choose again, pay on Checkout.
      paymentStatus = await applicationPaymentService.chargeOnApproval(applicationId);
    }
    const owned = await boothService.boothForApplication(applicationId);
    return {
      boothId: owned?.id ?? booth?.boothId ?? null,
      holdExpiresAt,
      status: owned?.status ?? (paymentStatus === 'PAID' ? 'SOLD' : 'AVAILABLE'),
      paymentStatus,
      orderRef,
    };
  }

  /** The vendor gives back a held space (to choose another); only while it is not being paid. */
  async _releaseByVendor(applicationId) {
    const application = await prisma.application.findUnique({ where: { id: applicationId }, select: { status: true, paymentStatus: true, selectionHeldUntil: true } });
    if (!application || application.status !== 'APPROVED' || application.paymentStatus !== 'PAYMENT_DUE' || !application.selectionHeldUntil) {
      throw coded(new ConflictError('There is no held space to release'), 'NOTHING_HELD');
    }
    const released = await this.releaseSelection(applicationId, { reason: 'Released by the vendor' });
    if (!released) {
      // A payment started between the read above and the locked release.
      throw coded(new ConflictError('Your payment is being processed; refresh the page'), 'PAYMENT_IN_PROGRESS');
    }
    return { released: true, paymentStatus: 'AWAITING_SELECTION' };
  }

  /** Put a chosen space back (spec 037 phase 5); see ApplicationPaymentService.releaseSelection. */
  async releaseSelection(applicationId, options = {}) {
    return applicationPaymentService.releaseSelection(applicationId, options);
  }

  /**
   * Choose-your-space data for the applicant view (spec 037 phase 5), or null
   * when the application is not choosing / paying for a space. Prices are the
   * applicant's all-in figures under the form's fee mode; `spacesLeft` counts
   * the vendor's own approval slot as theirs.
   *
   * Spec 039: `mode` is the form's `spaceSelection`.
   *   TIERS — `category` is the locked (or vendor-picked) tier; with none yet,
   *           `categories` lists every active tier to pick from. No map.
   *   MAP   — `category` is the approved category and `map` its spots on the
   *           published floor map with their all-in price range; `map.pending`
   *           while the map is not published (the vendor waits).
   */
  async _selectionView(a) {
    if (a.form?.kind !== 'PAID' || a.status !== 'APPROVED') return null;
    const choosing = a.paymentStatus === 'AWAITING_SELECTION';
    const holding = Boolean(a.selectionHeldUntil) && ['PAYMENT_DUE', 'PROCESSING'].includes(a.paymentStatus);
    if (!choosing && !holding) return null;
    const mode = a.form.spaceSelection === 'MAP' ? 'MAP' : 'TIERS';
    if (!a.tier && (mode === 'MAP' || !choosing)) return null;
    const event = a.event;
    const organization = event.venue.organization;
    const [addOnRows, map, placed] = await Promise.all([
      applicationFormService._addOnsForEvent(a.eventId, { activeOnly: true }),
      prisma.floorMap.findUnique({ where: { eventId: a.eventId }, select: { id: true, status: true } }),
      prisma.booth.findFirst({ where: { applicationId: a.id }, select: { id: true, label: true, w: true, h: true, status: true, price: true } }),
    ]);
    const tiers = a.tier ? [a.tier] : (a.form.tiers || []).filter((t) => t.isActive);
    const attached = await prisma.applicationTierAddOn.findMany({ where: { applicationTierId: { in: tiers.map((t) => t.id) } }, select: { addOnId: true, applicationTierId: true } });
    const ownSlot = a.capacitySlot === 'RESERVED' || a.capacitySlot === 'APPROVED';
    const describe = (tier) => {
      // A booth staff placed the vendor on is priced on its own (spec 039 D10).
      const amounts = orderLineService.applicationOrderData(tier, a.form, [], [], event, organization, { booth: a.tier ? placed : null }).amounts;
      const free = Math.max(0, tier.quantityTotal - tier.quantityApproved - tier.quantityReserved);
      const mine = ownSlot && tier.id === a.tierId;
      const offered = applicationFormService._offeredOnTier({ addOns: attached.filter((row) => row.applicationTierId === tier.id) }, addOnRows);
      return {
        id: tier.id,
        name: tier.name,
        description: tier.description ?? null,
        price: Number(tier.price),
        applicantPays: amounts.applicantPays,
        feesIncluded: amounts.feeMode === 'PASS' ? Math.round((amounts.applicantPays - amounts.subtotal - amounts.tax) * 100) / 100 : 0,
        tax: amounts.tax,
        // Spaces the vendor can still take: their own approval slot counts.
        spacesLeft: mine ? Math.max(1, free) : free,
        guaranteed: mine,
        addOns: offered.map((addOn) => applicationFormService._serializePublicAddOn(addOn, a.form, event, organization)),
      };
    };
    const card = a.stripePaymentMethodId ? await applicationPaymentService.savedCardSummary(a.stripePaymentMethodId) : null;
    const base = {
      mode,
      state: holding ? 'HELD' : 'CHOOSE',
      heldUntil: holding ? a.selectionHeldUntil : null,
      dueAt: selectionDueAt(a),
      reserveOnApproval: a.form.reserveOnApproval !== false,
      placedBooth: placed ? { id: placed.id, label: placed.label, w: placed.w, h: placed.h } : null,
      savedCard: card,
    };
    const noMap = { available: false, pending: false, mapId: null, boothsAvailable: 0, priceFrom: null, priceTo: null };

    if (!a.tier) {
      // TIERS, approved without a category: the vendor picks one.
      return { ...base, tierLocked: false, category: null, categories: tiers.map(describe), addOns: [], map: noMap };
    }
    const category = describe(a.tier);
    let mapView = noMap;
    if (mode === 'MAP' && !placed) {
      if (map?.status !== 'PUBLISHED') {
        mapView = { ...noMap, pending: true };
      } else {
        const booths = await prisma.booth.findMany({ where: { mapId: map.id, tierId: a.tier.id }, select: { status: true, price: true } });
        const allIn = (b) => orderLineService.applicationOrderData(a.tier, a.form, [], [], event, organization, { booth: b }).amounts.applicantPays;
        const prices = booths.map(allIn);
        mapView = {
          available: booths.length > 0,
          pending: false,
          mapId: map.id,
          boothsAvailable: booths.filter((b) => b.status === 'AVAILABLE').length,
          priceFrom: prices.length ? Math.min(...prices) : null,
          priceTo: prices.length ? Math.max(...prices) : null,
        };
      }
    }
    const { addOns, ...categoryOut } = category;
    return {
      ...base,
      // Locked by the organizer; a vendor-picked tier is theirs until released.
      tierLocked: a.tierChosenByVendor !== true,
      category: categoryOut,
      categories: null,
      addOns,
      map: mapView,
    };
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
        stripeCheckoutSessionId: null,
        decisions: {
          create: { action: 'WITHDRAWN', byUserId: null, note: 'Withdrawn by applicant' },
        },
      });
    });
    if (application.stripeCheckoutSessionId && application.paymentStatus !== 'PAID') {
      await applicationPaymentService.expireSupersededSession(application.id, application.stripeCheckoutSessionId);
    }
    logger.info('Application withdrawn by applicant', { event: 'application_decided', applicationId: application.id, action: 'WITHDRAWN', by: 'applicant' });
    return this._applicantView(updated);
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
    const [rows, total, summary, awaitingSpace] = await Promise.all([
      prisma.application.findMany({ where, include: LIST_INCLUDE, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.application.count({ where }),
      this.summaryInScope(scope),
      // Spec 037 phase 5: the "Awaiting space" chip — approved, still choosing.
      prisma.application.count({ where: { ...this._scopeWhere(scope), status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION' } }),
    ]);
    const bases = await this._storefrontBases(rows);
    await attachBooths(rows);
    await attachMapBound(rows);
    return {
      data: rows.map((a) => this._serializeRow(a, { unscoped: !scope.organizationId && !scope.eventId, statusBase: bases.get(a.organizationId) })),
      total,
      page,
      pageSize,
      summary,
      awaitingSpace,
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
    await attachBooths([application]);
    await attachMapBound([application]);
    return this._serializeAdmin(application);
  }

  /** Kept for callers of the phase 1 name; `updateMeta` is the full version. */
  async updateNotes(eventId, applicationId, organizationId, fields, options) {
    return this.updateMeta(eventId, applicationId, organizationId, fields, options);
  }

  /**
   * Organizer-only metadata (spec 019 phase 3 generalises the notes patch):
   * `boothLabel`, `internalNote`, `tags` (trimmed, deduped case-insensitively
   * — first spelling wins — at most MAX_TAGS × MAX_TAG_LENGTH), and
   * `checkedIn` / `checkedOut` booleans that stamp or clear the timestamps.
   * Check-in is refused (409) unless the application is APPROVED.
   *
   * Spec 036: setting a stamp goes through the same conditional write the door
   * page uses, so the table checkbox and a scan at the door cannot overwrite
   * each other's timestamp when they land in the same second.
   */
  async updateMeta(eventId, applicationId, organizationId, { boothLabel, internalNote, tags, checkedIn, checkedOut, publicProfile }, { byUserId = null } = {}) {
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
    if (publicProfile !== undefined) {
      if (typeof publicProfile !== 'boolean') throw new ValidationError('publicProfile must be a boolean');
      data.publicProfile = publicProfile;
    }
    // Stamps are applied separately from `data` (see below); `touched` keeps
    // "nothing to update" honest when the body is only a check-in toggle.
    const stamping = [];
    let touched = Object.keys(data).length;
    for (const [key, column] of [['checkedIn', 'checkedInAt'], ['checkedOut', 'checkedOutAt']]) {
      const value = key === 'checkedIn' ? checkedIn : checkedOut;
      if (value === undefined) continue;
      if (typeof value !== 'boolean') throw new ValidationError(`${key} must be a boolean`);
      touched += 1;
      // true stamps (idempotently, below); false clears in the ordinary write.
      if (value) stamping.push(column);
      else if (column === 'checkedInAt') Object.assign(data, { checkedInAt: null, checkedInById: null, checkedInVia: null });
      else data[column] = null;
    }
    if (touched === 0) throw new ValidationError('Nothing to update');
    const existing = await prisma.application.findFirst({ where: { id: applicationId, eventId }, select: { id: true, status: true, checkedInAt: true, checkedOutAt: true } });
    if (!existing || existing.status === 'DRAFT') throw new NotFoundError('Application not found');
    if ((stamping.length || data.checkedInAt !== undefined || data.checkedOutAt !== undefined) && existing.status !== 'APPROVED') {
      throw new ConflictError('Only approved applications can be checked in');
    }
    if (stamping.length) {
      const now = new Date();
      for (const column of stamping) {
        // Conditional on the column still being null: the first writer wins and
        // a concurrent toggle / door scan reads that timestamp back instead of
        // replacing it (spec 036).
        await prisma.application.updateMany({
          where: { id: applicationId, eventId, status: 'APPROVED', [column]: null },
          data: column === 'checkedInAt' ? { checkedInAt: now, checkedInById: byUserId, checkedInVia: 'TOGGLE' } : { checkedOutAt: now },
        });
      }
    }
    const application = await prisma.application.update({ where: { id: applicationId }, data, include: DETAIL_INCLUDE });
    await attachBooths([application]);
    await attachMapBound([application]);
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

  /**
   * The email a decision would send. Approving a PAID application (spec 037
   * phase 5) previews CHOOSE_SPACE with the category it would be assigned
   * (`tierId`, else the only active one, else the current one). Spec 039: an
   * explicit `tierId: null` on a TIERS form previews "the vendor chooses".
   */
  async previewMessage(eventId, applicationId, organizationId, decision, { tierId = undefined } = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const spec = DECISIONS[decision];
    if (!spec) throw new ValidationError('decision must be APPROVE, REJECT, WAITLIST or WITHDRAW');
    const application = await prisma.application.findFirst({ where: { id: applicationId, eventId }, include: DETAIL_INCLUDE });
    if (!application) throw new NotFoundError('Application not found');
    if (spec.to === 'APPROVED' && application.form.kind === 'PAID') {
      const tiers = application.form.tiers.filter((t) => t.isActive);
      const vendorChooses = tierId === null && application.form.spaceSelection !== 'MAP';
      const tier = vendorChooses ? null :
        (tierId && application.form.tiers.find((t) => t.id === tierId)) ||
        (tiers.length === 1 ? tiers[0] : null) ||
        application.tier ||
        null;
      const preview = { ...application, tier, tierId: tier?.id ?? null, status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', decidedAt: new Date() };
      return applicationTemplateService.render(organizationId, 'CHOOSE_SPACE', preview);
    }
    return applicationTemplateService.render(organizationId, spec.action, application);
  }

  /**
   * Spec 037 D4: the category an approval assigns — the organizer's pick
   * (`tierId`), else the one already on the application, else the form's only
   * active tier. Required when the form has several.
   */
  _resolveCategory(form, application, tierId) {
    const active = form.tiers.filter((t) => t.isActive);
    if (tierId) {
      const tier = form.tiers.find((t) => t.id === tierId);
      if (!tier) throw new NotFoundError('Category not found on this form');
      if (!tier.isActive) throw new ValidationError(`${tier.name} is not active`);
      return tier;
    }
    const current = application.tierId ? form.tiers.find((t) => t.id === application.tierId && t.isActive) : null;
    if (current) return current;
    if (active.length === 1) return active[0];
    if (active.length === 0) throw new ConflictError('This form has no active category to approve into');
    throw coded(new ValidationError('Choose a category for this vendor'), 'CATEGORY_REQUIRED');
  }

  /**
   * Spec 039 D2 / D9: a MAP form approves into a category only while the
   * event's published map has spots in it — otherwise the vendor would be
   * asked to choose from nothing.
   */
  async _assertSpotsInCategory(tx, eventId, tier) {
    const spots = await tx.booth.count({ where: { tierId: tier.id, map: { eventId, status: 'PUBLISHED' } } });
    if (spots === 0) {
      throw coded(new ConflictError(`${tier.name} has no spots on the published floor map`), 'NO_SPOTS_IN_CATEGORY');
    }
  }

  /**
   * Organizer decision. Approving a FREE application takes its tier slot
   * (legacy tiered FREE rows) and is final. Approving a PAID application
   * (spec 037 phase 5) assigns the category (`input.tierId`, see
   * `_resolveCategory`), takes a slot in it when the form reserves on
   * approval (409 with a Waitlist suggestion when full), and moves to
   * AWAITING_SELECTION: nothing is charged, the vendor is emailed to choose
   * their space (CHOOSE_SPACE template). Leaving APPROVED releases whatever
   * the application holds, a held space included.
   *
   * @param {{ decision: 'APPROVE'|'REJECT'|'WAITLIST'|'WITHDRAW', tierId?: string|null, note?: string, message?: { subject: string, body: string }|null, sendEmail?: boolean, byUserId: string }} input
   */
  async decide(eventId, applicationId, organizationId, input) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const spec = DECISIONS[input.decision];
    if (!spec) throw new ValidationError('decision must be APPROVE, REJECT, WAITLIST or WITHDRAW');
    const note = input.note ? String(input.note).slice(0, 5000) : null;
    const override = this._validateMessage(input.message);

    let supersededSessionId = null;
    const { updated, emailAction } = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`SELECT * FROM "Application" WHERE "id" = ${applicationId} AND "eventId" = ${eventId} FOR UPDATE`;
      const application = rows[0];
      if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
      if (!spec.from.includes(application.status)) {
        throw new ConflictError(`Cannot ${input.decision.toLowerCase()} an application that is ${application.status.toLowerCase()}`);
      }
      if (application.paymentStatus === 'PROCESSING') throw new ConflictError('A payment is in progress for this application; try again in a moment');
      const form = await tx.applicationForm.findUnique({
        where: { id: application.formId },
        select: { kind: true, eventId: true, reserveOnApproval: true, spaceSelection: true, tiers: { orderBy: { displayOrder: 'asc' } } },
      });

      const data = { status: spec.to, decidedAt: new Date(), decidedById: input.byUserId };
      // Any decision ends the pay-now session the vendor may still have open
      // (it is expired on Stripe after commit), so it can never pay a
      // withdrawn, rejected or re-approved application.
      if (application.stripeCheckoutSessionId && !['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(application.paymentStatus)) {
        supersededSessionId = application.stripeCheckoutSessionId;
        data.stripeCheckoutSessionId = null;
      }
      let action = spec.action;
      if (spec.to === 'APPROVED' && form.kind === 'PAID') {
        if (!paymentsEnabled()) throw new ConflictError('Application payments are not enabled');
        // Spec 039 D6: on a TIERS form an explicit `tierId: null` approves
        // without a category — the vendor picks one when choosing, and no
        // slot is taken until then. A MAP form always locks the category (D2).
        const vendorChooses = input.tierId === null && form.spaceSelection !== 'MAP';
        if (input.tierId === null && !vendorChooses) {
          throw coded(new ValidationError('Choose the category whose spots this vendor may pick'), 'CATEGORY_REQUIRED');
        }
        const tier = vendorChooses ? null : this._resolveCategory(form, application, input.tierId);
        if (tier && form.spaceSelection === 'MAP') await this._assertSpotsInCategory(tx, form.eventId, tier);
        // A slot held for an earlier category (a migrated row) moves with it.
        if (application.capacitySlot !== 'NONE' && application.tierId && application.tierId !== tier?.id) {
          await this._releaseCapacity(tx, application);
          application.capacitySlot = 'NONE';
        }
        let capacitySlot = application.capacitySlot;
        if (tier && form.reserveOnApproval !== false && capacitySlot === 'NONE') {
          await this._takeTierSlot(tx, tier, 'RESERVED', { onFull: 'WAITLIST' });
          capacitySlot = 'RESERVED';
        }
        Object.assign(data, {
          tierId: tier?.id ?? null,
          tierChosenByVendor: false,
          capacitySlot,
          paymentStatus: 'AWAITING_SELECTION',
          selectionHeldUntil: null,
          stripeCheckoutSessionId: null,
          overdue: false,
        });
        action = 'CHOOSE_SPACE';
      } else if (spec.to === 'APPROVED') {
        if (application.tierId) {
          await this._takeCapacity(tx, application, 'APPROVED');
          data.capacitySlot = 'APPROVED';
        }
      } else {
        // Leaving APPROVED (withdraw) releases the slot and, through the live
        // order, any held add-ons; the booth follows below.
        if (application.capacitySlot !== 'NONE') {
          await this._releaseCapacity(tx, application);
          data.capacitySlot = 'NONE';
        }
        if (application.selectionHeldUntil) data.selectionHeldUntil = null;
      }
      if (spec.to === 'WITHDRAWN') {
        await boothService.releaseForApplication(applicationId, { tx });
        data.withdrawnBy = 'ORGANIZER';
        data.withdrawReason = note;
      }

      const row = await this._transition(tx, applicationId, {
        ...data,
        decisions: { create: { action: spec.action, byUserId: input.byUserId, note } },
      });
      return { updated: row, emailAction: action };
    });

    if (supersededSessionId) await applicationPaymentService.expireSupersededSession(applicationId, supersededSessionId);

    logger.info('Application decided', {
      event: 'application_decided',
      applicationId,
      eventId,
      action: spec.action,
      byUserId: input.byUserId,
    });

    const action = emailAction;
    if (input.sendEmail !== false && action) {
      const current = updated;
      const statusUrl = await statusUrlFor(current);
      const sent = await applicationTemplateService.send(organizationId, action, { ...current, statusUrl }, { override, payNowUrl: statusUrl });
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
      // A held booth must still be held while the card is charged.
      const booth = await boothService.boothForApplication(applicationId, { tx });
      if (booth?.status === 'HELD') {
        await boothService.beginPayment(applicationId, { tx, markProcessing: false });
      }
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

      const booth = await boothService.boothForApplication(application.id, { tx });
      const data = this._orderData(application, { booth, addOnLines: validated });
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

    const { updated, note, sessionId, orderless } = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${applicationId} AND "eventId" = ${eventId} FOR UPDATE`;
      if (!locked[0]) throw new NotFoundError('Application not found');
      const application = await tx.application.findUnique({ where: { id: applicationId }, include: DETAIL_INCLUDE });
      if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
      const editable = tierEditable(application);
      if (!editable.allowed) throw new ConflictError(editable.reason);
      if (application.tierId === tierId) throw new ValidationError('The application is already on that tier');
      const newTier = await tx.applicationTier.findFirst({ where: { id: tierId, formId: application.formId } });
      if (!newTier) throw new NotFoundError('Tier not found on this form');
      if (!newTier.isActive) throw new ValidationError(`${newTier.name} is not active`);

      // Spec 037 phase 5: no order yet (under review, or approved and still
      // choosing): the category moves, with the approval slot when it holds one.
      if (!hasLiveOrder(application)) {
        if (application.tierId && application.capacitySlot === 'RESERVED') {
          await tx.$executeRaw`UPDATE "ApplicationTier" SET "quantityReserved" = GREATEST("quantityReserved" - 1, 0) WHERE "id" = ${application.tierId}`;
          await this._takeTierSlot(tx, newTier, 'RESERVED', { onFull: 'WAITLIST' });
        }
        // Spec 039 D6: the organizer locking a tier on a vendor who was left
        // to choose takes the slot a reserving approval would have taken.
        let capacitySlot = application.capacitySlot;
        if (
          !application.tierId && application.status === 'APPROVED' && application.paymentStatus === 'AWAITING_SELECTION' &&
          capacitySlot === 'NONE' && application.form.reserveOnApproval !== false
        ) {
          await this._takeTierSlot(tx, newTier, 'RESERVED', { onFull: 'WAITLIST' });
          capacitySlot = 'RESERVED';
        }
        const noteText = `Category: ${application.tier?.name ?? 'none'} → ${newTier.name}.`;
        const row = await tx.application.update({
          where: { id: applicationId },
          data: { tierId: newTier.id, tierChosenByVendor: false, capacitySlot, decisions: { create: { action: 'TIER_CHANGED', byUserId, note: noteText } } },
          include: DETAIL_INCLUDE,
        });
        return { updated: row, note: noteText, sessionId: null, orderless: true };
      }
      if (!amountEditable(application, 'the tier').allowed) throw new ConflictError(amountEditable(application, 'the tier').reason);

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
      await boothService.releaseForApplication(applicationId, { tx });

      // The booth went back above, so the new tier's own price applies.
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
    if (orderless) {
      // Nothing is priced yet; a vendor already choosing hears about their new category.
      const action = updated.status === 'APPROVED' && updated.paymentStatus === 'AWAITING_SELECTION' ? 'CHOOSE_SPACE' : null;
      await this._afterAmountChange(organizationId, updated, null, action, sendEmail);
    } else {
      await this._afterAmountChange(organizationId, updated, sessionId, 'TIER_CHANGED', sendEmail);
    }
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
      const booth = await boothService.boothForApplication(application.id, { tx });
      const spacePrice = spacePriceFor({ tier: application.tier, booth });
      if (spacePrice + total < -1e-9) {
        throw new ValidationError(`Adjustment exceeds the space price (${money(spacePrice)}); edit add-ons or waive the balance instead`);
      }
      const row = await this._rewriteOrder(
        tx,
        application,
        this._orderData(application, { booth, adjustments }),
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
      const booth = await boothService.boothForApplication(application.id, { tx });
      const row = await this._rewriteOrder(
        tx,
        application,
        this._orderData(application, { booth, adjustments: items.filter((a) => a.id !== adjustmentId) }),
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
          selectionHeldUntil: null,
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
          selectionHeldUntil: null,
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
    await applicationPaymentService.sendReceipt(applicationId);
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
    if (application.paymentStatus !== 'AWAITING_SELECTION') return application;
    // Spec 037 phase 5: settling before the vendor chose a space pays for the
    // category alone (staff place them later). Take the slot when the
    // approval did not, and open the order the settlement is recorded on.
    if (application.capacitySlot === 'NONE') await this._takeTierSlot(tx, application.tier, 'RESERVED');
    const adjustments = application.order ? adjustmentItems(application.order).filter((i) => i.kind === 'ADJUSTMENT') : [];
    const booth = await boothService.boothForApplication(applicationId, { tx });
    const data = orderLineService.applicationOrderData(application.tier, application.form, [], adjustments, application.event, application.event.venue.organization, { booth });
    if (application.order) {
      await orderLineService.rewriteApplicationOrder(tx, application.order.id, data, { status: 'PENDING', paidAt: null });
    } else {
      await orderService.createApplicationOrder(tx, { application, data });
    }
    await this._transition(tx, applicationId, { paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' }, { include: null });
    return this._reload(tx, applicationId);
  }

  /** RESERVED → APPROVED for the tier and add-on holds, as `_markPaid` does after a Stripe payment. */
  async _confirmHeldSlot(tx, application) {
    if (application.tierId && application.capacitySlot === 'RESERVED') {
      await tx.$executeRaw`UPDATE "ApplicationTier" SET "quantityReserved" = GREATEST("quantityReserved" - 1, 0), "quantityApproved" = "quantityApproved" + 1 WHERE "id" = ${application.tierId}`;
      const lines = await this._addOnLines(tx, application.id);
      if (lines.length) await addOnService.commit(tx, lines);
    }
    // A booth the vendor holds becomes theirs with the payment (spec 014 phase 2).
    const booth = await boothService.boothForApplication(application.id, { tx });
    if (booth?.status === 'HELD' && booth.holdApplicationId === application.id) {
      await boothService.claimBooth(application.id, booth.id, { tx });
    }
  }

  /**
   * Spec 024: order lines and totals for the application's current tier,
   * add-on lines and adjustments, with any of the three replaced. `booth` is
   * the space it holds or was placed on (spec 039: its price wins); callers
   * load it with `boothService.boothForApplication` inside their transaction.
   */
  _orderData(application, { tier = application.tier, booth = null, addOnLines = null, adjustments = null } = {}) {
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
      application.event.venue.organization,
      { booth }
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
            venue: { select: { timezone: true, organization: { select: { name: true } } } },
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
            status: true,
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
    // Spec 037 phase 5: a cancelled order on a row still in play owes nothing.
    for (const a of rows) if (!hasLiveOrder(a)) a.order = null;
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

  /**
   * Add-on lines of an application in lock order, shaped for AddOnService
   * reserve / release / commit. Only a live order's lines hold inventory: a
   * CANCELLED order (spec 037 phase 5: an expired selection, or one from
   * before apply-then-choose) has already given its lines back.
   */
  async _addOnLines(tx, applicationId) {
    const rows = await tx.orderAddOn.findMany({
      where: { order: { applicationId, status: { not: 'CANCELLED' } } },
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

  /**
   * Spec 037 phase 5: one slot in a category, nothing else (add-ons are
   * chosen at selection). Conditional UPDATE … RETURNING like `_takeCapacity`.
   * A full category is 409: on approval with a Waitlist suggestion, at
   * selection with code SOLD_OUT.
   */
  async _takeTierSlot(tx, tier, slot, { onFull = null } = {}) {
    const column = slot === 'APPROVED' ? 'quantityApproved' : 'quantityReserved';
    const rows = await tx.$queryRawUnsafe(
      `UPDATE "ApplicationTier" SET "${column}" = "${column}" + 1
       WHERE "id" = $1 AND ("quantityTotal" - "quantityApproved" - "quantityReserved") >= 1
       RETURNING "id"`,
      tier.id
    );
    if (rows && rows.length > 0) return;
    if (onFull === 'WAITLIST') {
      throw new ConflictError(`${tier.name} is full. Waitlist the application or raise the category's quantity.`, { tierId: tier.id, suggestion: 'WAITLIST' });
    }
    throw coded(new ConflictError(`No ${tier.name} spaces are left.`, { tierId: tier.id }), 'SOLD_OUT');
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
    const email = normalizeEmail(contact.email);
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
    if (query.addOn) {
      // Lines on the live order (spec 037 phase 5: an expired selection's
      // cancelled order gave its lines back; rejected / withdrawn keep theirs).
      where.order = { addOns: { some: { addOnId: String(query.addOn) } } };
      where.AND = [
        ...(where.AND || []),
        { OR: [{ order: { status: { not: 'CANCELLED' } } }, { status: { in: ['REJECTED', 'WITHDRAWN'] } }] },
      ];
    }
    if (query.tag) where.tags = { has: String(query.tag) };
    if (query.status) {
      const list = String(query.status).split(',').filter((s) => STATUSES.has(s) && s !== 'DRAFT');
      if (list.length) where.status = { in: list };
    }
    if (query.payment) {
      const list = String(query.payment).split(',').filter((s) => PAYMENT_STATUSES.has(s));
      if (list.length) where.paymentStatus = { in: list };
    }
    // Spec 014 phase 2: "Booth not chosen" = approved on a map-bound tier with
    // no booth owned yet (a HELD booth is still unpaid, so it counts as not
    // chosen). Spec 037 phase 5: map-bound = the event's published map has
    // booths on the tier.
    if (query.booth === 'none') {
      // ANDed with any status filter the user picked: a status the filter
      // excludes just yields no rows instead of silently overriding it.
      where.AND = [...(where.AND || []), { status: 'APPROVED' }];
      where.tier = { booths: { some: { map: { status: 'PUBLISHED' } } } };
      where.booth = null;
    } else if (query.booth === 'chosen') {
      where.booth = { isNot: null };
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
    if (!a.tier || a.form?.kind !== 'PAID') return null;
    if (!hasLiveOrder(a)) {
      // Spec 037 phase 5: no order yet — what the category costs today.
      const now = orderLineService.applicationOrderData(a.tier, a.form, [], [], a.event, a.event?.venue?.organization, { booth: a.mapBooth ?? null }).amounts;
      return { currentApplicantPays: now.applicantPays, currentOrgReceives: now.orgReceives, changed: false };
    }
    const m = moneyOf(a);
    const lines = m.addOns.map((l) => ({ addOn: l.addOn, quantity: l.quantity }));
    const now = orderLineService.applicationOrderData(
      a.tier,
      a.form,
      lines,
      adjustmentItems(a.order),
      a.event,
      a.event?.venue?.organization,
      // Spec 039: the booth's own price, when the rows went through attachBooths.
      { booth: a.mapBooth ?? null }
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
      event: a.event ? { id: a.event.id, name: a.event.name, date: a.event.date, timezone: a.event.venue?.timezone ?? null } : null,
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
      // Spec 037 phase 5: a cancelled order on a row still in play is not shown.
      orderId: hasLiveOrder(a) ? a.order.id : null,
      orderRef: hasLiveOrder(a) ? a.order.orderRef : null,
      applicantPays: hasLiveOrder(a) ? Number(a.order.totalAmount ?? 0) : 0,
      addOns: (hasLiveOrder(a) ? a.order.addOns || [] : []).map((l) => ({
        addOnId: l.addOnId,
        name: l.name ?? l.addOn?.name ?? null,
        quantity: l.quantity,
      })),
      submittedAt: a.submittedAt,
      decidedAt: a.decidedAt,
      // The payment clock: the order's due date, or approval + paymentDueDays while choosing.
      paymentDueAt: selectionDueAt(a) ?? (hasLiveOrder(a) ? a.order.dueAt ?? null : null),
      overdue: a.overdue,
      boothLabel: a.boothLabel,
      // Spec 014 phase 2: the Booth column — owned or held; `mapBound` tells
      // "not chosen" apart from "this tier is not sold from a map".
      booth: a.mapBooth ? { id: a.mapBooth.id, label: a.mapBooth.label, status: a.mapBooth.status } : null,
      mapBound: a.tierMapBound === true,
      selectionHeldUntil: a.selectionHeldUntil ?? null,
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
    const { tiers: formTiers = [], ...form } = a.form || {};
    return {
      id: a.id,
      orderId: m.orderId,
      orderRef: m.orderRef,
      form: { ...form, reserveOnApproval: form.reserveOnApproval !== false },
      // Spec 037 phase 5: the categories an approval can assign, with what is left.
      categories: formTiers.map((t) => ({
        id: t.id,
        name: t.name,
        price: Number(t.price),
        isActive: t.isActive,
        remaining: Math.max(0, t.quantityTotal - t.quantityApproved - t.quantityReserved),
      })),
      event: { id: a.event.id, name: a.event.name, date: a.event.date, timezone: a.event.venue?.timezone ?? null },
      status: a.status,
      paymentStatus: a.paymentStatus,
      capacitySlot: a.capacitySlot,
      // Spec 037 phase 5: while set, the vendor holds a chosen space and is paying for it.
      selectionHeldUntil: a.selectionHeldUntil ?? null,
      contact: this._contact(a.contact),
      profile: applicantProfileService.serialize(a.profile),
      tier: a.tier ? { id: a.tier.id, name: a.tier.name, price: Number(a.tier.price), mapBound: a.tierMapBound === true } : null,
      tierEditable: tierEditable(a),
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
        paymentDueAt: m.paymentDueAt ?? selectionDueAt(a),
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
      // Spec 014: owned (SOLD / RESERVED) or, phase 2, HELD while the vendor pays.
      booth: a.mapBooth ? boothView(a) : a.booth ? { id: a.booth.id, label: a.booth.label, mapId: a.booth.mapId, status: 'SOLD', w: null, h: null, holdExpiresAt: null } : null,
      publicProfile: a.publicProfile,
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
      event: { id: a.event.id, name: a.event.name, date: a.event.date, timezone: a.event.venue?.timezone ?? null },
      organization: a.event.venue?.organization ? { id: a.event.venue.organization.id, name: a.event.venue.organization.name } : null,
      status: a.status,
      paymentStatus: a.paymentStatus,
      tier: a.tier ? { id: a.tier.id, name: a.tier.name, mapBound: a.tierMapBound === true } : null,
      amounts: this._amounts(a),
      addOns: m.addOns.map(({ addOn: _addOn, ...l }) => l),
      adjustments: m.adjustments
        .filter((adj) => adj.kind !== 'WAIVER')
        .map((adj) => ({ id: adj.id, amount: adj.amount, reason: adj.reason })),
      paymentSource: m.paymentSource === 'OFFLINE' ? 'offline' : 'stripe',
      paymentDueAt: m.paymentDueAt ?? selectionDueAt(a),
      // Spec 037 phase 5: choose your space (list / map), or finish paying for the one held.
      selection: a.selectionView ?? null,
      profile: applicantProfileService.serialize(a.profile),
      answers: this._serializeAnswers(a).filter((ans) => !ans.archived),
      boothLabel: a.boothLabel,
      // Spec 014 phase 2: the booth picker needs the current booth (owned or
      // held, with the hold deadline) and whether a saved card will be charged.
      booth: boothView(a),
      hasCardOnFile: Boolean(a.stripePaymentMethodId),
      submittedAt: a.submittedAt,
      decidedAt: a.decidedAt,
      paidAt: m.paidAt,
      refundedTotal: m.refundedTotal,
      canWithdraw:
        ['SUBMITTED', 'WAITLISTED'].includes(a.status) && a.paymentStatus !== 'PROCESSING',
      canResume: a.status === 'DRAFT' && a.form.kind === 'PAID',
      canPay: a.status === 'APPROVED' && a.paymentStatus === 'PAYMENT_DUE',
      canUpdateCard:
        ['SUBMITTED', 'WAITLISTED', 'APPROVED'].includes(a.status) &&
        (['CARD_ON_FILE', 'PAYMENT_DUE'].includes(a.paymentStatus) ||
          (['NOT_DUE', 'AWAITING_SELECTION'].includes(a.paymentStatus) && Boolean(a.stripePaymentMethodId))),
    };
  }
}

export default new ApplicationService();
