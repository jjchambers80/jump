// Content › Galleries (spec 046). Mounted at /admin/galleries.

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { activeOrgFor } from './adminScope.js';
import galleryService from '../../services/GalleryService.js';
import { validateCreateGallery, validateReplaceGallery } from '../validators/galleryValidators.js';

const router = Router();
router.use(requireAuth);
router.use(requireOrganizer);

router.get('/', async (req, res, next) => {
  try {
    res.json({ galleries: await galleryService.list(await activeOrgFor(req)) });
  } catch (error) {
    next(error);
  }
});

router.post('/', validateCreateGallery, async (req, res, next) => {
  try {
    res.status(201).json(await galleryService.create(await activeOrgFor(req), req.body));
  } catch (error) {
    next(error);
  }
});

router.get('/:galleryId', async (req, res, next) => {
  try {
    res.json(await galleryService.get(await activeOrgFor(req), req.params.galleryId));
  } catch (error) {
    next(error);
  }
});

router.put('/:galleryId', validateReplaceGallery, async (req, res, next) => {
  try {
    res.json(await galleryService.replace(await activeOrgFor(req), req.params.galleryId, req.body));
  } catch (error) {
    next(error);
  }
});

router.delete('/:galleryId', async (req, res, next) => {
  try {
    await galleryService.remove(await activeOrgFor(req), req.params.galleryId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
