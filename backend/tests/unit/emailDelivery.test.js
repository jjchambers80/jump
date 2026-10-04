// Unit tests for EmailService delivery: Resend's SDK resolves `{ error }`
// instead of throwing when it refuses a message (sandbox sender, unverified
// domain), so EmailService must turn that into a failure, not a "sent" log.

import { jest } from '@jest/globals';

const send = jest.fn();
jest.unstable_mockModule('../../src/config/resend.js', () => ({ default: { emails: { send } } }));

const { default: emailService } = await import('../../src/services/EmailService.js');

const message = { to: 'vendor@example.com', subject: 'We received your application', body: 'Hi', organization: { name: 'Org', email: 'hello@org.example' } };

describe('EmailService delivery', () => {
  beforeEach(() => send.mockReset());

  it('rejects when Resend refuses the message', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'You can only send testing emails to your own email address' } });
    await expect(emailService.sendApplicationMessage(message)).rejects.toThrow(/Resend refused the email \(validation_error\)/);
  });

  it('resolves when Resend accepts the message, with replies going to the organization', async () => {
    send.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    await expect(emailService.sendApplicationMessage(message)).resolves.toBeUndefined();
    expect(send.mock.calls[0][0]).toMatchObject({ to: ['vendor@example.com'], reply_to: 'hello@org.example' });
  });

  it('omits reply_to when the organization has no email', async () => {
    send.mockResolvedValue({ data: { id: 'em_2' }, error: null });
    await emailService.sendApplicationMessage({ ...message, organization: { name: 'Org' } });
    expect(send.mock.calls[0][0]).not.toHaveProperty('reply_to');
  });
});
