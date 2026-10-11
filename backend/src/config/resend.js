// Resend email service configuration
// Email delivery for order confirmations and notifications

import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  console.warn('⚠️  RESEND_API_KEY not set — email functionality will not work');
}

const resend = new Resend(process.env.RESEND_API_KEY);
// Tests run with this fake key (tests/setup.js): never call Resend for real. Suites that assert emails mock this module.
if (process.env.NODE_ENV === 'test' && process.env.RESEND_API_KEY === 're_test_fake_key') resend.emails.send = async () => ({ data: { id: 'test-email' }, error: null });

export default resend;
