import { describe, expect, it } from 'vitest';
import { API_URL, imageVariantUrl } from '@/lib/assets';

const base = API_URL.replace(/\/$/, '');

describe('imageVariantUrl', () => {
  it('swaps a served original for the requested variant', () => {
    expect(imageVariantUrl('/images/img1/abc123/original', 'thumb')).toBe(
      `${base}/images/img1/abc123/thumb`
    );
  });

  it('works on absolute backend URLs', () => {
    expect(imageVariantUrl('https://api.example.com/images/img1/abc/original', 'card')).toBe(
      'https://api.example.com/images/img1/abc/card'
    );
  });

  it('leaves other URLs alone', () => {
    expect(imageVariantUrl('https://cdn.example.com/original/abc.png', 'thumb')).toBe(
      'https://cdn.example.com/original/abc.png'
    );
    expect(imageVariantUrl('/uploads/logo.png', 'thumb')).toBe(`${base}/uploads/logo.png`);
  });

  it('returns null without a URL', () => {
    expect(imageVariantUrl(null, 'thumb')).toBeNull();
    expect(imageVariantUrl('', 'thumb')).toBeNull();
  });
});
