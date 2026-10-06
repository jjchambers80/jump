// Application Template Service (spec 011)
// Per-organization decision emails: defaults seeded lazily, edited on
// Settings › Applications, rendered with a whitelisted merge context, sent
// through EmailService. Templates are plain text; every merged value is
// escaped, so organizers cannot inject HTML into applicant emails.
//
// Syntax: {{path.to.value}} and {{#path}}…{{/path}} (section shown when the
// value is truthy). Unknown paths render empty.

import { prisma } from '@jump/db';
import { moneyOf } from './applicationMoney.js';
import { DUE_ZONE, selectionDueAt } from './applicationSelection.js';
import orderLineService from './OrderLineService.js';
import { DEFAULT_TEMPLATES, MERGE_FIELDS, STANDING_DEFAULT_TEMPLATES, STANDING_TEMPLATE_ACTIONS, TEMPLATE_ACTIONS } from '../config/applications.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import emailService from './EmailService.js';
import boothService from './BoothService.js';
import { buyerAccountUrl, eventUrl } from '../utils/storefrontUrl.js';
import logger from '../utils/logger.js';
import { statusUrlFor } from './applicationLinks.js';

const ACTIONS = new Set(TEMPLATE_ACTIONS);

function lookup(context, path) {
  return path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), context);
}

/** Render a template string against a context. Sections first, then fields. */
export function renderTemplate(text, context) {
  const withSections = String(text ?? '').replace(/\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, path, inner) =>
    lookup(context, path) ? inner : ''
  );
  return withSections.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path) => {
    const value = lookup(context, path);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return '';
    return String(value);
  });
}

/** A due date, read on the organization's calendar like the deadline itself. */
function formatDueDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: DUE_ZONE });
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

class ApplicationTemplateService {
  /** All templates for an organization, defaults filled in for missing actions. */
  async listTemplates(organizationId, scope = 'EVENT') {
    const actions = scope === 'STANDING' ? STANDING_TEMPLATE_ACTIONS : TEMPLATE_ACTIONS;
    const rows = await prisma.applicationMessageTemplate.findMany({ where: { organizationId, scope } });
    const byAction = new Map(rows.map((r) => [r.action, r]));
    return actions.map((action) => this._serialize(action, byAction.get(action), scope));
  }

  async getTemplate(organizationId, action, scope = 'EVENT') {
    this._assertAction(action, scope);
    const row = await prisma.applicationMessageTemplate.findUnique({ where: { organizationId_scope_action: { organizationId, scope, action } } });
    return this._serialize(action, row, scope);
  }

  async updateTemplate(organizationId, action, { subject, body }, scope = 'EVENT') {
    this._assertAction(action, scope);
    const cleanSubject = String(subject ?? '').trim();
    const cleanBody = String(body ?? '').trim();
    if (cleanSubject.length < 1 || cleanSubject.length > 200) throw new ValidationError('subject must be 1-200 characters');
    if (cleanBody.length < 1 || cleanBody.length > 10000) throw new ValidationError('body must be 1-10000 characters');
    this._assertBalancedSections(cleanBody);
    this._assertBalancedSections(cleanSubject);
    const row = await prisma.applicationMessageTemplate.upsert({
      where: { organizationId_scope_action: { organizationId, scope, action } },
      update: { subject: cleanSubject, body: cleanBody },
      create: { organizationId, scope, action, subject: cleanSubject, body: cleanBody },
    });
    logger.info('Application template updated', { event: 'application_template_updated', organizationId, action });
    return this._serialize(action, row, scope);
  }

  async resetTemplate(organizationId, action, scope = 'EVENT') {
    this._assertAction(action, scope);
    await prisma.applicationMessageTemplate.deleteMany({ where: { organizationId, scope, action } });
    return this._serialize(action, null, scope);
  }

  mergeFields() {
    return MERGE_FIELDS.map(([key, description]) => ({ key, description }));
  }

