// Online store themes (spec 038). Mounted at /admin/themes.
// Everything but /status and /rollout is 404 until the master switch
// (THEME_EDITOR_ENABLED) and the organization's rollout flag are both on.

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { allowDeveloperToken } from '../../middleware/developerToken.js';
import { ForbiddenError } from '../../middleware/errorHandler.js';
import { requireOrganizer, requireSystemAdmin } from '../../middleware/rbac.js';
import { activeOrgFor } from './adminScope.js';
import themeService from '../../services/ThemeService.js';
import { validateThemeRestore, validateThemeRollout, validateThemeSave } from '../validators/themeValidators.js';

const router = Router();
// Spec 043: the Jump CLI's developer token (scope `themes`) works here and nowhere else.
router.use(allowDeveloperToken('themes'));
router.use((req, res, next) => (req.user?.developerTokenId ? next() : requireAuth(req, res, next)));
router.use(requireOrganizer);

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};

/** GET /admin/themes/status — whether the themes UI is on for the active organization. */
router.get('/status', handle(async (req, res) => {
  res.json(await themeService.status(await activeOrgFor(req)));
}));

/** PUT /admin/themes/rollout { enabled } — SYSTEM_ADMIN per-org rollout (contracts C10). */
router.put('/rollout', requireSystemAdmin, validateThemeRollout, handle(async (req, res) => {
  if (req.user.developerTokenId) throw new ForbiddenError('Developer tokens cannot change the rollout');
  res.json(await themeService.setRollout(await activeOrgFor(req), req.body.enabled));
}));

// Every route below needs themes on for the organization.
const enabled = (fn) => async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    await themeService.assertEnabled(organizationId);
    await fn(req, res, organizationId);
  } catch (error) {
    next(error);
  }
};

router.get('/', enabled(async (req, res, organizationId) => {
  res.json({ themes: await themeService.list(organizationId) });
}));

router.get('/:themeId', enabled(async (req, res, organizationId) => {
  res.json(await themeService.get(organizationId, req.params.themeId));
}));

router.get('/:themeId/content', enabled(async (req, res, organizationId) => {
  res.json(await themeService.getContent(organizationId, req.params.themeId));
}));

router.get('/:themeId/documents/:key', enabled(async (req, res, organizationId) => {
  res.json(await themeService.getDocument(organizationId, req.params.themeId, req.params.key));
}));

/** PUT /admin/themes/:id/save — the only write for editor content (contracts C5). */
router.put('/:themeId/save', validateThemeSave, enabled(async (req, res, organizationId) => {
  res.json(await themeService.save(organizationId, req.params.themeId, req.body, req.user.id));
}));

router.get('/:themeId/revisions', enabled(async (req, res, organizationId) => {
  res.json({ revisions: await themeService.revisions(organizationId, req.params.themeId) });
}));

router.post('/:themeId/revisions/:revisionId/restore', validateThemeRestore, enabled(async (req, res, organizationId) => {
  res.json(
    await themeService.restore(organizationId, req.params.themeId, req.params.revisionId, req.body.themeVersion, req.user.id),
  );
}));

router.get('/:themeId/preview-data', enabled(async (req, res, organizationId) => {
  res.json(await themeService.previewData(organizationId, req.params.themeId, String(req.query.page || 'home')));
}));

export default router;
