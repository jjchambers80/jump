// Content › Menus (spec 027): storefront navigation trees. main-menu and
// footer-menu exist for every organization (created lazily, never deleted).
// Items are saved as a whole tree (PUT) so the storefront never sees a
// half-edited menu; targets are resolved at read time — a deleted page shows
// as a broken link in the editor and is skipped on the storefront.

import { prisma } from '@jump/db';
import { uniqueHandle } from '../utils/uniqueHandle.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { postStatus } from './BlogPostService.js';

export const MENU_MAX_DEPTH = 3;
export const MENU_MAX_ITEMS = 200;
export const MENU_LABEL_MAX = 60;
export const LINK_TYPES = [
  'HOME',
  'EVENTS',
  'EVENT',
  'VENUE',
  'PAGE',
  'BLOG',
  'BLOG_POST',
  'ACCOUNT',
  'EXTERNAL',
];
const TARGET_TYPES = new Set(['EVENT', 'VENUE', 'PAGE', 'BLOG', 'BLOG_POST']);
const URL_RE = /^(https?:\/\/|mailto:|tel:)/i;

export const DEFAULT_MENUS = [
  {
    title: 'Main menu',
    handle: 'main-menu',
    items: [
      { label: 'Home', linkType: 'HOME' },
      { label: 'Events', linkType: 'EVENTS' },
    ],
  },
  { title: 'Footer menu', handle: 'footer-menu', items: [{ label: 'Home', linkType: 'HOME' }] },
];

/** Flat rows (position-ordered) → nested tree. */
export function buildTree(rows) {
  const byParent = new Map();
  for (const row of rows) {
    const key = row.parentId || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(row);
  }
  const walk = (parentId) =>
    (byParent.get(parentId) || [])
      .sort((a, b) => a.position - b.position)
      .map((row) => ({ ...row, children: walk(row.id) }));
  return walk(null);
}

/** Path on the platform host; the frontend shortens it on tenant hosts. */
export function hrefFor(organizationSlug, item, target) {
  switch (item.linkType) {
    case 'HOME':
      return `/organizations/${organizationSlug}`;
    case 'EVENTS':
      return `/organizations/${organizationSlug}#events`;
    case 'EVENT':
      return target ? `/events/${target.slug}` : null;
    case 'VENUE':
      return target ? `/venues/${target.slug}` : null;
    case 'PAGE':
      return target ? `/organizations/${organizationSlug}/pages/${target.slug}` : null;
    case 'BLOG':
      return target ? `/organizations/${organizationSlug}/blogs/${target.handle}` : null;
    case 'BLOG_POST':
      return target
        ? `/organizations/${organizationSlug}/blogs/${target.blog.handle}/${target.handle}`
        : null;
    case 'ACCOUNT':
      return `/organizations/${organizationSlug}/account`;
    case 'EXTERNAL':
      return item.url;
    default:
      return null;
  }
}

class MenuService {
  async ensureDefaults(organizationId) {
    const existing = await prisma.menu.findMany({
      where: { organizationId, isDefault: true },
      select: { handle: true },
    });
    const have = new Set(existing.map((m) => m.handle));
    for (const menu of DEFAULT_MENUS) {
      if (have.has(menu.handle)) continue;
      try {
        await prisma.menu.create({
          data: {
            organizationId,
            title: menu.title,
            handle: menu.handle,
            isDefault: true,
            items: { create: menu.items.map((item, position) => ({ ...item, position })) },
          },
        });
      } catch (error) {
        if (error.code !== 'P2002') throw error; // created concurrently
      }
    }
  }