  /**
   * Merge context for one application. `application` must include contact,
   * profile, event (with venue.organization), form, tier.
   */
  async contextFor(application, { payNowUrl = null, accountUrl = null, accountCreated = false } = {}) {
    const organization = application.event?.venue?.organization || application.form?.organization || {};
    const statusUrl =
      application.statusUrl || await statusUrlFor(application);
    const money = moneyOf(application, { taxInclusive: organization.taxInclusivePricing === true });
    const booth = await this._boothContext(application);
    const space = await this._spaceContext(application);
    // Spec 037 phase 5: the category's all-in price, what the vendor pays before add-ons.
    // Spec 039: a booth the vendor owns or was placed on is priced on its own;
    // on a MAP form still choosing, spots carry their own prices, so the
    // category's price would mislead and is left out.
    const placed = application.id && application.tier ? await boothService.boothForApplication(application.id).catch(() => null) : null;
    const owned = placed && placed.status !== 'HELD' ? placed : null;
    const spotsPriced = application.form?.spaceSelection === 'MAP' && !owned;
    const tierPrice =
      application.tier && application.form?.kind === 'PAID' && !spotsPriced
        ? orderLineService.applicationOrderData(application.tier, application.form, [], [], application.event || {}, organization, {
            booth: owned,
          }).amounts.applicantPays
        : null;
    return {
      applicant: {
        firstName: application.contact?.firstName || '',
        lastName: application.contact?.lastName || '',
        email: application.contact?.email || '',
      },
      profile: { businessName: application.profile?.businessName || '' },
      event: { name: application.event?.name || '', date: formatDate(application.event?.date) },
      organization: { name: organization.name || '', email: organization.email || '' },
      // `paid` is a section flag: a PAID form charges on approval, never at submission.
      form: { name: application.form?.name || '', paid: application.form?.kind === 'PAID' },
      tier: application.tier ? { name: application.tier.name, price: tierPrice == null ? '' : formatMoney(tierPrice) } : null,
      // Spec 012: null when there are no lines so {{#addOns}} sections hide.
      // Spec 024: money comes from the application's order.
      addOns: money.addOns.length
        ? {
            summary: money.addOns
              .map(
                (l) => `${l.name ?? l.addOn?.name} ×${l.quantity} (${formatMoney(l.applicantPays)})`
              )
              .join(', '),
            count: money.addOns.length,
          }
        : null,
      // No order yet (spec 037 phase 5): the amount is the category's price.
      amount: { applicantPays: formatMoney(money.orderId ? money.applicantPays : tierPrice ?? money.applicantPays) },
      payment: { dueDate: formatDueDate(money.paymentDueAt || selectionDueAt(application)) },
      space,
      order: { ref: money.orderRef || '' },
      // Spec 024 phase 3: `account.created` is true on the RECEIVED email that
      // carries the applicant's first sign-in link (`links.account` is then that link).
      account: { created: accountCreated === true },
      // Spec 014 phase 2: the vendor's booth, or the "choose your booth" step
      // an approved map-bound application still has ahead of it.
      booth: booth.booth,
      links: {
        status: statusUrl,
        payNow: payNowUrl || '',
        account: accountUrl || (await buyerAccountUrl(organization.id || application.organizationId)),
        map: booth.mapUrl,
      },
    };
  }

  /**
   * `{ booth: { label, size, chooseRequired } | null, mapUrl }` for the merge
   * context. `chooseRequired` is true while an approved application on a
   * map-bound tier owes payment and owns no booth yet; a HELD booth is not
   * shown (the hold may lapse before the email is read).
   */
  async _boothContext(application) {
    const owned = application.id ? await boothService.boothForApplication(application.id).catch(() => null) : null;
    const sold = owned && owned.status !== 'HELD' ? owned : null;
    // Spec 037 phase 5: approved on a PAID form and still choosing a space.
    const chooseRequired = application.status === 'APPROVED' && application.paymentStatus === 'AWAITING_SELECTION';
    const organizationId = application.organizationId || application.event?.venue?.organizationId || application.event?.venue?.organization?.id;
    const mapUrl = sold && organizationId ? await eventUrl(application.eventId, organizationId, `/map?booth=${encodeURIComponent(sold.label)}`) : '';
    const label = sold?.label || (!owned ? application.boothLabel : null) || '';
    if (!label && !chooseRequired) return { booth: null, mapUrl };
    return {
      booth: {
        label,
        size: sold ? `${sold.w}\u00d7${sold.h}` : '',
        chooseRequired,
      },
      mapUrl,
    };
  }

