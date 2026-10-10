// Unit tests for the audit trail helpers (spec 048-A).

import { Prisma, AUDIT_EXCLUDED_MODELS, diffRows } from '@jump/db';
import { MODEL_FEATURES, entityKey } from '../../src/audit/features.js';
import { redactChanges, REDACTED } from '../../src/audit/redact.js';

describe('audit features map', () => {
  it('maps or excludes every Prisma model', () => {
    const unmapped = Prisma.dmmf.datamodel.models
      .map((model) => model.name)
      .filter((name) => !MODEL_FEATURES[name] && !AUDIT_EXCLUDED_MODELS.has(name));
    expect(unmapped).toEqual([]);
  });

  it('names actions in snake case', () => {
    expect(entityKey('PriceTier')).toBe('price_tier');
    expect(entityKey('Event')).toBe('event');
  });
});

describe('diffRows', () => {
  it('keeps changed scalars only and ignores updatedAt', () => {
    const before = { id: 'p1', title: 'A', updatedAt: new Date(1), visible: true };
    const after = { id: 'p1', title: 'B', updatedAt: new Date(2), visible: true };
    expect(diffRows('Page', before, after)).toEqual({ title: ['A', 'B'] });
  });

  it('compares dates by value', () => {
    const d = '2026-10-01T00:00:00.000Z';
    expect(diffRows('Event', { date: new Date(d) }, { date: new Date(d) })).toEqual({});
  });
});

describe('redactChanges', () => {
  it('never keeps secret values', () => {
    const out = redactChanges({
      storefrontPasswordHash: [null, 'abc'],
      tokenHash: ['x', 'y'],
      name: ['a', 'b'],
    });
    expect(out.storefrontPasswordHash).toEqual([null, REDACTED]);
    expect(out.tokenHash).toEqual([REDACTED, REDACTED]);
    expect(out.name).toEqual(['a', 'b']);
  });

  it('cuts long values', () => {
    const out = redactChanges({ content: ['', 'x'.repeat(2000)] });
    expect(out.content[1].length).toBeLessThan(600);
  });
});
