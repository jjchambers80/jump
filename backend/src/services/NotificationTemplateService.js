// Notification Template Service (spec 053)
// Store-edited wording of system emails. Defaults live in the registry
// (config/notifications.js); a NotificationTemplate row exists only once the
// store saves a change, so "Customized" = a row exists. Rendering into HTML
// belongs to EmailService, which owns the branded shells and system blocks.

import { prisma } from '@jump/db';
import { NOTIFICATION_GROUPS, NOTIFICATIONS, NOTIFICATIONS_BY_KEY } from '../config/notifications.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { cleanTemplate } from '../utils/renderTemplate.js';
import logger from '../utils/logger.js';

class NotificationTemplateService {
  /** Groups of rows for Settings › Notifications, defaults filled in. */
  async list(organizationId) {
    const rows = await prisma.notificationTemplate.findMany({ where: { organizationId } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return NOTIFICATION_GROUPS.map((group) => ({
      ...group,
      notifications: NOTIFICATIONS.filter((n) => n.group === group.key).map((n) => this._serialize(n, byKey.get(n.key))),
    }));
  }

  async get(organizationId, key) {
    const entry = this._entry(key);
    const row = organizationId
      ? await prisma.notificationTemplate.findUnique({ where: { organizationId_key: { organizationId, key } } })
      : null;
    return this._serialize(entry, row);
  }

  /** `draft.enabled` is accepted only for optional keys (the RSVP reminder). */
  async update(organizationId, key, draft) {
    const entry = this._entry(key);
    const { subject, body } = cleanTemplate(draft);
    if (draft.enabled !== undefined) {
      if (!entry.optional) throw new ValidationError('This email cannot be switched off');
      if (typeof draft.enabled !== 'boolean') throw new ValidationError('enabled must be a boolean');
    }
    const enabled = draft.enabled ?? undefined;
    const row = await prisma.notificationTemplate.upsert({
      where: { organizationId_key: { organizationId, key } },
      update: { subject, body, ...(enabled !== undefined && { enabled }) },
      create: { organizationId, key, subject, body, ...(enabled !== undefined && { enabled }) },
    });
    logger.info('Notification template updated', { event: 'notification_template_updated', organizationId, key, enabled: row.enabled });
    return this._serialize(entry, row);
  }

  async reset(organizationId, key) {
    const entry = this._entry(key);
    await prisma.notificationTemplate.deleteMany({ where: { organizationId, key } });
    return this._serialize(entry, null);
  }

  /**
   * `{ subject, body, enabled }` to send: the store's row, else the default.
   * Never throws for a known key — a failed lookup must not stop an email.
   */
  async resolve(organizationId, key) {
    const entry = this._entry(key);
    try {
      const { subject, body, enabled } = await this.get(organizationId, key);
      return { subject, body, enabled };
    } catch (error) {
      logger.warn('Notification template lookup failed; using the default', { organizationId, key, error: error.message });
      return { ...entry.defaults, enabled: true };
    }
  }

  _entry(key) {
    const entry = NOTIFICATIONS_BY_KEY.get(key);
    if (!entry) throw new NotFoundError('Unknown notification');
    return entry;
  }

  _serialize(entry, row) {
    return {
      key: entry.key,
      label: entry.label,
      when: entry.when,
      blocks: entry.blocks,
      mergeFields: entry.mergeFields.map(([key, description]) => ({ key, description })),
      subject: row?.subject ?? entry.defaults.subject,
      body: row?.body ?? entry.defaults.body,
      optional: entry.optional === true,
      enabled: row?.enabled ?? true,
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
    };
  }
}

export default new NotificationTemplateService();
