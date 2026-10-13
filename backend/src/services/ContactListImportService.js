// CSV import into a manual contact list (spec 055 §4.6). The server parses
// and validates every row itself; the client only says which column is which.
//
// Rules: an email already in Contacts joins the list unchanged (tags from the
// file are added, nothing else is touched); a new email becomes a contact who
// is never subscribed to email (a file is no proof of consent) with a timeline
// note by the importing staff member; a person who asked to be deleted is
// skipped. Rows go in batches of 500, each in its own transaction, so one bad
// batch fails only its own rows.

import { prisma } from '@jump/db';
import { ValidationError } from '../middleware/errorHandler.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';
import { parseCsv } from '../utils/csv.js';
import { suppressionHash } from './ContactErasureService.js';
import { upsertContactFillBlanks } from './contactRecord.js';
import contactListService from './ContactListService.js';

export const IMPORT_MAX_ROWS = 10_000;
export const IMPORT_FIELDS = ['email', 'firstName', 'lastName', 'name', 'phone', 'tags'];
const BATCH = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HEADER_NAMES = {
  email: ['email', 'emailaddress', 'e-mail', 'mail'],
  firstName: ['firstname', 'first', 'givenname', 'forename'],
  lastName: ['lastname', 'last', 'surname', 'familyname'],
  name: ['name', 'fullname', 'contactname'],
  phone: ['phone', 'phonenumber', 'mobile', 'cell', 'telephone'],
  tags: ['tags', 'tag', 'labels'],
};

const keyOf = (header) => String(header ?? '').toLowerCase().replace(/[\s_\-.]/g, '');

const invalid = (field, message) => new ValidationError('Validation failed', [{ field, message }]);

/** Header row and data rows of an uploaded file; empty, header-only or oversized files are a 400. */
function readRows(buffer) {
  const rows = parseCsv(buffer.toString('utf8'));
  if (rows.length < 2) throw invalid('file', 'The file needs a header row and at least one contact');
  const data = rows.slice(1);
  if (data.length > IMPORT_MAX_ROWS) {
    throw invalid('file', `The file has ${data.length.toLocaleString('en-US')} rows; import at most ${IMPORT_MAX_ROWS.toLocaleString('en-US')} at a time`);
  }
  return { headers: rows[0].map((h) => String(h).trim()), data };
}

/** Column index per field, from the header names. */
export function guessMapping(headers) {
  const keys = headers.map(keyOf);
  const mapping = {};
  for (const field of IMPORT_FIELDS) {
    const index = keys.findIndex((key) => HEADER_NAMES[field].includes(key));
    mapping[field] = index >= 0 ? index : null;
  }
  // A "Name" column only matters when there is no first / last name column.
  if (mapping.firstName !== null || mapping.lastName !== null) mapping.name = null;
  return mapping;
}

/** Validate a client mapping against the file's columns; email is required. */
export function cleanMapping(raw, columnCount) {
  let mapping = raw;
  if (typeof raw === 'string') {
    try {
      mapping = JSON.parse(raw);
    } catch {
      throw invalid('mapping', 'mapping must be JSON');
    }
  }
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw invalid('mapping', 'mapping must be an object');
  const clean = {};
  for (const field of IMPORT_FIELDS) {
    const value = mapping[field];
    if (value === undefined || value === null || value === '') {
      clean[field] = null;
      continue;
    }
    if (!Number.isInteger(value) || value < 0 || value >= columnCount) {
      throw invalid(`mapping.${field}`, `${field} must be a column of the file`);
    }
    clean[field] = value;
  }
  const unknown = Object.keys(mapping).filter((key) => !IMPORT_FIELDS.includes(key));
  if (unknown.length) throw invalid(`mapping.${unknown[0]}`, `${unknown[0]} is not an import field`);
  if (clean.email === null) throw invalid('mapping.email', 'Choose the column that holds email addresses');
  return clean;
}

/** One file row as a contact, or the reason it is skipped. */
export function rowToContact(row, mapping) {
  const at = (field) => (mapping[field] === null ? '' : String(row[mapping[field]] ?? '').trim());
  const email = normalizeEmail(at('email'));
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return { skip: 'invalid email', email: at('email') };
  let firstName = at('firstName');
  let lastName = at('lastName');
  if (!firstName && !lastName && at('name')) {
    const full = at('name').replace(/\s+/g, ' ');
    const split = full.lastIndexOf(' ');
    firstName = split > 0 ? full.slice(0, split) : full;
    lastName = split > 0 ? full.slice(split + 1) : '';
  }
  const tags = [
    ...new Set(
      at('tags')
        .split(/[,;|]/)
        .map((tag) => tag.trim())
        .filter((tag) => tag && tag.length <= 50)
    ),
  ].slice(0, 20);
  return {
    email,
    firstName: firstName.slice(0, 100),
    lastName: lastName.slice(0, 100),
    phone: at('phone').slice(0, 40) || null,
    tags,
  };
}

