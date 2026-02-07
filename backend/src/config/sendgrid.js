// SendGrid email service configuration
// Email delivery for QR codes per FR-008

import sgMail from '@sendgrid/mail';

if (!process.env.SENDGRID_API_KEY) {
  console.warn('SENDGRID_API_KEY not set - email functionality will not work');
} else {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export default sgMail;
