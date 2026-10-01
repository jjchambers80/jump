// Online store themes (spec 038, card 038A). Contracts:
// specs/038-theme-editor/contracts.md (C1 render, C5 atomic save and
// full-state revisions, C6 file references, C10 rollout).
//
// A theme stores only what differs from its preset: settings and content
// overrides, and the documents the organizer has saved. Everything else is
// the preset (code), so organizations without a Theme row render the preset
// with no database write.

import { prisma } from '@jump/db';
import {
  DOCUMENTS,
  PAGE_KEYS,
  REVISIONS_KEPT,
  SCHEMA_VERSION,
  THEME_NAME_MAX,
  documentDef,
  fileIdsInThemeJson,
  linkKey,
  linksInThemeJson,
  getPreset,
  migrateDocument,
  presetDocument,
  resolveContent,
  resolveSettings,
  schemesUsed,
  validateContent,
  validateDocument,
  validateSettings,
  DEFAULT_PRESET_KEY,
} from '@jump/theme';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { sanitizeContentHtml } from '../utils/sanitizeHtml.js';
import logger from '../utils/logger.js';
import storeFileService from './StoreFileService.js';
import menuService from './MenuService.js';
import { publicEventSummaries } from './OrganizationService.js';

import { themesEnabledFor, themesMasterSwitch } from './storefrontLogo.js';

export { themesEnabledFor, themesMasterSwitch };

function themeConflict(current) {
  const error = new ConflictError('This theme changed since you opened it', current);
  error.code = 'THEME_CONFLICT';
  return error;
}

function themeInvalid(errors) {
  const error = new ValidationError('The theme has errors', { errors });
  error.code = 'THEME_INVALID';
  return error;
}

const ORGANIZATION_IDENTITY = {
  id: true,
  slug: true,
  name: true,
  logoUrl: true,
  coverUrl: true,
  brandColor: true,
  themeMode: true,
  buyerSignInLinks: true,
};

const BLOCKS_ONLY = new Set(['AnnouncementBar', 'HeroCarousel', 'Faq']);

