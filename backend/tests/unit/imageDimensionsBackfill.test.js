// Header logo layout shift: logo URLs carry the original's pixel size.

import { dimensionQuery } from '../../src/services/ImageService.js';
import { planLogoUrl } from '../../src/scripts/backfill-image-dimensions.js';

const file = { hash: 'a'.repeat(64), mimeType: 'image/png', width: 600, height: 240 };

describe('dimensionQuery', () => {
  it('describes a sized file', () => {
    expect(dimensionQuery(file)).toBe('?w=600&h=240');
  });

  it('is empty when the size is unknown', () => {
    expect(dimensionQuery({ ...file, width: null, height: null })).toBe('');
    expect(dimensionQuery(undefined)).toBe('');
  });
});

describe('planLogoUrl', () => {
  const image = { id: 'img1', file };

  it('adds the size to the stored logo URL of the organization logo image', () => {
    expect(planLogoUrl({ logoUrl: `/images/img1/${file.hash}/original`, logoImage: image })).toBe(
      `/images/img1/${file.hash}/original?w=600&h=240`
    );
  });

  it('leaves an up-to-date URL alone (idempotent)', () => {
    expect(planLogoUrl({ logoUrl: `/images/img1/${file.hash}/original?w=600&h=240`, logoImage: image })).toBeNull();
  });

  it('never rewrites a URL that is not this image (external or legacy)', () => {
    expect(planLogoUrl({ logoUrl: 'https://cdn.example.com/logo.png', logoImage: image })).toBeNull();
    expect(planLogoUrl({ logoUrl: '/uploads/logo.png', logoImage: image })).toBeNull();
  });

  it('skips files whose size is still unknown', () => {
    const unsized = { id: 'img1', file: { ...file, width: null, height: null } };
    expect(planLogoUrl({ logoUrl: `/images/img1/${file.hash}/original`, logoImage: unsized })).toBeNull();
  });
});
