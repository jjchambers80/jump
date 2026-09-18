// Admin Routes — aggregate endpoints for admin dashboard
// Requires ORGANIZER, ADMIN, or SYSTEM_ADMIN role

import express from 'express';
import { prisma } from '@jump/db';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer, requireAdmin } from '../../middleware/rbac.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';
import { resolveOrgScope, isUnscoped } from '../../middleware/orgScope.js';
import { validateUpdateAttendee } from '../validators/adminValidators.js';
import { validateUpdateBusinessDetails } from '../validators/organizationValidators.js';
import { validateCreateOrganizationPerson } from '../validators/organizationPersonValidators.js';
import { validateTaxRegionParams, validateUpsertTaxRegion, validateUpdateTaxSettings, validateTaxReportQuery } from '../validators/taxValidators.js';
import { validateFormBody, validateTierBody, validateQuestionBody, validateDecisionBody, validateBulkBody, validateTemplateBody, validateRefundBody, validateAddOnLinesBody, validateTierAddOnsBody } from '../validators/applicationValidators.js';
import { validateUpdatePaymentSettings, validateUpdatePayoutSettings } from '../validators/paymentValidators.js';
import { validateTransactionQuery, validateTransactionParams, validateTransactionRefundBody } from '../validators/transactionValidators.js';
import organizationService from '../../services/OrganizationService.js';
import organizationPersonService from '../../services/OrganizationPersonService.js';
import orderService from '../../services/OrderService.js';
import ticketService from '../../services/TicketService.js';
import refundService from '../../services/RefundService.js';
import customerService from '../../services/CustomerService.js';
import domainService from '../../services/DomainService.js';
import taxService from '../../services/TaxService.js';
import paymentSettingsService from '../../services/PaymentSettingsService.js';
import connectService from '../../services/ConnectService.js';
import imageService from '../../services/ImageService.js';
import emailService from '../../services/EmailService.js';
import qrService from '../../services/QRService.js';
import applicationFormService from '../../services/ApplicationFormService.js';
import applicationService from '../../services/ApplicationService.js';
import applicationTemplateService from '../../services/ApplicationTemplateService.js';
import applicationDigestService from '../../services/ApplicationDigestService.js';
import transactionService from '../../services/TransactionService.js';

const router = express.Router();

// All admin routes require authentication + admin/organizer role
router.use(requireAuth);
router.use(requireOrganizer);

/**
 * Organization the Settings pages act on. Members: the org the switcher sent
 * as X-Jump-Org when they belong to it, else their first membership.
 * SYSTEM_ADMIN has no memberships, so honor the switcher header, then an
 * explicit ?organizationId= / body.organizationId.
 */
async function activeOrgFor(req) {
  const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
  const orgId = isUnscoped(scope)
    ? req.user.organizationId || req.query.organizationId || req.body?.organizationId
    : scope.organizationId;
  if (!orgId) throw new NotFoundError('No organization is assigned to this user');
  return orgId;
}

/** GET /admin/settings/business-details — current user's assigned organization. */
router.get('/settings/business-details', async (req, res, next) => {
  try {
    const businessDetails = await organizationService.getBusinessDetails(await activeOrgFor(req));
    if (!businessDetails) throw new NotFoundError('Organization not found');
    res.json(businessDetails);
  } catch (error) {
    next(error);
  }
});

/** PATCH /admin/settings/business-details — update the current user's organization. */
router.patch(
  '/settings/business-details',
  validateUpdateBusinessDetails,
  async (req, res, next) => {
    try {
      const businessDetails = await organizationService.updateBusinessDetails(
        await activeOrgFor(req),
        req.body
      );
      res.json(businessDetails);
    } catch (error) {
      next(error);
    }
  }
);

/** GET /admin/settings/people — list people in the current user's organization. */
router.get('/settings/people', async (req, res, next) => {
  try {
    const people = await organizationPersonService.listPeople(await activeOrgFor(req));
    res.json({ people });
  } catch (error) {
    next(error);
  }
});

