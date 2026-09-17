// Application Payment Service (spec 011 phase 2)
// Everything that touches Stripe for a paid application:
//   - Checkout sessions: setup (card on file at submission), payment (pay at
//     submission, pay-now after a failed charge), update-card
//   - the off-session charge at approval, routed like ticket orders (spec 010:
//     statement descriptor, Connect destination + application fee)
//   - webhook handlers keyed on metadata.applicationId (idempotent)
//   - refunds, and the overdue sweep for PAYMENT_DUE applications
//
// The amount snapshot on the application row is the only amount ever charged.
// Capacity: approval reserves a slot (quantityReserved); PAID moves it to
// quantityApproved; a failed / overdue payment releases it.

import stripe from '../config/stripe.js';
import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import applicationTemplateService from './ApplicationTemplateService.js';
import paymentSettingsService, { stripeMode } from './PaymentSettingsService.js';
import { createStripeRefund } from './stripeRefund.js';
import { statusUrlFor } from './applicationLinks.js';
import logger from '../utils/logger.js';

const SESSION_TTL_SECONDS = 30 * 60;
const APPLICATION_EVENT_PREFIXES = ['checkout.session.', 'setup_intent.', 'payment_intent.'];

export const cents = (value) => Math.round((Number(value) + Number.EPSILON) * 100);