class ThemeService {
  /** 404 unless themes are on for this organization (master switch + rollout flag). */
  async assertEnabled(organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { themesEnabled: true },
    });
    if (!themesEnabledFor(organization)) {
      const error = new NotFoundError('Themes are not enabled for this organization');
      error.code = 'THEMES_NOT_ENABLED';
      throw error;
    }
  }

  async status(organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { themesEnabled: true },
    });
    return {
      masterSwitch: themesMasterSwitch(),
      organizationEnabled: Boolean(organization?.themesEnabled),
      enabled: themesEnabledFor(organization),
    };
  }

  /** SYSTEM_ADMIN rollout switch (Organization.themesEnabled). */
  async setRollout(organizationId, enabled) {
    await prisma.organization.update({ where: { id: organizationId }, data: { themesEnabled: Boolean(enabled) } });
    logger.info('Theme rollout changed', { event: 'theme_rollout', organizationId, enabled: Boolean(enabled) });
    return this.status(organizationId);
  }

  /**
   * The organization's MAIN theme, created from the default preset on first
   * use. Idempotent under concurrency: the organization row is locked and the
   * partial unique index "Theme_one_main_per_org" backs it up.
   */
  async ensureMain(organizationId) {
    const existing = await prisma.theme.findFirst({ where: { organizationId, role: 'MAIN' } });
    if (existing) return existing;
    const { preset } = getPreset(DEFAULT_PRESET_KEY);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
      const again = await tx.theme.findFirst({ where: { organizationId, role: 'MAIN' } });
      if (again) return again;
      return tx.theme.create({
        data: {
          organizationId,
          name: preset.name.slice(0, THEME_NAME_MAX),
          presetKey: preset.key,
          presetVersion: preset.version,
          role: 'MAIN',
          publishedAt: new Date(),
        },
      });
    });
  }

  async _theme(organizationId, themeId, db = prisma) {
    const theme = await db.theme.findFirst({ where: { id: themeId, organizationId } });
    if (!theme) throw new NotFoundError('Theme not found');
    return theme;
  }

  async _userNames(ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
    return new Map(users.map((u) => [u.id, u.name || u.email]));
  }

  _summary(theme, names) {
    return {
      id: theme.id,
      name: theme.name,
      role: theme.role,
      presetKey: theme.presetKey,
      presetVersion: theme.presetVersion,
      version: theme.version,
      lastSavedAt: theme.lastSavedAt,
      lastSavedBy: theme.lastSavedById
        ? { id: theme.lastSavedById, name: names.get(theme.lastSavedById) ?? null }
        : null,
      publishedAt: theme.publishedAt,
      createdAt: theme.createdAt,
    };
  }

  async list(organizationId) {
    await this.ensureMain(organizationId);
    const themes = await prisma.theme.findMany({
      where: { organizationId },
      orderBy: [{ role: 'asc' }, { lastSavedAt: 'desc' }],
    });
    const names = await this._userNames(themes.map((t) => t.lastSavedById));
    return themes.map((t) => this._summary(t, names));
  }

  async get(organizationId, themeId) {
    const theme = await this._theme(organizationId, themeId);
    const rows = await prisma.themeDocument.findMany({
      where: { themeId },
      select: { key: true, kind: true, version: true, updatedAt: true },
    });
    const stored = new Map(rows.map((r) => [r.key, r]));
    const names = await this._userNames([theme.lastSavedById]);
    const preset = getPreset(theme.presetKey);
    return {
      ...this._summary(theme, names),
      settings: theme.settings,
      resolvedSettings: resolveSettings(theme.settings, preset?.settings),
      content: theme.content,
      documents: Object.entries(DOCUMENTS).map(([key, def]) => {
        const row = stored.get(key);
        return row
          ? { key, kind: row.kind, version: row.version, updatedAt: row.updatedAt, isDefault: false }
          : { key, kind: def.kind, version: 0, updatedAt: null, isDefault: true };
      }),
    };
  }

  _readDocument(theme, key, row) {
    if (row) {
      const { data, dropped } = migrateDocument(row.data, row.schemaVersion);
      if (dropped.length) logger.warn('Theme document had unknown types', { themeId: theme.id, key, dropped });
      return { data, version: row.version, isDefault: false };
    }
    return { data: presetDocument(theme.presetKey, key) ?? { root: { props: {} }, content: [] }, version: 0, isDefault: true };
  }

  async getDocument(organizationId, themeId, key) {
    if (!documentDef(key)) throw new NotFoundError('Theme document not found');
    const theme = await this._theme(organizationId, themeId);
    const row = await prisma.themeDocument.findUnique({ where: { themeId_key: { themeId, key } } });
    return { key, kind: DOCUMENTS[key].kind, ...this._readDocument(theme, key, row) };
  }

  async getContent(organizationId, themeId) {
    const theme = await this._theme(organizationId, themeId);
    return { overrides: theme.content, resolved: resolveContent(theme.content) };
  }

  /** Effective color schemes: the stored override, else the preset's. */
  _schemeIds(settings, presetKey) {
    const schemes = settings?.colors?.schemes ?? getPreset(presetKey)?.settings?.colors?.schemes ?? [];
    return new Set(schemes.map((s) => s.id));
  }

  /**
   * The only write for editor content (contracts C5): settings, content and
   * any documents in ONE transaction, all or nothing.
   *
   * body: { themeVersion, settings?, content?, documents?: { key: { data | null, version } } }
   */
  async save(organizationId, themeId, body, userId, { changedKeysPrefix = [] } = {}) {
    return prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw`
        SELECT id, "organizationId", version, role, "presetKey", settings, content
        FROM "Theme" WHERE id = ${themeId} FOR UPDATE`;
      if (!locked || locked.organizationId !== organizationId) throw new NotFoundError('Theme not found');

      const sentDocs = body.documents ?? {};
      const sentKeys = Object.keys(sentDocs);
      const rows = await tx.themeDocument.findMany({ where: { themeId } });
      const byKey = new Map(rows.map((r) => [r.key, r]));

      // 1. Versions: any mismatch is a 409 and nothing is written.
      const staleDocs = sentKeys.filter((key) => (byKey.get(key)?.version ?? 0) !== sentDocs[key].version);
      if (body.themeVersion !== locked.version || staleDocs.length) {
        throw themeConflict({
          theme: locked.version,
          documents: Object.fromEntries(sentKeys.map((key) => [key, byKey.get(key)?.version ?? 0])),
        });
      }

      // 2. Validation (and rich-text sanitising): any error is a 400 and nothing is written.
      const errors = {};
      let settings;
      if (body.settings !== undefined) {
        const checked = validateSettings(body.settings);
        Object.assign(errors, checked.errors);
        settings = checked.value;
      }
      let content;
      if (body.content !== undefined) {
        const checked = validateContent(body.content);
        Object.assign(errors, checked.errors);
        content = checked.value;
      }
      const schemeIds = this._schemeIds(settings ?? locked.settings, locked.presetKey);
      const documents = {};
      for (const key of sentKeys) {
        const def = documentDef(key);
        if (!def) {
          errors[`documents.${key}`] = 'is not a theme document';
          continue;
        }
        const { data } = sentDocs[key];
        if (data === null) {
          documents[key] = null;
          continue;
        }
        const checked = validateDocument(key, data, { schemeIds, sanitizeHtml: sanitizeContentHtml });
        for (const [path, message] of Object.entries(checked.errors)) errors[`documents.${key}.${path}`] = message;
        documents[key] = checked.value;
      }
      // A scheme still used by a document that is not being replaced cannot go away.
      if (settings !== undefined) {
        for (const row of rows) {
          if (hasKey(documents, row.key)) continue;
          for (const scheme of schemesUsed(row.data)) {
            if (!schemeIds.has(scheme)) errors[`documents.${row.key}`] = `uses ${scheme}, which the new settings remove`;
          }
        }
      }
      if (Object.keys(errors).length) throw themeInvalid(errors);

      // 3. Write.
      const now = new Date();
      const themeData = { lastSavedAt: now, lastSavedById: userId ?? null };
      if (settings !== undefined) themeData.settings = settings;
      if (content !== undefined) themeData.content = content;
      if (settings !== undefined || content !== undefined) themeData.version = { increment: 1 };
      const theme = await tx.theme.update({ where: { id: themeId }, data: themeData });

      const versions = {};
      for (const [key, data] of Object.entries(documents)) {
        const row = byKey.get(key);
        if (data === null) {
          if (row) await tx.themeDocument.delete({ where: { id: row.id } });
          byKey.delete(key);
          versions[key] = 0;
          continue;
        }
        const written = row
          ? await tx.themeDocument.update({
              where: { id: row.id },
              data: { data, version: { increment: 1 }, schemaVersion: SCHEMA_VERSION, updatedById: userId ?? null },
            })
          : await tx.themeDocument.create({
              data: { themeId, kind: DOCUMENTS[key].kind, key, data, schemaVersion: SCHEMA_VERSION, updatedById: userId ?? null },
            });
        byKey.set(key, written);
        versions[key] = written.version;
      }

      // File references: exactly the fields this save wrote, on this transaction (contracts C6).
      const fields = {};
      if (settings !== undefined) fields.settings = fileIdsInThemeJson(settings);
      if (content !== undefined) fields.content = [];
      for (const [key, data] of Object.entries(documents)) fields[key] = data ? fileIdsInThemeJson(data) : [];
      await storeFileService.syncReferences('THEME', themeId, fields, organizationId, {
        tx,
        onlyFields: Object.keys(fields),
      });

      // 4. One full-state revision per save on the live theme; keep the last 50.
      const changedKeys = [
        ...changedKeysPrefix,
        ...(settings !== undefined ? ['settings'] : []),
        ...(content !== undefined ? ['content'] : []),
        ...Object.keys(documents),
      ];
      if (locked.role === 'MAIN') {
        const snapshot = {
          settings: theme.settings,
          content: theme.content,
          documents: Object.fromEntries([...byKey.entries()].map(([key, row]) => [key, row.data])),
        };
        await tx.themeRevision.create({ data: { themeId, snapshot, changedKeys, savedById: userId ?? null } });
        const stale = await tx.themeRevision.findMany({
          where: { themeId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: REVISIONS_KEPT,
          select: { id: true },
        });
        if (stale.length) await tx.themeRevision.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
      }

      return { theme: { id: theme.id, version: theme.version, lastSavedAt: theme.lastSavedAt }, documents: versions, changedKeys };
    });
  }

  async revisions(organizationId, themeId) {
    await this._theme(organizationId, themeId);
    const rows = await prisma.themeRevision.findMany({
      where: { themeId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, changedKeys: true, savedById: true, createdAt: true },
    });
    const names = await this._userNames(rows.map((r) => r.savedById));
    return rows.map((r) => ({
      id: r.id,
      changedKeys: r.changedKeys,
      savedBy: r.savedById ? { id: r.savedById, name: names.get(r.savedById) ?? null } : null,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Put the whole theme back to a revision (D6): settings, content, every
   * snapshot document, and a delete for every stored document the snapshot
   * does not have. It is one /save, so it writes its own revision.
   */
  async restore(organizationId, themeId, revisionId, themeVersion, userId) {
    await this._theme(organizationId, themeId);
    const revision = await prisma.themeRevision.findFirst({ where: { id: revisionId, themeId } });
    if (!revision) throw new NotFoundError('Revision not found');
    const rows = await prisma.themeDocument.findMany({ where: { themeId }, select: { key: true, version: true } });
    const current = new Map(rows.map((r) => [r.key, r.version]));
    const snapshotDocs = revision.snapshot?.documents ?? {};
    const documents = {};
    for (const [key, data] of Object.entries(snapshotDocs)) documents[key] = { data, version: current.get(key) ?? 0 };
    for (const [key, version] of current) if (!(key in snapshotDocs)) documents[key] = { data: null, version };
    return this.save(
      organizationId,
      themeId,
      { themeVersion, settings: revision.snapshot?.settings ?? {}, content: revision.snapshot?.content ?? {}, documents },
      userId,
      { changedKeysPrefix: [`restore:${revision.id}`] },
    );
  }

  // ── Rendering ───────────────────────────────────────────────────────

  /** Hidden items removed; announcements only inside their window. */
  _visible(data, now) {
    const inWindow = (props) =>
      (!props.startsAt || Date.parse(props.startsAt) <= now) && (!props.endsAt || Date.parse(props.endsAt) > now);
    return {
      root: data.root,
      content: data.content
        .filter((section) => !section.props?.hidden)
        .map((section) =>
          Array.isArray(section.props?.blocks)
            ? {
                ...section,
                props: {
                  ...section.props,
                  blocks: section.props.blocks.filter(
                    (block) => !block.props?.hidden && (block.type !== 'Announcement' || inWindow(block.props)),
                  ),
                },
              }
            : section,
        )
        // A section that is only its blocks (announcements, slides, questions)
        // does not render without any.
        .filter((section) => !BLOCKS_ONLY.has(section.type) || section.props.blocks?.length),
    };
  }

  /** Data sections reference by id, resolved and filtered to the organization (D8). */
  async _resolve(organizationId, values, { events: withEvents = true } = {}) {
    const fileIds = fileIdsInThemeJson(values);
    const [events, menus, links, files] = await Promise.all([
      withEvents ? publicEventSummaries(organizationId) : [],
      menuService.publicMenus(organizationId),
      menuService.resolveLinks(organizationId, linksInThemeJson(values), linkKey),
      fileIds.length
        ? prisma.storeFile.findMany({ where: { id: { in: fileIds }, organizationId }, include: { file: true, image: true } })
        : [],
    ]);
    return {
      events,
      menus,
      links,
      files: Object.fromEntries(
        files.map((row) => [
          row.id,
          { url: storeFileService.url(row), width: row.width ?? null, height: row.height ?? null, alt: row.altText ?? null },
        ]),
      ),
    };
  }

  /**
   * Everything the storefront needs to render one page of the MAIN theme
   * (contracts C1). `/` shows `home` once it has been saved, else the
   * Events page (D5). With no Theme row the preset renders from code.
   */
  async renderPublic(organizationId, page = 'home', { now = Date.now() } = {}) {
    // `frame`: header and footer only, for pages whose body the theme does not
    // own yet (Content pages, blog; 038G turns them into templates).
    if (page !== 'frame' && !PAGE_KEYS.includes(page)) throw new NotFoundError('Page not found');
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: ORGANIZATION_IDENTITY });
    if (!organization) throw new NotFoundError('Organization not found');
    const theme =
      (await prisma.theme.findFirst({ where: { organizationId, role: 'MAIN' } })) ?? {
        id: null,
        name: getPreset(DEFAULT_PRESET_KEY).preset.name,
        presetKey: DEFAULT_PRESET_KEY,
        settings: {},
        content: {},
      };
    const rows = theme.id ? await prisma.themeDocument.findMany({ where: { themeId: theme.id } }) : [];
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const templateKey = page === 'home' && !byKey.has('home') ? 'events' : page;
    const read = (key) => this._visible(this._readDocument(theme, key, byKey.get(key)).data, now);
    const documents = {
      header: read('header'),
      template: page === 'frame' ? null : read(templateKey),
      footer: read('footer'),
    };
    const settings = resolveSettings(theme.settings, getPreset(theme.presetKey)?.settings);
    return {
      renderer: 'theme',
      page: templateKey,
      fallback: templateKey !== page,
      theme: { id: theme.id, name: theme.name },
      organization,
      settings,
      content: resolveContent(theme.content),
      documents,
      resolved: await this._resolve(organizationId, { settings, documents }, { events: page !== 'frame' }),
    };
  }

  /**
   * Resolved data for the editor iframe (hidden items included). Files are
   * resolved across EVERY document, not just `page`: the editor loads this
   * once and switches pages without reloading, so a hero image on Home must
   * resolve even when the editor asked for another page.
   */
  async previewData(organizationId, themeId, page = 'home') {
    if (!documentDef(page)) throw new NotFoundError('Theme document not found');
    const theme = await this._theme(organizationId, themeId);
    const rows = await prisma.themeDocument.findMany({ where: { themeId } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const values = Object.keys(DOCUMENTS).map((key) => this._readDocument(theme, key, byKey.get(key)).data);
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: ORGANIZATION_IDENTITY });
    return { organization, resolved: await this._resolve(organizationId, { settings: theme.settings, values }) };
  }
}

function hasKey(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export default new ThemeService();