/** POST /admin/settings/people — add a person to the current user's organization. */
router.post(
  '/settings/people',
  validateCreateOrganizationPerson,
  async (req, res, next) => {
    try {
      const person = await organizationPersonService.createPerson(
        req.user.id,
        await activeOrgFor(req),
        req.body
      );
      res.status(201).json(person);
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /admin/settings/people/:personId — remove only a same-organization person. */
router.delete('/settings/people/:personId', async (req, res, next) => {
  try {
    const deleted = await organizationPersonService.deletePerson(
      req.user.id,
      await activeOrgFor(req),
      req.params.personId
    );
    if (!deleted) throw new NotFoundError('Organization person not found');
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Settings > Domains (spec 007 phase 3). Scoped to the caller's active org;
// SYSTEM_ADMIN must pass ?organizationId= or pick one in the switcher.
// ---------------------------------------------------------------------------

/** GET /admin/settings/domains — list this organization's storefront domains. */
router.get('/settings/domains', async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    res.json({
      domains: await domainService.listForOrganization(organizationId),
      platformUrl: domainService.platformUrlFor(organizationId),
    });
  } catch (error) {
    next(error);
  }
});

/** GET /admin/settings/domains/:id — one domain with its DNS records and last check (setup page). */
router.get('/settings/domains/:id', async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    res.json(await domainService.getForOrganization(organizationId, req.params.id));
  } catch (error) {
    next(error);
  }
});

/** POST /admin/settings/domains { hostname } — register a hostname and return its DNS records. */
router.post('/settings/domains', async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    const domain = await domainService.addDomain(organizationId, req.body?.hostname);
    res.status(201).json(domain);
  } catch (error) {
    next(error);
  }
});

/** POST /admin/settings/domains/:id/verify — re-check DNS now. */
router.post('/settings/domains/:id/verify', async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    res.json(await domainService.verifyDomain(organizationId, req.params.id));
  } catch (error) {
    next(error);
  }
});

/** POST /admin/settings/domains/:id/primary — make this the primary storefront host. */
router.post('/settings/domains/:id/primary', async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    res.json(await domainService.setPrimary(organizationId, req.params.id));
  } catch (error) {
    next(error);
  }
});

