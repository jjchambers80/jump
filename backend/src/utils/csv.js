// CSV in and out (spec 055). One parser and one cell writer for every
// import and export; no CSV library is added.

/**
 * Parse RFC 4180 text into rows of cells: quoted fields, "" escapes, commas
 * and line breaks inside quotes, CRLF or LF, a leading BOM. Blank lines are
 * dropped. Cells are returned as text, never evaluated.
 */
export function parseCsv(text) {
  const input = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

/**
 * One CSV cell. A value starting with = + - @, a tab or a CR gets a leading
 * apostrophe so a spreadsheet never runs it as a formula (OWASP CSV injection).
 * A plain number such as -10.00 cannot be a formula and is left as it is.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str) && !/^[-+]?\d+(\.\d+)?$/.test(str)) str = `'${str}`;
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** One CSV line from a list of values. */
export const csvLine = (values) => values.map(csvCell).join(',');
