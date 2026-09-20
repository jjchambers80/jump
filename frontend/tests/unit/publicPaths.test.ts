import { describe, expect, it } from 'vitest';
import {
  blogPostPath,
  eventPath,
  organizationAccountPath,
  organizationPath,
  pagePath,
  venuePath,
} from '@/lib/publicPaths';

describe('canonical public paths', () => {
  it('uses slugs for every public resource type', () => {
    expect(organizationPath('raleigh-retro-gamers')).toBe('/organizations/raleigh-retro-gamers');
    expect(organizationAccountPath('raleigh-retro-gamers')).toBe(
      '/organizations/raleigh-retro-gamers/account'
    );
    expect(eventPath('2026-game-and-geek-expo')).toBe('/events/2026-game-and-geek-expo');
    expect(venuePath('raleigh-convention-center')).toBe('/venues/raleigh-convention-center');
    expect(pagePath('raleigh-retro-gamers', 'about-us')).toBe(
      '/organizations/raleigh-retro-gamers/pages/about-us'
    );
    expect(blogPostPath('raleigh-retro-gamers', 'news', 'expo-preview')).toBe(
      '/organizations/raleigh-retro-gamers/blogs/news/expo-preview'
    );
  });

  it('encodes individual path segments', () => {
    expect(eventPath('expo/preview')).toBe('/events/expo%2Fpreview');
    expect(pagePath('org name', 'about us')).toBe('/organizations/org%20name/pages/about%20us');
  });
});
