// Onboarding Service (spec 022)
// The /signup flow: a pending Organization + ADMIN membership are created at
// the first step (the id is needed in the URL and for resume); the survey is
// stored on PlatformCustomer.onboarding as it is answered; `complete` stamps
// Organization.onboardingCompletedAt, which is what makes the organization
// appear in the org switcher, and promotes the owner's global role.

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import organizationService from './OrganizationService.js';
import applicationFormTemplateService from './ApplicationFormTemplateService.js';
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
      const org = await tx.organization.create({
        data: {
          name,
          slug: await organizationService.uniqueSlug(name),
          onboardingCompletedAt: null,
          members: { create: { userId, role: 'ADMIN' } },
          platformCustomer: {
            create: { ownerUserId: userId, onboarding: { version: ONBOARDING_VERSION, source: src } },
          },
        },
        select: pendingSelect,
      });
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

  async getPending(userId, role, organizationId) {
    return serializePending(await this.requirePending(userId, role, organizationId));
  }

  /** Merge a patch into PlatformCustomer.onboarding for a pending organization. */
  async _mergeOnboarding(organizationId, userId, patch) {
    const existing = await prisma.platformCustomer.findUnique({ where: { organizationId }, select: { onboarding: true } });
    const merged = { version: ONBOARDING_VERSION, ...(existing?.onboarding || {}), ...patch };
    await prisma.platformCustomer.upsert({
      where: { organizationId },
      update: { onboarding: merged },
      create: { organizationId, ownerUserId: userId, onboarding: merged },
    });
    return merged;
  }

  async saveSurvey(userId, role, organizationId, body) {
    const org = await this.requirePending(userId, role, organizationId);
    const patch = this.validateSurvey(body);
    const merged = await this._mergeOnboarding(org.id, userId, patch);
    logger.info('Organization onboarding survey saved', {
      event: 'organization_onboarding_step',
      organizationId: org.id,
      step: 'survey',
      keys: Object.keys(patch),
    });
    return { ...serializePending({ ...org, platformCustomer: { onboarding: merged } }) };
  }

  async skipSurvey(userId, role, organizationId) {
    const org = await this.requirePending(userId, role, organizationId);
    const merged = await this._mergeOnboarding(org.id, userId, { surveySkippedAt: new Date().toISOString() });
    return serializePending({ ...org, platformCustomer: { onboarding: merged } });
  }

  async skipSubscribe(userId, role, organizationId) {
    const org = await this.requirePending(userId, role, organizationId);
    const merged = await this._mergeOnboarding(org.id, userId, { subscribeSkippedAt: new Date().toISOString() });
    return serializePending({ ...org, platformCustomer: { onboarding: merged } });
  }

  /**
   * Finish onboarding: stamp the organization, make sure the Jump customer
   * record exists and is owned, and promote the owner from UNASSIGNED.
   * Idempotent for an already-completed organization the caller administers.
   * @returns {Promise<Object>} the organization in the GET /organizations shape
   */
  async complete(userId, role, organizationId) {
    const existing = await prisma.organization.findFirst({
      where: {
        id: organizationId,
        ...(role === 'SYSTEM_ADMIN' ? {} : { members: { some: { userId, role: 'ADMIN' } } }),
      },
      select: { id: true, onboardingCompletedAt: true, platformCustomer: { select: { id: true, onboarding: true, ownerUserId: true } } },
    });
    if (!existing) throw new NotFoundError('Organization not found');

    if (!existing.onboardingCompletedAt) {
      const now = new Date();
      const onboarding = {
        version: ONBOARDING_VERSION,
        ...(existing.platformCustomer?.onboarding || {}),
        ...(existing.platformCustomer?.onboarding?.surveySkippedAt ? {} : { surveyCompletedAt: now.toISOString() }),
      };
      await prisma.$transaction(async (tx) => {
        await tx.organization.update({ where: { id: existing.id }, data: { onboardingCompletedAt: now } });
        await tx.platformCustomer.upsert({
          where: { organizationId: existing.id },
          update: { onboarding },
          create: { organizationId: existing.id, ownerUserId: userId, onboarding },
        });
        // The owner may have signed in for the first time to do this; a
        // global staff role is what lets them into /admin at all.
        await tx.user.updateMany({ where: { id: userId, role: 'UNASSIGNED' }, data: { role: 'ADMIN' } });
      });

      logger.info('Organization onboarding completed', {
        event: 'organization_onboarding_completed',
        organizationId: existing.id,
        userId,
        source: onboarding.source ?? null,
        surveySkipped: Boolean(onboarding.surveySkippedAt),
        subscribeSkipped: Boolean(onboarding.subscribeSkippedAt),
        goals: onboarding.goals ?? [],
      });

      await this.seedTemplates(existing.id, userId, onboarding.goals ?? []);
    }

    return organizationService.getOrganizationById(existing.id);
  }

  /**
   * Phase 3 tailoring: organizations that said they run applications get the
   * starter form templates. Names are unique per organization, so re-running
   * is a no-op; a seed failure never fails the signup.
   */
  async seedTemplates(organizationId, userId, goals) {
    if (!goals.some((goal) => APPLICATION_GOALS.includes(goal))) return [];
    const seeded = [];
    for (const template of SEED_TEMPLATES) {
      try {
        const created = await applicationFormTemplateService.create(organizationId, template, { byUserId: userId });
        seeded.push(created.id);
      } catch (error) {
        if (error.statusCode !== 409) {
          logger.error('Onboarding template seed failed', { organizationId, template: template.name, error: error.message });
        }
      }
    }
    logger.info('Onboarding templates seeded', { event: 'organization_onboarding_templates_seeded', organizationId, count: seeded.length });
    return seeded;
  }

  /**
   * Delete unfinished signups nobody came back to: pending for longer than
   * `olderThanMs`, no events, no Stripe subscription. Runs from server.js.
   * @returns {Promise<number>} organizations removed
   */
  async sweepAbandoned(olderThanMs = ABANDON_AFTER_MS) {
    const cutoff = new Date(Date.now() - olderThanMs);
    const stale = await prisma.organization.findMany({
      where: {
        onboardingCompletedAt: null,
        createdAt: { lt: cutoff },
        venues: { none: { events: { some: {} } } },
        OR: [{ platformCustomer: null }, { platformCustomer: { stripeSubscriptionId: null } }],
      },
      select: { id: true, createdAt: true, platformCustomer: { select: { onboarding: true } } },
    });
    for (const org of stale) {
      await prisma.organization.delete({ where: { id: org.id } });
      logger.info('Organization onboarding abandoned', {
        event: 'organization_onboarding_abandoned',
        organizationId: org.id,
        startedAt: org.createdAt,
        step: stepFor(org.platformCustomer?.onboarding),
        source: org.platformCustomer?.onboarding?.source ?? null,
      });
    }
    return stale.length;
  }

  /**
   * Funnel counts for SYSTEM_ADMIN (phase 3). "Started" = organizations
   * created through /signup (they have a PlatformCustomer from step 1).
   * @param {number[]} windowsDays
   */
  async funnel(windowsDays = [7, 30]) {
    const now = Date.now();
    const windows = {};
    for (const days of windowsDays) {
      const since = new Date(now - days * 24 * 60 * 60 * 1000);
      const [started, completed, subscribed] = await Promise.all([
        prisma.platformCustomer.count({ where: { createdAt: { gte: since } } }),
        prisma.organization.count({ where: { onboardingCompletedAt: { gte: since }, platformCustomer: { isNot: null } } }),
        prisma.platformCustomer.count({ where: { createdAt: { gte: since }, stripeSubscriptionId: { not: null } } }),
      ]);
      windows[days] = { started, completed, subscribed };
    }
    const pending = await prisma.organization.count({ where: { onboardingCompletedAt: null } });
    return { windows, pending };
  }

  /** Discard an unfinished organization (membership and customer row cascade). */
  async discard(userId, role, organizationId) {
    const org = await this.requirePending(userId, role, organizationId);
    await prisma.organization.delete({ where: { id: org.id } });
    logger.info('Organization onboarding discarded', {
      event: 'organization_onboarding_discarded',
      organizationId: org.id,
      userId,
    });
  }
}

export default new OnboardingService();
