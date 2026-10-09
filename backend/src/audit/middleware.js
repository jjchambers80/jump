// Spec 048: opens an audit context for every API request. Writes are only
// captured once a staff user (session or CLI token) is on req.user — buyers
// and anonymous traffic pass straight through — and are flushed after the
// response has gone out, only when it succeeded.
//
// ponytail: a write that committed before the request failed (status ≥ 400)
// is dropped from the trail. Writing audit rows inside each transaction is the
// upgrade if that ever matters.

import { auditContext } from '@jump/db';
import auditLogService from './AuditLogService.js';

export function auditContextMiddleware(req, res, next) {
  const store = { req, events: [] };
  res.on('finish', () => {
    if (!store.events.length) return;
    if (res.statusCode >= 400) {
      store.events.length = 0;
      return;
    }
    if (!store.source) store.source = req.user?.developerTokenId ? 'cli' : 'admin';
    auditLogService.flush(store);
  });
  auditContext.run(store, next);
}
