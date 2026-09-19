// Content › URL redirects (spec 028). Mounted at /admin/redirects.

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { activeOrgFor } from './adminScope.js';
import urlRedirectService from '../../services/UrlRedirectService.js';
import {
  validateBulkRedirectIds,
  validateCreateRedirect,
  validateUpdateRedirect,
} from '../validators/redirectValidators.js';

const router = Router();
router.use(requireAuth);
router.use(requireOrganizer);

router.get('/', async (req, res, next) => {
  try {
    res.json(await urlRedirectService.list(await activeOrgFor(req), req.query));
  } catch (error) {
    next(error);
  }
});

router.post('/', validateCreateRedirect, async (req, res, next) => {
  try {
    res.status(201).json(await urlRedirectService.create(await activeOrgFor(req), req.body));
  } catch (error) {
    next(error);
  }
});

router.post('/bulk-delete', validateBulkRedirectIds, async (req, res, next) => {
  try {
    res.json(await urlRedirectService.removeMany(await activeOrgFor(req), req.body.ids));
  } catch (error) {
    next(error);
  }
});

router.patch('/:redirectId', validateUpdateRedirect, async (req, res, next) => {
  try {
    res.json(
      await urlRedirectService.update(await activeOrgFor(req), req.params.redirectId, req.body)
    );
  } catch (error) {
    next(error);
  }
});

router.delete('/:redirectId', async (req, res, next) => {
  try {
    await urlRedirectService.remove(await activeOrgFor(req), req.params.redirectId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
