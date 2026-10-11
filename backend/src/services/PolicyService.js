// Spec 052: Settings › Policies. Each written policy is a Page row with
// `policyType` set, so it renders like any page (default template, slug,
// theme). Saving publishes; removing deletes the row ("No policy set"). Until
// a policy is saved the editor offers starter text built from the store's
// details — never stored on its own.

import { prisma } from '@jump/db';
import { NotFoundError } from '../middleware/errorHandler.js';
import { rethrowSlugConflict, uniqueSlug } from '../utils/slug.js';
import { sanitizeContentHtml } from '../utils/sanitizeHtml.js';
import { POLICY_TYPES, policyMeta, starterPolicy } from '../config/policyTemplates.js';
import storeFileService from './StoreFileService.js';

const STARTER_ORG_SELECT = {
  name: true,
  companyName: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  selfServeRefundsEnabled: true,
  selfServeRefundCutoffHours: true,
  selfServeRefundFeeType: true,
  selfServeRefundFeeValue: true,
};

function rowFor(type) {
  const meta = policyMeta(type);
  if (!meta) throw new NotFoundError('Policy not found');
  return meta;
}

class PolicyService {
  /** The seven policies in display order, with their published state. */
  async list(organizationId) {
    const [org, pages] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { showPoliciesInFooter: true } }),
      prisma.page.findMany({
        where: { organizationId, policyType: { not: null } },
        select: { policyType: true, title: true, slug: true, updatedAt: true },
      }),
    ]);
    if (!org) throw new NotFoundError('Organization not found');
    const byType = new Map(pages.map((p) => [p.policyType, p]));
    return {
      showInFooter: org.showPoliciesInFooter,
      policies: POLICY_TYPES.map(({ type, title }) => {
        const page = byType.get(type);
        return {
          type,
          title: page?.title ?? title,
          slug: page?.slug ?? null,
          status: page ? 'PUBLISHED' : 'NOT_SET',
          updatedAt: page?.updatedAt ?? null,
        };
      }),
    };
  }

  /** The saved policy, or starter text (`starter: true`) when none is set. */
  async get(organizationId, type) {
    rowFor(type);
    const page = await prisma.page.findFirst({
      where: { organizationId, policyType: type },
      select: { title: true, slug: true, content: true, updatedAt: true },
    });
    if (page) return { type, ...page, status: 'PUBLISHED', starter: false };
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: STARTER_ORG_SELECT });
    if (!org) throw new NotFoundError('Organization not found');
    return { type, ...starterPolicy(type, org), slug: null, updatedAt: null, status: 'NOT_SET', starter: true };
  }

  /** Create or replace a policy; it is published at once. */
  async save(organizationId, type, { title, content }) {
    const meta = rowFor(type);
    const data = { title: title.trim(), content: sanitizeContentHtml(content) };
    const existing = await prisma.page.findFirst({
      where: { organizationId, policyType: type },
      select: { id: true },
    });
    let page;
    try {
      page = existing
        ? await prisma.page.update({ where: { id: existing.id }, data })
        : await prisma.page.create({
            data: {
              organizationId,
              policyType: type,
              ...data,
              slug: await uniqueSlug(prisma.page, { scope: { organizationId }, raw: meta.slug }),
              isVisible: true,
              template: null,
            },
          });
    } catch (error) {
      rethrowSlugConflict(error);
    }
    await storeFileService.syncReferences('PAGE', page.id, { content: page.content }, organizationId);
    return this.get(organizationId, type);
  }

  /** Unset a policy: the page goes away and the list shows "No policy set". */
  async remove(organizationId, type) {
    rowFor(type);
    const page = await prisma.page.findFirst({ where: { organizationId, policyType: type }, select: { id: true } });
    if (!page) return;
    await storeFileService.syncReferences('PAGE', page.id, { content: '' }, organizationId);
    await prisma.page.delete({ where: { id: page.id } });
  }

  async setShowInFooter(organizationId, showInFooter) {
    await prisma.organization.update({ where: { id: organizationId }, data: { showPoliciesInFooter: showInFooter } });
    return this.list(organizationId);
  }

  /**
   * Storefront footer and checkout links: published policies in display order,
   * or none when the organization turned the footer links off.
   */
  async publicLinks(organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        slug: true,
        showPoliciesInFooter: true,
        pages: {
          where: { policyType: { not: null }, isVisible: true },
          select: { policyType: true, title: true, slug: true },
        },
      },
    });
    if (!org?.showPoliciesInFooter) return [];
    const order = POLICY_TYPES.map((p) => p.type);
    return org.pages
      .sort((a, b) => order.indexOf(a.policyType) - order.indexOf(b.policyType))
      .map((p) => ({ type: p.policyType, title: p.title, href: `/organizations/${org.slug}/pages/${p.slug}` }));
  }
}

export default new PolicyService();
