// Settings › Users: the staff of one organization.
//
// Adding a user creates (or reuses) the User row by email plus an
// OrganizationMember, then emails a sign-in link. There is no invite table:
// magic link and Google already sign in to an existing User, and the member
// reads "Pending" until that first sign-in creates a UserSession.
//
// Membership role is per organization; User.role is the global claim the
// admin uses for RBAC, so every change here re-derives it (_syncGlobalRole).

import { prisma } from '@jump/db';
import { ConflictError, ForbiddenError, NotFoundError } from '../middleware/errorHandler.js';
import emailService from './EmailService.js';
import sessionService from './SessionService.js';
import { platformBaseUrl } from '../utils/storefrontUrl.js';
import logger from '../utils/logger.js';

const memberInclude = {
  user: {
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      image: true,
      isActive: true,
      twoStepEnabledAt: true,
      createdAt: true,
      _count: { select: { sessions: true } },
    },
  },
};

function statusOf(member) {
  if (!member.user.isActive) return 'INACTIVE';
  if (member.invitedAt && member.user._count.sessions === 0) return 'PENDING';
  return 'ACTIVE';
}

function format(member) {
  const { user } = member;
  return {
    id: user.id,
    email: user.email,
    name: user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    image: user.image,
    role: member.role,
    status: statusOf(member),
    requireTwoStep: member.requireTwoStep,
    twoStepEnabled: Boolean(user.twoStepEnabledAt),
    invitedAt: member.invitedAt,
    joinedAt: member.createdAt,
  };
}

