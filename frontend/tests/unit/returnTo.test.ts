import { describe, expect, it } from 'vitest';
import { safeAdminReturnTo } from '@/lib/returnTo';

describe('safeAdminReturnTo', () => {
  it('keeps a same-origin /admin path with its query and hash', () => {
    expect(safeAdminReturnTo('/admin/events/e1/setup?step=floor-map')).toBe('/admin/events/e1/setup?step=floor-map');
    expect(safeAdminReturnTo('/admin')).toBe('/admin');
    expect(safeAdminReturnTo('/admin/maps#x')).toBe('/admin/maps#x');
  });

  it.each([
    null,
    undefined,
    '',
    'https://evil.example/admin',
    'http://evil.example',
    '//evil.example/admin',
    '/\\evil.example/admin',
    '/\t/evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'admin/events',
    '/administrator',
    '/events/e1',
    '/admin/../events',
    '/admin/%2e%2e/events',
    `/admin/${'a'.repeat(2048)}`,
  ])('rejects %s', (value) => {
    expect(safeAdminReturnTo(value)).toBeNull();
  });
});
