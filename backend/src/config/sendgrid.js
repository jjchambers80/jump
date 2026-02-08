// Resend email service configuration
// Email delivery for QR codes per FR-008

import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  console.warn('RESEND_API_KEY not set - email functionality will not work');
}

const resend = new Resend(process.env.RESEND_API_KEY);

export default resend;
