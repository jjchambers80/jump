// Application Template Service (spec 011)
// Per-organization decision emails: defaults seeded lazily, edited on
// Settings › Applications, rendered with a whitelisted merge context, sent
// through EmailService. Templates are plain text; every merged value is
// escaped, so organizers cannot inject HTML into applicant emails.
//
// Syntax: {{path.to.value}} and {{#path}}…{{/path}} (section shown when the
// value is truthy). Unknown paths render empty.

import { prisma } from '@jump/db';
import { DEFAULT_TEMPLATES, MERGE_FIELDS, TEMPLATE_ACTIONS } from '../config/applications.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import emailService from './EmailService.js';
import { buyerAccountUrl, storefrontFor } from '../utils/storefrontUrl.js';
import logger from '../utils/logger.js';

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

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

class ApplicationTemplateService {
  /** All templates for an organization, defaults filled in for missing actions. */
  async listTemplates(organizationId) {
    const rows = await prisma.applicationMessageTemplate.findMany({ where: { organizationId } });
    const byAction = new Map(rows.map((r) => [r.action, r]));
    return TEMPLATE_ACTIONS.map((action) => this._serialize(action, byAction.get(action)));
  }

  async getTemplate(organizationId, action) {
    this._assertAction(action);
    const row = await prisma.applicationMessageTemplate.findUnique({ where: { organizationId_action: { organizationId, action } } });
    return this._serialize(action, row);
  }

  async updateTemplate(organizationId, action, { subject, body }) {
    this._assertAction(action);
    const cleanSubject = String(subject ?? '').trim();
    const cleanBody = String(body ?? '').trim();
    if (cleanSubject.length < 1 || cleanSubject.length > 200) throw new ValidationError('subject must be 1-200 characters');
    if (cleanBody.length < 1 || cleanBody.length > 10000) throw new ValidationError('body must be 1-10000 characters');
    this._assertBalancedSections(cleanBody);
    this._assertBalancedSections(cleanSubject);
    const row = await prisma.applicationMessageTemplate.upsert({
      where: { organizationId_action: { organizationId, action } },
      update: { subject: cleanSubject, body: cleanBody },
      create: { organizationId, action, subject: cleanSubject, body: cleanBody },
    });
    logger.info('Application template updated', { event: 'application_template_updated', organizationId, action });
    return this._serialize(action, row);
  }

  async resetTemplate(organizationId, action) {
    this._assertAction(action);
    await prisma.applicationMessageTemplate.deleteMany({ where: { organizationId, action } });
    return this._serialize(action, null);
  }

  mergeFields() {
    return MERGE_FIELDS.map(([key, description]) => ({ key, description }));
  }

  /**
   * Merge context for one application. `application` must include contact,
   * profile, event (with venue.organization), form, tier.
   */
  async contextFor(application, { payNowUrl = null } = {}) {
    const organization = application.event?.venue?.organization || {};
    const { base } = await storefrontFor(organization.id || application.organizationId);
    const statusUrl = application.statusUrl || `${base}/events/${application.eventId}/apply/status/${application.id}`;
    return {
      applicant: {
        firstName: application.contact?.firstName || '',
        lastName: application.contact?.lastName || '',
        email: application.contact?.email || '',
      },
      profile: { businessName: application.profile?.businessName || '' },
      event: { name: application.event?.name || '', date: formatDate(application.event?.date) },
      organization: { name: organization.name || '' },
      form: { name: application.form?.name || '' },
      tier: application.tier ? { name: application.tier.name } : null,
      // Spec 012: null when there are no lines so {{#addOns}} sections hide.
      addOns: application.addOns?.length
        ? { summary: application.addOns.map((l) => `${l.addOn?.name ?? l.name} ×${l.quantity} (${formatMoney(l.applicantPays)})`).join(', '), count: application.addOns.length }
        : null,
      amount: { applicantPays: formatMoney(application.applicantPays) },
      payment: { dueDate: formatDate(application.paymentDueAt) },
      links: {
        status: statusUrl,
        payNow: payNowUrl || '',
        account: await buyerAccountUrl(organization.id || application.organizationId),
      },
    };
  }

  /**
   * Rendered subject/body for an action, using the org template or the default.
   * The organization is the application's own: callers pass the caller's
   * scope, which is null for SYSTEM_ADMIN (no memberships), and a null
   * organizationId would make the template lookup throw.
   */
  async render(organizationId, action, application, options = {}) {
    const orgId = organizationId || application.organizationId || application.event?.venue?.organizationId || application.event?.venue?.organization?.id || null;
    this._assertAction(action);
    const template = orgId ? await this.getTemplate(orgId, action) : this._serialize(action, null);
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
  async send(organizationId, action, application, { override = null, payNowUrl = null } = {}) {
    let message;
    try {
      message = override && override.subject && override.body ? override : await this.render(organizationId, action, application, { payNowUrl });
      await emailService.sendApplicationMessage({
        to: application.contact.email,
        subject: message.subject,
        body: message.body,
        organization: application.event?.venue?.organization || {},
      });
      logger.info('Application email sent', { event: 'application_email_sent', applicationId: application.id, action });
    } catch (error) {
      logger.error('Application email failed', { event: 'application_email_failed', applicationId: application.id, action, error: error.message });
    }
    return message || null;
  }

  _assertAction(action) {
    if (!ACTIONS.has(action)) throw new NotFoundError('Unknown template action');
  }

  _assertBalancedSections(text) {
    const opens = [...text.matchAll(/\{\{#([\w.]+)\}\}/g)].map((m) => m[1]);
    const closes = [...text.matchAll(/\{\{\/([\w.]+)\}\}/g)].map((m) => m[1]);
    if (opens.length !== closes.length || opens.some((o) => !closes.includes(o))) {
      throw new ValidationError('Every {{#section}} needs a matching {{/section}}');
    }
  }

  _serialize(action, row) {
    const def = DEFAULT_TEMPLATES[action];
    return {
      action,
      subject: row?.subject ?? def.subject,
      body: row?.body ?? def.body,
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
    };
  }
}

export default new ApplicationTemplateService();