class MemberService {
  /** The caller must be an ADMIN of this organization (SYSTEM_ADMIN always is). */
  async assertOrgAdmin(actor, organizationId) {
    if (actor.role === 'SYSTEM_ADMIN') return;
    const membership = await prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId: actor.id, organizationId } },
      select: { role: true },
    });
    if (membership?.role !== 'ADMIN') throw new ForbiddenError('Admin role required to manage users');
  }

  async list(organizationId, { role, status } = {}) {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId, user: { deletedAt: null }, ...(role ? { role } : {}) },
      include: memberInclude,
      orderBy: { createdAt: 'asc' },
    });
    const users = members.map(format);
    return status ? users.filter((u) => u.status === status) : users;
  }

  async invite(actor, organizationId, { emails, role, requireTwoStep = false }) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    if (!organization) throw new NotFoundError('Organization not found');
    const inviter = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { name: true, firstName: true, lastName: true, email: true },
    });
    const inviterName =
      inviter?.name || [inviter?.firstName, inviter?.lastName].filter(Boolean).join(' ') || inviter?.email || 'An admin';

    const invited = [];
    const alreadyMember = [];
    const emailFailed = [];
    for (const email of [...new Set(emails.map((e) => e.trim().toLowerCase()))]) {
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.upsert({
          where: { email },
          update: {},
          create: { email, role },
          select: { id: true, deletedAt: true },
        });
        if (user.deletedAt) throw new ConflictError(`${email} belongs to a deleted account`);
        const existing = await tx.organizationMember.findUnique({
          where: { userId_organizationId: { userId: user.id, organizationId } },
        });
        if (existing) return null;
        await tx.organizationMember.create({
          data: { userId: user.id, organizationId, role, requireTwoStep, invitedAt: new Date(), invitedById: actor.id },
        });
        await this._syncGlobalRole(tx, user.id);
        return user;
      });
      if (!created) {
        alreadyMember.push(email);
        continue;
      }
      invited.push(email);
      try {
        await this._sendInvite({ to: email, organizationId, organizationName: organization.name, inviterName, role, requireTwoStep });
      } catch (error) {
        // The member exists either way; the admin can resend from the list.
        logger.error('Staff invite email failed', { event: 'staff_invite_failed', error: error.message });
        emailFailed.push(email);
      }
    }
    logger.info('Staff invited', { event: 'staff_invited', organizationId, count: invited.length });
    return { invited, alreadyMember, emailFailed };
  }

  async update(actor, organizationId, userId, { role, requireTwoStep, isActive }) {
    const member = await this._member(organizationId, userId);
    if (userId === actor.id && (role !== undefined || isActive !== undefined)) {
      throw new ForbiddenError('You cannot change your own role or status');
    }
    if (role && role !== 'ADMIN' && member.role === 'ADMIN') await this._assertNotLastAdmin(organizationId);

    await prisma.$transaction(async (tx) => {
      const data = {};
      if (role !== undefined) data.role = role;
      if (requireTwoStep !== undefined) data.requireTwoStep = requireTwoStep;
      if (Object.keys(data).length) {
        await tx.organizationMember.update({ where: { id: member.id }, data });
      }
      if (isActive !== undefined) {
        // Deactivation signs the user out of Jump entirely, so only an org
        // that owns every one of their memberships may do it.
        const others = await tx.organizationMember.count({ where: { userId, NOT: { organizationId } } });
        if (others > 0) throw new ForbiddenError('This user belongs to other organizations; remove them instead');
        await tx.user.update({ where: { id: userId }, data: { isActive } });
      }
      if (role !== undefined) await this._syncGlobalRole(tx, userId);
    });
    // The frontend claims refresh also drops an inactive user, but only within
    // 60 s; revoking the sessions makes the backend refuse them at once.
    if (isActive === false) await sessionService.revokeAll(userId, 'deactivated');
    return format(await this._member(organizationId, userId));
  }

  async remove(actor, organizationId, userId) {
    if (userId === actor.id) throw new ForbiddenError('You cannot remove yourself');
    const member = await this._member(organizationId, userId);
    if (member.role === 'ADMIN') await this._assertNotLastAdmin(organizationId);
    await prisma.$transaction(async (tx) => {
      await tx.organizationMember.delete({ where: { id: member.id } });
      await this._syncGlobalRole(tx, userId);
    });
  }

  async resend(actor, organizationId, userId) {
    const member = await this._member(organizationId, userId);
    if (statusOf(member) !== 'PENDING') throw new ConflictError('This user has already signed in');
    const [organization, inviter] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } }),
    ]);
    await this._sendInvite({
      to: member.user.email,
      organizationId,
      organizationName: organization.name,
      inviterName: inviter?.name || inviter?.email || 'An admin',
      role: member.role,
      requireTwoStep: member.requireTwoStep,
    });
  }

  async _member(organizationId, userId) {
    const member = await prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: memberInclude,
    });
    if (!member) throw new NotFoundError('User not found in this organization');
    return member;
  }

  async _assertNotLastAdmin(organizationId) {
    const admins = await prisma.organizationMember.count({ where: { organizationId, role: 'ADMIN' } });
    if (admins <= 1) throw new ConflictError('An organization needs at least one admin');
  }

  /** The sign-in link names the org and prefills the email ("Join <Org> on Eventimus"). */
  _sendInvite({ organizationId, ...params }) {
    const query = new URLSearchParams({ callbackUrl: '/admin', invite: organizationId, email: params.to });
    return emailService.sendStaffInvite({
      ...params,
      signInUrl: `${platformBaseUrl()}/auth/signin?${query}`,
    });
  }

  /** User.role follows memberships: any ADMIN → ADMIN, any → ORGANIZER, none → UNASSIGNED. */
  async _syncGlobalRole(tx, userId) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || user.role === 'SYSTEM_ADMIN') return;
    const roles = (await tx.organizationMember.findMany({ where: { userId }, select: { role: true } })).map((m) => m.role);
    const role = roles.includes('ADMIN') ? 'ADMIN' : roles.length ? 'ORGANIZER' : 'UNASSIGNED';
    if (role !== user.role) await tx.user.update({ where: { id: userId }, data: { role } });
  }
}

export default new MemberService();
