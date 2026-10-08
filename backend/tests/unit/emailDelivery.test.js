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

describe('EmailService From name', () => {
  const platform = process.env.RESEND_FROM_EMAIL;
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ data: { id: 'em_3' }, error: null });
    process.env.RESEND_FROM_EMAIL = 'Eventimus <noreply@eventimus.net>';
  });
  afterAll(() => {
    if (platform === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = platform;
  });

  it('store emails come from the organization name at the platform address', async () => {
    await emailService.sendBuyerLoginEmail({ contact: { email: 'b@example.com' }, loginUrl: 'https://x.test', organization: { name: 'Raleigh Retro Gamers' } });
    expect(send.mock.calls[0][0].from).toBe('"Raleigh Retro Gamers" <noreply@eventimus.net>');
  });

  it('strips quotes and line breaks from the display name', async () => {
    await emailService.sendApplicationMessage({ ...message, organization: { name: 'Bad "Org"\r\nBcc: x@y.z' } });
    expect(send.mock.calls[0][0].from).toBe('"Bad OrgBcc: x@y.z" <noreply@eventimus.net>');
  });

  it('falls back to the platform sender without an organization name', async () => {
    await emailService.sendBuyerLoginEmail({ contact: { email: 'b@example.com' }, loginUrl: 'https://x.test' });
    expect(send.mock.calls[0][0].from).toBe('Eventimus <noreply@eventimus.net>');
  });

  it('account and security emails stay on the platform sender', async () => {
    await emailService.sendSecurityNotice({ to: 'staff@example.com', title: 'Password changed', body: 'x' });
    expect(send.mock.calls[0][0].from).toBe('Eventimus <noreply@eventimus.net>');
  });
});

describe('EmailService brand color', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ data: { id: 'em_4' }, error: null });
  });

  it('store buttons and links use the organization brand color', async () => {
    await emailService.sendApplicationMessage({
      ...message,
      body: 'See https://x.test/a for details\n\nhttps://x.test/open',
      organization: { name: 'RRG', brandColor: '#d6007d' },
    });
    const html = send.mock.calls[0][0].html;
    expect(html).toContain('background-color: #d6007d; color: #ffffff;');
    expect(html).toContain('<a href="https://x.test/a" style="color: #d6007d;">');
    expect(html).not.toContain('#2563eb');
  });

  it('staff variant (digest, dispute alerts) keeps the platform sender and color, no logo', async () => {
    await emailService.sendApplicationMessage({
      ...message,
      body: 'https://x.test/admin',
      organization: { name: 'RRG', logoUrl: 'https://cdn.example.test/logo.png', brandColor: '#d6007d' },
      staff: true,
    });
    const sent = send.mock.calls[0][0];
    expect(sent.from).not.toContain('RRG');
    expect(sent.html).toContain('background-color: #2563eb;');
    expect(sent.html).not.toContain('#d6007d');
    expect(sent.html).not.toContain('logo.png');
  });

  it('staff security emails use the Eventimus shell and escape their input', async () => {
    await emailService.sendRecoveryLink({ to: 'a@b.co', primaryEmail: '<c@d.co>', recoverUrl: 'https://x.test/?a=1&b=2' });
    const msg = send.mock.calls[0][0];
    expect(msg.subject).toBe('Restore access to your Eventimus account');
    expect(msg.html).toContain('#c8ff00');
    expect(msg.html).toContain('&lt;c@d.co&gt;');
    expect(msg.html).toContain('href="https://x.test/?a=1&amp;b=2"');
    expect(msg.text).toContain('https://x.test/?a=1&b=2');
  });

  it('verification code email is Eventimus-branded and escapes the code', async () => {
    await emailService.sendReauthCode({ to: 'a@b.co', code: '123456' });
    const msg = send.mock.calls[0][0];
    expect(msg.subject).toBe('123456 is your Eventimus verification code');
    expect(msg.html).toContain('#c8ff00');
    expect(msg.html).toContain('>123456</span>');
    expect(msg.text).toContain('123456');
  });
});