/** DELETE /admin/settings/domains/:id */
router.delete('/settings/domains/:id', async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    await domainService.removeDomain(organizationId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Settings > Tax (spec 009). Regions derive from the org's venues; every staff
// role can read, ADMIN/SYSTEM_ADMIN can change what is collected.
// ---------------------------------------------------------------------------

/** GET /admin/settings/tax — Stripe Tax status, per-region settings, venues without a state. */
router.get('/settings/tax', async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    const [service, { regions, needsAddress }, settings] = await Promise.all([
      taxService.getServiceStatus(),
      taxService.listRegions(organizationId),
      taxService.getTaxSettings(organizationId),
    ]);
    // The Stripe dashboard link is only useful to whoever owns the platform account.
    const { manageUrl, ...serviceForRole } = service;
    res.json({
      service: req.user.role === 'SYSTEM_ADMIN' ? service : serviceForRole,
      regions,
      needsAddress,
      settings,
      canEdit: ['ADMIN', 'SYSTEM_ADMIN'].includes(req.user.role),
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /admin/settings/tax/regions/:country/:region { collecting, source, manualRate } */
router.put(
  '/settings/tax/regions/:country/:region',
  requireAdmin,
  validateTaxRegionParams,
  validateUpsertTaxRegion,
  async (req, res, next) => {
    try {
      const organizationId = await activeOrgFor(req);
      const result = await taxService.upsertRegion(organizationId, req.params.country, req.params.region, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/** PATCH /admin/settings/tax { taxInclusivePricing } — organization-level tax options. */
router.patch('/settings/tax', requireAdmin, validateUpdateTaxSettings, async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    res.json(await taxService.updateTaxSettings(organizationId, req.body));
  } catch (error) {
    next(error);
  }
});

/** GET /admin/settings/tax/report?from&to&format=json|csv — tax collected per region. */
router.get('/settings/tax/report', validateTaxReportQuery, async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    const report = await taxService.collectedReport(organizationId, req.taxReport);
    if (req.taxReport.format === 'csv') {
      const stamp = `${report.from.slice(0, 10)}_${report.to.slice(0, 10)}`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="tax-collected-${stamp}.csv"`);
      res.send(taxService.reportToCsv(report));
      return;
    }
    res.json(report);
  } catch (error) {
    next(error);
  }
});

/** POST /admin/settings/tax/regions/:country/:region/recalculate — re-run lookups for upcoming events there. */
router.post(
  '/settings/tax/regions/:country/:region/recalculate',
  requireAdmin,
  validateTaxRegionParams,
  async (req, res, next) => {
    try {
      const organizationId = await activeOrgFor(req);
      res.json(await taxService.recalculateRegion(organizationId, req.params.country, req.params.region));
    } catch (error) {
      next(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Settings › Payments (spec 010 phase 1). Every staff role can read; ADMIN and
// SYSTEM_ADMIN can change the statement descriptor and enabled methods.
// ---------------------------------------------------------------------------

/** Stripe dashboard links only help whoever owns the platform account. */
function providerForRole(provider, role) {
  if (role === 'SYSTEM_ADMIN') return provider;
  const { manageUrl, radarUrl, ...rest } = provider;
  return rest;
}

/** GET /admin/settings/payments — platform Stripe status + this organization's settings. */
router.get('/settings/payments', async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    const [provider, settings, connect] = await Promise.all([
      paymentSettingsService.getProviderStatus(),
      paymentSettingsService.getSettings(organizationId),
      connectService.statusFor(organizationId),
    ]);
    res.json({
      provider: providerForRole(provider, req.user.role),
      settings,
      // Spec 010 phase 2: `{ enabled: false }` until STRIPE_CONNECT_ENABLED is on
      connect,
      canEdit: ['ADMIN', 'SYSTEM_ADMIN'].includes(req.user.role),
    });
  } catch (error) {
    next(error);
  }
});

/** PATCH /admin/settings/payments { statementDescriptorSuffix?, enabledPaymentMethods? } */
router.patch('/settings/payments', requireAdmin, validateUpdatePaymentSettings, async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    res.json(await paymentSettingsService.updateSettings(organizationId, req.body));
  } catch (error) {
    next(error);
  }
});

// ─── Applications (spec 011) ──────────────────────────────────────────────
// Event ownership is enforced inside the services via requireEvent(eventId, orgId);
// SYSTEM_ADMIN passes null and may reach any event.

async function scopedOrgFor(req) {
  const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
  if (isUnscoped(scope)) return null;
  if (!scope.organizationId) throw new NotFoundError('Event not found');
  return scope.organizationId;
}

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};

// Forms
router.get('/events/:eventId/application-forms', wrap(async (req, res) => {
  res.json({ data: await applicationFormService.listForms(req.params.eventId, await scopedOrgFor(req)) });
}));
router.post('/events/:eventId/application-forms', requireAdmin, validateFormBody, wrap(async (req, res) => {
  res.status(201).json(await applicationFormService.createForm(req.params.eventId, await scopedOrgFor(req), req.body));
}));
router.get('/events/:eventId/application-forms/:formId', wrap(async (req, res) => {
  res.json(await applicationFormService.getForm(req.params.eventId, req.params.formId, await scopedOrgFor(req)));
}));
router.patch('/events/:eventId/application-forms/:formId', requireAdmin, validateFormBody, wrap(async (req, res) => {
  res.json(await applicationFormService.updateForm(req.params.eventId, req.params.formId, await scopedOrgFor(req), req.body));
}));
router.delete('/events/:eventId/application-forms/:formId', requireAdmin, wrap(async (req, res) => {
  await applicationFormService.deleteForm(req.params.eventId, req.params.formId, await scopedOrgFor(req));
  res.status(204).end();
}));

// Tiers
router.post('/events/:eventId/application-forms/:formId/tiers', requireAdmin, validateTierBody, wrap(async (req, res) => {
  res.status(201).json(await applicationFormService.addTier(req.params.eventId, req.params.formId, await scopedOrgFor(req), req.body));
}));
router.patch('/events/:eventId/application-forms/:formId/tiers/:tierId', requireAdmin, validateTierBody, wrap(async (req, res) => {
  res.json(await applicationFormService.updateTier(req.params.eventId, req.params.formId, req.params.tierId, await scopedOrgFor(req), req.body));
}));
router.delete('/events/:eventId/application-forms/:formId/tiers/:tierId', requireAdmin, wrap(async (req, res) => {
  await applicationFormService.deleteTier(req.params.eventId, req.params.formId, req.params.tierId, await scopedOrgFor(req));
  res.status(204).end();
}));

// Questions
router.post('/events/:eventId/application-forms/:formId/questions', requireAdmin, validateQuestionBody, wrap(async (req, res) => {
  res.status(201).json(await applicationFormService.addQuestion(req.params.eventId, req.params.formId, await scopedOrgFor(req), req.body));
}));
router.patch('/events/:eventId/application-forms/:formId/questions/reorder', requireAdmin, wrap(async (req, res) => {
  res.json({ data: await applicationFormService.reorderQuestions(req.params.eventId, req.params.formId, await scopedOrgFor(req), req.body?.ids) });
}));
router.patch('/events/:eventId/application-forms/:formId/questions/:questionId', requireAdmin, validateQuestionBody, wrap(async (req, res) => {
  res.json(await applicationFormService.updateQuestion(req.params.eventId, req.params.formId, req.params.questionId, await scopedOrgFor(req), req.body));
}));
router.delete('/events/:eventId/application-forms/:formId/questions/:questionId', requireAdmin, wrap(async (req, res) => {
  res.json(await applicationFormService.removeQuestion(req.params.eventId, req.params.formId, req.params.questionId, await scopedOrgFor(req)));
}));

// Spec 012: which restricted add-ons a tier offers (ADMIN)
router.put('/events/:eventId/application-forms/:formId/tiers/:tierId/add-ons', requireAdmin, validateTierAddOnsBody, wrap(async (req, res) => {
  const { eventId, formId, tierId } = req.params;
  res.json(await applicationFormService.setTierAddOns(eventId, formId, tierId, await scopedOrgFor(req), req.body.addOnIds));
}));

// Applications
router.get('/events/:eventId/applications', wrap(async (req, res) => {
  res.json(await applicationService.list(req.params.eventId, await scopedOrgFor(req), req.query));
}));
router.get('/events/:eventId/applications/summary', wrap(async (req, res) => {
  res.json(await applicationService.summary(req.params.eventId, await scopedOrgFor(req)));
}));
router.get('/events/:eventId/applications/export.csv', wrap(async (req, res) => {
  const csv = await applicationService.exportCsv(req.params.eventId, await scopedOrgFor(req), req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="applications-${req.params.eventId}.csv"`);
  res.send(csv);
}));
router.post('/events/:eventId/applications/bulk', validateBulkBody, wrap(async (req, res) => {
  res.json(await applicationService.bulkDecide(req.params.eventId, await scopedOrgFor(req), { ...req.body, byUserId: req.user.id }));
}));
router.get('/events/:eventId/applications/:applicationId', wrap(async (req, res) => {
  res.json(await applicationService.get(req.params.eventId, req.params.applicationId, await scopedOrgFor(req)));
}));
router.patch('/events/:eventId/applications/:applicationId', wrap(async (req, res) => {
  const { boothLabel, internalNote, ...rest } = req.body || {};
  if (Object.keys(rest).length) throw new ValidationError(`Unknown field(s): ${Object.keys(rest).join(', ')}`);
  res.json(await applicationService.updateNotes(req.params.eventId, req.params.applicationId, await scopedOrgFor(req), { boothLabel, internalNote }));
}));
router.post('/events/:eventId/applications/:applicationId/preview', wrap(async (req, res) => {
  res.json(await applicationService.previewMessage(req.params.eventId, req.params.applicationId, await scopedOrgFor(req), req.body?.decision));
}));
router.post('/events/:eventId/applications/:applicationId/decision', validateDecisionBody, wrap(async (req, res) => {
  res.json(await applicationService.decide(req.params.eventId, req.params.applicationId, await scopedOrgFor(req), { ...req.body, byUserId: req.user.id }));
}));
// Phase 2: retry the saved card (organizer+), refund (admin)
router.post('/events/:eventId/applications/:applicationId/charge', wrap(async (req, res) => {
  res.json(await applicationService.retryCharge(req.params.eventId, req.params.applicationId, await scopedOrgFor(req)));
}));
router.post('/events/:eventId/applications/:applicationId/refund', requireAdmin, validateRefundBody, wrap(async (req, res) => {
  res.json(await applicationService.refund(req.params.eventId, req.params.applicationId, await scopedOrgFor(req), { ...req.body, initiatedBy: req.user.id }));
}));
// Spec 012: replace the add-on lines before payment (organizer+)
router.patch('/events/:eventId/applications/:applicationId/add-ons', validateAddOnLinesBody, wrap(async (req, res) => {
  const { eventId, applicationId } = req.params;
  res.json(await applicationService.updateAddOns(eventId, applicationId, await scopedOrgFor(req), req.body.addOns, { byUserId: req.user.id, sendEmail: req.body.sendEmail }));
}));

// Templates (Settings › Applications)
router.get('/settings/application-templates', wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  res.json({ data: await applicationTemplateService.listTemplates(organizationId), mergeFields: applicationTemplateService.mergeFields() });
}));
router.put('/settings/application-templates/:action', requireAdmin, validateTemplateBody, wrap(async (req, res) => {
  res.json(await applicationTemplateService.updateTemplate(await activeOrgFor(req), req.params.action, req.body));
}));
router.delete('/settings/application-templates/:action', requireAdmin, wrap(async (req, res) => {
  res.json(await applicationTemplateService.resetTemplate(await activeOrgFor(req), req.params.action));
}));

// Daily digest of new submissions (spec 011 phase 3)
router.get('/settings/application-digest', wrap(async (req, res) => {
  res.json(await applicationDigestService.getSettings(await activeOrgFor(req)));
}));
router.patch('/settings/application-digest', requireAdmin, wrap(async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') throw new ValidationError('enabled must be a boolean');
  res.json(await applicationDigestService.updateSettings(await activeOrgFor(req), { enabled: req.body.enabled }));
}));
// ─── Stripe Connect (spec 010 phase 2) ────────────────────────────────────
// All 404 while STRIPE_CONNECT_ENABLED is off (ConnectService._assertEnabled).

/** POST /admin/settings/payments/connect/onboard → { url } Account Link (create account on first call). */
router.post('/settings/payments/connect/onboard', requireAdmin, async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    res.json(await connectService.startOnboarding(organizationId, { actorId: req.user.id }));
  } catch (error) {
    next(error);
  }
});

