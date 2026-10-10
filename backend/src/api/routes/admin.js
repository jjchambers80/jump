// Admin Routes — aggregate endpoints for admin dashboard
// Requires ORGANIZER, ADMIN, or SYSTEM_ADMIN role

import express from 'express';
import { prisma } from '@jump/db';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer, requireAdmin, requireSystemAdmin } from '../../middleware/rbac.js';
import { NotFoundError, ValidationError, ForbiddenError } from '../../middleware/errorHandler.js';
import { resolveOrgScope, isUnscoped } from '../../middleware/orgScope.js';
import {
  validateAdminSearchQuery,
  validateUpdateAttendee,
} from '../validators/adminValidators.js';
import { validateUpdateBusinessDetails } from '../validators/organizationValidators.js';
import { validateCreateOrganizationPerson } from '../validators/organizationPersonValidators.js';
import { validateTaxRegionParams, validateUpsertTaxRegion, validateUpdateTaxSettings, validateTaxReportQuery } from '../validators/taxValidators.js';
import { validateFormBody, validateTierBody, validateQuestionBody, validateDecisionBody, validateBulkBody, validateTemplateBody, validateRefundBody, validateAddOnLinesBody, validateTierAddOnsBody, validateTierChangeBody, validateAdjustmentBody, validateWaiveBody, validateOfflinePaymentBody, validateFormTemplateBody, validateSaveAsTemplateBody, validateMetaBody, validateCheckInBody, validateScanBody } from '../validators/applicationValidators.js';
import { validateUpdatePaymentSettings, validateUpdatePayoutSettings } from '../validators/paymentValidators.js';
import { validateCreatePage, validateUpdatePage } from '../validators/pageValidators.js';
import { validateUpdateStorefrontPreferences } from '../validators/storefrontPreferencesValidators.js';
import { validateUpdateCustomerAccountSettings } from '../validators/customerAccountSettingsValidators.js';
import { validateUpdateCustomer } from '../validators/customerValidators.js';
import {
  timelineQuery,
  validateCreateCustomerComment,
} from '../validators/customerTimelineValidators.js';
import { validateOrderListQuery } from '../validators/orderValidators.js';
import organizationService from '../../services/OrganizationService.js';
import organizationPersonService from '../../services/OrganizationPersonService.js';
import memberService from '../../services/MemberService.js';
import { validateInviteMembers, validateUpdateMember } from '../validators/memberValidators.js';
import orderService from '../../services/OrderService.js';
import ticketService from '../../services/TicketService.js';
import refundService from '../../services/RefundService.js';
import customerService from '../../services/CustomerService.js';
import buyerDataExportService from '../../services/BuyerDataExportService.js';
import contactErasureService from '../../services/ContactErasureService.js';
import { requireRecentAuth } from '../../middleware/recentAuth.js';
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
import applicationFormTemplateService from '../../services/ApplicationFormTemplateService.js';
import applicationDigestService from '../../services/ApplicationDigestService.js';
import vendorCheckInService from '../../services/VendorCheckInService.js';
import setupGuideService from '../../services/SetupGuideService.js';
import customerAccountSettingsService from '../../services/CustomerAccountSettingsService.js';
import billingService from '../../services/BillingService.js';
import pageService from '../../services/PageService.js';
import pageTemplateService from '../../services/PageTemplateService.js';
import storefrontPreferencesService from '../../services/StorefrontPreferencesService.js';
import adminSearchService from '../../services/AdminSearchService.js';
import customerTimelineService from '../../services/CustomerTimelineService.js';
import buyerAuthService from '../../services/BuyerAuthService.js';
import { LIMITS, makeLimiter } from '../../middleware/rateLimit.js';
import { buyerVerifyUrl } from '../../utils/storefrontUrl.js';
import mapService from '../../services/MapService.js';
import { PAID_ORDER_STATUSES } from '../../services/paidStatuses.js';
import { activeOrgFor } from './adminScope.js';
import agentAccessService from '../../services/AgentAccessService.js';
import dashboardService from '../../services/DashboardService.js';
import auditLogService from '../../audit/AuditLogService.js';
import { validateAuditLogQuery } from '../validators/auditLogValidators.js';

const router = express.Router();

// All admin routes require authentication + admin/organizer role
router.use(requireAuth);
router.use(requireOrganizer);

// Organization the Settings pages act on — see routes/adminScope.js.

/**
 * GET /admin/search?q=<term> — bounded launcher results across admin resources.
 * Members are restricted to their active organization; a SYSTEM_ADMIN without
 * X-Jump-Org is intentionally unscoped, matching the other admin lists.
 */
router.get('/search', validateAdminSearchQuery, async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
    if (!isUnscoped(scope) && !scope.organizationId) {
      return res.json({ query: req.adminSearchQuery, total: 0, data: [] });
    }
    const data = await adminSearchService.search(scope, req.adminSearchQuery);
    res.json({ query: req.adminSearchQuery, total: data.length, data });
  } catch (error) {
    next(error);
  }
});

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

/** GET /admin/pages — list Online Store pages for the active organization. */
router.get('/pages', async (req, res, next) => {
  try {
    res.json({ pages: await pageService.list(await activeOrgFor(req)) });
  } catch (error) {
    next(error);
  }
});

/** POST /admin/pages — create an Online Store page for the active organization. */
router.post('/pages', validateCreatePage, async (req, res, next) => {
  try {
    res.status(201).json(await pageService.create(await activeOrgFor(req), req.body));
  } catch (error) {
    next(error);
  }
});

/** GET /admin/pages/:pageId — one page; 404 when it belongs to another organization. */
router.get('/pages/:pageId', async (req, res, next) => {
  try {
    res.json(await pageService.get(await activeOrgFor(req), req.params.pageId));
  } catch (error) {
    next(error);
  }
});

