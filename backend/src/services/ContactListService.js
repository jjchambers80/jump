// Contacts › Lists (spec 055). AUTOMATIC lists are saved filters with no
// member rows; MANUAL lists hold exactly the contacts staff put in. Three
// built-in automatic lists live here in code, read-only, for every store.

import { prisma } from '@jump/db';
import { ConflictError, ForbiddenError, NotFoundError } from '../middleware/errorHandler.js';
import { filtersWhere, filterWarnings, normalizeFilters } from './contactListFilters.js';

export const BUILT_IN_LISTS = [
  { id: 'builtin:all', name: 'All contacts', filters: {} },
  { id: 'builtin:paying', name: 'Paying contacts', filters: { scope: 'customers' } },
  { id: 'builtin:subscribers', name: 'Email subscribers', filters: { source: 'subscribed' } },
];

const MAX_MEMBERS_PER_CALL = 500;
const MAX_MEMBERS_FROM_QUERY = 10_000;

/** The error handler copies `err.code` onto the response body. */
function coded(error, code) {
  error.code = code;
  return error;
}

const builtIn = (id) => BUILT_IN_LISTS.find((list) => list.id === id);

function builtInRow(list) {
  return {
    id: list.id,
    name: list.name,
    type: 'AUTOMATIC',
    builtIn: true,
    filters: list.filters,
    createdBy: null,
    createdAt: null,
    lastActivityAt: null,
  };
}

function listRow(list) {
  const lastMemberAt = list.members?.[0]?.addedAt ?? null;
  return {
    id: list.id,
    name: list.name,
    type: list.type,
    builtIn: false,
    filters: list.type === 'AUTOMATIC' ? list.filters ?? {} : null,
    createdBy: list.createdBy ? { id: list.createdBy.id, name: list.createdBy.name } : null,
    createdAt: list.createdAt,
    lastActivityAt: lastMemberAt && lastMemberAt > list.updatedAt ? lastMemberAt : list.updatedAt,
  };
}

const LIST_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  members: { select: { addedAt: true }, orderBy: { addedAt: 'desc' }, take: 1 },
};

class ContactListService {
  async _find(organizationId, listId) {
    const list = await prisma.contactList.findFirst({ where: { id: listId, organizationId }, include: LIST_INCLUDE });
    if (!list) throw new NotFoundError('List not found');
    return list;
  }

  async _assertNameFree(organizationId, name, exceptId) {
    const taken = await prisma.contactList.findFirst({
      where: { organizationId, name: { equals: name, mode: 'insensitive' }, ...(exceptId && { id: { not: exceptId } }) },
      select: { id: true },
    });
    if (taken || BUILT_IN_LISTS.some((list) => list.name.toLowerCase() === name.toLowerCase())) {
      throw coded(new ConflictError('A list with this name already exists'), 'LIST_NAME_TAKEN');
    }
  }

  /** Prisma where for the contacts on a list (built-in, automatic or manual). */
  async whereFor(organizationId, listId) {
    const fixed = builtIn(listId);
    if (fixed) return filtersWhere(organizationId, fixed.filters);
    const list = await prisma.contactList.findFirst({ where: { id: listId, organizationId } });
    if (!list) throw new NotFoundError('List not found');
    if (list.type === 'MANUAL') return { listMemberships: { some: { listId: list.id } } };
    return filtersWhere(organizationId, list.filters ?? {});
  }

  async _count(organizationId, listId) {
    return prisma.contact.count({ where: { organizationId, ...(await this.whereFor(organizationId, listId)) } });
  }