/** POST /admin/settings/payments/connect/login-link → { url } Express dashboard (after onboarding). */
router.post('/settings/payments/connect/login-link', requireAdmin, async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    res.json(await connectService.loginLink(organizationId));
  } catch (error) {
    next(error);
  }
});

/** POST /admin/settings/payments/connect/sync → { connect } pull account state from Stripe now. */
router.post('/settings/payments/connect/sync', requireAdmin, async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    await connectService.syncAccount(organizationId);
    res.json({ connect: await connectService.statusFor(organizationId) });
  } catch (error) {
    next(error);
  }
});

/** PATCH /admin/settings/payments/connect/payouts { interval?, anchor?, statementDescriptor? } → { connect } */
router.patch('/settings/payments/connect/payouts', requireAdmin, validateUpdatePayoutSettings, async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    await connectService.updatePayoutSettings(organizationId, req.body);
    res.json({ connect: await connectService.statusFor(organizationId) });
  } catch (error) {
    next(error);
  }
});

// ─── Transactions (spec 018 phase 1) ──────────────────────────────────────
// Org-wide union of ticket orders and application payments. Members are
// scoped to their active organization; SYSTEM_ADMIN is unscoped unless the
// org switcher (X-Jump-Org) or ?organizationId= names one, and then gets an
// organization column on every row.