/** PUT /admin/pages/:pageId — partial update (title, content, visibility, search engine listing). */
router.put('/pages/:pageId', validateUpdatePage, async (req, res, next) => {
  try {
    res.json(await pageService.update(await activeOrgFor(req), req.params.pageId, req.body));
  } catch (error) {
    next(error);
  }
});

/** GET /admin/page-templates — the active organization's page templates (spec 042). */
router.get('/page-templates', async (req, res, next) => {
  try {
    res.json({ templates: await pageTemplateService.list(await activeOrgFor(req)) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/page-templates — upload a template manifest (JSON body). A
 * template with the same name is replaced. Developers only (SYSTEM_ADMIN).
 */
router.post('/page-templates', requireSystemAdmin, async (req, res, next) => {
  try {
    res
      .status(201)
      .json(await pageTemplateService.upsert(await activeOrgFor(req), req.body, req.user.id));
  } catch (error) {
    next(error);
  }
});

/** GET /admin/page-templates/:id/manifest — the stored manifest, for download. */
router.get('/page-templates/:id/manifest', requireSystemAdmin, async (req, res, next) => {
  try {
    res.json(await pageTemplateService.manifest(await activeOrgFor(req), req.params.id));
  } catch (error) {
    next(error);
  }
});

/** DELETE /admin/page-templates/:id — pages using it fall back to the default layout. */
router.delete('/page-templates/:id', requireSystemAdmin, async (req, res, next) => {
  try {
    res.json(await pageTemplateService.remove(await activeOrgFor(req), req.params.id));
  } catch (error) {
    next(error);
  }
});

/** GET /admin/online-store/preferences — store access, homepage SEO, redirection. */
router.get('/online-store/preferences', async (req, res, next) => {
  try {
    res.json(await storefrontPreferencesService.get(await activeOrgFor(req)));
  } catch (error) {
    next(error);
  }
});

/** PATCH /admin/online-store/preferences — partial update (ADMIN: it can lock the storefront). */
router.patch(
  '/online-store/preferences',
  requireAdmin,
  validateUpdateStorefrontPreferences,
  async (req, res, next) => {
    try {
      res.json(await storefrontPreferencesService.update(await activeOrgFor(req), req.body));
    } catch (error) {
      next(error);
    }
  }
);

/** GET /admin/settings/customer-accounts — sign-in links, sign-in method, account URL (spec 031). */
router.get('/settings/customer-accounts', async (req, res, next) => {
  try {
    res.json(await customerAccountSettingsService.get(await activeOrgFor(req)));
  } catch (error) {
    next(error);
  }
});

/** PATCH /admin/settings/customer-accounts — partial update (ADMIN). */
router.patch(
  '/settings/customer-accounts',
  requireAdmin,
  validateUpdateCustomerAccountSettings,
  async (req, res, next) => {
    try {
      res.json(await customerAccountSettingsService.update(await activeOrgFor(req), req.body));
    } catch (error) {
      next(error);
    }
  }
);

/** GET /admin/setup-guide — dashboard setup tasks for the active organization (spec 022). */
router.get('/setup-guide', async (req, res, next) => {
  try {
    res.json(await setupGuideService.get(await activeOrgFor(req)));
  } catch (error) {
    next(error);
  }
});

/** PATCH /admin/setup-guide { dismissed: true } — hide the guide for this organization. */
router.patch('/setup-guide', async (req, res, next) => {
  try {
    if (req.body?.dismissed !== true) throw new ValidationError('dismissed must be true');
    res.json(await setupGuideService.dismiss(await activeOrgFor(req)));
  } catch (error) {
    next(error);
  }
});

/** GET /admin/settings/plan — the organization's Jump plan (spec 022 phase 2). */
router.get('/settings/plan', async (req, res, next) => {
  try {
    const status = await billingService.statusFor(await activeOrgFor(req));
    res.json({ ...status, canEdit: ['ADMIN', 'SYSTEM_ADMIN'].includes(req.user.role) });
  } catch (error) {
    next(error);
  }
});

/** POST /admin/settings/plan/checkout — start the STARTER trial from Settings (embedded Checkout). */
router.post('/settings/plan/checkout', requireAdmin, async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    res.json(await billingService.createCheckout(organizationId, req.user.id, { returnPath: '/admin/settings/plan' }));
  } catch (error) {
    next(error);
  }
});

/** POST /admin/settings/plan/confirm { sessionId } — record a completed Checkout on return. */
router.post('/settings/plan/confirm', requireAdmin, async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    const result = await billingService.confirmCheckout(organizationId, req.body?.sessionId);
    res.json({ ...result, ...(await billingService.statusFor(organizationId)) });
  } catch (error) {
    next(error);
  }
});

/** POST /admin/settings/plan/portal — Stripe customer portal link (cancel, card, invoices). */
router.post('/settings/plan/portal', requireAdmin, async (req, res, next) => {
  try {
    res.json(await billingService.portalLink(await activeOrgFor(req), { returnPath: '/admin/settings/plan' }));
  } catch (error) {
    next(error);
  }
});

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
      platformUrl: await domainService.platformUrlFor(organizationId),
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

// Settings › Users: staff of the active organization. requireAdmin checks the
// global role; assertOrgAdmin checks the role in *this* organization.
async function orgAdminScope(req) {
  const organizationId = await activeOrgFor(req);
  await memberService.assertOrgAdmin(req.user, organizationId);
  return organizationId;
}
const memberInviteLimiter = makeLimiter('MEMBER_INVITE', LIMITS.MEMBER_INVITE);

/** GET /admin/settings/users?role=&status= */
router.get('/settings/users', requireAdmin, wrap(async (req, res) => {
  const { role, status } = req.query;
  res.json({ users: await memberService.list(await orgAdminScope(req), { role, status }) });
}));

/** POST /admin/settings/users — add users by email and send each an invite */
router.post('/settings/users', requireAdmin, memberInviteLimiter, validateInviteMembers, wrap(async (req, res) => {
  res.status(201).json(await memberService.invite(req.user, await orgAdminScope(req), req.body));
}));

/** PATCH /admin/settings/users/:userId — role, requireTwoStep, isActive */
router.patch('/settings/users/:userId', requireAdmin, validateUpdateMember, wrap(async (req, res) => {
  res.json(await memberService.update(req.user, await orgAdminScope(req), req.params.userId, req.body));
}));

/** DELETE /admin/settings/users/:userId — remove from this organization */
router.delete('/settings/users/:userId', requireAdmin, wrap(async (req, res) => {
  await memberService.remove(req.user, await orgAdminScope(req), req.params.userId);
  res.status(204).end();
}));

/** POST /admin/settings/users/:userId/resend — re-send a pending invite */
router.post('/settings/users/:userId/resend', requireAdmin, memberInviteLimiter, wrap(async (req, res) => {
  await memberService.resend(req.user, await orgAdminScope(req), req.params.userId);
  res.status(204).end();
}));

/**
 * Scope for the organization-wide Participants routes (spec 019), the
 * customers-route shape: SYSTEM_ADMIN unscoped (organizationId null), a
 * member scoped to the active organization, a staff user with no
 * membership sees nothing (`empty`).
 */
async function participantsScopeFor(req) {
  const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
  if (isUnscoped(scope)) return { organizationId: null, empty: false };
  return { organizationId: scope.organizationId, empty: !scope.organizationId };
}

// ─── Participants: submissions across events (spec 019) ───────────────────
// Registered before the per-event block so `applications` is never read as an
// event id (different prefix, but the contract test pins it).

router.get('/applications', wrap(async (req, res) => {
  const scope = await participantsScopeFor(req);
  if (scope.empty) return res.json({ data: [], total: 0, page: 1, pageSize: 0, summary: {} });
  res.json(await applicationService.listInScope({ organizationId: scope.organizationId, eventOnly: true }, req.query));
}));
router.get('/applications/summary', wrap(async (req, res) => {
  const scope = await participantsScopeFor(req);
  if (scope.empty) return res.json({});
  res.json(await applicationService.summaryInScope({ organizationId: scope.organizationId, eventOnly: true }));
}));
router.get('/applications/tags', wrap(async (req, res) => {
  const scope = await participantsScopeFor(req);
  if (scope.empty) return res.json({ data: [] });
  res.json({ data: await applicationService.distinctTags({ organizationId: scope.organizationId, eventOnly: true }) });
}));
router.get('/applications/export.csv', wrap(async (req, res) => {
  const scope = await participantsScopeFor(req);
  const csv = scope.empty ? '' : await applicationService.exportCsvInScope({ organizationId: scope.organizationId, eventOnly: true }, req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="participants-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));
router.post('/applications/bulk', validateBulkBody, wrap(async (req, res) => {
  const scope = await participantsScopeFor(req);
  if (scope.empty) return res.json({ results: req.body.ids.map((id) => ({ id, ok: false, error: 'Application not found' })), succeeded: 0, failed: req.body.ids.length });
  res.json(await applicationService.bulkDecideInScope({ organizationId: scope.organizationId, eventOnly: true }, { ...req.body, byUserId: req.user.id }));
}));
router.get('/application-forms', wrap(async (req, res) => {
  const scope = await participantsScopeFor(req);
  if (scope.empty) return res.json({ data: [] });
  res.json({ data: await applicationFormService.listFormsInScope(scope.organizationId) });
}));

// Standing application forms (spec 044): organization content with no event.
router.get('/standing-application-forms', wrap(async (req, res) => {
  res.json({ data: await applicationFormService.listStandingForms(await activeOrgFor(req)) });
}));
router.post('/standing-application-forms', requireAdmin, validateFormBody, wrap(async (req, res) => {
  res.status(201).json(await applicationFormService.createStandingForm(await activeOrgFor(req), req.body));
}));
router.get('/standing-application-forms/:formId', wrap(async (req, res) => {
  res.json(await applicationFormService.getStandingForm(await activeOrgFor(req), req.params.formId));
}));
router.patch('/standing-application-forms/:formId', requireAdmin, validateFormBody, wrap(async (req, res) => {
  res.json(await applicationFormService.updateStandingForm(await activeOrgFor(req), req.params.formId, req.body));
}));
router.delete('/standing-application-forms/:formId', requireAdmin, wrap(async (req, res) => {
  await applicationFormService.deleteStandingForm(await activeOrgFor(req), req.params.formId);
  res.status(204).end();
}));
router.post('/standing-application-forms/:formId/save-as-template', requireAdmin, validateSaveAsTemplateBody, wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  await applicationFormService.getStandingForm(organizationId, req.params.formId);
  const form = await prisma.applicationForm.findUnique({
    where: { id: req.params.formId },
    include: { tiers: { orderBy: { displayOrder: 'asc' } }, questions: { where: { archivedAt: null }, orderBy: { displayOrder: 'asc' } } },
  });
  const status = req.body.replaceTemplateId ? 200 : 201;
  res.status(status).json(await applicationFormTemplateService.saveFrom(form, organizationId, req.body, { byUserId: req.user.id }));
}));
router.post('/standing-application-forms/:formId/questions', requireAdmin, validateQuestionBody, wrap(async (req, res) => {
  res.status(201).json(await applicationFormService.addStandingQuestion(await activeOrgFor(req), req.params.formId, req.body));
}));
router.patch('/standing-application-forms/:formId/questions/reorder', requireAdmin, wrap(async (req, res) => {
  res.json({ data: await applicationFormService.reorderStandingQuestions(await activeOrgFor(req), req.params.formId, req.body?.ids) });
}));
router.patch('/standing-application-forms/:formId/questions/:questionId', requireAdmin, validateQuestionBody, wrap(async (req, res) => {
  res.json(await applicationFormService.updateStandingQuestion(await activeOrgFor(req), req.params.formId, req.params.questionId, req.body));
}));
router.delete('/standing-application-forms/:formId/questions/:questionId', requireAdmin, wrap(async (req, res) => {
  res.json(await applicationFormService.removeStandingQuestion(await activeOrgFor(req), req.params.formId, req.params.questionId));
}));
router.get('/standing-application-forms/:formId/submissions', wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  await applicationFormService.getStandingForm(organizationId, req.params.formId);
  res.json(await applicationService.listInScope({ organizationId, formId: req.params.formId }, req.query));
}));
router.get('/standing-application-forms/:formId/submissions/summary', wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  await applicationFormService.getStandingForm(organizationId, req.params.formId);
  res.json(await applicationService.summaryInScope({ organizationId, formId: req.params.formId }));
}));
router.get('/standing-application-forms/:formId/submissions/tags', wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  await applicationFormService.getStandingForm(organizationId, req.params.formId);
  res.json({ data: await applicationService.distinctTags({ organizationId, formId: req.params.formId }) });
}));
router.get('/standing-application-forms/:formId/submissions/export.csv', wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  await applicationFormService.getStandingForm(organizationId, req.params.formId);
  const csv = await applicationService.exportCsvInScope({ organizationId, formId: req.params.formId }, req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="applications-${req.params.formId}.csv"`);
  res.send(csv);
}));
router.post('/standing-application-forms/:formId/submissions/bulk', validateBulkBody, wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  await applicationFormService.getStandingForm(organizationId, req.params.formId);
  res.json(await applicationService.bulkDecideInScope({ organizationId, formId: req.params.formId }, { ...req.body, byUserId: req.user.id }));
}));
router.get('/standing-application-forms/:formId/submissions/:applicationId', wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  res.json(await applicationService.getInScope({ organizationId, formId: req.params.formId }, req.params.applicationId));
}));
router.patch('/standing-application-forms/:formId/submissions/:applicationId', validateMetaBody, wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  res.json(await applicationService.updateMetaInScope({ organizationId, formId: req.params.formId }, req.params.applicationId, req.body));
}));
router.post('/standing-application-forms/:formId/submissions/:applicationId/preview', wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  res.json(await applicationService.previewMessageInScope({ organizationId, formId: req.params.formId }, req.params.applicationId, req.body?.decision));
}));
router.post('/standing-application-forms/:formId/submissions/:applicationId/decision', validateDecisionBody, wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  res.json(await applicationService.decideInScope(
    { organizationId, formId: req.params.formId },
    req.params.applicationId,
    { ...req.body, sendEmail: true, byUserId: req.user.id }
  ));
}));

// Form templates (spec 019 phase 2). Reads follow the Participants scope;
// writes need one organization — a member's own, SYSTEM_ADMIN's active one.
router.get('/application-templates', wrap(async (req, res) => {
  const scope = await participantsScopeFor(req);
  if (scope.empty) return res.json({ data: [] });
  res.json({ data: await applicationFormTemplateService.list(scope.organizationId) });
}));
router.post('/application-templates', requireAdmin, validateFormTemplateBody, wrap(async (req, res) => {
  res.status(201).json(await applicationFormTemplateService.create(await activeOrgFor(req), req.body, { byUserId: req.user.id }));
}));
router.get('/application-templates/:templateId', wrap(async (req, res) => {
  const scope = await participantsScopeFor(req);
  if (scope.empty) throw new NotFoundError('Application form template not found');
  res.json(await applicationFormTemplateService.get(req.params.templateId, scope.organizationId));
}));
router.put('/application-templates/:templateId', requireAdmin, validateFormTemplateBody, wrap(async (req, res) => {
  const scope = await participantsScopeFor(req);
  if (scope.empty) throw new NotFoundError('Application form template not found');
  res.json(await applicationFormTemplateService.update(req.params.templateId, scope.organizationId, req.body));
}));
router.delete('/application-templates/:templateId', requireAdmin, wrap(async (req, res) => {
  const scope = await participantsScopeFor(req);
  if (scope.empty) throw new NotFoundError('Application form template not found');
  await applicationFormTemplateService.remove(req.params.templateId, scope.organizationId);
  res.status(204).end();
}));

// Map deep-link for event Map button (spec 014)
router.get('/events/:eventId/map', wrap(async (req, res) => {
  const orgId = await activeOrgFor(req);
  const map = await mapService.findByEvent(orgId, req.params.eventId);
  if (!map) return res.status(404).json({ error: 'NotFoundError', message: 'No map for this event' });
  res.json({ mapId: map.id });
}));

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

router.post('/events/:eventId/application-forms/:formId/save-as-template', requireAdmin, validateSaveAsTemplateBody, wrap(async (req, res) => {
  const { eventId, formId } = req.params;
  const event = await applicationFormService.requireEvent(eventId, await scopedOrgFor(req));
  const form = await prisma.applicationForm.findFirst({
    where: { id: formId, eventId },
    include: { tiers: { orderBy: { displayOrder: 'asc' } }, questions: { where: { archivedAt: null }, orderBy: { displayOrder: 'asc' } } },
  });
  if (!form) throw new NotFoundError('Application form not found');
  const status = req.body.replaceTemplateId ? 200 : 201;
  res.status(status).json(await applicationFormTemplateService.saveFrom(form, event.venue.organizationId, req.body, { byUserId: req.user.id }));
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
router.get('/events/:eventId/applications/tags', wrap(async (req, res) => {
  await applicationFormService.requireEvent(req.params.eventId, await scopedOrgFor(req));
  res.json({ data: await applicationService.distinctTags({ eventId: req.params.eventId }) });
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
router.patch('/events/:eventId/applications/:applicationId', validateMetaBody, wrap(async (req, res) => {
  res.json(await applicationService.updateMeta(req.params.eventId, req.params.applicationId, await scopedOrgFor(req), req.body, { byUserId: req.user.id }));
}));
router.post('/events/:eventId/applications/:applicationId/preview', wrap(async (req, res) => {
  res.json(await applicationService.previewMessage(req.params.eventId, req.params.applicationId, await scopedOrgFor(req), req.body?.decision, { tierId: req.body?.tierId === null || typeof req.body?.tierId === 'string' ? req.body.tierId : undefined }));
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
// Spec 018 phase 3: corrections before money moves (organizer+) and offline settlement (ADMIN)
router.post('/events/:eventId/applications/:applicationId/tier', validateTierChangeBody, wrap(async (req, res) => {
  const { eventId, applicationId } = req.params;
  res.json(await applicationService.changeTier(eventId, applicationId, await scopedOrgFor(req), req.body.tierId, { byUserId: req.user.id, sendEmail: req.body.sendEmail }));
}));
router.post('/events/:eventId/applications/:applicationId/adjustments', validateAdjustmentBody, wrap(async (req, res) => {
  const { eventId, applicationId } = req.params;
  res.status(201).json(await applicationService.addAdjustment(eventId, applicationId, await scopedOrgFor(req), req.body, { byUserId: req.user.id }));
}));
router.delete('/events/:eventId/applications/:applicationId/adjustments/:adjustmentId', wrap(async (req, res) => {
  const { eventId, applicationId, adjustmentId } = req.params;
  res.json(await applicationService.removeAdjustment(eventId, applicationId, await scopedOrgFor(req), adjustmentId, { byUserId: req.user.id }));
}));
router.post('/events/:eventId/applications/:applicationId/waive', requireAdmin, validateWaiveBody, wrap(async (req, res) => {
  const { eventId, applicationId } = req.params;
  res.json(await applicationService.waiveBalance(eventId, applicationId, await scopedOrgFor(req), req.body, { byUserId: req.user.id, sendEmail: req.body.sendEmail }));
}));
router.post('/events/:eventId/applications/:applicationId/offline-payment', requireAdmin, validateOfflinePaymentBody, wrap(async (req, res) => {
  const { eventId, applicationId } = req.params;
  res.json(await applicationService.recordOfflinePayment(eventId, applicationId, await scopedOrgFor(req), req.body, { byUserId: req.user.id, sendEmail: req.body.sendEmail }));
}));

// ─── Door check-in (spec 036) ─────────────────────────────────────────────
// Event-day surface for staff on a phone. Every route is scoped by the active
// organization *and* the event id, so staff working one door can never see or
// stamp another event's vendors. Check-in is idempotent (see
// VendorCheckInService) — these endpoints are safe to retry.
router.get('/events/:eventId/check-in', wrap(async (req, res) => {
  res.json(await vendorCheckInService.roster(req.params.eventId, await scopedOrgFor(req), req.query));
}));
router.post('/events/:eventId/check-in/scan', validateScanBody, wrap(async (req, res) => {
  res.json(await vendorCheckInService.resolveScan(req.params.eventId, await scopedOrgFor(req), req.body.payload));
}));
router.post('/events/:eventId/check-in/:applicationId', validateCheckInBody, wrap(async (req, res) => {
  const { eventId, applicationId } = req.params;
  res.json(await vendorCheckInService.checkIn(eventId, applicationId, await scopedOrgFor(req), { byUserId: req.user.id, via: req.body?.via || 'SEARCH' }));
}));
router.delete('/events/:eventId/check-in/:applicationId', wrap(async (req, res) => {
  const { eventId, applicationId } = req.params;
  res.json(await vendorCheckInService.undoCheckIn(eventId, applicationId, await scopedOrgFor(req)));
}));

// Templates (Settings › Applications)
router.get('/settings/application-templates', wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  const scope = req.query.scope === 'STANDING' ? 'STANDING' : 'EVENT';
  res.json({ data: await applicationTemplateService.listTemplates(organizationId, scope), mergeFields: applicationTemplateService.mergeFields() });
}));
router.put('/settings/application-templates/:action', requireAdmin, validateTemplateBody, wrap(async (req, res) => {
  const scope = req.query.scope === 'STANDING' ? 'STANDING' : 'EVENT';
  res.json(await applicationTemplateService.updateTemplate(await activeOrgFor(req), req.params.action, req.body, scope));
}));
router.delete('/settings/application-templates/:action', requireAdmin, wrap(async (req, res) => {
  const scope = req.query.scope === 'STANDING' ? 'STANDING' : 'EVENT';
  res.json(await applicationTemplateService.resetTemplate(await activeOrgFor(req), req.params.action, scope));
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

/**
 * GET /admin/finance/payouts → { connect, activity, canEdit }
 * Finance › Payouts: connected-account state plus live balance and recent
 * payouts. `activity` is null until onboarding is complete (or while the
 * flag is off) so the page renders its empty state. Every staff role can read.
 */
router.get('/finance/payouts', async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    const [connect, activity] = await Promise.all([
      connectService.statusFor(organizationId),
      connectService.payoutActivity(organizationId),
    ]);
    res.json({ connect, activity, canEdit: ['ADMIN', 'SYSTEM_ADMIN'].includes(req.user.role) });
  } catch (error) {
    next(error);
  }
});

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
        revenue: { orders: 0, applications: 0, gross: 0 },
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

    // Payment success rate, scoped to the org on the order (spec 047 D0-C:
    // an order need not have an event; unscoped = every order).
    const orderScope = scope.organizationId ? { organizationId: scope.organizationId } : {};
    const [completedOrders, failedOrders] = await Promise.all([
      prisma.order.count({ where: { status: 'COMPLETED', ...orderScope } }),
      prisma.order.count({ where: { status: 'FAILED', ...orderScope } }),
    ]);
    const totalOrders = completedOrders + failedOrders;
    const paymentSuccessRate =
      totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 100;

    // Gross revenue by source (spec 018 phase 2; one ledger since spec 024).
    const [orderRevenue, applicationRevenue] = await Promise.all([
      prisma.order.aggregate({
        where: { kind: 'TICKET', status: { in: PAID_ORDER_STATUSES }, ...orderScope },
        _sum: { totalAmount: true },
      }),
      prisma.order.aggregate({
        where: { kind: 'APPLICATION', status: { in: PAID_ORDER_STATUSES }, ...orderScope },
        _sum: { totalAmount: true },
      }),
    ]);
    const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    const ordersGross = round(Number(orderRevenue._sum.totalAmount || 0));
    const applicationsGross = round(Number(applicationRevenue._sum.totalAmount || 0));

    res.json({
      totalCapacity,
      ticketsSold,
      remainingCapacity: Math.max(0, totalCapacity - ticketsSold),
      ticketsRedeemed,
      salesRate,
      paymentSuccessRate,
      revenue: { orders: ordersGross, applications: applicationsGross, gross: round(ordersGross + applicationsGross) },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/dashboard/overview?tz=America/New_York
 * Bird's-eye view for the dashboard: 14-day sales trend (days in `tz`),
 * upcoming events, recent paid orders and what needs attention.
 */
router.get('/dashboard/overview', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
    if (!isUnscoped(scope) && !scope.organizationId) {
      return res.json({ timeZone: 'UTC', trend: [], upcoming: [], recentOrders: [], checkedInLast24h: 0, attention: { draftEvents: [], applicationsToReview: [] } });
    }
    res.json(await dashboardService.overview(scope.venueFilter || {}, { timeZone: req.query.tz }));
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
 * Org-wide order list, both kinds (spec 024 phase 2). Query (validated):
 * page, limit, kind, status (comma list; default hides FAILED + CANCELLED),
 * eventId, from, to, search (order ref / name / email / business, or a
 * Stripe id), sort, dir. SYSTEM_ADMIN is unscoped and rows carry `organization`.
 */
router.get('/orders', validateOrderListQuery, async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);

    if (!isUnscoped(scope) && !scope.organizationId) {
      return res.json({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    }

    res.json(await orderService.getOrdersByOrganization(scope.organizationId, req.orderQuery));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/orders/export.csv
 * The same rows as the list (every filter, no paging) plus fee / tax
 * breakdown, Stripe ids and one `refund` line per succeeded refund.
 */
router.get('/orders/export.csv', validateOrderListQuery, async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
    if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Organization not found');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`);
    await orderService.exportOrdersCsv(scope.organizationId, req.orderQuery, (chunk) => res.write(chunk));
    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
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

    const { firstName, lastName } = req.body;
    const updated = await ticketService.updateTicketAttendee(req.params.ticketId, {
      firstName,
      lastName,
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
    if (!isUnscoped(scope) && order.organization?.id !== scope.organizationId) {
      throw new NotFoundError('Order not found');
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
    if (!isUnscoped(scope) && order.organization?.id !== scope.organizationId) {
      throw new NotFoundError('Order not found');
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
      const order = await prisma.order.findUnique({
        where: { id: req.params.orderId },
        select: { organizationId: true },
      });
      if (!order || order.organizationId !== scope.organizationId) {
        throw new NotFoundError('Order not found');
      }
    }

    // `amount` (spec 024): partial refund of an application order; ticket
    // orders are refunded per ticket, per add-on line, or in full.
    const amount =
      req.body.amount === undefined || req.body.amount === null ? null : Number(req.body.amount);
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0))
      throw new ValidationError('amount must be a positive number');
    const result = await refundService.refundOrder(req.params.orderId, {
      amount,
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
      include: { order: { select: { organizationId: true } } },
    });
    if (!line || (!isUnscoped(scope) && line.order.organizationId !== scope.organizationId)) {
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
      const order = await prisma.order.findUnique({
        where: { id: req.params.orderId },
        select: { organizationId: true },
      });
      if (!order || order.organizationId !== scope.organizationId) {
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

/** GET /admin/customers — list customers with search + pagination + tag filter */
router.get('/customers', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
    if (!isUnscoped(scope) && !scope.organizationId) {
      // Staff with no membership see no customers rather than every org's
      return res.json({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    }
    const { page, limit, search, tag, segment, rsvp, eventId, sort, direction, scope: customerScope = 'customers', source, formId } = req.query;
    if (!['customers', 'all'].includes(customerScope)) {
      throw new ValidationError('scope must be customers or all');
    }
    if (rsvp !== undefined && rsvp !== 'going') {
      throw new ValidationError('rsvp must be going');
    }
    if (eventId && rsvp !== 'going') {
      throw new ValidationError('eventId requires the RSVP filter');
    }
    if (source !== undefined) {
      const validSources = ['tickets', 'rsvp', 'subscribed', 'form'];
      if (!validSources.includes(source)) {
        throw new ValidationError('source must be tickets, rsvp, subscribed, or form');
      }
    }
    if (formId && source !== 'form') {
      throw new ValidationError('formId requires source=form');
    }
    // source=form flips to all contacts (a form submitter may not have a paid order)
    const effectiveScope = source === 'form' ? 'all' : customerScope;
    const result = await customerService.getCustomersByOrganization(scope.organizationId, {
      page,
      limit,
      search,
      tag,
      scope: effectiveScope,
      segment,
      rsvp,
      eventId,
      source,
      formId,
      sort,
      direction,
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
    const { search, tag, segment, rsvp, eventId, sort, direction, scope: customerScope = 'customers', source, formId } = req.query;
    if (!['customers', 'all'].includes(customerScope)) {
      throw new ValidationError('scope must be customers or all');
    }
    const result = await customerService.getCustomerById(req.params.contactId, scope.organizationId, {
      search,
      tag,
      scope: customerScope,
      segment,
      rsvp,
      eventId,
      source,
      formId,
      sort,
      direction,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** GET /admin/customers/:contactId/timeline — comments and derived customer events. */
router.get('/customers/:contactId/timeline', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
    if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Customer not found');
    const result = await customerTimelineService.getTimeline(
      req.params.contactId,
      scope.organizationId,
      timelineQuery(req)
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** POST /admin/customers/:contactId/comments — add an attributed plain-text note. */
router.post(
  '/customers/:contactId/comments',
  validateCreateCustomerComment,
  async (req, res, next) => {
    try {
      const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
      if (!isUnscoped(scope) && !scope.organizationId)
        throw new NotFoundError('Customer not found');
      const comment = await customerTimelineService.createComment(
        req.params.contactId,
        scope.organizationId,
        req.user.id,
        req.body.body
      );
      res.status(201).json(comment);
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /admin/customers/:contactId/comments/:commentId — author or ADMIN only. */
router.delete('/customers/:contactId/comments/:commentId', async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
    if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Customer not found');
    await customerTimelineService.deleteComment(
      req.params.contactId,
      req.params.commentId,
      scope.organizationId,
      req.user
    );
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** PATCH /admin/customers/:contactId — update customer fields (spec 032 phase 1) */
router.patch(
  '/customers/:contactId',
  validateUpdateCustomer,
  async (req, res, next) => {
    try {
      const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
      if (!isUnscoped(scope) && !scope.organizationId) {
        throw new NotFoundError('Customer not found');
      }

      // Email change is ADMIN-only
      if (req.body.email !== undefined && req.user.role !== 'ADMIN' && req.user.role !== 'SYSTEM_ADMIN') {
        throw new ForbiddenError('Only administrators can change a customer email address');
      }

      const updated = await customerService.updateCustomer(
        req.params.contactId,
        scope.organizationId,
        req.body,
        { id: req.user.id, role: req.user.role },
      );
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/customers/:contactId/export — the customer's data as one JSON file,
 * staff notes included, for an access request that arrived by email (spec 040 PA-11).
 */
router.get('/customers/:contactId/export', requireAdmin, async (req, res, next) => {
  try {
    const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
    if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Customer not found');
    const contact = await prisma.contact.findFirst({
      where: { id: req.params.contactId, ...(scope.organizationId && { organizationId: scope.organizationId }) },
      select: { id: true, organizationId: true },
    });
    if (!contact) throw new NotFoundError('Customer not found');
    const data = await buyerDataExportService.exportForStaff(contact.organizationId, contact.id, req.user.id);
    res.set('Content-Disposition', `attachment; filename="${buyerDataExportService.filename(data).replace('-my-data-', '-customer-data-')}"`);
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET  /admin/customers/:contactId/erasure — preview (what would be voided, what blocks it).
 * POST /admin/customers/:contactId/anonymize — erase now, no grace period (spec 040 PA-18):
 * ADMIN and a fresh step-up proof, for requests that arrive by email.
 */
async function contactInScope(req) {
  const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
  if (!isUnscoped(scope) && !scope.organizationId) throw new NotFoundError('Customer not found');
  const contact = await prisma.contact.findFirst({
    where: { id: req.params.contactId, ...(scope.organizationId && { organizationId: scope.organizationId }) },
    select: { id: true, organizationId: true },
  });
  if (!contact) throw new NotFoundError('Customer not found');
  return contact;
}

router.get('/customers/:contactId/erasure', requireAdmin, async (req, res, next) => {
  try {
    const contact = await contactInScope(req);
    res.json(await contactErasureService.preview(contact.organizationId, contact.id));
  } catch (error) {
    next(error);
  }
});

router.post('/customers/:contactId/anonymize', requireAdmin, requireRecentAuth, async (req, res, next) => {
  try {
    const contact = await contactInScope(req);
    res.json(await contactErasureService.erase(contact.id, { organizationId: contact.organizationId, actorUserId: req.user.id }));
  } catch (error) {
    next(error);
  }
});

/** POST /admin/customers/:contactId/send-sign-in-link — issue and email a passwordless sign-in link (spec 032 phase 1). */
const sendSignInLinkLimiter = makeLimiter('BUYER_AUTH_REQUEST', LIMITS.BUYER_AUTH_REQUEST);
router.post(
  '/customers/:contactId/send-sign-in-link',
  sendSignInLinkLimiter,
  async (req, res, next) => {
    try {
      const scope = await resolveOrgScope(req.user.id, req.user.role, req.user.organizationId);
      if (!isUnscoped(scope) && !scope.organizationId) {
        throw new NotFoundError('Customer not found');
      }

      const contact = await prisma.contact.findFirst({
        where: { id: req.params.contactId, ...(scope.organizationId && { organizationId: scope.organizationId }) },
        select: {
          id: true,
          organizationId: true,
          email: true,
          firstName: true,
          accountCreatedAt: true,
        },
      });
      if (!contact) {
        throw new NotFoundError('Customer not found');
      }
      if (!contact.accountCreatedAt) {
        return res.status(422).json({
          error: 'UnprocessableContent',
          message: 'This customer does not have an account. They checked out as a guest.',
          code: 'NO_ACCOUNT',
        });
      }

      const result = await buyerAuthService.requestLogin(contact.organizationId, contact.email);
      if (!result.issued) {
        // Rate limited or account not reachable — return 429
        return res.status(429).json({
          error: 'TooManyRequests',
          message: 'This customer has received too many sign-in links recently. Try again later.',
          code: 'SIGN_IN_LINK_RATE_LIMITED',
        });
      }

      // Send the email
      const loginUrl = await buyerVerifyUrl(contact.organizationId, result.rawToken);
      await emailService.sendBuyerLoginEmail({
        contact: { email: contact.email, firstName: contact.firstName, organizationId: contact.organizationId },
        loginUrl,
        organization: result.contact?.organization || {},
        code: result.rawCode || null,
      });

      res.json({ sent: true });
    } catch (error) {
      next(error);
    }
  }
);

// ── Agent access (spec 045C) ──

// D3: only an ADMIN *member* of the active store manages its agent access.
// requireAdmin alone checks the account-wide role, which an ADMIN of another
// store also has.
async function agentAdminOrg(req) {
  const organizationId = await activeOrgFor(req);
  if (req.user.role !== 'SYSTEM_ADMIN') {
    const membership = await prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId: req.user.id, organizationId } },
      select: { role: true },
    });
    if (membership?.role !== 'ADMIN') throw new ForbiddenError('Only an Admin of this store can manage agent access');
  }
  return organizationId;
}

/** GET /admin/agent-access/settings — the store's agent access switch. ADMIN+. */
router.get('/agent-access/settings', requireAdmin, async (req, res, next) => {
  try {
    res.json(await agentAccessService.getSettings(await agentAdminOrg(req)));
  } catch (error) {
    next(error);
  }
});

/** PATCH /admin/agent-access/settings — ADMIN toggles the switch. Needs step-up proof. */
router.patch('/agent-access/settings', requireAdmin, requireRecentAuth, async (req, res, next) => {
  try {
    const orgId = await agentAdminOrg(req);
    res.json(await agentAccessService.toggleSettings(orgId, !!req.body.enabled, req.user.id));
  } catch (error) {
    next(error);
  }
});

/** GET /admin/agent-access/grants — list every grant for the active org. ADMIN+. */
router.get('/agent-access/grants', requireAdmin, async (req, res, next) => {
  try {
    res.json({ grants: await agentAccessService.listGrants(await agentAdminOrg(req)) });
  } catch (error) {
    next(error);
  }
});

/** POST /admin/agent-access/grants/:id/revoke — revoke one grant. ADMIN+. Needs step-up. */
router.post('/agent-access/grants/:id/revoke', requireAdmin, requireRecentAuth, async (req, res, next) => {
  try {
    const result = await agentAccessService.revokeGrant(await agentAdminOrg(req), req.params.id);
    if (!result) return res.status(404).json({ message: 'Grant not found' });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** POST /admin/agent-access/grants/revoke-all — ADMIN revokes every grant for the org. Needs step-up. */
router.post('/agent-access/grants/revoke-all', requireAdmin, requireRecentAuth, async (req, res, next) => {
  try {
    res.json(await agentAccessService.revokeAllGrants(await agentAdminOrg(req)));
  } catch (error) {
    next(error);
  }
});

/** GET /admin/agent-access/audit-log — filtered audit log for the active org. ADMIN+. */
router.get('/agent-access/audit-log', requireAdmin, async (req, res, next) => {
  try {
    res.json(await agentAccessService.listAuditLog(await agentAdminOrg(req), {
      grantId: req.query.grantId,
      tool: req.query.tool,
      offset: parseInt(req.query.offset, 10) || 0,
      limit: Math.min(parseInt(req.query.limit, 10) || 50, 200),
    }));
  } catch (error) {
    next(error);
  }
});

// ── Activity log (spec 048) — the organization's audit trail ──

// Store ADMINs (by membership in the active org) and SYSTEM_ADMIN.
async function auditAdminOrg(req) {
  const organizationId = await activeOrgFor(req);
  if (req.user.role !== 'SYSTEM_ADMIN') {
    const membership = await prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId: req.user.id, organizationId } },
      select: { role: true },
    });
    if (membership?.role !== 'ADMIN') throw new ForbiddenError('Only an Admin of this store can view the activity log');
  }
  return organizationId;
}

/** GET /admin/audit-log — filtered, paged activity log for the active org. */
router.get('/audit-log', validateAuditLogQuery, async (req, res, next) => {
  try {
    res.json(await auditLogService.list(await auditAdminOrg(req), req.auditQuery));
  } catch (error) {
    next(error);
  }
});

/** GET /admin/audit-log/export.csv — the same filters, every row. Logged as an export itself. */
router.get('/audit-log/export.csv', validateAuditLogQuery, async (req, res, next) => {
  try {
    const organizationId = await auditAdminOrg(req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    await auditLogService.exportCsv(organizationId, req.auditQuery, (chunk) => res.write(chunk));
    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    next(error);
  }
});

// ── Connected apps (spec 045C) — the calling user's own grants across orgs ──

/** GET /admin/agent-access/my-grants — the authenticated user's grants across all orgs. */
router.get('/agent-access/my-grants', requireOrganizer, async (req, res, next) => {
  try {
    res.json({ grants: await agentAccessService.listMyGrants(req.user.id) });
  } catch (error) {
    next(error);
  }
});

/** POST /admin/agent-access/my-grants/:id/revoke — user revokes their own grant. */
router.post('/agent-access/my-grants/:id/revoke', requireOrganizer, async (req, res, next) => {
  try {
    const result = await agentAccessService.revokeMyGrant(req.user.id, req.params.id);
    if (!result) return res.status(404).json({ message: 'Grant not found' });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
