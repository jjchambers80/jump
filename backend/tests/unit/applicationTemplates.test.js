// Unit tests for application template rendering (spec 011)

import { jest } from '@jest/globals';

jest.unstable_mockModule('@jump/db', () => ({ prisma: {} }));
jest.unstable_mockModule('../../src/config/resend.js', () => ({ default: { emails: { send: jest.fn() } } }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const { renderTemplate } = await import('../../src/services/ApplicationTemplateService.js');
const { DEFAULT_TEMPLATES, TEMPLATE_ACTIONS } = await import('../../src/config/applications.js');

const context = {
  applicant: { firstName: 'Pat' },
  profile: { businessName: 'Retro Weekly' },
  event: { name: 'Gaming Geek Expo' },
  organization: { name: 'Raleigh Retro Gamers' },
  form: { name: 'Vendor Space' },
  tier: { name: '10x10' },
  amount: { applicantPays: '$303.00' },
  payment: { dueDate: 'October 3, 2026' },
  links: { status: 'https://x/status', payNow: 'https://x/pay', account: 'https://x/account' },
};

describe('renderTemplate', () => {
  test('replaces fields and keeps sections whose value is truthy', () => {
    expect(renderTemplate('Hi {{applicant.firstName}}, {{form.name}}{{#tier}} ({{tier.name}}){{/tier}}', context)).toBe('Hi Pat, Vendor Space (10x10)');
    expect(renderTemplate('{{form.name}}{{#tier}} ({{tier.name}}){{/tier}}', { ...context, tier: null })).toBe('Vendor Space');
  });

  test('unknown paths and objects render empty; no raw braces survive', () => {
    expect(renderTemplate('{{nope.x}}|{{links}}|{{ applicant.firstName }}', context)).toBe('||Pat');
  });

  test('every default template renders without leftover merge syntax', () => {
    for (const action of TEMPLATE_ACTIONS) {
      const { subject, body } = DEFAULT_TEMPLATES[action];
      for (const text of [renderTemplate(subject, context), renderTemplate(body, context), renderTemplate(body, { ...context, tier: null })]) {
        expect(text).not.toMatch(/\{\{|\}\}/);
      }
    }
  });
});