async function transactionsOrgFor(req) {
  const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
  if (isUnscoped(scope)) return req.user.organizationId || req.query.organizationId || null;
  if (!scope.organizationId) throw new NotFoundError('No organization is assigned to this user');
  return scope.organizationId;
}

/** GET /admin/transactions — see validateTransactionQuery for the filters. */
router.get('/transactions', validateTransactionQuery, wrap(async (req, res) => {
  res.json(await transactionService.list(await transactionsOrgFor(req), req.transactionQuery));
}));

/** GET /admin/transactions/export.csv — same filters, one row per transaction plus one per refund. */
router.get('/transactions/export.csv', validateTransactionQuery, wrap(async (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
  await transactionService.exportCsv(await transactionsOrgFor(req), req.transactionQuery, res);
  res.end();
}));

/** GET /admin/transactions/:type/:id/refunds — normalised refund history. */
router.get('/transactions/:type/:id/refunds', validateTransactionParams, wrap(async (req, res) => {
  res.json({ refunds: await transactionService.refunds(await transactionsOrgFor(req), req.params.type, req.params.id) });
}));

/** POST /admin/transactions/:type/:id/refund { amount?, reason? } — ADMIN; delegates to the per-type refund service. */
router.post('/transactions/:type/:id/refund', requireAdmin, validateTransactionParams, validateTransactionRefundBody, wrap(async (req, res) => {
  const result = await transactionService.refund(await transactionsOrgFor(req), req.params.type, req.params.id, {
    amount: req.body.amount ?? null,
    reason: req.body.reason ? req.body.reason.trim() || null : null,
    initiatedBy: req.user.id,
  });
  res.json(result);
}));

/**
 * GET /admin/dashboard/stats
 * Aggregate statistics across all accessible events
 */
