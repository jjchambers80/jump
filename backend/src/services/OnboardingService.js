// Onboarding Service (spec 022)
// The /signup flow: a pending Organization + ADMIN membership are created at
// the first step (the id is needed in the URL and for resume); the survey is
// stored on PlatformCustomer.onboarding as it is answered; `complete` stamps
// Organization.onboardingCompletedAt, which is what makes the organization
// appear in the org switcher, and promotes the owner's global role.

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { rethrowSlugConflict, resolveUniqueSlug } from '../utils/slug.js';
import {
  ONBOARDING_VERSION,
  ONBOARDING_SURVEY,
  MULTI_SELECT_KEYS,
  SINGLE_SELECT_KEYS,
  MAX_PENDING_ORGANIZATIONS,
  SIGNUP_SOURCES,
  APPLICATION_GOALS,
  SEED_TEMPLATES,
  ABANDON_AFTER_MS,
} from '../config/onboarding.js';

const SURVEY_KEYS = [...MULTI_SELECT_KEYS, ...SINGLE_SELECT_KEYS];

const pendingSelect = { id: true, name: true, slug: true, createdAt: true, platformCustomer: { select: { onboarding: true } } };

import { billingEnabled } from '../config/billing.js';
import billingService from './BillingService.js';
import applicationFormTemplateService from './ApplicationFormTemplateService.js';

export { billingEnabled };

/** Which step a pending organization resumes at. */
export function stepFor(onboarding) {
  const data = onboarding || {};
  if (billingEnabled() && !data.subscribeSkippedAt && !data.subscribedAt) return 'subscribe';
  if (!data.surveySkippedAt && !data.surveyCompletedAt) return 'survey';
  return 'done';
}

const serializePending = (org) => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
  createdAt: org.createdAt,
  step: stepFor(org.platformCustomer?.onboarding),
  onboarding: org.platformCustomer?.onboarding ?? null,
});

class OnboardingService {
  /**
   /** Ensure a signup source string is valid, for resume partial updates. */
  _assertValidSource(source) {
    if (!SIGNUP_SOURCES.includes(source)) throw new ValidationError(`Invalid signup source: ${source}`);
  }

