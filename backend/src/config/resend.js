// Resend email service configuration
// Email delivery for order confirmations and notifications

import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  console.warn('⚠️  RESEND_API_KEY not set — email functionality will not work');
}

const resend = new Resend(process.env.RESEND_API_KEY);

export default resend;
