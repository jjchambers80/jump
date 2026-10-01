// Spec 042: storefront contact-form messages. Saved first, then emailed to the
// store email (Organization.email); the row records whether the email left,
// so a Resend failure never loses a message.

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError } from '../middleware/errorHandler.js';
import { contactFormSection } from '../utils/pageTemplateManifest.js';
import emailService from './EmailService.js';
import pageService from './PageService.js';
import pageTemplateService from './PageTemplateService.js';
import logger from '../utils/logger.js';

const PAGE_SIZE = 25;

function serialize(row, pageTitles) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    subject: row.subject,
    message: row.message,
    page: row.pageId ? { id: row.pageId, title: pageTitles.get(row.pageId) ?? null } : null,
    emailedAt: row.emailedAt,
    emailError: row.emailError,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

class ContactInquiryService {
  /**
   * Admin inbox (Online store › Messages): newest first, 25 a page.
   * @param {{ status?: 'all'|'unread', page?: number, q?: string }} query
   */
  async list(organizationId, { status = 'all', page = 1, q = '' } = {}) {
    const search = String(q || '').trim();
    const where = {
      organizationId,
      ...(status === 'unread' ? { readAt: null } : {}),
      ...(search
        ? {
            OR: ['name', 'email', 'subject', 'message'].map((field) => ({
              [field]: { contains: search, mode: 'insensitive' },
            })),
          }
        : {}),
    };
    const current = Math.max(1, Number.parseInt(page, 10) || 1);
    const [rows, total, unreadCount] = await Promise.all([
      prisma.contactInquiry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (current - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.contactInquiry.count({ where }),
      prisma.contactInquiry.count({ where: { organizationId, readAt: null } }),
    ]);
    const pageTitles = await this._pageTitles(organizationId, rows);
    return {
      inquiries: rows.map((row) => serialize(row, pageTitles)),
      unreadCount,
      pagination: { page: current, limit: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) },
    };
  }

  /** Unread messages of the organization (sidebar badge). */
  async unreadCount(organizationId) {
    return prisma.contactInquiry.count({ where: { organizationId, readAt: null } });
  }

  /** Mark one message read or unread. */
  async setRead(organizationId, id, read) {
    const existing = await prisma.contactInquiry.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Message not found');
    const row = await prisma.contactInquiry.update({
      where: { id },
      data: { readAt: read ? existing.readAt ?? new Date() : null },
    });
    return serialize(row, await this._pageTitles(organizationId, [row]));
  }

  async remove(organizationId, id) {
    const { count } = await prisma.contactInquiry.deleteMany({ where: { id, organizationId } });
    if (!count) throw new NotFoundError('Message not found');
  }

  async _pageTitles(organizationId, rows) {
    const ids = [...new Set(rows.map((row) => row.pageId).filter(Boolean))];
    if (!ids.length) return new Map();
    const pages = await prisma.page.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, title: true },
    });
    return new Map(pages.map((page) => [page.id, page.title]));
  }

  /**
   * @param {string} organizationId
   * @param {string} pageIdentifier  slug or id of a visible page
   * @param {{ name: string, email: string, phone?: string|null, subject?: string|null, message: string }} input  validated
   */
  async submit(organizationId, pageIdentifier, input) {
    const page = await pageService._findPublic(organizationId, pageIdentifier);
    const template = await pageTemplateService.resolve(organizationId, page.template);
    const form = template && contactFormSection(template.definition);
    if (!form) throw new NotFoundError('This page has no contact form');

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, logoUrl: true, email: true },
    });
    if (!organization?.email) {
      const error = new ConflictError('This store is not accepting messages right now');
      error.code = 'CONTACT_UNAVAILABLE';
      throw error;
    }

    const inquiry = await prisma.contactInquiry.create({
      data: {
        organizationId,
        pageId: page.id,
        name: input.name,
        email: input.email,
        phone: form.settings?.showPhone ? input.phone ?? null : null,
        subject: form.settings?.showSubject ? input.subject ?? null : null,
        message: input.message,
      },
    });

    try {
      await emailService.sendContactInquiry({
        to: organization.email,
        inquiry,
        organization,
        pageTitle: page.title,
      });
      await prisma.contactInquiry.update({ where: { id: inquiry.id }, data: { emailedAt: new Date() } });
    } catch (error) {
      logger.error('Contact inquiry email failed', {
        event: 'contact_inquiry_email_failed',
        organizationId,
        inquiryId: inquiry.id,
        error: error.message,
      });
      await prisma.contactInquiry.update({
        where: { id: inquiry.id },
        data: { emailError: String(error.message || error).slice(0, 500) },
      });
    }
    return { id: inquiry.id };
  }
}

export default new ContactInquiryService();
