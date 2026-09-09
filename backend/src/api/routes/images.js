import { Router } from 'express';
import imageService from '../../services/ImageService.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { NotFoundError } from '../../middleware/errorHandler.js';

const router = Router();

/**
 * GET /images/:id
 * Get image metadata and serving URLs
 */
router.get('/:id', async (req, res, next) => {
  try {
    const image = await imageService.getImage(req.params.id);
    res.json(image);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /images/:id/:hash/:variant
 * Serve an image variant. Hash in URL acts as capability token.
 * Variant: original, thumb, card, hero
 */
router.get('/:id/:hash/:variant', async (req, res, next) => {
  try {
    const { id, hash, variant } = req.params;

    const image = await imageService.getImage(id);
    if (image.hash !== hash) {
      throw new NotFoundError('Image not found');
    }

    const data = await imageService.getVariantData(id, variant);
    if (!data) {
      throw new NotFoundError('Variant not found');
    }

    res.set({
      'Content-Type': data.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': `"${data.hash}"`,
    });

    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === `"${data.hash}"`) {
      return res.status(304).end();
    }

    res.send(data.buffer);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /images/cleanup
 * Delete orphaned file records with no image references.
 * Admin only.
 */
router.post('/cleanup', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    const deleted = await imageService.cleanupOrphans();
    res.json({ deleted });
  } catch (error) {
    next(error);
  }
});

export default router;
