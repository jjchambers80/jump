// Unit tests for EmailService delivery: Resend's SDK resolves `{ error }`
// instead of throwing when it refuses a message (sandbox sender, unverified
// domain), so EmailService must turn that into a failure, not a "sent" log.

import { jest } from '@jest/globals';

const send = jest.fn();
jest.unstable_mockModule('../../src/config/resend.js', () => ({ default: { emails: { send } } }));

const { default: emailService, senderFor } = await import('../../src/services/EmailService.js');

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

describe('senderFor', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('keeps the single RESEND_FROM_EMAIL sender while EMAIL_FROM_DOMAIN is unset', () => {
    delete process.env.EMAIL_FROM_DOMAIN;
    process.env.RESEND_FROM_EMAIL = 'Eventimus <noreply@eventimus.net>';
    expect(senderFor({ id: 'org_1', name: 'Org' })).toBe('Eventimus <noreply@eventimus.net>');
  });

  it('sends store mail as the store, platform mail as Eventimus', () => {
    process.env.EMAIL_FROM_DOMAIN = 'eventimus.net';
    expect(senderFor({ id: 'org_1', name: 'Raleigh Retro Gamers' })).toBe('"Raleigh Retro Gamers" <store+org_1@eventimus.net>');
    expect(senderFor()).toBe('Eventimus <noreply@eventimus.net>');
    expect(senderFor({ name: 'No id' })).toBe('Eventimus <noreply@eventimus.net>');
  });

  it('strips characters that would break the From header', () => {
    process.env.EMAIL_FROM_DOMAIN = 'eventimus.net';
    expect(senderFor({ id: 'org_1', name: 'Bad "Name" <x@y>\r\nBcc: z' })).toBe('"Bad Name x@yBcc: z" <store+org_1@eventimus.net>');
    expect(senderFor({ id: 'org_1', name: '<>' })).toBe('"Eventimus" <store+org_1@eventimus.net>');
  });

  it('is the From of a store email', async () => {
    process.env.EMAIL_FROM_DOMAIN = 'eventimus.net';
    send.mockResolvedValue({ data: { id: 'em_3' }, error: null });
    await emailService.sendApplicationMessage({ ...message, organization: { id: 'org_9', name: 'Org' } });
    expect(send.mock.calls.at(-1)[0].from).toBe('"Org" <store+org_9@eventimus.net>');
  });
});
