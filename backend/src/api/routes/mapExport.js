// Map export route (spec 014 phase 3)
// GET /admin/maps/:mapId/export — returns a vector PDF of the floor map
// with an optional vendor directory. Admin/organizer only.
//
// Query params:
//   includeVendors=true  (default) — appends the vendor directory page(s)
//   includeVendors=false — map-only PDF

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { activeOrgFor } from './adminScope.js';
import mapExportService from '../../services/MapExportService.js';

const router = Router();

router.use(requireAuth, requireOrganizer);

router.get('/:mapId/export', async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    const includeVendors = req.query.includeVendors !== 'false';

    const pdfBuffer = await mapExportService.exportMapPdf(
      organizationId,
      req.params.mapId,
      { includeVendors },
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="floor-map-${req.params.mapId}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

export default router;