// Contacts › Lists (spec 055). Mounted at /admin/contact-lists. A list's
// contacts are read through GET /admin/customers?list=<id>, so search, sort,
// pagination and detail-page navigation stay one implementation.

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireFeature, requirePermission } from '../../middleware/rbac.js';
import { requireRecentAuth } from '../../middleware/recentAuth.js';
import { csvUpload } from '../../middleware/csvUpload.js';
import { LIMITS, makeLimiter } from '../../middleware/rateLimit.js';
import contactListImportService from '../../services/ContactListImportService.js';
import { activeOrgFor } from './adminScope.js';
import contactListService from '../../services/ContactListService.js';
import customerService from '../../services/CustomerService.js';
import {
  validateAddMembers,
  validateCreateList,
  validateMembers,
  validatePreview,
  validateUpdateList,
} from '../validators/contactListValidators.js';

const router = Router();
router.use(requireAuth);
router.use(requireFeature('customers'));

const canEdit = requirePermission('customers.lists');
const canImport = requirePermission('customers.import');
const importLimiter = makeLimiter('CONTACT_IMPORT', LIMITS.CONTACT_IMPORT);
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

router.get('/', wrap(async (req, res) => {
  const { search, type } = req.query;
  res.json({ lists: await contactListService.list(await activeOrgFor(req), { search, type }) });
}));

router.post('/preview', validatePreview, wrap(async (req, res) => {
  res.json(await contactListService.preview(await activeOrgFor(req), req.body.filters));
}));

router.post('/', canEdit, validateCreateList, wrap(async (req, res) => {
  res.status(201).json(await contactListService.create(await activeOrgFor(req), req.user.id, req.body));
}));

router.get('/:listId', wrap(async (req, res) => {
  res.json(await contactListService.get(await activeOrgFor(req), req.params.listId));
}));

router.patch('/:listId', canEdit, validateUpdateList, wrap(async (req, res) => {
  res.json(await contactListService.update(await activeOrgFor(req), req.params.listId, req.body));
}));

router.delete('/:listId', canEdit, wrap(async (req, res) => {
  await contactListService.remove(await activeOrgFor(req), req.params.listId);
  res.status(204).end();
}));

router.post('/:listId/duplicate', canEdit, wrap(async (req, res) => {
  res.status(201).json(await contactListService.duplicate(await activeOrgFor(req), req.user.id, req.params.listId));
}));

router.post('/:listId/members', canEdit, validateAddMembers, wrap(async (req, res) => {
  const organizationId = await activeOrgFor(req);
  if (req.body.query) {
    // Everyone the Contacts list shows for these filters (scope defaults to all, like the page).
    const where = await customerService.whereFor(organizationId, { scope: 'all', ...req.body.query });
    res.json(await contactListService.addMembersWhere(organizationId, req.user.id, req.params.listId, where));
    return;
  }
  res.json(await contactListService.addMembers(organizationId, req.user.id, req.params.listId, req.body.contactIds));
}));

router.delete('/:listId/members', canEdit, validateMembers, wrap(async (req, res) => {
  res.json(await contactListService.removeMembers(await activeOrgFor(req), req.params.listId, req.body.contactIds));
}));

// CSV import (spec 055 §4.6): preview reads the columns, import adds the rows.
router.post('/:listId/import/preview', canImport, csvUpload, wrap(async (req, res) => {
  res.json(await contactListImportService.preview(await activeOrgFor(req), req.params.listId, req.file.buffer));
}));

router.post('/:listId/import', importLimiter, canImport, requireRecentAuth, csvUpload, wrap(async (req, res) => {
  res.json(
    await contactListImportService.import(
      await activeOrgFor(req),
      req.user.id,
      req.params.listId,
      req.file.buffer,
      req.body?.mapping
    )
  );
}));

export default router;