const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

class ContactListImportService {
  /** Columns, a guessed mapping and the first five rows, for the mapping step. */
  async preview(organizationId, listId, buffer) {
    await contactListService.assertManual(organizationId, listId);
    const { headers, data } = readRows(buffer);
    return { headers, mapping: guessMapping(headers), sample: data.slice(0, 5), rowCount: data.length };
  }

  async import(organizationId, userId, listId, buffer, rawMapping) {
    const list = await contactListService.assertManual(organizationId, listId);
    const { headers, data } = readRows(buffer);
    const mapping = cleanMapping(rawMapping, headers.length);

    const skipped = [];
    const rows = [];
    const seen = new Set();
    data.forEach((cells, i) => {
      const line = i + 2; // the header is line 1
      const parsed = rowToContact(cells, mapping);
      if (parsed.skip) skipped.push({ row: line, email: parsed.email, reason: parsed.skip });
      else if (seen.has(parsed.email)) skipped.push({ row: line, email: parsed.email, reason: 'duplicate in file' });
      else {
        seen.add(parsed.email);
        rows.push({ ...parsed, line });
      }
    });

    // What the organization already has, looked up once (Gotcha 8: organizationId_email).
    const existing = new Map();
    const suppressed = new Set();
    for (const part of chunks(rows, 1000)) {
      const contacts = await prisma.contact.findMany({
        where: { organizationId, email: { in: part.map((r) => r.email) } },
        select: { id: true, email: true, tags: true, erasureScheduledAt: true, anonymizedAt: true },
      });
      contacts.forEach((contact) => existing.set(contact.email, contact));
      const hashes = new Map(part.map((r) => [suppressionHash(r.email), r.email]));
      const hits = await prisma.erasureSuppression.findMany({
        where: { organizationId, emailHash: { in: [...hashes.keys()] } },
        select: { emailHash: true },
      });
      hits.forEach((hit) => suppressed.add(hashes.get(hit.emailHash)));
    }

    let added = 0;
    let created = 0;
    let alreadyOn = 0;
    for (const batch of chunks(rows, BATCH)) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          let batchCreated = 0;
          const batchSkipped = [];
          const contactIds = [];
          for (const row of batch) {
            const found = existing.get(row.email);
            if (suppressed.has(row.email) || found?.erasureScheduledAt || found?.anonymizedAt) {
              batchSkipped.push({ row: row.line, email: row.email, reason: 'contact asked to be deleted' });
              continue;
            }
            if (found) {
              const tags = [...new Set([...(found.tags ?? []), ...row.tags])];
              if (tags.length !== (found.tags ?? []).length) {
                await tx.contact.update({ where: { id: found.id }, data: { tags } });
              }
              contactIds.push(found.id);
              continue;
            }
            const contact = await upsertContactFillBlanks(tx, {
              organizationId,
              email: row.email,
              firstName: row.firstName,
              lastName: row.lastName,
            });
            // Never subscribed: the upsert leaves emailSubscribed at its default (false).
            await tx.contact.update({
              where: { id: contact.id },
              data: {
                ...(row.phone && !contact.phone && { phone: row.phone }),
                ...(row.tags.length && { tags: [...new Set([...(contact.tags ?? []), ...row.tags])] }),
              },
            });
            await tx.contactComment.create({
              data: {
                contactId: contact.id,
                organizationId,
                authorUserId: userId ?? null,
                body: `Created by import into “${list.name}”`,
              },
            });
            batchCreated += 1;
            contactIds.push(contact.id);
          }
          const { count } = contactIds.length
            ? await tx.contactListMember.createMany({
                data: contactIds.map((contactId) => ({ listId: list.id, contactId, addedById: userId ?? null, source: 'IMPORT' })),
                skipDuplicates: true,
              })
            : { count: 0 };
          return { batchCreated, batchSkipped, members: contactIds.length, count };
        });
        created += result.batchCreated;
        added += result.count;
        alreadyOn += result.members - result.count;
        skipped.push(...result.batchSkipped);
      } catch {
        batch.forEach((row) => skipped.push({ row: row.line, email: row.email, reason: 'could not be saved; try again' }));
      }
    }

    skipped.sort((a, b) => a.row - b.row);
    return { rowCount: data.length, added, created, alreadyOn, skipped };
  }
}

export default new ContactListImportService();
