import { describe, expect, it } from 'vitest';
import { slugify, SLUG_MAX_LENGTH } from '@/lib/slug';

describe('slugify', () => {
  it('converts a readable name to a URL-safe slug', () => {
    expect(slugify('  Raleigh Rétro — Gamers!!!  ')).toBe('raleigh-retro-gamers');
    expect(slugify('2026 Game & Geek Expo')).toBe('2026-game-geek-expo');
    expect(slugify('Press & Media!')).toBe('press-media');
    expect(slugify('   Vendor   Space 2027 ')).toBe('vendor-space-2027');
  });

  it('handles NFKD accent decomposition', () => {
    expect(slugify('Café con Leche')).toBe('cafe-con-leche');
    expect(slugify('São Paulo')).toBe('sao-paulo');
    expect(slugify('München')).toBe('munchen');
  });

  it('handles empty and edge input', () => {
    expect(slugify('')).toBe('');
    expect(slugify('***')).toBe('');
    expect(slugify(null as unknown as string)).toBe('');
    expect(slugify(undefined as unknown as string)).toBe('');
  });

  it('collapses multiple hyphens from special chars', () => {
    expect(slugify('Hello...World---Test')).toBe('hello-world-test');
    expect(slugify('A & B | C / D')).toBe('a-b-c-d');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('---hello---')).toBe('hello');
    expect(slugify('!hello!')).toBe('hello');
  });

  it(`respects SLUG_MAX_LENGTH of ${SLUG_MAX_LENGTH}`, () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slugify(long)).toBe('a'.repeat(SLUG_MAX_LENGTH));
  });
});