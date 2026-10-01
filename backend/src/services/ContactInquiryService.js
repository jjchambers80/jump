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

class ContactInquiryService {
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