  /** Built-ins first, then the organization's lists, newest first. */
  async list(organizationId, { search, type } = {}) {
    const term = typeof search === 'string' ? search.trim().toLowerCase() : '';
    const wantType = type === 'AUTOMATIC' || type === 'MANUAL' ? type : null;
    const lists = await prisma.contactList.findMany({
      where: {
        organizationId,
        ...(wantType && { type: wantType }),
        ...(term && { name: { contains: term, mode: 'insensitive' } }),
      },
      include: LIST_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const fixed = wantType === 'MANUAL' ? [] : BUILT_IN_LISTS.filter((list) => !term || list.name.toLowerCase().includes(term));
    const rows = [...fixed.map(builtInRow), ...lists.map(listRow)];
    // ponytail: one count per list; cache per org for 60 s if the tab slows.
    const counts = await Promise.all(rows.map((row) => this._count(organizationId, row.id)));
    return rows.map((row, i) => ({ ...row, contactCount: counts[i] }));
  }

  async get(organizationId, listId) {
    const fixed = builtIn(listId);
    const row = fixed ? builtInRow(fixed) : listRow(await this._find(organizationId, listId));
    return {
      ...row,
      contactCount: await this._count(organizationId, listId),
      filterWarnings: row.filters ? await filterWarnings(organizationId, row.filters) : [],
    };
  }

  async create(organizationId, userId, { name, type, filters }) {
    const cleanName = name.trim();
    await this._assertNameFree(organizationId, cleanName);
    const list = await prisma.contactList.create({
      data: {
        organizationId,
        name: cleanName,
        type,
        filters: type === 'AUTOMATIC' ? normalizeFilters(filters) : undefined,
        createdById: userId ?? null,
      },
      include: LIST_INCLUDE,
    });
    return this.get(organizationId, list.id);
  }

  async update(organizationId, listId, { name, filters }) {
    if (builtIn(listId)) throw coded(new ForbiddenError('Built-in lists cannot be changed'), 'BUILT_IN_LIST');
    const list = await this._find(organizationId, listId);
    const data = {};
    if (name !== undefined) {
      data.name = name.trim();
      await this._assertNameFree(organizationId, data.name, list.id);
    }
    if (filters !== undefined) {
      if (list.type !== 'AUTOMATIC') {
        throw coded(new ConflictError('Only automatic lists have filters'), 'LIST_NOT_AUTOMATIC');
      }
      data.filters = normalizeFilters(filters);
    }
    await prisma.contactList.update({ where: { id: list.id }, data });
    return this.get(organizationId, list.id);
  }

  /** Deletes the list and its memberships, never a contact. */
  async remove(organizationId, listId) {
    if (builtIn(listId)) throw coded(new ForbiddenError('Built-in lists cannot be deleted'), 'BUILT_IN_LIST');
    const list = await this._find(organizationId, listId);
    await prisma.contactList.delete({ where: { id: list.id } });
  }

  /** "Copy of …" (then "(2)", "(3)"…); a manual list copies its members. */
  async duplicate(organizationId, userId, listId) {
    const fixed = builtIn(listId);
    const source = fixed ? { name: fixed.name, type: 'AUTOMATIC', filters: fixed.filters } : await this._find(organizationId, listId);
    const base = `Copy of ${source.name}`.slice(0, 80);
    let name = base;
    for (let n = 2; ; n += 1) {
      const taken = await prisma.contactList.findFirst({
        where: { organizationId, name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!taken) break;
      name = `${base} (${n})`;
    }
    const copy = await prisma.$transaction(async (tx) => {
      const created = await tx.contactList.create({
        data: {
          organizationId,
          name,
          type: source.type,
          filters: source.type === 'AUTOMATIC' ? source.filters ?? {} : undefined,
          createdById: userId ?? null,
        },
      });
      if (source.type === 'MANUAL') {
        const members = await tx.contactListMember.findMany({ where: { listId: source.id }, select: { contactId: true } });
        if (members.length) {
          await tx.contactListMember.createMany({
            data: members.map((m) => ({ listId: created.id, contactId: m.contactId, addedById: userId ?? null, source: 'MANUAL' })),
          });
        }
      }
      return created;
    });
    return this.get(organizationId, copy.id);
  }

  /** Live count and first five matches for the automatic-list builder. */
  async preview(organizationId, filters) {
    const where = { organizationId, ...(await filtersWhere(organizationId, normalizeFilters(filters))) };
    const [count, sample] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where,
        select: { id: true, firstName: true, lastName: true, email: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 5,
      }),
    ]);
    return { count, sample };
  }

  async _manual(organizationId, listId) {
    if (builtIn(listId)) throw coded(new ConflictError('Only manual lists have members'), 'LIST_NOT_MANUAL');
    const list = await this._find(organizationId, listId);
    if (list.type !== 'MANUAL') throw coded(new ConflictError('Only manual lists have members'), 'LIST_NOT_MANUAL');
    return list;
  }

  async _ownedContactIds(organizationId, contactIds) {
    const ids = [...new Set(contactIds)];
    if (ids.length > MAX_MEMBERS_PER_CALL) {
      throw coded(new ConflictError(`At most ${MAX_MEMBERS_PER_CALL} contacts at a time`), 'TOO_MANY_CONTACTS');
    }
    const found = await prisma.contact.count({ where: { organizationId, id: { in: ids } } });
    // Another organization's contact id is "not found", never a silent add.
    if (found !== ids.length) throw new NotFoundError('Contact not found');
    return ids;
  }

  async addMembers(organizationId, userId, listId, contactIds, source = 'PICKED') {
    const list = await this._manual(organizationId, listId);
    const ids = await this._ownedContactIds(organizationId, contactIds);
    const { count } = await prisma.contactListMember.createMany({
      data: ids.map((contactId) => ({ listId: list.id, contactId, addedById: userId ?? null, source })),
      skipDuplicates: true,
    });
    return { added: count, alreadyOn: ids.length - count };
  }

  /**
   * Add every contact matching a Contacts query (`where` from
   * CustomerService.whereFor), up to MAX_MEMBERS_FROM_QUERY.
   */
  async addMembersWhere(organizationId, userId, listId, where) {
    const list = await this._manual(organizationId, listId);
    const scoped = { ...where, organizationId };
    const total = await prisma.contact.count({ where: scoped });
    if (total > MAX_MEMBERS_FROM_QUERY) {
      throw coded(
        new ConflictError(`At most ${MAX_MEMBERS_FROM_QUERY.toLocaleString('en-US')} contacts at a time; narrow the filters`),
        'TOO_MANY_CONTACTS'
      );
    }
    const ids = (await prisma.contact.findMany({ where: scoped, select: { id: true } })).map((c) => c.id);
    let added = 0;
    for (let i = 0; i < ids.length; i += 1000) {
      const { count } = await prisma.contactListMember.createMany({
        data: ids.slice(i, i + 1000).map((contactId) => ({ listId: list.id, contactId, addedById: userId ?? null, source: 'PICKED' })),
        skipDuplicates: true,
      });
      added += count;
    }
    return { added, alreadyOn: ids.length - added };
  }

  async removeMembers(organizationId, listId, contactIds) {
    const list = await this._manual(organizationId, listId);
    const ids = await this._ownedContactIds(organizationId, contactIds);
    const { count } = await prisma.contactListMember.deleteMany({ where: { listId: list.id, contactId: { in: ids } } });
    return { removed: count };
  }

  /** Manual lists a contact is on (contact detail card). */
  async listsForContact(organizationId, contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId }, select: { id: true } });
    if (!contact) throw new NotFoundError('Contact not found');
    const memberships = await prisma.contactListMember.findMany({
      where: { contactId, list: { organizationId } },
      include: { list: { select: { id: true, name: true } } },
      orderBy: { addedAt: 'desc' },
    });
    return memberships.map((m) => ({ id: m.list.id, name: m.list.name, addedAt: m.addedAt, source: m.source }));
  }
}

export default new ContactListService();
