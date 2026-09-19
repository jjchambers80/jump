// Content › Menus (spec 027). Mounted at /admin/menus.

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { activeOrgFor } from './adminScope.js';
import menuService from '../../services/MenuService.js';
import { validateCreateMenu, validateReplaceMenu } from '../validators/menuValidators.js';

const router = Router();
router.use(requireAuth);
router.use(requireOrganizer);

router.get('/', async (req, res, next) => {
  try {
    res.json({ menus: await menuService.list(await activeOrgFor(req)) });
  } catch (error) {
    next(error);
  }
});

router.post('/', validateCreateMenu, async (req, res, next) => {
  try {
    res.status(201).json(await menuService.create(await activeOrgFor(req), req.body));
  } catch (error) {
    next(error);
  }
});

/** GET /admin/menus/link-targets?q= — link picker candidates. */
router.get('/link-targets', async (req, res, next) => {
  try {
    res.json(await menuService.linkTargets(await activeOrgFor(req), req.query.q));
  } catch (error) {
    next(error);
  }
});

router.get('/:menuId', async (req, res, next) => {
  try {
    res.json(await menuService.get(await activeOrgFor(req), req.params.menuId));
  } catch (error) {
    next(error);
  }
});

router.put('/:menuId', validateReplaceMenu, async (req, res, next) => {
  try {
    res.json(await menuService.replace(await activeOrgFor(req), req.params.menuId, req.body));
  } catch (error) {
    next(error);
  }
});

router.post('/:menuId/duplicate', async (req, res, next) => {
  try {
    res.status(201).json(await menuService.duplicate(await activeOrgFor(req), req.params.menuId));
  } catch (error) {
    next(error);
  }
});

router.delete('/:menuId', async (req, res, next) => {
  try {
    await menuService.remove(await activeOrgFor(req), req.params.menuId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
