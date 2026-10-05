import { prisma } from '@jump/db';
import { rethrowSlugConflict, resolveUniqueSlug, uniqueSlug } from '../utils/slug.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import storeFileService from './StoreFileService.js';
import { sanitizeContentHtml } from '../utils/sanitizeHtml.js';
import { findByPublicIdentifier } from '../utils/publicIdentifier.js';
import pageTemplateService from './PageTemplateService.js';
import { contactFormSection } from '../utils/pageTemplateManifest.js';
import { FULL_WIDTH_TEMPLATE } from '@jump/theme';

/** Optional text field: trims, and stores an empty string as null. */
function optionalText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

/** Spec 044D: a page may only point at a standing form (no event) of its own organization. */
async function assertStandingForm(organizationId, formId) {
  if (formId === undefined || formId === null) return;
  const form = await prisma.applicationForm.findFirst({
    where: { id: formId, organizationId, eventId: null },
    select: { id: true },
  });
  if (!form) throw new ValidationError('Validation failed', [{ field: 'applicationFormId', message: 'Choose one of your standing forms' }]);
}

/**
 * Spec 044D: the page's Apply button. DRAFT forms stay invisible; an OPEN form
 * outside its window reads as CLOSED (with the reopen date when it has one).
 */
async function publicApplyForm(organizationId, formId, applyLabel) {
  if (!formId) return null;
  const form = await prisma.applicationForm.findFirst({
    where: { id: formId, organizationId, eventId: null, status: { in: ['OPEN', 'CLOSED'] } },
    select: { slug: true, name: true, intro: true, status: true, buttonLabel: true, opensAt: true, closesAt: true },
  });
  if (!form) return null;
  const now = new Date();
  const open = form.status === 'OPEN' && !(form.opensAt && now < form.opensAt) && !(form.closesAt && now > form.closesAt);
  return {
    slug: form.slug,
    name: form.name,
    intro: form.intro,
    label: applyLabel || form.buttonLabel || 'Apply now',
    status: open ? 'OPEN' : 'CLOSED',
    opensAt: !open && form.opensAt && form.opensAt > now ? form.opensAt : null,
  };
}

class PageService {
  async list(organizationId) {
    return prisma.page.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** One page, only when it belongs to the organization; 404 otherwise. */
  async get(organizationId, pageId) {
    const page = await prisma.page.findFirst({ where: { id: pageId, organizationId } });
    if (!page) throw new NotFoundError('Page not found');
    return page;
  }

  /**
   * Storefront: a visible page by handle; hidden pages are 404. A page with a
   * template carries its sections (spec 042); `contactFormAvailable` says
   * whether a contact form can deliver — the store email itself never leaves
   * the backend. A full-width page lays out around its content in the theme
   * (`page:<id>` document); without the theme renderer it is the default body.
   * `includeHidden` is for the theme editor only.
   */
  async getPublic(organizationId, identifier, { includeHidden = false } = {}) {
    const { template: templateName, applicationFormId, applyLabel, ...row } = await this._findPublic(organizationId, identifier, { includeHidden });
    const page = { ...row, applyForm: await publicApplyForm(organizationId, applicationFormId, applyLabel) };
    if (templateName === FULL_WIDTH_TEMPLATE) {
      return { ...page, template: { name: FULL_WIDTH_TEMPLATE, sections: [{ type: 'page_content' }] } };
    }
    const template = await pageTemplateService.resolve(organizationId, templateName);
    if (!template) return { ...page, template: null };
    const sections = template.definition?.sections ?? [];
    let contactFormAvailable = false;
    if (contactFormSection(template.definition)) {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { email: true },
      });
      contactFormAvailable = Boolean(organization?.email);
    }
    return { ...page, template: { name: template.name, sections }, contactFormAvailable };
  }

  /** The visible page row the storefront reads (with its template name). */
  async _findPublic(organizationId, identifier, { includeHidden = false } = {}) {
    const page = await findByPublicIdentifier(prisma.page, identifier, {
      where: { organizationId, ...(!includeHidden && { isVisible: true }) },
      select: {
        id: true,
        title: true,
        slug: true,
        content: true,
        seoTitle: true,
        seoDescription: true,
        template: true,
        applicationFormId: true,
        applyLabel: true,
        updatedAt: true,
      },
    });
    if (!page) throw new NotFoundError('Page not found');
    return page;
  }

  async create(organizationId, data) {
    await pageTemplateService.assertAssignable(organizationId, data.template);
    await assertStandingForm(organizationId, data.applicationFormId);
    const title = data.title.trim();
    const slugState = await resolveUniqueSlug(prisma.page, {
      scope: { organizationId },
      title,
      customSlug: data.slug,
    });
    let page;
    try {
      page = await prisma.page.create({
        data: {
          organizationId,
          title,
          ...slugState,
          content: sanitizeContentHtml(data.content),
          isVisible: data.isVisible ?? true,
          seoTitle: optionalText(data.seoTitle) ?? null,
          seoDescription: optionalText(data.seoDescription) ?? null,
          template: data.template ?? null,
          applicationFormId: data.applicationFormId ?? null,
          applyLabel: optionalText(data.applyLabel) ?? null,
        },
      });
    } catch (error) {
      rethrowSlugConflict(error);
    }
    // Content › Files "Used in" (spec 025).
    await storeFileService.syncReferences(
      'PAGE',
      page.id,
      { content: page.content },
      organizationId
    );
    return page;
  }

  /** Partial update: only fields present in `data` change. */
  async update(organizationId, pageId, data) {
    const existing = await this.get(organizationId, pageId);
    const patch = {};
    if (data.title !== undefined) patch.title = data.title.trim();
    if (data.content !== undefined) patch.content = sanitizeContentHtml(data.content);
    if (data.isVisible !== undefined) patch.isVisible = data.isVisible;
    if (data.seoTitle !== undefined) patch.seoTitle = optionalText(data.seoTitle);
    if (data.seoDescription !== undefined) patch.seoDescription = optionalText(data.seoDescription);
    if (data.template !== undefined) {
      await pageTemplateService.assertAssignable(organizationId, data.template);
      patch.template = data.template;
    }
    if (data.applicationFormId !== undefined) {
      if (data.applicationFormId === null) {
        patch.applicationFormId = null;
        patch.applyLabel = null; // Clear label when form is removed
      } else {
        await assertStandingForm(organizationId, data.applicationFormId);
        patch.applicationFormId = data.applicationFormId;
      }
    }
    if (data.applyLabel !== undefined && data.applicationFormId !== null) {
      patch.applyLabel = optionalText(data.applyLabel) ?? null;
    }
    if (data.title !== undefined || data.slug !== undefined) {
      Object.assign(
        patch,
        await resolveUniqueSlug(prisma.page, {
          scope: { organizationId },
          title: patch.title ?? existing.title,
          customSlug: data.slug,
          currentSlug: existing.slug,
          slugCustomized: existing.slugCustomized,
          exceptId: pageId,
        })
      );
    }
    let page;
    try {
      page = await prisma.page.update({ where: { id: existing.id }, data: patch });
    } catch (error) {
      rethrowSlugConflict(error);
    }
    if (patch.content !== undefined) {
      await storeFileService.syncReferences(
        'PAGE',
        page.id,
        { content: page.content },
        organizationId
      );
    }
    return page;
  }

  async _uniqueSlug(organizationId, raw, exceptPageId = null) {
    return uniqueSlug(prisma.page, {
      scope: { organizationId },
      raw,
      exceptId: exceptPageId,
    });
  }
}

export default new PageService();
