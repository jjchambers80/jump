// Setup Guide Service (spec 022)
// The card grid a new organization sees on its empty dashboard. The API only
// says which tasks are done and which are shown; copy lives on the frontend.

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import { NotFoundError } from '../middleware/errorHandler.js';
import connectService from './ConnectService.js';
import { APPLICATION_GOALS, CHECKIN_GOAL } from '../config/onboarding.js';

class SetupGuideService {
  /**
   * @param {string} organizationId
   * @returns {Promise<{ dismissedAt: Date|null, tasks: Array, onboarding: Object|null }>}
   */
  async get(organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        setupGuideDismissedAt: true,
        brandColor: true,
        logoImageId: true,
        themeMode: true,
        companyName: true,
        addressLine1: true,
        paymentSettingsUpdatedAt: true,
        platformCustomer: { select: { onboarding: true } },
      },
    });
    if (!org) throw new NotFoundError('Organization not found');

    const [eventCount, activeDomainCount, formCount, redeemedCount, connect] = await Promise.all([
      prisma.event.count({ where: { venue: { organizationId } } }),
      prisma.organizationDomain.count({ where: { organizationId, status: 'ACTIVE' } }),
      prisma.applicationForm.count({ where: { event: { venue: { organizationId } } } }),
      prisma.ticket.count({ where: { status: 'REDEEMED', event: { venue: { organizationId } } } }),
      connectService.statusFor(organizationId),
    ]);

    const goals = org.platformCustomer?.onboarding?.goals ?? [];
    const showApplications = goals.some((goal) => APPLICATION_GOALS.includes(goal));
    const showCheckin = goals.includes(CHECKIN_GOAL);

    const tasks = [
      { id: 'event', done: eventCount > 0, href: '/admin/create-event', shown: true },
      {
        id: 'design',
        done: Boolean(org.brandColor || org.logoImageId || org.themeMode !== 'SYSTEM'),
        href: '/admin/online-store',
        shown: true,
      },
      {
        id: 'payments',
        // With Connect on, done means the organization's own Stripe account can
        // take charges; otherwise "reviewed the payments page" is the best signal.
        done: connect.enabled ? connect.status === 'active' : Boolean(org.paymentSettingsUpdatedAt),
        href: '/admin/settings/payments',
        state: connect.enabled ? 'connect' : 'platform',
        shown: true,
      },
      { id: 'business', done: Boolean(org.companyName && org.addressLine1), href: '/admin/settings', shown: true },
      { id: 'domain', done: activeDomainCount > 0, href: '/admin/settings/domains', shown: true },
      { id: 'applications', done: formCount > 0, href: '/admin/participants/applications', shown: showApplications },
      // Phase 3: organizers selling at the door get pointed at the scanner
      { id: 'checkin', done: redeemedCount > 0, href: '/admin/orders/scan', shown: showCheckin },
    ];

    return {
      dismissedAt: org.setupGuideDismissedAt,
      tasks,
      onboarding: org.platformCustomer?.onboarding ? { goals } : null,
    };
  }

  async dismiss(organizationId) {
    const org = await prisma.organization.update({
      where: { id: organizationId },
      data: { setupGuideDismissedAt: new Date() },
      select: { setupGuideDismissedAt: true },
    });
    logger.info('Setup guide dismissed', { event: 'setup_guide_dismissed', organizationId });
    return { dismissedAt: org.setupGuideDismissedAt };
  }
}

export default new SetupGuideService();
