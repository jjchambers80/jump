import { describe, expect, it } from 'vitest';
import { API_URL, imageDimensions, imageVariantUrl, withImageDimensions } from '@/lib/assets';

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

describe('image dimensions on URLs', () => {
  it('reads ?w=&h= from a logo URL', () => {
    expect(imageDimensions('/images/i/abc/original?w=600&h=240')).toEqual({ width: 600, height: 240 });
    expect(imageDimensions('https://api.example.com/images/i/abc/original?w=90&h=36#x')).toEqual({ width: 90, height: 36 });
  });

  it('is null when absent or malformed', () => {
    expect(imageDimensions('/images/i/abc/original')).toBeNull();
    expect(imageDimensions('/images/i/abc/original?w=0&h=10')).toBeNull();
    expect(imageDimensions('/images/i/abc/original?w=abc&h=10')).toBeNull();
    expect(imageDimensions(null)).toBeNull();
  });

  it('adds a size once, keeping other query parts and hashes', () => {
    expect(withImageDimensions('/files/f/h/logo.png', 300, 100)).toBe('/files/f/h/logo.png?w=300&h=100');
    expect(withImageDimensions('/x.png?v=2#top', 3, 1)).toBe('/x.png?v=2&w=3&h=1#top');
    expect(withImageDimensions('/x.png?w=1&h=1', 3, 1)).toBe('/x.png?w=1&h=1');
    expect(withImageDimensions('/x.png', null, 1)).toBe('/x.png');
  });

  it('drops the original size from a resized variant URL', () => {
    expect(imageVariantUrl('/images/i/abc/original?w=600&h=240', 'card')).toBe(`${base}/images/i/abc/card`);
  });
});
