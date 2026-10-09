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

// Walk `org` ("event.venue") from the row to an organizationId.
async function organizationVia(model, entityId, path) {
  if (!path || !entityId) return null;
  const select = path.split('.').reduceRight((inner, key) => ({ [key]: { select: inner } }), { organizationId: true });
  try {
    let node = await prisma[model.charAt(0).toLowerCase() + model.slice(1)].findUnique({ where: { id: entityId }, select });
    for (const key of path.split('.')) node = node?.[key];
    return node?.organizationId ?? null;
  } catch {
    return null;
  }
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
          ?? (await organizationVia(event.model, event.entityId, info.org));
        const label = event.entityLabel ?? (info.label ? event.row?.[info.label] : null);
        rows.push({
          organizationId,
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

  /** Inside a request with no staff user (a webhook): attribute its changes to the system. */
  markSystemActor(source, label) {
    const store = auditContext.getStore();
    if (!store) return;
    store.source = source;
    store.actor = { type: 'SYSTEM', label };
  }
}

export default new AuditLogService();
