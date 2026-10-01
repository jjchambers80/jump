// Spec 042: page templates a developer (SYSTEM_ADMIN) uploads to one
// organization. Pages pick one by name (Page.template); the storefront lays
// the page out from the stored, normalized manifest.

import { prisma } from '@jump/db';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { parsePageTemplateManifest } from '../utils/pageTemplateManifest.js';

function serialize(template, pageCount = 0) {
  return {
    id: template.id,
    name: template.name,
    label: template.label,
    description: template.description,
    sections: template.definition?.sections ?? [],
    pageCount,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

class PageTemplateService {
  /** Every template of the organization, with how many pages use each. */
  async list(organizationId) {
    const [templates, usage] = await Promise.all([
      prisma.pageTemplate.findMany({ where: { organizationId }, orderBy: [{ label: 'asc' }, { id: 'asc' }] }),
      prisma.page.groupBy({
        by: ['template'],
        where: { organizationId, template: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const counts = new Map(usage.map((row) => [row.template, row._count._all]));
    return templates.map((template) => serialize(template, counts.get(template.name) ?? 0));
  }

  async get(organizationId, id) {
    const template = await prisma.pageTemplate.findFirst({ where: { id, organizationId } });
    if (!template) throw new NotFoundError('Page template not found');
    return template;
  }

  /** The uploaded manifest as stored, for download. */
  async manifest(organizationId, id) {
    return (await this.get(organizationId, id)).definition;
  }

  /** Upload: a template with the same name is replaced in place. */
  async upsert(organizationId, input, userId = null) {
    const { manifest, errors } = parsePageTemplateManifest(input);
    if (!manifest) throw new ValidationError('The template is not valid', errors);
    const data = {
      label: manifest.label,
      description: manifest.description ?? null,
      definition: manifest,
      createdById: userId,
    };
    const template = await prisma.pageTemplate.upsert({
      where: { organizationId_name: { organizationId, name: manifest.name } },
      create: { organizationId, name: manifest.name, ...data },
      update: data,
    });
    const pageCount = await prisma.page.count({ where: { organizationId, template: template.name } });
    return serialize(template, pageCount);
  }

  /** Delete; pages that used it fall back to the default layout. */
  async remove(organizationId, id) {
    const template = await this.get(organizationId, id);
    const [{ count }] = await prisma.$transaction([
      prisma.page.updateMany({
        where: { organizationId, template: template.name },
        data: { template: null },
      }),
      prisma.pageTemplate.delete({ where: { id: template.id } }),
    ]);
    return { pagesReset: count };
  }

  /** The template a page names, or null (no template, or it was deleted). */
  async resolve(organizationId, name) {
    if (!name) return null;
    return prisma.pageTemplate.findUnique({
      where: { organizationId_name: { organizationId, name } },
    });
  }

  /** 400 unless `name` is null or one of the organization's templates. */
  async assertAssignable(organizationId, name) {
    if (name === null || name === undefined) return;
    if (!(await this.resolve(organizationId, name))) {
      const error = new ValidationError('That page template does not exist', [
        { field: 'template', message: 'Choose one of the store’s page templates' },
      ]);
      error.code = 'UNKNOWN_TEMPLATE';
      throw error;
    }
  }
}

export default new PageTemplateService();
