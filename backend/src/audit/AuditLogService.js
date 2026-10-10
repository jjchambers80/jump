// Spec 048: the audit trail writer.
//
// packages/db/src/audit.js buffers every model write made inside an audit
// context on `store.events`; `flush` turns that buffer into AuditLog rows once
// the request (or job) has succeeded. Who, which organization and from where
// are resolved here, after the response, so the request never waits on them.
// A failed audit write is logged and never breaks the action it describes.

import { prisma, auditContext } from '@jump/db';
import { activeOrgFor } from '../api/routes/adminScope.js';
import { requestMeta } from '../services/SecurityEventService.js';
import { describeUserAgent, deviceLabel } from '../services/SessionService.js';
import { clientIpForRateLimit } from '../utils/clientIp.js';
import { lookupGeo } from '../utils/geoip.js';
import logger from '../utils/logger.js';
import { featureFor, entityKey } from './features.js';
import { redactChanges } from './redact.js';

const VERBS = {
  CREATE: 'created',
  UPDATE: 'updated',
  DELETE: 'deleted',
  BULK_CREATE: 'bulk_created',
  BULK_UPDATE: 'bulk_updated',
  BULK_DELETE: 'bulk_deleted',
};
const LABEL_MAX = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
export const retentionDays = () => Number(process.env.AUDIT_RETENTION_DAYS) || 730;

const CSV_COLUMNS = ['When', 'Who', 'Actor type', 'Action', 'Feature', 'Record', 'Record id', 'Changes', 'Source', 'Location', 'Device', 'Request id'];

// Quotes, and refuses to let a spreadsheet read a value as a formula.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function whereFor(organizationId, f = {}) {
  const where = { organizationId };
  if (f.actorUserId) where.actorUserId = f.actorUserId;
  if (f.actorType) where.actorType = f.actorType;
  if (f.feature) where.feature = f.feature;
  if (f.operation) where.operation = f.operation;
  if (f.entityType) where.entityType = f.entityType;
  if (f.entityId) where.entityId = f.entityId;
  if (f.eventId) where.eventId = f.eventId;
  if (f.q) where.entityLabel = { contains: f.q, mode: 'insensitive' };
  if (f.from || f.to) where.createdAt = { ...(f.from && { gte: new Date(f.from) }), ...(f.to && { lte: new Date(f.to) }) };
  return where;
}

function serialize(row) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    actor: {
      type: row.actorType,
      userId: row.actorUserId,
      label: row.actorLabel,
      role: row.actorRole,
      viaPlatformAdmin: row.viaPlatformAdmin,
      clientName: row.agentClientName,
    },
    action: row.action,
    operation: row.operation,
    feature: row.feature,
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    eventId: row.eventId,
    changes: row.changes,
    meta: row.meta,
    source: row.source,
    requestId: row.requestId,
    method: row.method,
    route: row.route,
    location: row.location,
    device: row.userAgent ? deviceLabel(describeUserAgent(row.userAgent)) : null,
  };
}

function actorFromUser(user) {
  if (!user) return null;
  return {
    type: user.developerTokenId ? 'DEVELOPER_TOKEN' : 'USER',
    userId: user.id,
    label: user.name || user.email || user.id,
    role: user.role ?? null,
    developerTokenId: user.developerTokenId ?? null,
  };
}

async function contextOrganization(store) {
  if (store.organizationId !== undefined) return store.organizationId;
  if (!store.req?.user) return null;
  try {
    return await activeOrgFor(store.req);
  } catch {
    return null; // e.g. a fresh signup with no membership yet
  }
}

// Walk a relation path ("event.venue") from the row to `field` on the last hop.
async function fieldVia(model, entityId, path, field) {
  if (!path || !entityId) return null;
  const select = path.split('.').reduceRight((inner, key) => ({ [key]: { select: inner } }), { [field]: true });
  try {
    let node = await prisma[model.charAt(0).toLowerCase() + model.slice(1)].findUnique({ where: { id: entityId }, select });
    for (const key of path.split('.')) node = node?.[key];
    return node?.[field] ?? null;
  } catch {
    return null;
  }
}

// The event a change belongs to, for the event workspace's History tab.
// ponytail: a deleted child row (e.g. an application tier) can no longer be
// walked to its parent, so it lands with no event; store the parent key on
// the event before the delete if that gap matters.
async function eventFor(event, info) {
  if (event.model === 'Event') return event.entityId;
  if (event.row?.eventId) return event.row.eventId;
  return fieldVia(event.model, event.entityId, info.event, 'eventId');
}

