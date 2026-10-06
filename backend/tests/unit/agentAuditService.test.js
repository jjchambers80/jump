import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';

const create = jest.fn();
jest.unstable_mockModule('@jump/db', () => ({ prisma: { agentAuditLog: { create } } }));

const { argsDigest, redactAuditSummary, default: service } = await import('../../src/services/AgentAuditService.js');

describe('AgentAuditService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('digests canonical arguments regardless of object key order', () => {
    expect(argsDigest({ b: 2, a: { d: 4, c: 3 } })).toBe(argsDigest({ a: { c: 3, d: 4 }, b: 2 }));
    expect(argsDigest({ a: 1 })).toBe(createHash('sha256').update('{"a":1}').digest('hex'));
  });

  it('redacts personal and credential-like values from summaries', () => {
    const summary = redactAuditSummary('Sent jj@example.com Bearer secret-value oauth_abcdefghijklmnop 4242 4242 4242 4242');
    expect(summary).toBe('Sent [redacted-email] Bearer [redacted] [redacted-token] [redacted-number]');
  });

  it('stores only a digest and redacted summary, never raw arguments', async () => {
    create.mockImplementation(async ({ data }) => data);
    const args = { title: 'Draft', secret: 'never-store-this' };
    await service.write({
      authorization: { organizationId: 'org_1', userId: 'user_1', grantId: 'grant_1', clientName: 'Claude' },
      tool: 'create_event_draft',
      args,
      summary: 'Created draft for jj@example.com',
      outcome: 'ok',
      targetType: 'Event',
      targetId: 'event_1',
    });
    const data = create.mock.calls[0][0].data;
    expect(data.argsDigest).toBe(argsDigest(args));
    expect(data.summary).toBe('Created draft for [redacted-email]');
    expect(data).not.toHaveProperty('args');
    expect(JSON.stringify(data)).not.toContain('never-store-this');
  });

  it('requires authorization attribution', async () => {
    await expect(service.write({ tool: 'list_events', args: {}, summary: 'Listed', outcome: 'ok' }))
      .rejects.toThrow('A successful agent authorization is required');
  });
});
