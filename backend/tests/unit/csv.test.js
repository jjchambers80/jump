// Spec 055: the shared CSV parser / cell writer and import row handling (pure).

import { describe, expect, it } from '@jest/globals';
import { csvCell, csvLine, parseCsv } from '../../src/utils/csv.js';
import { cleanMapping, guessMapping, rowToContact } from '../../src/services/ContactListImportService.js';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas and line breaks in quotes, CRLF, BOM and blank lines', () => {
    const text = '﻿name,note\r\n"Lovelace, Ada","said ""hi""\nthen left"\r\n\r\nGrace,plain\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Lovelace, Ada', 'said "hi"\nthen left'],
      ['Grace', 'plain'],
    ]);
  });

  it('keeps a trailing row without a newline and empty cells', () => {
    expect(parseCsv('a,,c\n1,2')).toEqual([['a', '', 'c'], ['1', '2']]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('csvCell', () => {
  it('quotes when needed and neutralizes formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1 919')).toBe("'+1 919");
    expect(csvCell(null)).toBe('');
    expect(csvLine(['a', 1, '-2', '-10.00', '-2+3'])).toBe("a,1,-2,-10.00,'-2+3");
  });
});

describe('import rows', () => {
  it('guesses columns from common header names', () => {
    expect(guessMapping(['Email Address', 'Full name', 'Mobile', 'Labels'])).toEqual({
      email: 0, firstName: null, lastName: null, name: 1, phone: 2, tags: 3,
    });
    expect(guessMapping(['first_name', 'Name', 'email']).name).toBeNull();
  });

  it('requires an email column inside the file', () => {
    expect(cleanMapping('{"email":1,"tags":null}', 2)).toEqual({ email: 1, firstName: null, lastName: null, name: null, phone: null, tags: null });
    expect(() => cleanMapping({ email: 2 }, 2)).toThrow();
    expect(() => cleanMapping({ firstName: 0 }, 2)).toThrow();
    expect(() => cleanMapping('not json', 2)).toThrow();
  });

  it('normalizes email, splits names and tags', () => {
    const mapping = { email: 0, firstName: null, lastName: null, name: 1, phone: null, tags: 2 };
    expect(rowToContact([' Ada@Example.COM ', 'Ada King Lovelace', 'a; b|a,'], mapping)).toEqual({
      email: 'ada@example.com', firstName: 'Ada King', lastName: 'Lovelace', phone: null, tags: ['a', 'b'],
    });
    expect(rowToContact(['nope', 'X', ''], mapping)).toEqual({ skip: 'invalid email', email: 'nope' });
  });
});
