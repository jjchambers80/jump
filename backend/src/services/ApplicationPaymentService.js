// Application Payment Service (spec 011 phase 2)
// Everything that touches Stripe for a paid application:
//   - Checkout sessions: setup (card on file at submission), payment (pay at
//     submission, pay-now after a failed charge), update-card
//   - the off-session charge at approval, routed like ticket orders (spec 010:
//     statement descriptor, Connect destination + application fee)
//   - webhook handlers keyed on metadata.applicationId (idempotent)
//   - the overdue sweep for PAYMENT_DUE applications
//
// Spec 024: the application's order is the amount snapshot and the ledger —
// its lines are the Stripe line items, its PaymentTransaction is the charge,
// and Order.status is written beside every paymentStatus change through
// orderStatusFor(). Refunds live in RefundService for every order kind.
// Capacity: approval reserves a slot (quantityReserved); PAID moves it to
// quantityApproved; a failed / overdue payment releases it.

import stripe from '../config/stripe.js';
import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import addOnService from './AddOnService.js';
import applicationTemplateService from './ApplicationTemplateService.js';
import paymentSettingsService, { stripeMode } from './PaymentSettingsService.js';
import { statusUrlFor } from './applicationLinks.js';
import { buyerAccountUrl, eventUrl } from '../utils/storefrontUrl.js';
import emailService from './EmailService.js';
import contactOptInService from './ContactOptInService.js';
import boothService from './BoothService.js';
import { ORDER_INCLUDE, adjustmentItems, buyerLineTotal, tierItem } from './OrderLineService.js';
import { orderStatusFor } from './applicationOrderStatus.js';
import logger from '../utils/logger.js';

const SESSION_TTL_SECONDS = 30 * 60;
const APPLICATION_EVENT_PREFIXES = ['checkout.session.', 'setup_intent.', 'payment_intent.'];

export const cents = (value) => Math.round((Number(value) + Number.EPSILON) * 100);

const PAYMENT_INCLUDE = {
  contact: true,
  profile: { include: { images: { include: { image: { include: { file: true } } }, orderBy: { displayOrder: 'asc' } } } },
  tier: true,
  form: true,
  event: { select: { id: true, name: true, date: true, venue: { select: { organizationId: true, timezone: true, organization: true } } } },
  answers: { include: { question: true, image: { include: { file: true } } } },
  decisions: { orderBy: { createdAt: 'asc' } },
  order: { include: ORDER_INCLUDE },
};