async function requestFields(req) {
  if (!req) return {};
  const geo = await lookupGeo(clientIpForRateLimit(req)).catch(() => null);
  return {
    ...requestMeta(req),
    requestId: req.id ?? null,
    method: req.method,
    route: req.route ? `${req.baseUrl || ''}${req.route.path}` : (req.baseUrl || req.path || null),
    location: geo ? [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || null : null,
  };
}

class AuditLogService {
  /** Persist the events buffered on `store`. Safe to call more than once. */
  async flush(store) {
    const events = store?.events?.splice(0) ?? [];
    if (!events.length) return 0;
    try {
      const actor = store.actor ?? actorFromUser(store.req?.user);
      if (!actor) return 0;
      const fallbackOrg = actor.organizationId ?? (await contextOrganization(store));
      const request = await requestFields(store.req);

      const rows = [];
      for (const event of events) {
        const info = featureFor(event.model);
        const organizationId = event.organizationId
          ?? event.row?.organizationId
          ?? (event.model === 'Organization' ? event.entityId : null)
          ?? fallbackOrg
          ?? (await fieldVia(event.model, event.entityId, info.org, 'organizationId'));
        const label = event.entityLabel ?? (info.label ? event.row?.[info.label] : null);
        rows.push({
          organizationId,
          eventId: await eventFor(event, info),
          actorType: actor.type,
          actorUserId: actor.userId ?? null,
          actorLabel: String(actor.label).slice(0, LABEL_MAX),
          actorRole: actor.role ?? null,
          viaPlatformAdmin: actor.role === 'SYSTEM_ADMIN' && Boolean(organizationId),
          developerTokenId: actor.developerTokenId ?? null,
          agentGrantId: actor.grantId ?? null,
          agentClientName: actor.clientName ?? null,
          action: event.action ?? `${entityKey(event.model)}.${VERBS[event.operation] ?? 'changed'}`,
          operation: event.operation,
          feature: event.feature ?? info.feature,
          entityType: event.model,
          entityId: event.entityId ?? null,
          entityLabel: label == null ? null : String(label).slice(0, LABEL_MAX),
          changes: event.changes && Object.keys(event.changes).length ? redactChanges(event.changes) : undefined,
          meta: event.meta ?? undefined,
          source: store.source ?? 'admin',
          ...request,
        });
      }
      await prisma.auditLog.createMany({ data: rows });
      return rows.length;
    } catch (error) {
      logger.warn('Audit log not recorded', { error: error.message, events: events.length, requestId: store.req?.id });
      return 0;
    }
  }

  /**
   * Record an event that is not a row write (an export, a download). Inside a
   * request it joins that request's buffer; elsewhere it is written at once.
   * @param {{ action: string, operation?: string, feature: string, entityType: string,
   *           entityId?: string, entityLabel?: string, organizationId?: string, meta?: object }} event
   */
  async record({ action, operation = 'OTHER', feature, entityType, entityId = null, entityLabel = null, organizationId, meta = null }) {
    const event = { model: entityType, operation, action, feature, entityId, entityLabel, organizationId, meta, changes: null, row: null };
    const store = auditContext.getStore();
    if (store) {
      store.events.push(event);
      return;
    }
    logger.warn('Audit event outside an audit context dropped', { action });
  }

  /**
   * Run `fn` as a system actor (a sweep) and flush its changes when it ends.
   * Sweeps commit item by item, so a run that throws midway still flushes what
   * it already did.
   */
  async runAsSystem(source, label, fn) {
    const store = { source, actor: { type: 'SYSTEM', label }, events: [] };
    try {
      // `await` inside the context: Prisma queries are lazy and run on `.then`.
      return await auditContext.run(store, async () => await fn());
    } finally {
      await this.flush(store);
    }
  }

  /** One page of an organization's trail, newest first, plus the filter choices. */
  async list(organizationId, { offset = 0, limit = 50, ...filters } = {}) {
    const where = whereFor(organizationId, filters);
    const [total, rows, actors, features] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: offset, take: limit }),
      prisma.auditLog.groupBy({ by: ['actorUserId', 'actorLabel', 'actorType'], where: { organizationId }, orderBy: { actorLabel: 'asc' } }),
      prisma.auditLog.groupBy({ by: ['feature'], where: { organizationId }, orderBy: { feature: 'asc' } }),
    ]);
    return {
      total,
      offset,
      limit,
      rows: rows.map(serialize),
      facets: {
        actors: actors.map((a) => ({ userId: a.actorUserId, label: a.actorLabel, type: a.actorType })),
        features: features.map((f) => f.feature),
      },
      retentionDays: retentionDays(),
    };
  }

  /** The filtered trail as CSV, streamed in pages of 500. */
  async exportCsv(organizationId, filters, onChunk) {
    onChunk(`${CSV_COLUMNS.join(',')}\r\n`);
    const where = whereFor(organizationId, filters);
    for (let cursor = null; ;) {
      const rows = await prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });
      if (!rows.length) return;
      onChunk(rows.map((r) => {
        const row = serialize(r);
        const changes = r.changes ? Object.entries(r.changes).map(([field, [from, to]]) => `${field}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`).join('; ') : '';
        return [r.createdAt.toISOString(), r.actorLabel, r.actorType, r.action, r.feature, r.entityLabel, r.entityId, changes, r.source, r.location, row.device, r.requestId]
          .map(csvCell).join(',');
      }).join('\r\n') + '\r\n');
      cursor = rows[rows.length - 1].id;
      if (rows.length < 500) return;
    }
  }

  /** Retention: delete rows older than AUDIT_RETENTION_DAYS (default 730). */
  async sweep(now = new Date()) {
    const cutoff = new Date(now.getTime() - retentionDays() * DAY_MS);
    const result = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (result.count) logger.info('Audit log sweep', { event: 'audit_log_sweep', deleted: result.count });
    return { deleted: result.count };
  }

  /** Inside a request with no staff user (a webhook): attribute its changes to the system. */
  markSystemActor(source, label) {
    const store = auditContext.getStore();
    if (!store) return;
    store.source = source;
    store.actor = { type: 'SYSTEM', label };
  }
}

export default new AuditLogService();
