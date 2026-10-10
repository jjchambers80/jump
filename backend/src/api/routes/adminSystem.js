// System administration routes (/admin/system) — SYSTEM_ADMIN only.
//
// Platform-wide on purpose: nothing here reads X-Jump-Org. Mutations need a
// step-up proof (X-Jump-Reauth). Logic lives in SystemAdminService.

import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireSystemAdmin } from '../../middleware/rbac.js';
import { requireRecentAuth } from '../../middleware/recentAuth.js';
import { makeLimiter, LIMITS } from '../../middleware/rateLimit.js';
import systemAdminService from '../../services/SystemAdminService.js';
import organizationService from '../../services/OrganizationService.js';
import userService from '../../services/UserService.js';
import {
  validateOrganizationListQuery,
  validateOrganizationStatus,
  validateSystemAdminInvite,
  validateSystemUserUpdate,
  validateUserListQuery,
} from '../validators/systemAdminValidators.js';

const router = express.Router();

router.use(requireAuth);
router.use(requireSystemAdmin);

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};

// Invites send email: same budget as Settings › Users add-user.
const inviteLimiter = makeLimiter('MEMBER_INVITE', LIMITS.MEMBER_INVITE);

router.get('/overview', wrap(async (req, res) => {
  res.json(await systemAdminService.overview());
}));

router.get('/organizations', validateOrganizationListQuery, wrap(async (req, res) => {
  res.json(await organizationService.listOrganizationsPage(req.listQuery));
}));

router.get('/organizations/:id', wrap(async (req, res) => {
  res.json(await systemAdminService.getOrganization(req.params.id));
}));

router.patch('/organizations/:id/status', requireRecentAuth, validateOrganizationStatus, wrap(async (req, res) => {
  res.json(await systemAdminService.setOrganizationStatus(req.user, req.params.id, req.body.status, req));
}));

router.get('/users', validateUserListQuery, wrap(async (req, res) => {
  res.json(await userService.listUsers(req.listQuery));
}));

router.post('/users/invite', requireRecentAuth, inviteLimiter, validateSystemAdminInvite, wrap(async (req, res) => {
  res.status(201).json(await systemAdminService.invite(req.user, req.body, req));
}));

router.patch('/users/:id', requireRecentAuth, validateSystemUserUpdate, wrap(async (req, res) => {
  res.json(await systemAdminService.updateUser(req.user, req.params.id, req.body, req));
}));

export default router;
