// Spec 052: starter policy text.
import { POLICY_TYPES, starterPolicy } from '../../src/config/policyTemplates.js';

const org = { name: 'Retro <Expo>', email: null, selfServeRefundsEnabled: true, selfServeRefundCutoffHours: 48, selfServeRefundFeeType: 'FIXED', selfServeRefundFeeValue: '2.5' };

describe('starterPolicy', () => {
  it('builds titled HTML for every policy type with the store name escaped', () => {
    for (const { type, title } of POLICY_TYPES) {
      const policy = starterPolicy(type, org);
      expect(policy.title).toBe(title);
      expect(policy.content).toMatch(/^<(p|h2)>/);
      expect(policy.content).not.toContain('<Expo>');
    }
  });

  it('describes the self-serve refund rules the store configured', () => {
    const { content } = starterPolicy('REFUND', org);
    expect(content).toContain('up to 48 hours before the event starts');
    expect(content).toContain('$2.50');
    expect(starterPolicy('REFUND', { ...org, selfServeRefundsEnabled: false }).content).toContain('reviewed by our team');
  });
});
