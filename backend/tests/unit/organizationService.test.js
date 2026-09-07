import { serializeBusinessDetails } from '../../src/services/OrganizationService.js';

describe('serializeBusinessDetails', () => {
  it('masks an EIN and never returns the raw value', () => {
    const result = serializeBusinessDetails({
      id: 'org-1',
      name: 'Example LLC',
      ein: '123456789',
    });

    expect(result).toMatchObject({
      id: 'org-1',
      name: 'Example LLC',
      hasEin: true,
      einMasked: '••-•••6789',
    });
    expect(result).not.toHaveProperty('ein');
  });

  it('reports when no EIN is stored', () => {
    const result = serializeBusinessDetails({ id: 'org-1', name: 'Example LLC', ein: null });

    expect(result.hasEin).toBe(false);
    expect(result.einMasked).toBeNull();
    expect(result).not.toHaveProperty('ein');
  });
});
