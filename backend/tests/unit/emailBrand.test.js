// Email brand colors: same WCAG rules as the storefront (frontend/src/lib/color.ts).
import { contrastRatio, emailBrand } from '../../src/utils/emailBrand.js';

describe('emailBrand', () => {
  it('falls back to platform blue without a valid brand color', () => {
    expect(emailBrand(null)).toEqual({ brand: '#2563eb', onBrand: '#ffffff', link: '#2563eb' });
    expect(emailBrand('not-a-color').brand).toBe('#2563eb');
  });

  it('keeps a dark brand as is and puts white text on it', () => {
    expect(emailBrand('#D6007D')).toEqual({ brand: '#d6007d', onBrand: '#ffffff', link: '#d6007d' });
  });

  it('uses dark button text on a light brand and darkens links until they pass AA on white', () => {
    const b = emailBrand('#c8ff00');
    expect(b.onBrand).toBe('#111827');
    expect(b.link).not.toBe('#c8ff00');
    expect(contrastRatio(b.link, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
