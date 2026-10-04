import { describe, expect, it } from 'vitest';
import { suggestEmail } from '@/lib/emailTypo';

describe('suggestEmail', () => {
  it('corrects common domain slips', () => {
    expect(suggestEmail('ada@gmial.com')).toBe('ada@gmail.com');
    expect(suggestEmail('ada@gmail.co')).toBe('ada@gmail.com');
    expect(suggestEmail('ada@hotmial.com')).toBe('ada@hotmail.com');
    expect(suggestEmail('Ada@Yahoo.con')).toBe('ada@yahoo.com');
  });

  it('corrects a mistyped top-level domain on other domains', () => {
    expect(suggestEmail('ada@example.cmo')).toBe('ada@example.com');
    expect(suggestEmail('ada@company.nte')).toBe('ada@company.net');
  });

  it('leaves valid or unrecognised addresses alone', () => {
    expect(suggestEmail('ada@gmail.com')).toBeNull();
    expect(suggestEmail('ada@proton.me')).toBeNull();
    expect(suggestEmail('ada@eventimus.net')).toBeNull();
    expect(suggestEmail('ada@acme.io')).toBeNull();
    expect(suggestEmail('ada@mail.com')).toBeNull();
    expect(suggestEmail('ada@')).toBeNull();
    expect(suggestEmail('not-an-email')).toBeNull();
  });
});