  /**
  * Validate a partial survey payload against the option allowlists.
   * Multi-select keys take arrays, single-select keys take one id.
   * @returns {Object} normalized patch containing only the keys sent
   */
  validateSurvey(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('Survey answers must be an object');
    }
    const patch = {};
    for (const key of Object.keys(body)) {
      if (!SURVEY_KEYS.includes(key)) throw new ValidationError(`Unknown field: ${key}`);
      const allowed = ONBOARDING_SURVEY[key];
      const value = body[key];
      if (MULTI_SELECT_KEYS.includes(key)) {
        if (!Array.isArray(value)) throw new ValidationError(`${key} must be an array`);
        const unique = [...new Set(value)];
        for (const v of unique) {
          if (!allowed.includes(v)) throw new ValidationError(`${key} contains an unknown option: ${String(v)}`);
        }
        patch[key] = unique;
      } else if (value === null) {
        patch[key] = null;
      } else {
        if (!allowed.includes(value)) throw new ValidationError(`${key} must be one of ${allowed.join(', ')}`);
        patch[key] = value;
      }
    }
    return patch;
  }

  /**
   * Newest unfinished organization the user is an ADMIN member of.
   * @returns {Promise<Object|null>} serialized pending org with its resume step
   */
  async current(userId) {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId, role: 'ADMIN', organization: { onboardingCompletedAt: null } },
      orderBy: { createdAt: 'desc' },
      include: { organization: { select: pendingSelect } },
    });
    return membership ? serializePending(membership.organization) : null;
  }

  /**
   * Step 1: create the pending organization and make the caller its ADMIN.
   * @param {string} userId
   * @param {{ name: string, source?: 'admin'|'public' }} data
   */
  async start(userId, { name, source }) {
    const src = SIGNUP_SOURCES.includes(source) ? source : 'public';
    const pending = await prisma.organizationMember.count({
      where: { userId, role: 'ADMIN', organization: { onboardingCompletedAt: null } },
    });
    if (pending >= MAX_PENDING_ORGANIZATIONS) {
      throw new ConflictError('You have unfinished organizations; finish or discard one first');
    }

    const organization = await prisma.$transaction(async (tx) => {
      const slugState = await resolveUniqueSlug(tx.organization, {
        title: name,
        customSlug: undefined,
        fallback: 'org',
      });
      let org;
      try {
        org = await tx.organization.create({
        data: {
          name,
          ...slugState,
          onboardingCompletedAt: null,
          members: { create: { userId, role: 'ADMIN' } },
          platformCustomer: {
            create: { ownerUserId: userId, onboarding: { version: ONBOARDING_VERSION, source: src } },
          },
        },
        select: pendingSelect,
      });
      } catch (error) {
        rethrowSlugConflict(error);
      }
      return org;
    });

    logger.info('Organization onboarding started', {
      event: 'organization_onboarding_started',
      organizationId: organization.id,
      userId,
      source: src,
    });

    return serializePending(organization);
  }

  /**
   * Load a pending organization the user administers, or 404.
   * SYSTEM_ADMIN may act on any pending organization.
   */
  async requirePending(userId, role, organizationId) {
    const org = await prisma.organization.findFirst({
      where: {
        id: organizationId,
        onboardingCompletedAt: null,
        ...(role === 'SYSTEM_ADMIN' ? {} : { members: { some: { userId, role: 'ADMIN' } } }),
      },
      select: pendingSelect,
    });
    if (!org) throw new NotFoundError('Organization not found');
    return org;
  }

  async complete(userId, role, organizationId) {
    const org = await this.requirePending(userId, role, organizationId);
    await prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: org.id },
        data: { onboardingCompletedAt: new Date() },
      });
      await tx.user.update({
        where: { id: userId },
        data: { role: 'ADMIN' },
      });
      const survey = org.platformCustomer?.onboarding;
      if (survey?.applications?.length) {
        const templates = SEED_TEMPLATES.filter((t) => survey.applications.includes(t.category));
        for (const tpl of templates) {
          await applicationFormTemplateService.create(tx, org.id, tpl);
        }
      }
    });
    logger.info('Organization onboarding completed', {
      event: 'organization_onboarding_completed',
      organizationId: org.id,
      userId,
    });
    return { success: true };
  }

  async resume(userId, role, organizationId, body) {
    if (body.source !== undefined) {
      this._assertValidSource(body.source);
    }
    const org = await this.requirePending(userId, role, organizationId);
    const orgId = org.id;
    const patch = {};

    if (body.source !== undefined) {
      const src = SIGNUP_SOURCES.includes(body.source) ? body.source : 'public';
      patch.onboarding = { ...org.platformCustomer.onboarding, source: src };
    }
    if (body.survey !== undefined) {
      patch.onboarding = { ...patch.onboarding, ...this.validateSurvey(body.survey), surveyCompletedAt: new Date() };
    }
    if (body.surveySkipped === true) {
      patch.onboarding = { ...patch.onboarding, surveySkippedAt: new Date() };
    }
    if (body.surveySkipped === false) {
      patch.onboarding = { ...patch.onboarding, surveySkippedAt: undefined, surveyCompletedAt: undefined };
    }
    if (body.billingQuery !== undefined && billingEnabled()) {
      if (body.billingQuery !== 'subscribe') throw new ValidationError('Invalid billing query');
      await billingService.prepareCheckout(orgId, userId);
    }
    if (body.billingResult !== undefined && billingEnabled()) {
      // The frontend returns from Stripe Checkout; confirmCheckout updates the
      // subscription status on PlatformCustomer.
      await billingService.confirmCheckout(orgId, body.billingResult);
    }
    if (body.skipBilling === true && billingEnabled()) {
      patch.onboarding = { ...patch.onboarding, subscribeSkippedAt: new Date() };
    }
    if (body.skipBilling === false && billingEnabled()) {
      patch.onboarding = { ...patch.onboarding, subscribeSkippedAt: undefined };
    }
    if (body.report === true) {
      // Report a signup issue (cancelled, bug, etc.) without abandoning.
      return { success: true };
    }

    if (Object.keys(patch).length > 0) {
      await prisma.platformCustomer.upsert({
        where: { organizationId: orgId },
        update: { onboarding: patch.onboarding },
        create: { ownerUserId: userId, organizationId: orgId, onboarding: patch.onboarding },
      });
      if (body.surveySkipped === true && patch.onboarding?.surveySkippedAt) {
        billingService.setSurveySkipped(orgId, userId);
      }
    }

    const updated = await prisma.organization.findFirst({
      where: { id: orgId },
      select: pendingSelect,
    });

    return serializePending(updated);
  }

  async sweepAbandoned() {
    const cutoff = new Date(Date.now() - ABANDON_AFTER_MS);
    try {
      const stale = await prisma.organization.findMany({
        where: {
          onboardingCompletedAt: null,
          confirmedAt: null,
          createdAt: { lt: cutoff },
          ...(billingEnabled()
            ? {
                members: {
                  some: {
                    role: 'ADMIN',
                    user: { role: 'UNASSIGNED' },
                  },
                },
              }
            : {}),
        },
        select: { id: true },
      });
      if (stale.length === 0) return 0;
      await prisma.organization.deleteMany({ where: { id: { in: stale.map((o) => o.id) } } });
      return stale.length;
    } catch (error) {
      logger.error('Abandoned signup sweep failed', { error: error.message });
      return 0;
    }
  }

  async funnel() {
    const [sevenDays, thirtyDays] = await Promise.all([
      prisma.organization.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
      prisma.organization.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    ]);
    const pendingCount = await prisma.organization.count({ where: { platformCustomer: { onboardingCompletedAt: null } } });
    const activeCount = await prisma.organization.count({ where: { status: 'ACTIVE' } });
    return { createdLast7Days: sevenDays, createdLast30Days: thirtyDays, pending: pendingCount, active: activeCount };
  }
}

export default new OnboardingService();
