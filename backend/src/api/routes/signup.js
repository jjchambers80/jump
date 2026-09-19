// Signup routes (spec 022) — the create-organization onboarding flow.
// Any signed-in user may start: UNASSIGNED users are exactly who this is for.
// Every /:orgId route resolves a *pending* organization the caller administers
// (SYSTEM_ADMIN: any pending organization); completed ones 404 here and are
// managed through /organizations.

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validateCreateOrganization } from '../validators/organizationValidators.js';
import { ConflictError } from '../../middleware/errorHandler.js';
import onboardingService, { billingEnabled } from '../../services/OnboardingService.js';
import billingService from '../../services/BillingService.js';

const router = Router();

router.use(requireAuth);

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** GET /signup/current — the caller's newest unfinished organization, if any. */
router.get('/current', wrap(async (req, res) => {
  const organization = await onboardingService.current(req.user.id);
  res.json({ organization, billingEnabled: billingEnabled() });
}));

/** POST /signup { name, source? } — step 1: create the pending organization. */
router.post('/', validateCreateOrganization, wrap(async (req, res) => {
  const organization = await onboardingService.start(req.user.id, {
    name: req.body.name,
    source: req.body.source,
  });
  res.status(201).json(organization);
}));

/** GET /signup/:orgId — one pending organization the caller administers, with its step. */
router.get('/:orgId', wrap(async (req, res) => {
  res.json(await onboardingService.getPending(req.user.id, req.user.role, req.params.orgId));
}));

/**
 * POST /signup/:orgId/subscribe — embedded Stripe Checkout (subscription mode,
 * trial) for the STARTER plan. 409 until BILLING_ENABLED (phase 2).
 */
router.post('/:orgId/subscribe', wrap(async (req, res) => {
  const org = await onboardingService.requirePending(req.user.id, req.user.role, req.params.orgId);
  if (!billingEnabled()) throw new ConflictError('Subscriptions are not available yet');
  res.json(await billingService.createCheckout(org.id, req.user.id, { returnPath: `/signup/${org.id}/subscribe/return` }));
}));

/** POST /signup/:orgId/subscribe/confirm { sessionId } — record the completed Checkout on return. */
router.post('/:orgId/subscribe/confirm', wrap(async (req, res) => {
  const org = await onboardingService.requirePending(req.user.id, req.user.role, req.params.orgId);
  const result = await billingService.confirmCheckout(org.id, req.body?.sessionId);
  res.json({ ...result, organization: await onboardingService.getPending(req.user.id, req.user.role, org.id) });
}));

router.post('/:orgId/subscribe/skip', wrap(async (req, res) => {
  res.json(await onboardingService.skipSubscribe(req.user.id, req.user.role, req.params.orgId));
}));

/** PATCH /signup/:orgId/survey — partial survey answers, validated per key. */
router.patch('/:orgId/survey', wrap(async (req, res) => {
  res.json(await onboardingService.saveSurvey(req.user.id, req.user.role, req.params.orgId, req.body));
}));

router.post('/:orgId/survey/skip', wrap(async (req, res) => {
  res.json(await onboardingService.skipSurvey(req.user.id, req.user.role, req.params.orgId));
}));

/** POST /signup/:orgId/complete — finish; returns the org in the switcher shape. */
router.post('/:orgId/complete', wrap(async (req, res) => {
  res.json(await onboardingService.complete(req.user.id, req.user.role, req.params.orgId));
}));

/** DELETE /signup/:orgId — discard an unfinished organization. */
router.delete('/:orgId', wrap(async (req, res) => {
  await onboardingService.discard(req.user.id, req.user.role, req.params.orgId);
  res.status(204).end();
}));

export default router;
