import { prisma } from '@jump/db';

class PageService {
  async list(organizationId) {
    return prisma.page.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async create(organizationId, data) {
    return prisma.page.create({
      data: {
        organizationId,
        title: data.title.trim(),
        content: data.content.trim(),
        isVisible: data.isVisible ?? true,
      },
    });
  }
}

export default new PageService();
