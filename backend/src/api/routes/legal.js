// Legal routes (spec 024 phase 3): the current document versions, so a
// client can echo what it showed in `acceptances`. Public, cacheable for a
// minute; the pages themselves are spec 023.

import express from 'express';
import legalAcceptanceService from '../../services/LegalAcceptanceService.js';

const router = express.Router();

router.get('/versions', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(legalAcceptanceService.versions());
});

export default router;