router.get('/dashboard/stats', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) {
      // No org linked — return zeros
      return res.json({
        totalCapacity: 0,
        ticketsSold: 0,
        remainingCapacity: 0,
        ticketsRedeemed: 0,
        salesRate: 0,
        paymentSuccessRate: 100,
      });
    }

    const venueFilter = scope.venueFilter || {};

    // Get total capacity from all events
    const capacityResult = await prisma.event.aggregate({
      where: venueFilter,
      _sum: { capacity: true },
    });
    const totalCapacity = capacityResult._sum.capacity || 0;

    // Count tickets sold (from completed orders)
    const ticketsSold = await prisma.ticket.count({
      where: {
        order: { status: 'COMPLETED' },
        event: venueFilter,
      },
    });

    // Count tickets redeemed (REDEEMED status)
    const ticketsRedeemed = await prisma.ticket.count({
      where: {
        status: 'REDEEMED',
        event: venueFilter,
      },
    });

    // Calculate sales rate (tickets sold in last hour / 60 minutes)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentSales = await prisma.ticket.count({
      where: {
        createdAt: { gte: oneHourAgo },
        order: { status: 'COMPLETED' },
        event: venueFilter,
      },
    });
    const salesRate = Math.round(recentSales / 60);

    // Calculate payment success rate (scoped to org via event → venue)
    const [completedOrders, failedOrders] = await Promise.all([
      prisma.order.count({ where: { status: 'COMPLETED', event: venueFilter } }),
      prisma.order.count({ where: { status: 'FAILED', event: venueFilter } }),
    ]);
    const totalOrders = completedOrders + failedOrders;
    const paymentSuccessRate =
      totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 100;

    res.json({
      totalCapacity,
      ticketsSold,
      remainingCapacity: Math.max(0, totalCapacity - ticketsSold),
      ticketsRedeemed,
      salesRate,
      paymentSuccessRate,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/events
 * List events accessible to the current user
 */
router.get('/events', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) {
      return res.json({ events: [] });
    }

    const venueFilter = scope.venueFilter || {};

    const events = await prisma.event.findMany({
      where: venueFilter,
      include: {
        venue: {
          select: {
            id: true,
            name: true,
            organization: { select: { id: true, name: true } },
          },
        },
        priceTiers: {
          select: {
            id: true,
            name: true,
            price: true,
            quantityTotal: true,
            quantitySold: true,
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 50,
    });

    res.json({
      events: events.map((e) => ({
        id: e.id,
        name: e.name,
        date: e.date,
        status: e.status,
        capacity: e.capacity,
        venue: { id: e.venue.id, name: e.venue.name },
        organization: e.venue.organization,
        priceTiers: e.priceTiers.map((t) => ({
          id: t.id,
          name: t.name,
          priceCents: Math.round(Number(t.price) * 100),
          quantityTotal: t.quantityTotal,
          quantitySold: t.quantitySold,
        })),
        ticketsSold: e.priceTiers.reduce((sum, t) => sum + t.quantitySold, 0),
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/orders
 * List orders across all events for the user's organization.
 * Query: page, limit, status, eventId, search
 */
router.get('/orders', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) {
      return res.json({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    }

    const { page, limit, status, eventId, search } = req.query;
    const result = await orderService.getOrdersByOrganization(scope.organizationId, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      status: status || undefined,
      eventId: eventId || undefined,
      search: search || undefined,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/tickets
 * List tickets across all events for the user's organization (ticket-level rows).
 * Query: page, limit, status, eventId, search
 */
router.get('/tickets', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) {
      return res.json({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    }

    const { page, limit, status, eventId, search } = req.query;
    const result = await orderService.getTicketsByOrganization(scope.organizationId, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      status: status || undefined,
      eventId: eventId || undefined,
      search: search || undefined,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/tickets/:ticketId
 * Get full ticket detail for admin view (QR code, attendee, payment, sibling tickets).
 */
router.get('/tickets/:ticketId', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Ticket not found');

    const detail = await ticketService.getTicketDetailForAdmin(req.params.ticketId);

    // Verify ticket belongs to this organization (SYSTEM_ADMIN skips)
    if (!isUnscoped(scope)) {
      const event = await prisma.event.findUnique({
        where: { id: detail.event.id },
        include: { venue: { select: { organizationId: true } } },
      });

      if (!event || event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Ticket not found');
      }
    }

    res.json(detail);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /admin/tickets/:ticketId/attendee
 * Update attendee information on a ticket.
 */
router.patch('/tickets/:ticketId/attendee', validateUpdateAttendee, async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Ticket not found');

    // Verify ownership before update (SYSTEM_ADMIN skips)
    if (!isUnscoped(scope)) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: req.params.ticketId },
        include: { event: { include: { venue: { select: { organizationId: true } } } } },
      });

      if (!ticket || ticket.event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Ticket not found');
      }
    }

    const { firstName, lastName, email } = req.body;
    const updated = await ticketService.updateTicketAttendee(req.params.ticketId, {
      firstName,
      lastName,
      email,
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/tickets/:ticketId/check-in
 * Admin check-in: mark ticket as REDEEMED.
 */
router.post('/tickets/:ticketId/check-in', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Ticket not found');

    if (!isUnscoped(scope)) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: req.params.ticketId },
        include: { event: { include: { venue: { select: { organizationId: true } } } } },
      });

      if (!ticket || ticket.event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Ticket not found');
      }
    }

    const result = await ticketService.adminCheckIn(req.params.ticketId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/tickets/:ticketId/undo-check-in
 * Admin undo check-in: revert ticket from REDEEMED to VALID.
 */
router.post('/tickets/:ticketId/undo-check-in', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Ticket not found');

    if (!isUnscoped(scope)) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: req.params.ticketId },
        include: { event: { include: { venue: { select: { organizationId: true } } } } },
      });

      if (!ticket || ticket.event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Ticket not found');
      }
    }

    const result = await ticketService.adminUndoCheckIn(req.params.ticketId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/orders/:orderId
 * Get order detail, scoped to the user's organization.
 */
router.get('/orders/:orderId', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) {
      throw new NotFoundError('Order not found');
    }

    const order = await orderService.getOrderById(req.params.orderId);

    // Verify order belongs to this organizer's organization (SYSTEM_ADMIN skips)
    if (!isUnscoped(scope)) {
      const event = await prisma.event.findUnique({
        where: { id: order.event.id },
        include: { venue: { select: { organizationId: true } } },
      });

      if (!event || event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Order not found');
      }
    }

    res.json(order);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/orders/:orderId/resend-confirmation
 * Resend order confirmation email to the purchaser.
 */
router.post('/orders/:orderId/resend-confirmation', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) {
      throw new NotFoundError('Order not found');
    }

    const order = await orderService.getOrderById(req.params.orderId);

    // Verify order belongs to this organization (SYSTEM_ADMIN skips)
    if (!isUnscoped(scope)) {
      const event = await prisma.event.findUnique({
        where: { id: order.event.id },
        include: { venue: { select: { organizationId: true } } },
      });

      if (!event || event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Order not found');
      }
    }

    if (order.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Can only resend confirmation for completed orders' });
    }

    // order.tickets are formatted (flat priceTierName), but EmailService
    // expects nested priceTier: { name }. Remap to match the expected shape.
    const tickets = (order.tickets || []).map(t => ({
      ...t,
      priceTier: { name: t.priceTierName || t.priceTier?.name || 'General' },
    }));

    await emailService.sendOrderConfirmation(order, tickets);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/orders/:orderId/refund
 * Refund an entire order (all tickets voided, full amount returned).
 * Body: { reason?: string }
 */
router.post('/orders/:orderId/refund', requireAdmin, async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) {
      throw new NotFoundError('Order not found');
    }

    // Verify order belongs to this organization (SYSTEM_ADMIN skips)
    if (!isUnscoped(scope)) {
      const order = await orderService.getOrderById(req.params.orderId);
      const event = await prisma.event.findUnique({
        where: { id: order.event.id },
        include: { venue: { select: { organizationId: true } } },
      });

      if (!event || event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Order not found');
      }
    }

    const result = await refundService.refundOrder(req.params.orderId, {
      reason: req.body.reason || null,
      initiatedBy: req.user.id,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/tickets/:ticketId/refund
 * Refund a single ticket (void ticket, partial refund).
 * Body: { reason?: string }
 */
router.post('/tickets/:ticketId/refund', requireAdmin, async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) {
      throw new NotFoundError('Ticket not found');
    }

    if (!isUnscoped(scope)) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: req.params.ticketId },
        include: { event: { include: { venue: { select: { organizationId: true } } } } },
      });

      if (!ticket || ticket.event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Ticket not found');
      }
    }

    const result = await refundService.refundTicket(req.params.ticketId, {
      reason: req.body.reason || null,
      initiatedBy: req.user.id,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/orders/:orderId/add-ons/:orderAddOnId/refund
 * Refund one add-on line (spec 012): all-in line amount, quantity released,
 * tickets untouched. Body: { reason?: string }
 */
router.post('/orders/:orderId/add-ons/:orderAddOnId/refund', requireAdmin, async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) {
      throw new NotFoundError('Order not found');
    }

    const line = await prisma.orderAddOn.findFirst({
      where: { id: req.params.orderAddOnId, orderId: req.params.orderId },
      include: { order: { include: { event: { include: { venue: { select: { organizationId: true } } } } } } },
    });
    if (!line || (!isUnscoped(scope) && line.order.event.venue.organizationId !== scope.organizationId)) {
      throw new NotFoundError('Order not found');
    }

    const result = await refundService.refundAddOnLine(line.id, {
      reason: req.body?.reason || null,
      initiatedBy: req.user.id,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/orders/:orderId/refunds
 * Get refund history for an order.
 */
router.get('/orders/:orderId/refunds', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) {
      throw new NotFoundError('Order not found');
    }

    if (!isUnscoped(scope)) {
      const order = await orderService.getOrderById(req.params.orderId);
      const event = await prisma.event.findUnique({
        where: { id: order.event.id },
        include: { venue: { select: { organizationId: true } } },
      });

      if (!event || event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Order not found');
      }
    }

    const refunds = await refundService.getRefundsForOrder(req.params.orderId);
    res.json({ refunds });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/images/cleanup
 * Delete orphaned file records with no image references.
 */
router.post('/images/cleanup', async (req, res, next) => {
  try {
    const deleted = await imageService.cleanupOrphans();
    res.json({ deleted });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/tickets/scan-order
 * Scan a QR payload or barcode and return the full order context:
 * the scanned ticket plus all sibling tickets in the same order.
 *
 * Body: { payload: string }
 * 200 → OrderScanResult
 */
router.post('/tickets/scan-order', async (req, res, next) => {
  try {
    const { payload } = req.body;

    if (!payload || typeof payload !== 'string') {
      throw new ValidationError('payload is required');
    }

    let barcode;

    if (qrService.isJumpPayload(payload)) {
      const parsed = qrService.parseQRPayload(payload);
      if (!parsed) {
        throw new ValidationError('Invalid QR code format');
      }
      barcode = parsed.barcode;
    } else if (payload.startsWith('JUMP-')) {
      // Direct barcode entry
      barcode = payload.trim();
    } else {
      // Try as legacy JWT
      try {
        const decoded = qrService.verifyQRCode(payload);
        barcode = decoded.barcode;
      } catch {
        throw new ValidationError('Invalid QR code or barcode');
      }
    }

    const result = await ticketService.scanOrderByBarcode(barcode);

    // Org-scope check: ensure scanned ticket belongs to caller's organization
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
    if (!isUnscoped(scope)) {
      if (!scope.organizationId) throw new NotFoundError('Ticket not found');

      const event = await prisma.event.findUnique({
        where: { id: result.eventId },
        include: { venue: { select: { organizationId: true } } },
      });

      if (!event || event.venue.organizationId !== scope.organizationId) {
        throw new NotFoundError('Ticket not found');
      }
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** GET /admin/customers — list customers with search + pagination */
router.get('/customers', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
    if (!isUnscoped(scope) && !scope.organizationId) {
      // Staff with no membership see no customers rather than every org's
      return res.json({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    }
    const { page, limit, search } = req.query;
    const result = await customerService.getCustomersByOrganization(scope.organizationId, {
      page,
      limit,
      search,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** GET /admin/customers/:contactId — single customer detail with order history */
router.get('/customers/:contactId', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
    if (!isUnscoped(scope) && !scope.organizationId) {
      throw new NotFoundError('Customer not found');
    }
    const result = await customerService.getCustomerById(req.params.contactId, scope.organizationId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** PATCH /admin/customers/:contactId — update note, location, emailSubscribed */
router.patch('/customers/:contactId', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
    if (!isUnscoped(scope) && !scope.organizationId) {
      throw new NotFoundError('Customer not found');
    }
    const { note, location, emailSubscribed } = req.body;
    const updated = await customerService.updateCustomer(req.params.contactId, scope.organizationId, {
      note,
      location,
      emailSubscribed,
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