/** Stripe metadata that ties a session or intent to the application and its order. */
function metadataFor(application, purpose) {
  return {
    applicationId: application.id,
    organizationId: application.organizationId,
    ...(application.order && {
      orderId: application.order.id,
      orderRef: application.order.orderRef,
    }),
    purpose,
  };
}

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
      metadata: metadataFor(application, purpose),
      setup_intent_data: { metadata: metadataFor(application, purpose) },
      success_url: this._returnUrl(
        statusUrl,
        purpose === 'update_card' ? 'card_updated' : 'submitted'
      ),
      cancel_url: this._returnUrl(statusUrl, 'cancelled'),
      expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    });
  }

  async _paymentSession(application, statusUrl, purpose) {
    const organization = application.event.venue.organization;
    const customer = await this.ensureCustomer(application.contact);
    const charge = this._chargeFor(application);
    const checkoutOptions = await paymentSettingsService.checkoutOptionsFor(organization, charge);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...checkoutOptions,
      payment_intent_data: {
        ...checkoutOptions.payment_intent_data,
        metadata: metadataFor(application, purpose),
      },
      customer,
      line_items: charge.lineItems,
      metadata: metadataFor(application, purpose),
      success_url: this._returnUrl(statusUrl, purpose === 'pay_now' ? 'paid' : 'submitted'),
      cancel_url: this._returnUrl(statusUrl, 'cancelled'),
      expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    });
    // The pending payment row, as OrderService.createOrder writes for a ticket
    // checkout; the webhook fills in the intent id and the outcome.
    const routedTo = checkoutOptions.payment_intent_data?.transfer_data?.destination || null;
    const applicationFeeCents = checkoutOptions.payment_intent_data?.application_fee_amount;
    await this._upsertPayment(prisma, application.order, {
      stripePaymentIntentId:
        typeof session.payment_intent === 'string' ? session.payment_intent : null,
      status: 'PENDING',
      failureReason: null,
      stripeAccountId: routedTo,
      applicationFee: routedTo && applicationFeeCents != null ? applicationFeeCents / 100 : null,
    });
    return session;
  }

  /**
   * One PaymentTransaction per order (plan decision 7.1): created on the first
   * charge attempt, updated in place by later attempts and the webhooks.
   */
  async _upsertPayment(db, order, data) {
    return db.paymentTransaction.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        amount: order.totalAmount,
        currency: order.currency,
        source: 'STRIPE',
        ...data,
      },
      update: {
        amount: order.totalAmount,
        source: 'STRIPE',
        offlineMethod: null,
        offlineReference: null,
        recordedById: null,
        ...data,
      },
    });
  }

  /**
   * The spec 010 charge shape: all-in line items, subtotal = what the
   * organization receives. The tier line carries whatever the add-on lines
   * (spec 012) do not, so the Stripe page itemises exactly the snapshot total.
   */
  _chargeFor(application) {
    const order = application.order;
    const currency = order.currency || 'usd';
    const taxInclusive = application.event?.venue?.organization?.taxInclusivePricing === true;
    const addOns = order.addOns || [];
    const addOnTotal = addOns.reduce(
      (sum, l) => sum + buyerLineTotal(l, order.feeMode, { taxInclusive }),
      0
    );
    // The tier line carries whatever the add-on lines do not (adjustments included).
    const tierAmount = Math.round((Number(order.totalAmount) - addOnTotal) * 100) / 100;
    const line = (name, amount, description) => ({
      price_data: { currency, product_data: { name, ...(description && { description }) }, unit_amount: cents(amount) },
      quantity: 1,
    });
    const lineItems = [
      line(
        this._tierLabel(application),
        tierAmount,
        application.profile?.businessName || undefined
      ),
      ...addOns.map((l) =>
        line(
          `${l.addOn?.name ?? 'Add-on'} ×${l.quantity}`,
          buyerLineTotal(l, order.feeMode, { taxInclusive })
        )
      ),
    ].filter((l) => l.price_data.unit_amount > 0);
    return {
      fees: { subtotal: Number(order.orgReceives) },
      lineItems: lineItems.length
        ? lineItems
        : [line(this._tierLabel(application), Number(order.totalAmount))],
    };
  }

  _tierLabel(application) {
    return `${application.event.name} — ${application.form.name}${application.tier ? ` (${application.tier.name})` : ''}`;
  }

  /** PaymentIntent description: the tier line plus a compact add-on summary. */
  _chargeDescription(application) {
    const summary = addOnService.summarizeLines(application.order?.addOns);
    const adjusted = adjustmentItems(application.order).length > 0 ? ' (adjusted)' : '';
    return `${this._tierLabel(application)}${summary ? ` + ${summary}` : ''}${adjusted}`.slice(
      0,
      1000
    );
  }

  /**
   * Expire a pending Checkout session whose amount is stale (add-on lines
   * changed, spec 012). Best effort: an already-completed or unknown session
   * is ignored; the row's session id is cleared either way.
   */
  async expireSession(application, sessionId) {
    try {
      await stripe.checkout.sessions.expire(sessionId);
    } catch (error) {
      logger.info('Application checkout session not expired', { applicationId: application.id, sessionId, error: error.message });
    }
    await prisma.application.updateMany({ where: { id: application.id, stripeCheckoutSessionId: sessionId }, data: { stripeCheckoutSessionId: null } });
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
    const amount = cents(application.order.totalAmount);
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
          description: this._chargeDescription(application),
          ...(routing.statement_descriptor_suffix && {
            statement_descriptor_suffix: routing.statement_descriptor_suffix,
          }),
          ...(routing.transfer_data && {
            transfer_data: routing.transfer_data,
            application_fee_amount: routing.application_fee_amount,
          }),
          metadata: metadataFor(application, 'approval'),
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
        // No intent exists to reconcile. PAYMENT_DUE (with its due date and a
        // FAILED payment row) is the one state every retry path accepts; the
        // released booth lets the vendor select another one.
        await prisma.application.update({ where: { id: application.id }, data: { capacitySlot: 'RESERVED' } });
        await this._markPaymentDue(application, error.message);
        throw new ValidationError(`Could not charge the card on file: ${error.message}`);
      }
      return this._markPaymentDue(application, error.message, intentId);
    }

    const routedTo = routing.transfer_data?.destination || null;
    await this._upsertPayment(prisma, application.order, {
      stripePaymentIntentId: intent.id,
      status: intent.status === 'succeeded' ? 'SUCCEEDED' : 'PENDING',
      failureReason: null,
      stripeAccountId: routedTo,
      applicationFee: routedTo ? routing.application_fee_amount / 100 : null,
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
    const changed = await this._markPaidTx(applicationId, paymentIntentId, { source });
    // The receipt (spec 024 phase 2) follows the transition, once, after commit.
    if (changed) await this.sendReceipt(applicationId);
    return changed;
  }

  async _markPaidTx(applicationId, paymentIntentId, { source }) {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`SELECT * FROM "Application" WHERE "id" = ${applicationId} FOR UPDATE`;
      const application = rows[0];
      if (
        !application ||
        ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(application.paymentStatus)
      )
        return false;
      const data = { paymentStatus: 'PAID', overdue: false };
      if (application.tierId && application.capacitySlot === 'RESERVED') {
        await tx.$executeRaw`UPDATE "ApplicationTier" SET "quantityReserved" = GREATEST("quantityReserved" - 1, 0), "quantityApproved" = "quantityApproved" + 1 WHERE "id" = ${application.tierId}`;
        // Add-on holds become sales with the slot (spec 012).
        const lines = await tx.orderAddOn.findMany({
          where: { order: { applicationId } },
          select: { addOnId: true, quantity: true },
        });
        if (lines.length) await addOnService.commit(tx, lines);
        data.capacitySlot = 'APPROVED';
      }
      if (application.status === 'DRAFT') {
        // Pay-at-submission: the payment is the submission.
        data.status = 'SUBMITTED';
        data.submittedAt = new Date();
      }
      const tier = application.tierId && tx.applicationTier?.findUnique
        ? await tx.applicationTier.findUnique({ where: { id: application.tierId }, select: { mapBound: true } })
        : null;
      // Stripe has the money: the PAID transition never fails on booth state.
      // A hold that vanished meanwhile is logged for the organizer to assign by hand.
      try {
        if (tier?.mapBound && application.status === 'APPROVED') {
          await boothService.claimBooth(applicationId, null, { tx });
        } else {
          const booth = await boothService.boothForApplication(applicationId, { tx });
          if (booth?.status === 'HELD') await boothService.claimBooth(applicationId, booth.id, { tx });
        }
      } catch (error) {
        if (error?.code !== 'BOOTH_HOLD_MISSING') throw error;
        logger.warn('Application paid without a booth hold', {
          event: 'application_paid_without_booth', applicationId, error: error.message,
        });
      }
      const row = await tx.application.update({
        where: { id: applicationId },
        data,
        select: {
          status: true,
          paymentStatus: true,
          order: { select: { id: true, totalAmount: true, currency: true } },
        },
      });
      if (row.order) {
        await tx.order.update({
          where: { id: row.order.id },
          data: { status: orderStatusFor(row), paidAt: new Date(), dueAt: null },
        });
        // Stripe-paid: the payment row reflects the intent that settled (an
        // external intent id can differ from the one we stored — the webhook wins).
        if (paymentIntentId) {
          await this._upsertPayment(tx, row.order, {
            stripePaymentIntentId: paymentIntentId,
            status: 'SUCCEEDED',
            failureReason: null,
          });
        }
      }
      logger.info('Application paid', {
        event: 'application_paid',
        applicationId,
        paymentIntentId,
        source,
      });
      return true;
    });
  }

  /** Expire a hosted Checkout session the vendor walked away from; already-expired sessions are fine. */
  async expireCheckoutSession(sessionId) {
    try {
      await stripe.checkout.sessions.expire(sessionId);
    } catch (error) {
      if (error?.code !== 'resource_missing' && !/already|expired|complete/i.test(String(error?.message))) throw error;
    }
  }

  /** Charge failed: keep the reserved slot, start the pay-now clock. */
  async _markPaymentDue(application, reason, paymentIntentId = null) {
    const dueDays = application.form?.paymentDueDays ?? 7;
    const paymentDueAt = application.order?.dueAt || new Date(Date.now() + dueDays * 86_400_000);
    await prisma.$transaction(async (tx) => {
      const row = await tx.application.update({
        where: { id: application.id },
        data: { paymentStatus: 'PAYMENT_DUE' },
        select: {
          status: true,
          paymentStatus: true,
          order: { select: { id: true, totalAmount: true, currency: true } },
        },
      });
      if (!row.order) return;
      await tx.order.update({
        where: { id: row.order.id },
        data: { status: orderStatusFor(row), dueAt: paymentDueAt },
      });
      // The declined attempt is the payment row's failure; a later pay-now overwrites it.
      await this._upsertPayment(tx, row.order, {
        ...(paymentIntentId && { stripePaymentIntentId: paymentIntentId }),
        status: 'FAILED',
        failureReason: String(reason || '').slice(0, 500) || null,
      });
      await boothService.releaseHoldOnFailure(application.id, { tx });
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

  async handleEvent(event) {
    const object = event.data.object;
    const applicationId = object.metadata?.applicationId;
    switch (event.type) {
      case 'checkout.session.completed':
        return this._onCheckoutCompleted(applicationId, object);
      case 'checkout.session.async_payment_succeeded':
        return this._onCheckoutCompleted(applicationId, { ...object, payment_status: 'paid' });
      case 'checkout.session.expired':
        if (object.metadata?.purpose === 'pay_now') {
          const application = await prisma.application.findUnique({
            where: { id: applicationId },
            include: PAYMENT_INCLUDE,
          });
          // Only the session the application is waiting on may reset it; a
          // stale session expiring after a re-choose must not touch the new hold.
          if (application?.paymentStatus === 'PROCESSING' && application.stripeCheckoutSessionId === object.id) {
            await this._markPaymentDue(application, 'Checkout session expired');
          }
        }
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
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    const before = await prisma.application.findUnique({
      where: { id: applicationId },
      select: {
        status: true,
        order: {
          select: {
            id: true,
            totalAmount: true,
            currency: true,
            payment: { select: { stripeAccountId: true } },
          },
        },
      },
    });
    if (!before) return;
    if (session.payment_intent && before.order && before.order.payment?.stripeAccountId == null) {
      // Destination routing chosen at session time; read it back for the ledger.
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId).catch(() => null);
      const destination = intent?.transfer_data?.destination || null;
      if (destination) {
        await this._upsertPayment(prisma, before.order, {
          stripeAccountId: destination,
          applicationFee:
            intent.application_fee_amount != null ? intent.application_fee_amount / 100 : null,
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
    // A decline inside hosted Checkout is retried by the vendor on Stripe's
    // page within the same session; the session's expiry or completion
    // settles it. Only off-session charges fail here.
    if (intent.metadata?.purpose === 'pay_now' || intent.metadata?.purpose === 'submit') return;
    await this._markPaymentDue(application, intent.last_payment_error?.message || intent.status, intent.id);
    await this._send(applicationId, 'PAYMENT_DUE');
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
      where: {
        status: 'APPROVED',
        paymentStatus: 'PAYMENT_DUE',
        overdue: false,
        order: { dueAt: { lt: now } },
      },
      include: { form: { select: { overduePolicy: true } }, order: { select: { id: true } } },
      take: 500,
    });
    let withdrawn = 0;
    let held = 0;
    for (const row of due) {
      try {
        if (row.form.overduePolicy === 'WITHDRAW') {
          await prisma.$transaction(async (tx) => {
            if (row.tierId && row.capacitySlot !== 'NONE') {
              const column =
                row.capacitySlot === 'APPROVED' ? 'quantityApproved' : 'quantityReserved';
              await tx.$executeRawUnsafe(
                `UPDATE "ApplicationTier" SET "${column}" = GREATEST("${column}" - 1, 0) WHERE "id" = $1`,
                row.tierId
              );
              const lines = await tx.orderAddOn.findMany({
                where: { order: { applicationId: row.id } },
                select: { addOnId: true, quantity: true },
              });
              if (lines.length)
                await (row.capacitySlot === 'APPROVED'
                  ? addOnService.unsell(tx, lines)
                  : addOnService.release(tx, lines));
            }
            await boothService.releaseForApplication(row.id, { tx });
            const updated = await tx.application.update({
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
              select: { status: true, paymentStatus: true },
            });
            if (row.order)
              await tx.order.update({
                where: { id: row.order.id },
                data: { status: orderStatusFor(updated) },
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

  /**
   * The RECEIVED email for a PAID form, once the card step made the
   * application SUBMITTED. Applies the apply-form opt-ins first (idempotent on
   * `optInsAppliedAt`) so a just-created account gets its sign-in link in the
   * same email (spec 024 phase 3).
   */
  async _sendReceived(applicationId) {
    const optIns = await contactOptInService.applyForApplication(prisma, applicationId);
    const application = await this._load(applicationId);
    if (!application) return null;
    const accountUrl = optIns.accountJustCreated ? await contactOptInService.welcomeUrl(application.contactId) : null;
    const statusUrl = await statusUrlFor(application);
    return applicationTemplateService.send(application.organizationId, 'RECEIVED', { ...application, statusUrl }, { payNowUrl: statusUrl, accountUrl, accountCreated: Boolean(accountUrl) });
  }

  /**
   * Spec 024 phase 2: Jump's receipt for a paid application order, sent once
   * per completion (callers run it only when the PAID transition happened).
   * Card details come from the payment intent when Stripe can be asked;
   * offline payments describe the method. Never throws.
   */
  async sendReceipt(applicationId) {
    try {
      const application = await this._load(applicationId);
      const order = application?.order;
      if (!order || order.status !== 'COMPLETED' || Number(order.totalAmount) <= 0) return false;
      const organization = application.event?.venue?.organization || {};
      const taxInclusive = organization.taxInclusivePricing === true;
      const addOns = (order.addOns || []).map((l) => ({ label: `${l.addOn?.name ?? 'Add-on'} ×${l.quantity}`, amount: buyerLineTotal(l, order.feeMode, { taxInclusive }) }));
      const addOnTotal = addOns.reduce((sum, l) => sum + l.amount, 0);
      const tier = tierItem(order);
      const adjusted = adjustmentItems(order).some((i) => i.kind === 'ADJUSTMENT');
      const lines = [
        { label: `${application.form?.name ?? 'Application'}${tier?.description ? ` — ${tier.description}` : ''}${adjusted ? ' (adjusted)' : ''}`, amount: Math.round((Number(order.totalAmount) - addOnTotal) * 100) / 100 },
        ...addOns,
      ];
      let paymentMethod = null;
      if (order.payment?.source !== 'OFFLINE' && order.payment?.stripePaymentIntentId) {
        const intent = await stripe.paymentIntents.retrieve(order.payment.stripePaymentIntentId, { expand: ['payment_method'] }).catch(() => null);
        const card = intent?.payment_method?.card;
        if (card?.brand && card?.last4) paymentMethod = `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)} •••• ${card.last4}`;
      }
      const statusUrl = await statusUrlFor(application);
      const accountUrl = application.contact?.accountCreatedAt ? await buyerAccountUrl(application.organizationId) : null;
      // Spec 014 phase 2: name the booth this payment bought and deep-link the public map.
      let booth = null;
      const owned = application.tier?.mapBound ? await boothService.boothForApplication(applicationId).catch(() => null) : null;
      if (owned && owned.status === 'SOLD') {
        booth = {
          label: owned.label,
          size: `${owned.w}\u00d7${owned.h}`,
          mapUrl: await eventUrl(application.eventId, application.organizationId, `/map?booth=${encodeURIComponent(owned.label)}`).catch(() => null),
        };
      }
      return await emailService.sendApplicationReceipt(application, { statusUrl, accountUrl, paymentMethod, lines, booth });
    } catch (error) {
      logger.error('Application receipt failed', { applicationId, error: error.message });
      return false;
    }
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
