import { describe, it, expect, jest } from '@jest/globals';
import { normalizeEmail } from '../../src/utils/normalizeEmail.js';
import { upsertContactFillBlanks } from '../../src/services/contactRecord.js';

describe('normalizeEmail (spec 037 C3)', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM \t')).toBe('jane.doe@example.com');
  });

  it('returns an empty string for a missing value', () => {
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail(null)).toBe('');
  });
});

describe('upsertContactFillBlanks (spec 037 C4 / D12)', () => {
  const txWith = (existing) => ({
    contact: {
      upsert: jest.fn(async ({ create }) => existing ?? { id: 'c1', ...create }),
      update: jest.fn(async ({ data }) => ({ ...existing, ...data })),
    },
  });

  it('creates on the normalized key with the given name', async () => {
    const tx = txWith(null);
    const contact = await upsertContactFillBlanks(tx, { organizationId: 'o1', email: ' A@B.co ', firstName: 'Ann', lastName: 'Lee' });
    expect(tx.contact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_email: { organizationId: 'o1', email: 'a@b.co' } },
      update: {},
    }));
    expect(contact).toMatchObject({ email: 'a@b.co', firstName: 'Ann', lastName: 'Lee' });
    expect(tx.contact.update).not.toHaveBeenCalled();
  });

  it('never overwrites an existing name', async () => {
    const tx = txWith({ id: 'c1', email: 'a@b.co', firstName: 'Ann', lastName: 'Lee' });
    const contact = await upsertContactFillBlanks(tx, { organizationId: 'o1', email: 'a@b.co', firstName: 'Bob', lastName: 'Other' });
    expect(tx.contact.update).not.toHaveBeenCalled();
    expect(contact).toMatchObject({ firstName: 'Ann', lastName: 'Lee' });
  });

  it('fills only the blank half of a name', async () => {
    const tx = txWith({ id: 'c1', email: 'a@b.co', firstName: '  ', lastName: 'Lee' });
    const contact = await upsertContactFillBlanks(tx, { organizationId: 'o1', email: 'a@b.co', firstName: 'Bob', lastName: 'Other' });
    expect(tx.contact.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { firstName: 'Bob' } });
    expect(contact).toMatchObject({ firstName: 'Bob', lastName: 'Lee' });
  });
});
