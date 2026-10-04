// Spec 042: storefront contact-form messages. Emailed straight to the store
// email (Organization.email) with reply-to set to the visitor; nothing is
// stored. The visitor is answered only after the email left, so a failed send
// is an error they see and can retry, never a message lost in silence.

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
      select: { id: true, name: true, logoUrl: true, email: true },
    });
    if (!organization?.email) {
      const error = new ConflictError('This store is not accepting messages right now');
      error.code = 'CONTACT_UNAVAILABLE';
      throw error;
    }

    const inquiry = {
      name: input.name,
      email: input.email,
      phone: form.settings?.showPhone ? input.phone ?? null : null,
      subject: form.settings?.showSubject ? input.subject ?? null : null,
      message: input.message,
    };
    try {
      await emailService.sendContactInquiry({
        to: organization.email,
        inquiry,
        organization,
        pageTitle: page.title,
      });
    } catch (error) {
      logger.error('Contact form email failed', {
        event: 'contact_form_email_failed',
        organizationId,
        pageId: page.id,
        error: error.message,
      });
      const failed = new Error('Your message could not be sent. Try again in a moment.');
      failed.name = 'ContactSendFailed';
      failed.statusCode = 502;
      failed.code = 'CONTACT_SEND_FAILED';
      throw failed;
    }
  }
}

export default new ContactInquiryService();