const PAYMENT_INCLUDE = {
  contact: true,
  profile: { include: { images: { include: { image: { include: { file: true } } }, orderBy: { displayOrder: 'asc' } } } },
  tier: true,
  form: true,
  event: { select: { id: true, name: true, date: true, venue: { select: { organizationId: true, organization: true } } } },
  answers: { include: { question: true, image: { include: { file: true } } } },
  decisions: { orderBy: { createdAt: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
};

/** Stripe declines that a hosted pay-now page can recover from (3DS etc.). */
function isCardFailure(error) {
  return error?.type === 'StripeCardError' || error?.code === 'authentication_required' || error?.code === 'card_declined';
}

class ApplicationPaymentService {
  // ---------------------------------------------------------------------------
  // Stripe customer
  // ---------------------------------------------------------------------------

  /** Platform-account Customer holding the applicant's saved card; created once per Contact. */
  async ensureCustomer(contact) {
    if (contact.stripeCustomerId) return contact.stripeCustomerId;
    const customer = await stripe.customers.create({
      email: contact.email,
      name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || undefined,
      metadata: { contactId: contact.id, organizationId: contact.organizationId, source: 'jump-applications' },
    });
    await prisma.contact.update({ where: { id: contact.id }, data: { stripeCustomerId: customer.id } });
    return customer.id;
  }

  // ---------------------------------------------------------------------------
  // Checkout sessions
  // ---------------------------------------------------------------------------

  /**
   * Checkout for a DRAFT paid application: setup mode when the form charges at
   * approval, payment mode when it charges at submission. Stores the session
   * id so the webhook can find the row. Returns the hosted URL.
   */
  async checkoutForSubmission(application, statusUrl) {
    if (application.status !== 'DRAFT') throw new ConflictError('This application has already been submitted');
    const setup = application.form.chargeTiming === 'APPROVAL';
    const session = setup ? await this._setupSession(application, statusUrl) : await this._paymentSession(application, statusUrl, 'submit');
    await prisma.application.update({ where: { id: application.id }, data: { stripeCheckoutSessionId: session.id } });
    return session.url;
  }

  /** Pay-now for an APPROVED application whose card charge failed. */
  async payNowUrl(application, statusUrl) {
    if (application.status !== 'APPROVED' || application.paymentStatus !== 'PAYMENT_DUE') {
      throw new ConflictError('There is no outstanding balance on this application');
    }
    const session = await this._paymentSession(application, statusUrl, 'pay_now');
    await prisma.application.update({ where: { id: application.id }, data: { stripeCheckoutSessionId: session.id } });
    return session.url;
  }

  /** Replace the saved card (buyer account). Allowed while a charge can still happen. */
  async updateCardUrl(application, statusUrl) {
    if (!['CARD_ON_FILE', 'PAYMENT_DUE'].includes(application.paymentStatus) || !['SUBMITTED', 'WAITLISTED', 'APPROVED'].includes(application.status)) {
      throw new ConflictError('This application does not have a card to update');
    }
    const session = await this._setupSession(application, statusUrl, { purpose: 'update_card' });
    return session.url;
  }

  async _setupSession(application, statusUrl, { purpose = 'submit' } = {}) {
    const customer = await this.ensureCustomer(application.contact);
    return stripe.checkout.sessions.create({
      mode: 'setup',
      customer,
      payment_method_types: ['card'],
      metadata: { applicationId: application.id, organizationId: application.organizationId, purpose },
      setup_intent_data: { metadata: { applicationId: application.id, organizationId: application.organizationId, purpose } },
      success_url: this._returnUrl(statusUrl, purpose === 'update_card' ? 'card_updated' : 'submitted'),
      cancel_url: this._returnUrl(statusUrl, 'cancelled'),
      expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    });
  }

  async _paymentSession(application, statusUrl, purpose) {
    const organization = application.event.venue.organization;
    const customer = await this.ensureCustomer(application.contact);
    const charge = this._chargeFor(application);
    const checkoutOptions = await paymentSettingsService.checkoutOptionsFor(organization, charge);
    return stripe.checkout.sessions.create({
      mode: 'payment',
      ...checkoutOptions,
      payment_intent_data: {
        ...checkoutOptions.payment_intent_data,
        metadata: { applicationId: application.id, organizationId: application.organizationId, purpose },
      },
      customer,
      line_items: charge.lineItems,
      metadata: { applicationId: application.id, organizationId: application.organizationId, purpose },
      success_url: this._returnUrl(statusUrl, purpose === 'pay_now' ? 'paid' : 'submitted'),
      cancel_url: this._returnUrl(statusUrl, 'cancelled'),
      expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    });
  }

  /** The spec 010 charge shape: one all-in line item, subtotal = what the organization receives. */
  _chargeFor(application) {
    return {
      fees: { subtotal: Number(application.orgReceives) },
      lineItems: [
        {
          price_data: {
            currency: application.currency || 'usd',
            product_data: {
              name: `${application.event.name} — ${application.form.name}${application.tier ? ` (${application.tier.name})` : ''}`,
              description: application.profile?.businessName || undefined,
            },
            unit_amount: cents(application.applicantPays),
          },
          quantity: 1,
        },
      ],
    };
  }

  _returnUrl(statusUrl, checkout) {
    return `${statusUrl}${statusUrl.includes('?') ? '&' : '?'}checkout=${checkout}`;
  }

  // ---------------------------------------------------------------------------
  // Off-session charge at approval
  // ---------------------------------------------------------------------------

  /**
   * Charge the saved card for an application that was just approved (the
   * approval transaction already reserved the tier slot and bumped
   * chargeAttempts). Never throws for a card problem: the outcome is written to
   * the row and returned so the caller can pick the email.
   * @returns {Promise<'PAID'|'PROCESSING'|'PAYMENT_DUE'>}
   */
  async chargeOnApproval(applicationId) {
    const application = await prisma.application.findUnique({ where: { id: applicationId }, include: PAYMENT_INCLUDE });
    if (!application) throw new NotFoundError('Application not found');
    if (application.paymentStatus !== 'PROCESSING') return application.paymentStatus;
    if (!application.stripePaymentMethodId) return this._markPaymentDue(application, 'No card on file');

    const organization = application.event.venue.organization;
    const customer = await this.ensureCustomer(application.contact);
    const options = await paymentSettingsService.checkoutOptionsFor(organization, this._chargeFor(application));
    const routing = options.payment_intent_data || {};
    const amount = cents(application.applicantPays);
    let intent;
    try {
      intent = await stripe.paymentIntents.create(
        {
          amount,
          currency: application.currency || 'usd',
          customer,
          payment_method: application.stripePaymentMethodId,
          off_session: true,
          confirm: true,
          payment_method_types: ['card'],
          description: `${application.event.name} — ${application.form.name}${application.tier ? ` (${application.tier.name})` : ''}`,
          ...(routing.statement_descriptor_suffix && { statement_descriptor_suffix: routing.statement_descriptor_suffix }),
          ...(routing.transfer_data && { transfer_data: routing.transfer_data, application_fee_amount: routing.application_fee_amount }),
          metadata: { applicationId: application.id, organizationId: application.organizationId, purpose: 'approval' },
        },
        { idempotencyKey: `application:${application.id}:charge:${application.chargeAttempts}` }
      );
    } catch (error) {
      const intentId = error?.raw?.payment_intent?.id || error?.payment_intent?.id || null;
      logger.warn('Application off-session charge failed', {
        event: 'application_charge_failed',
        applicationId: application.id,
        code: error?.code,
        error: error.message,
      });
      if (!isCardFailure(error) && !intentId) {
        // Stripe / network problem, not the card: leave PROCESSING so the
        // organizer retries; the webhook will reconcile if the intent exists.
        await prisma.application.update({ where: { id: application.id }, data: { paymentStatus: 'CARD_ON_FILE', capacitySlot: 'RESERVED' } });
        throw new ValidationError(`Could not charge the card on file: ${error.message}`);
      }
      return this._markPaymentDue(application, error.message, intentId);
    }

    const routedTo = routing.transfer_data?.destination || null;
    await prisma.application.update({
      where: { id: application.id },
      data: {
        stripePaymentIntentId: intent.id,
        stripeAccountId: routedTo,
        applicationFee: routedTo ? routing.application_fee_amount / 100 : null,
      },
    });
    if (intent.status === 'succeeded') {
      await this._markPaid(application.id, intent.id, { source: 'approval' });
      return 'PAID';
    }
    if (intent.status === 'processing') return 'PROCESSING';
    return this._markPaymentDue(application, `Payment intent ${intent.status}`, intent.id);
  }

  // ---------------------------------------------------------------------------
  // State transitions (shared by the charge path and the webhooks)
  // ---------------------------------------------------------------------------

  /**
   * PAID: capacity RESERVED → APPROVED, clear the due date. Idempotent on
   * paymentStatus. Returns true when the transition happened now.
   */
  async _markPaid(applicationId, paymentIntentId, { source }) {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`SELECT * FROM "Application" WHERE "id" = ${applicationId} FOR UPDATE`;
      const application = rows[0];
      if (!application || ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(application.paymentStatus)) return false;
      const data = { paymentStatus: 'PAID', paidAt: new Date(), overdue: false, paymentDueAt: null };
      if (paymentIntentId && application.stripePaymentIntentId !== paymentIntentId) data.stripePaymentIntentId = paymentIntentId;
      if (application.tierId && application.capacitySlot === 'RESERVED') {
        await tx.$executeRaw`UPDATE "ApplicationTier" SET "quantityReserved" = GREATEST("quantityReserved" - 1, 0), "quantityApproved" = "quantityApproved" + 1 WHERE "id" = ${application.tierId}`;
        data.capacitySlot = 'APPROVED';
      }
      if (application.status === 'DRAFT') {
        // Pay-at-submission: the payment is the submission.
        data.status = 'SUBMITTED';
        data.submittedAt = new Date();
      }
      await tx.application.update({ where: { id: applicationId }, data });
      logger.info('Application paid', { event: 'application_paid', applicationId, paymentIntentId, source });
      return true;
    });
  }

  /** Charge failed: keep the reserved slot, start the pay-now clock. */
  async _markPaymentDue(application, reason, paymentIntentId = null) {
    const dueDays = application.form?.paymentDueDays ?? 7;
    const paymentDueAt = application.paymentDueAt || new Date(Date.now() + dueDays * 86_400_000);
    await prisma.application.update({
      where: { id: application.id },
      data: {
        paymentStatus: 'PAYMENT_DUE',
        paymentDueAt,
        ...(paymentIntentId && { stripePaymentIntentId: paymentIntentId }),
      },
    });
    logger.warn('Application payment due', { event: 'application_payment_due', applicationId: application.id, reason, paymentDueAt });
    return 'PAYMENT_DUE';
  }

  /** Setup complete: the card is on file and the application is submitted. */
  async _markCardOnFile(applicationId, paymentMethodId, customerId, { purpose }) {
    return prisma.$transaction(async (tx) => {
      const application = await tx.application.findUnique({ where: { id: applicationId }, select: { id: true, status: true, paymentStatus: true, contactId: true } });
      if (!application) return null;
      if (customerId) await tx.contact.update({ where: { id: application.contactId }, data: { stripeCustomerId: customerId } }).catch(() => {});
      const data = { stripePaymentMethodId: paymentMethodId };
      let transition = null;
      if (application.status === 'DRAFT') {
        Object.assign(data, { status: 'SUBMITTED', submittedAt: new Date(), paymentStatus: 'CARD_ON_FILE' });
        transition = 'SUBMITTED';
      } else if (purpose === 'update_card' && application.paymentStatus === 'PAYMENT_DUE') {
        // A new card after a failed charge: leave PAYMENT_DUE, the applicant pays now or the organizer retries.
        transition = 'CARD_UPDATED';
      } else if (purpose === 'update_card') {
        transition = 'CARD_UPDATED';
      }
      await tx.application.update({ where: { id: applicationId }, data });
      return transition;
    });
  }

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  /** Platform-endpoint events that belong to an application (metadata.applicationId). */
  isApplicationEvent(event) {
    const type = event?.type || '';
    if (!APPLICATION_EVENT_PREFIXES.some((p) => type.startsWith(p))) return false;
    return Boolean(event.data?.object?.metadata?.applicationId);
  }

  /** charge.refunded needs a row lookup: the charge carries the PaymentIntent id. */
  async isApplicationRefundEvent(event) {
    if (event?.type !== 'charge.refunded') return false;
    const charge = event.data?.object;
    if (charge?.metadata?.applicationId) return true;
    if (!charge?.payment_intent) return false;
    const row = await prisma.application.findUnique({ where: { stripePaymentIntentId: String(charge.payment_intent) }, select: { id: true } });
    return Boolean(row);
  }

  async handleEvent(event) {
    const object = event.data.object;
    const applicationId = object.metadata?.applicationId;
    switch (event.type) {
      case 'checkout.session.completed':
        return this._onCheckoutCompleted(applicationId, object);
      case 'checkout.session.async_payment_succeeded':
        return this._onCheckoutCompleted(applicationId, { ...object, payment_status: 'paid' });
      case 'checkout.session.expired':
        logger.info('Application checkout session expired', { applicationId, sessionId: object.id, mode: object.mode });
        return;
      case 'payment_intent.succeeded':
        return this._onIntentSucceeded(applicationId, object);
      case 'payment_intent.processing':
        logger.info('Application payment processing', { applicationId, paymentIntentId: object.id });
        return;
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
        return this._onIntentFailed(applicationId, object);
      case 'charge.refunded':
        return this._onChargeRefunded(object);
      default:
        logger.info('Unhandled application Stripe event', { type: event.type, applicationId });
    }
  }

  async _onCheckoutCompleted(applicationId, session) {
    if (session.mode === 'setup') {
      const setupIntentId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id;
      const setupIntent = setupIntentId ? await stripe.setupIntents.retrieve(setupIntentId) : null;
      const paymentMethodId = typeof setupIntent?.payment_method === 'string' ? setupIntent.payment_method : setupIntent?.payment_method?.id;
      if (!paymentMethodId) {
        logger.warn('Setup session completed without a payment method', { applicationId, sessionId: session.id });
        return;
      }
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const transition = await this._markCardOnFile(applicationId, paymentMethodId, customerId, { purpose: session.metadata?.purpose });
      if (transition === 'SUBMITTED') await this._sendReceived(applicationId);
      return;
    }
    if (session.payment_status !== 'paid') return;
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    const before = await prisma.application.findUnique({ where: { id: applicationId }, select: { status: true, stripeAccountId: true } });
    if (!before) return;
    if (session.payment_intent && before.stripeAccountId === null) {
      // Destination routing chosen at session time; read it back for the ledger.
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId).catch(() => null);
      const destination = intent?.transfer_data?.destination || null;
      if (destination) {
        await prisma.application.update({
          where: { id: applicationId },
          data: { stripeAccountId: destination, applicationFee: intent.application_fee_amount != null ? intent.application_fee_amount / 100 : null },
        });
      }
    }
    const changed = await this._markPaid(applicationId, paymentIntentId, { source: session.metadata?.purpose || 'checkout' });
    if (!changed) return;
    if (before.status === 'DRAFT') await this._sendReceived(applicationId);
    else await this._send(applicationId, 'APPROVED');
  }

  async _onIntentSucceeded(applicationId, intent) {
    const changed = await this._markPaid(applicationId, intent.id, { source: 'payment_intent' });
    if (changed && intent.metadata?.purpose === 'approval') await this._send(applicationId, 'APPROVED');
  }

  async _onIntentFailed(applicationId, intent) {
    const application = await prisma.application.findUnique({ where: { id: applicationId }, include: { form: true } });
    if (!application || application.paymentStatus !== 'PROCESSING') return;
    await this._markPaymentDue(application, intent.last_payment_error?.message || intent.status, intent.id);
    await this._send(applicationId, 'PAYMENT_DUE');
  }

  /** Reconcile refunds made from the Stripe dashboard. */
  async _onChargeRefunded(charge) {
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    const application = await prisma.application.findFirst({
      where: charge.metadata?.applicationId ? { id: charge.metadata.applicationId } : { stripePaymentIntentId: paymentIntentId },
      include: { refunds: true },
    });
    if (!application) return;
    for (const refund of charge.refunds?.data || []) {
      if (application.refunds.some((r) => r.stripeRefundId === refund.id)) continue;
      await prisma.applicationRefund.create({
        data: { applicationId: application.id, amount: refund.amount / 100, reason: refund.reason || 'external', status: 'SUCCEEDED', stripeRefundId: refund.id, initiatedBy: null },
      });
    }
    await this._recomputeRefundStatus(application.id);
  }

  // ---------------------------------------------------------------------------
  // Refunds
  // ---------------------------------------------------------------------------

  /**
   * Organizer refund (ADMIN). Partial by default when `amount` is given; the
   * review status is untouched — withdraw separately to release the slot.
   */
  async refund(application, { amount = null, reason = null, initiatedBy = null } = {}) {
    if (!['PAID', 'PARTIALLY_REFUNDED'].includes(application.paymentStatus) || !application.stripePaymentIntentId) {
      throw new ConflictError('Only paid applications can be refunded');
    }
    const refunded = (application.refunds || []).filter((r) => r.status === 'SUCCEEDED').reduce((sum, r) => sum + Number(r.amount), 0);
    const remaining = Math.round((Number(application.applicantPays) - refunded) * 100) / 100;
    const value = amount == null ? remaining : Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(value) || value <= 0) throw new ValidationError('amount must be a positive number');
    if (value > remaining + 1e-9) throw new ValidationError(`amount cannot exceed the remaining ${remaining.toFixed(2)}`);

    const row = await prisma.applicationRefund.create({
      data: { applicationId: application.id, amount: value, reason, status: 'PENDING', initiatedBy },
    });
    let stripeRefund;
    try {
      stripeRefund = await createStripeRefund({
        paymentIntentId: application.stripePaymentIntentId,
        amount: value,
        reason,
        connected: Boolean(application.stripeAccountId),
        metadata: { applicationId: application.id },
      });
    } catch (error) {
      await prisma.applicationRefund.update({ where: { id: row.id }, data: { status: 'FAILED' } });
      throw error;
    }
    await prisma.applicationRefund.update({ where: { id: row.id }, data: { status: 'SUCCEEDED', stripeRefundId: stripeRefund.id } });
    await this._recomputeRefundStatus(application.id);
    logger.info('Application refunded', { event: 'application_refunded', applicationId: application.id, amount: value, stripeRefundId: stripeRefund.id, initiatedBy });
    return row.id;
  }

  async _recomputeRefundStatus(applicationId) {
    const application = await prisma.application.findUnique({ where: { id: applicationId }, include: { refunds: true } });
    if (!application) return;
    const refunded = application.refunds.filter((r) => r.status === 'SUCCEEDED').reduce((sum, r) => sum + Number(r.amount), 0);
    if (refunded <= 0) return;
    const full = refunded + 1e-9 >= Number(application.applicantPays);
    await prisma.application.update({ where: { id: applicationId }, data: { paymentStatus: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
  }

  // ---------------------------------------------------------------------------
  // Overdue sweep
  // ---------------------------------------------------------------------------

  /**
   * PAYMENT_DUE past its due date: WITHDRAW policy releases the slot and
   * withdraws (system); HOLD flags the row for the organizer. Runs hourly.
   * @returns {Promise<{ withdrawn: number, held: number }>}
   */
  async sweepOverdue(now = new Date()) {
    const due = await prisma.application.findMany({
      where: { status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', overdue: false, paymentDueAt: { lt: now } },
      include: { form: { select: { overduePolicy: true } } },
      take: 500,
    });
    let withdrawn = 0;
    let held = 0;
    for (const row of due) {
      try {
        if (row.form.overduePolicy === 'WITHDRAW') {
          await prisma.$transaction(async (tx) => {
            if (row.tierId && row.capacitySlot !== 'NONE') {
              const column = row.capacitySlot === 'APPROVED' ? 'quantityApproved' : 'quantityReserved';
              await tx.$executeRawUnsafe(`UPDATE "ApplicationTier" SET "${column}" = GREATEST("${column}" - 1, 0) WHERE "id" = $1`, row.tierId);
            }
            await tx.application.update({
              where: { id: row.id },
              data: {
                status: 'WITHDRAWN',
                overdue: true,
                withdrawnBy: 'SYSTEM',
                withdrawReason: 'payment_overdue',
                capacitySlot: 'NONE',
                decidedAt: now,
                decisions: { create: { action: 'WITHDRAWN', byUserId: null, note: 'Payment overdue' } },
              },
            });
          });
          await this._send(row.id, 'WITHDRAWN');
          withdrawn += 1;
        } else {
          await prisma.application.update({ where: { id: row.id }, data: { overdue: true } });
          held += 1;
        }
      } catch (error) {
        logger.error('Overdue sweep failed for application', { applicationId: row.id, error: error.message });
      }
    }
    if (due.length) logger.info('Application overdue sweep', { event: 'application_overdue_sweep', withdrawn, held });
    return { withdrawn, held };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  dashboardPaymentUrl(paymentIntentId) {
    if (!paymentIntentId) return null;
    return `https://dashboard.stripe.com/${stripeMode() === 'test' ? 'test/' : ''}payments/${paymentIntentId}`;
  }

  async _load(applicationId) {
    return prisma.application.findUnique({ where: { id: applicationId }, include: PAYMENT_INCLUDE });
  }

  async _sendReceived(applicationId) {
    return this._send(applicationId, 'RECEIVED');
  }

  /** Decision emails from the payment path; the raw status link is rebuilt from the id. */
  async _send(applicationId, action) {
    const application = await this._load(applicationId);
    if (!application) return null;
    const statusUrl = await statusUrlFor(application);
    const sent = await applicationTemplateService.send(application.organizationId, action, { ...application, statusUrl }, { payNowUrl: statusUrl });
    if (sent && action !== 'RECEIVED') {
      const decision = [...(application.decisions || [])].reverse().find((d) => d.action === action && !d.emailSubject);
      if (decision) await prisma.applicationDecision.update({ where: { id: decision.id }, data: { emailSubject: sent.subject, emailBody: sent.body } }).catch(() => {});
      else if (action === 'PAYMENT_DUE') await prisma.applicationDecision.create({ data: { applicationId, action: 'PAYMENT_DUE', byUserId: null, emailSubject: sent.subject, emailBody: sent.body } }).catch(() => {});
    }
    return sent;
  }
}

export default new ApplicationPaymentService();
