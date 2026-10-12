// Notification Template Service (spec 053)
// Store-edited wording of system emails. Defaults live in the registry
// (config/notifications.js); a NotificationTemplate row exists only once the
// store saves a change, so "Customized" = a row exists. Rendering into HTML
// belongs to EmailService, which owns the branded shells and system blocks.

import { prisma } from '@jump/db';
import { NOTIFICATION_GROUPS, NOTIFICATIONS, NOTIFICATIONS_BY_KEY } from '../config/notifications.js';
import { NotFoundError } from '../middleware/errorHandler.js';
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

  async update(organizationId, key, draft) {
    const entry = this._entry(key);
    const { subject, body } = cleanTemplate(draft);
    const row = await prisma.notificationTemplate.upsert({
      where: { organizationId_key: { organizationId, key } },
      update: { subject, body },
      create: { organizationId, key, subject, body },
    });
    logger.info('Notification template updated', { event: 'notification_template_updated', organizationId, key });
    return this._serialize(entry, row);
  }

  async reset(organizationId, key) {
    const entry = this._entry(key);
    await prisma.notificationTemplate.deleteMany({ where: { organizationId, key } });
    return this._serialize(entry, null);
  }

  /**
   * `{ subject, body }` to send: the store's row, else the default. Never
   * throws for a known key — a failed lookup must not stop an order email.
   */
  async resolve(organizationId, key) {
    const entry = this._entry(key);
    try {
      const { subject, body } = await this.get(organizationId, key);
      return { subject, body };
    } catch (error) {
      logger.warn('Notification template lookup failed; using the default', { organizationId, key, error: error.message });
      return { ...entry.defaults };
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
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
    };
  }
}

export default new NotificationTemplateService();