  /**
   * Spec 037 phase 5: `space` merge fields \u2014 whether the vendor still has to
   * choose, whether the event's published map sells their category, and the
   * date the payment clock runs out (approval + paymentDueDays).
   */
  async _spaceContext(application) {
    const chooseRequired = application.status === 'APPROVED' && application.paymentStatus === 'AWAITING_SELECTION';
    // Spec 039: the form decides — MAP forms sell spots, TIERS forms never show the map.
    const onMap = application.form?.spaceSelection === 'MAP' && Boolean(application.tierId);
    const pickTier = chooseRequired && application.form?.kind === 'PAID' && !application.tierId;
    const due = selectionDueAt(application);
    return { chooseRequired, onMap, pickTier, dueDate: formatDueDate(due) };
  }

  /**
   * Rendered subject/body for an action, using the org template or the default.
   * The organization is the application's own: callers pass the caller's
   * scope, which is null for SYSTEM_ADMIN (no memberships), and a null
   * organizationId would make the template lookup throw.
   */
  async render(organizationId, action, application, options = {}) {
    const orgId = organizationId || application.organizationId || application.event?.venue?.organizationId || application.event?.venue?.organization?.id || null;
    const scope = application.eventId ? 'EVENT' : 'STANDING';
    this._assertAction(action, scope);
    const template = orgId ? await this.getTemplate(orgId, action, scope) : this._serialize(action, null, scope);
    const context = await this.contextFor(application, options);
    return {
      subject: renderTemplate(template.subject, context),
      body: renderTemplate(template.body, context),
    };
  }

  /**
   * Send a decision email. `override` ({ subject, body }) is the organizer's
   * one-off edit from the decision dialog, already rendered text.
   * Never throws: a failed email must not undo a decision.
   */
  async send(organizationId, action, application, { override = null, payNowUrl = null, accountUrl = null, accountCreated = false } = {}) {
    let message;
    try {
      message = override && override.subject && override.body ? override : await this.render(organizationId, action, application, { payNowUrl, accountUrl, accountCreated });
      await emailService.sendApplicationMessage({
        to: application.contact.email,
        subject: message.subject,
        body: message.body,
        organization: application.event?.venue?.organization || application.form?.organization || {},
      });
      logger.info('Application email sent', { event: 'application_email_sent', applicationId: application.id, action });
    } catch (error) {
      logger.error('Application email failed', { event: 'application_email_failed', applicationId: application.id, action, error: error.message });
    }
    return message || null;
  }

  _assertAction(action, scope = 'EVENT') {
    const actions = scope === 'STANDING' ? new Set(STANDING_TEMPLATE_ACTIONS) : ACTIONS;
    if (!actions.has(action)) throw new NotFoundError('Unknown template action');
  }

  _assertBalancedSections(text) {
    const opens = [...text.matchAll(/\{\{#([\w.]+)\}\}/g)].map((m) => m[1]);
    const closes = [...text.matchAll(/\{\{\/([\w.]+)\}\}/g)].map((m) => m[1]);
    if (opens.length !== closes.length || opens.some((o) => !closes.includes(o))) {
      throw new ValidationError('Every {{#section}} needs a matching {{/section}}');
    }
  }

  _serialize(action, row, scope = 'EVENT') {
    const def = (scope === 'STANDING' ? STANDING_DEFAULT_TEMPLATES : DEFAULT_TEMPLATES)[action];
    return {
      action,
      scope,
      subject: row?.subject ?? def.subject,
      body: row?.body ?? def.body,
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
    };
  }
}

export default new ApplicationTemplateService();