  async list(organizationId) {
    await this.ensureDefaults(organizationId);
    const menus = await prisma.menu.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      include: {
        items: { where: { parentId: null }, orderBy: { position: 'asc' }, select: { label: true } },
      },
    });
    return menus.map((menu) => ({
      id: menu.id,
      title: menu.title,
      handle: menu.handle,
      isDefault: menu.isDefault,
      itemLabels: menu.items.map((item) => item.label),
      updatedAt: menu.updatedAt,
    }));
  }

  async get(organizationId, id) {
    const menu = await prisma.menu.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!menu) throw new NotFoundError('Menu not found');
    const [targets, organizationSlug] = await Promise.all([
      this._resolveTargets(organizationId, menu.items),
      this._organizationSlug(organizationId),
    ]);
    const decorate = (node) => ({
      id: node.id,
      label: node.label,
      linkType: node.linkType,
      targetId: node.targetId,
      url: node.url,
      newTab: node.newTab,
      target: this._describeTarget(organizationSlug, node, targets),
      children: node.children.map(decorate),
    });
    return {
      id: menu.id,
      title: menu.title,
      handle: menu.handle,
      isDefault: menu.isDefault,
      items: buildTree(menu.items).map(decorate),
      updatedAt: menu.updatedAt,
    };
  }

  async create(organizationId, { title }) {
    const clean = title.trim();
    const menu = await prisma.menu.create({
      data: {
        organizationId,
        title: clean,
        handle: await uniqueHandle(prisma.menu, { organizationId }, clean),
      },
    });
    return this.get(organizationId, menu.id);
  }

  /** Replace the title and the whole tree in one transaction. */
  async replace(organizationId, id, { title, items }) {
    const existing = await prisma.menu.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Menu not found');
    const flat = this._flatten(items);
    await this._validateTargets(organizationId, flat);

    await prisma.$transaction(async (tx) => {
      if (title !== undefined)
        await tx.menu.update({ where: { id }, data: { title: title.trim() } });
      else await tx.menu.update({ where: { id }, data: { updatedAt: new Date() } });
      await tx.menuItem.deleteMany({ where: { menuId: id } });
      // Parents must exist before children: insert level by level.
      const idMap = new Map();
      for (const row of flat) {
        const created = await tx.menuItem.create({
          data: {
            menuId: id,
            parentId: row.parentKey === null ? null : idMap.get(row.parentKey),
            position: row.position,
            label: row.label,
            linkType: row.linkType,
            targetId: row.targetId,
            url: row.url,
            newTab: row.newTab,
          },
          select: { id: true },
        });
        idMap.set(row.key, created.id);
      }
    });
    return this.get(organizationId, id);
  }

  async duplicate(organizationId, id) {
    const source = await prisma.menu.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!source) throw new NotFoundError('Menu not found');
    const title = `${source.title} copy`;
    const copy = await prisma.menu.create({
      data: {
        organizationId,
        title,
        handle: await uniqueHandle(prisma.menu, { organizationId }, `${source.handle}-copy`),
      },
    });
    const tree = buildTree(source.items);
    const flat = this._flatten(tree.map((node) => this._strip(node)));
    await prisma.$transaction(async (tx) => {
      const idMap = new Map();
      for (const row of flat) {
        const created = await tx.menuItem.create({
          data: {
            menuId: copy.id,
            parentId: row.parentKey === null ? null : idMap.get(row.parentKey),
            position: row.position,
            label: row.label,
            linkType: row.linkType,
            targetId: row.targetId,
            url: row.url,
            newTab: row.newTab,
          },
          select: { id: true },
        });
        idMap.set(row.key, created.id);
      }
    });
    return this.get(organizationId, copy.id);
  }

  async remove(organizationId, id) {
    const existing = await prisma.menu.findFirst({
      where: { id, organizationId },
      select: { id: true, isDefault: true },
    });
    if (!existing) throw new NotFoundError('Menu not found');
    if (existing.isDefault)
      throw new ValidationError('The main and footer menus cannot be deleted');
    await prisma.menu.delete({ where: { id } });
  }

  /**
   * Storefront: both default menus with resolved hrefs; unrenderable items
   * dropped. Not cached server-side (a page going hidden must disappear at
   * once); the route sets Cache-Control: max-age=60 for browsers/CDNs.
   */
  async publicMenus(organizationId) {
    await this.ensureDefaults(organizationId);
    const menus = await prisma.menu.findMany({
      where: { organizationId, handle: { in: ['main-menu', 'footer-menu'] } },
      include: { items: true },
    });
    const allItems = menus.flatMap((menu) => menu.items);
    const [targets, organizationSlug] = await Promise.all([
      this._resolveTargets(organizationId, allItems),
      this._organizationSlug(organizationId),
    ]);
    const render = (node) => {
      const described = this._describeTarget(organizationSlug, node, targets);
      if (described.status !== 'ok') return null;
      return {
        id: node.id,
        label: node.label,
        href: described.href,
        newTab: node.newTab,
        children: node.children.map(render).filter(Boolean),
      };
    };
    const out = { main: [], footer: [] };
    for (const menu of menus) {
      const items = buildTree(menu.items).map(render).filter(Boolean);
      if (menu.handle === 'main-menu') out.main = items;
      if (menu.handle === 'footer-menu') out.footer = items;
    }
    return out;
  }

  /** Link picker search: a few candidates per type. */
  async linkTargets(organizationId, q = '') {
    const term = String(q || '').trim();
    const contains = term ? { contains: term, mode: 'insensitive' } : undefined;
    const now = new Date();
    const [events, venues, pages, blogs, blogPosts] = await Promise.all([
      prisma.event.findMany({
        where: {
          venue: { organizationId },
          status: 'PUBLISHED',
          ...(contains ? { name: contains } : {}),
        },
        orderBy: [{ date: 'asc' }],
        take: 8,
        select: { id: true, name: true, date: true },
      }),
      prisma.venue.findMany({
        where: { organizationId, ...(contains ? { name: contains } : {}) },
        orderBy: { name: 'asc' },
        take: 8,
        select: { id: true, name: true },
      }),
      prisma.page.findMany({
        where: { organizationId, ...(contains ? { title: contains } : {}) },
        orderBy: { title: 'asc' },
        take: 8,
        select: { id: true, title: true, isVisible: true },
      }),
      prisma.blog.findMany({
        where: { organizationId, ...(contains ? { title: contains } : {}) },
        orderBy: { title: 'asc' },
        take: 8,
        select: { id: true, title: true },
      }),
      prisma.blogPost.findMany({
        where: { organizationId, ...(contains ? { title: contains } : {}) },
        orderBy: [{ updatedAt: 'desc' }],
        take: 8,
        select: {
          id: true,
          title: true,
          isVisible: true,
          publishedAt: true,
          blog: { select: { title: true } },
        },
      }),
    ]);
    return {
      events: events.map((e) => ({
        id: e.id,
        title: e.name,
        hint:
          e.date < now
            ? 'Past'
            : new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      })),
      venues: venues.map((v) => ({ id: v.id, title: v.name })),
      pages: pages.map((p) => ({
        id: p.id,
        title: p.title,
        hint: p.isVisible ? undefined : 'Hidden',
      })),
      blogs: blogs.map((b) => ({ id: b.id, title: b.title })),
      blogPosts: blogPosts.map((p) => ({
        id: p.id,
        title: p.title,
        hint:
          postStatus(p, now) === 'visible'
            ? p.blog.title
            : `${p.blog.title} · ${postStatus(p, now)}`,
      })),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _strip(node) {
    return {
      label: node.label,
      linkType: node.linkType,
      targetId: node.targetId,
      url: node.url,
      newTab: node.newTab,
      children: (node.children || []).map((child) => this._strip(child)),
    };
  }

  /** Validate and flatten the incoming tree (parents before children). */
  _flatten(items) {
    const out = [];
    let count = 0;
    const walk = (nodes, parentKey, depth) => {
      if (!Array.isArray(nodes)) throw new ValidationError('items must be a list');
      if (nodes.length && depth > MENU_MAX_DEPTH)
        throw new ValidationError(`Menus can be ${MENU_MAX_DEPTH} levels deep`);
      nodes.forEach((node, position) => {
        count += 1;
        if (count > MENU_MAX_ITEMS)
          throw new ValidationError(`A menu can hold ${MENU_MAX_ITEMS} items`);
        const key = `${parentKey ?? 'root'}/${position}`;
        const label = typeof node?.label === 'string' ? node.label.trim() : '';
        if (!label || label.length > MENU_LABEL_MAX)
          throw new ValidationError(`Each item needs a label of 1–${MENU_LABEL_MAX} characters`);
        const linkType = node.linkType;
        if (!LINK_TYPES.includes(linkType)) throw new ValidationError('Unknown link type');
        let targetId = null;
        let url = null;
        if (TARGET_TYPES.has(linkType)) {
          if (typeof node.targetId !== 'string' || !node.targetId)
            throw new ValidationError(`${label}: choose what to link to`);
          targetId = node.targetId;
        } else if (linkType === 'EXTERNAL') {
          url = typeof node.url === 'string' ? node.url.trim() : '';
          if (!URL_RE.test(url) || url.length > 2048)
            throw new ValidationError(`${label}: enter a full web, email or phone link`);
        }
        out.push({
          key,
          parentKey,
          position,
          label,
          linkType,
          targetId,
          url,
          newTab: !!node.newTab,
        });
        walk(node.children || [], key, depth + 1);
      });
    };
    walk(items, null, 1);
    return out;
  }

  async _validateTargets(organizationId, flat) {
    const targets = await this._resolveTargets(organizationId, flat);
    for (const row of flat) {
      if (!TARGET_TYPES.has(row.linkType)) continue;
      if (!targets.get(`${row.linkType}:${row.targetId}`)) {
        throw new ValidationError(
          `${row.label}: that ${row.linkType.toLowerCase().replace('_', ' ')} does not belong to this organization`
        );
      }
    }
  }

  /** Batched lookups by type → Map("TYPE:id" → record). */
  async _resolveTargets(organizationId, items) {
    const ids = (type) => [
      ...new Set(items.filter((i) => i.linkType === type && i.targetId).map((i) => i.targetId)),
    ];
    const [events, venues, pages, blogs, blogPosts] = await Promise.all([
      ids('EVENT').length
        ? prisma.event.findMany({
            where: { id: { in: ids('EVENT') }, venue: { organizationId } },
            select: { id: true, slug: true, name: true, status: true },
          })
        : [],
      ids('VENUE').length
        ? prisma.venue.findMany({
            where: { id: { in: ids('VENUE') }, organizationId },
            select: { id: true, slug: true, name: true },
          })
        : [],
      ids('PAGE').length
        ? prisma.page.findMany({
            where: { id: { in: ids('PAGE') }, organizationId },
            select: { id: true, title: true, slug: true, isVisible: true },
          })
        : [],
      ids('BLOG').length
        ? prisma.blog.findMany({
            where: { id: { in: ids('BLOG') }, organizationId },
            select: { id: true, title: true, handle: true },
          })
        : [],
      ids('BLOG_POST').length
        ? prisma.blogPost.findMany({
            where: { id: { in: ids('BLOG_POST') }, organizationId },
            select: {
              id: true,
              title: true,
              handle: true,
              isVisible: true,
              publishedAt: true,
              blog: { select: { handle: true } },
            },
          })
        : [],
    ]);
    const map = new Map();
    for (const e of events) map.set(`EVENT:${e.id}`, e);
    for (const v of venues) map.set(`VENUE:${v.id}`, v);
    for (const p of pages) map.set(`PAGE:${p.id}`, p);
    for (const b of blogs) map.set(`BLOG:${b.id}`, b);
    for (const p of blogPosts) map.set(`BLOG_POST:${p.id}`, p);
    return map;
  }

  /** { title, status: ok | missing | hidden, href } for one item. */
  _describeTarget(organizationSlug, item, targets) {
    if (!TARGET_TYPES.has(item.linkType)) {
      return { title: null, status: 'ok', href: hrefFor(organizationSlug, item, null) };
    }
    const target = targets.get(`${item.linkType}:${item.targetId}`);
    if (!target) return { title: null, status: 'missing', href: null };
    let hidden = false;
    if (item.linkType === 'EVENT') hidden = target.status !== 'PUBLISHED';
    if (item.linkType === 'PAGE') hidden = !target.isVisible;
    if (item.linkType === 'BLOG_POST') hidden = postStatus(target) !== 'visible';
    return {
      title: target.title || target.name,
      status: hidden ? 'hidden' : 'ok',
      href: hrefFor(organizationSlug, item, target),
    };
  }

  async _organizationSlug(organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    });
    if (!organization) throw new NotFoundError('Organization not found');
    return organization.slug;
  }
}

export default new MenuService();
