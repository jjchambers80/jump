// Stripe webhook delivery receipts (EVE-3).
//
// Stripe delivers at least once and in no guaranteed order. Every handler in
// this codebase is already individually idempotent, but nothing recorded *that*
// a delivery happened — so "the webhook never arrived" and "the webhook arrived
// and did nothing" looked identical after the fact, and a redelivery re-ran the
// whole handler for no reason.
//
// This service writes one `StripeWebhookEvent` row per (endpoint, event id).
// The unique insert is the lock: a concurrent redelivery loses the insert and
// is told to stop before it reaches a handler.
//
// Fail-open by design. If the ledger itself cannot be written, the event is
// still processed and the failure is logged loudly. The handlers remain the
// correctness guarantee; this is defense in depth plus the audit trail. A
// database outage must not also become a dropped payment.

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';

export const ENDPOINTS = { PLATFORM: 'PLATFORM', CONNECT: 'CONNECT', BILLING: 'BILLING' };

/** Terminal states — a redelivery in one of these is a pure duplicate. */
const SETTLED = new Set(['PROCESSED', 'IGNORED']);

/**
 * How long a `RECEIVED` row may sit before a redelivery is allowed to retry it.
 *
 * A row is stamped RECEIVED before the handler runs and updated after. If the
 * process dies in between — OOM, a Railway restart mid-request, a hung Stripe
 * call — it never settles. Without this, every subsequent Stripe retry would be
 * skipped as "a concurrent delivery is in flight" and the event would be lost
 * for good. Five minutes is comfortably longer than any handler here and well
 * inside Stripe's retry schedule.
 */
const STALE_IN_FLIGHT_MS = 5 * 60 * 1000;

function objectIdOf(event) {
  const obj = event?.data?.object;
  return obj && typeof obj.id === 'string' ? obj.id : null;
}

/**
 * Claim an incoming delivery.
 *
 * @returns {Promise<{ proceed: boolean, recordId: string|null, duplicate: boolean, priorStatus: string|null }>}
 *   `proceed: false` means this exact event was already handled (or is being
 *   handled right now by a concurrent delivery) — the caller should answer 200
 *   without re-running the handler.
 */
export async function claim(endpoint, event) {
  const stripeEventId = event?.id;
  const base = { proceed: true, recordId: null, duplicate: false, priorStatus: null };

  // An unsigned local/test event may have no id at all. Nothing to dedup on;
  // process it and skip the ledger rather than inventing a key.
  if (!stripeEventId) return base;

  const objectId = objectIdOf(event);
  const data = {
    endpoint,
    stripeEventId,
    type: event.type ?? 'unknown',
    accountId: event.account ?? null,
    objectId,
    apiVersion: event.api_version ?? null,
    stripeCreatedAt: Number.isFinite(event.created) ? new Date(event.created * 1000) : null,
  };

  let record;
  try {
    record = await prisma.stripeWebhookEvent.create({ data });
  } catch (err) {
    // P2002 on (endpoint, stripeEventId) is the whole point: someone got here first.
    if (err?.code === 'P2002') return claimExisting(endpoint, event, stripeEventId);
    logger.error('Stripe webhook ledger write failed; processing anyway', {
      event: 'stripe_webhook_ledger_error',
      endpoint,
      stripeEventId,
      type: data.type,
      error: err.message,
    });
    return base;
  }

  logger.info('Stripe webhook received', {
    event: 'stripe_webhook_received',
    endpoint,
    stripeEventId,
    type: data.type,
    objectId,
    accountId: data.accountId,
  });

  await warnIfOutOfOrder(endpoint, data, record.id);
  return { ...base, recordId: record.id };
}

/** Second delivery of an event we have already seen. */
async function claimExisting(endpoint, event, stripeEventId) {
  try {
    const existing = await prisma.stripeWebhookEvent.update({
      where: { endpoint_stripeEventId: { endpoint, stripeEventId } },
      data: { deliveries: { increment: 1 } },
    });

    // A previous attempt failed — Stripe retrying is exactly the recovery path,
    // so let it through again. The handler's own idempotency covers the case
    // where the failure happened after the money moved.
    const retryAfterFailure = existing.status === 'FAILED';

    // RECEIVED normally means a concurrent delivery is mid-flight, and stopping
    // is the safe read. But a row that never settled because the process died
    // would otherwise swallow every retry forever, so past the staleness window
    // a redelivery is allowed to pick it up.
    const stale =
      existing.status === 'RECEIVED' &&
      Date.now() - new Date(existing.receivedAt).getTime() > STALE_IN_FLIGHT_MS;

    const reprocessing = retryAfterFailure || stale;

    logger.info('Stripe webhook redelivered', {
      event: 'stripe_webhook_duplicate',
      endpoint,
      stripeEventId,
      type: existing.type,
      priorStatus: existing.status,
      deliveries: existing.deliveries,
      reprocessing,
      ...(stale && { staleInFlight: true, firstReceivedAt: new Date(existing.receivedAt).toISOString() }),
    });

    if (stale) {
      logger.warn('Stripe webhook retrying a delivery that never settled', {
        event: 'stripe_webhook_stale_in_flight',
        endpoint,
        stripeEventId,
        type: existing.type,
        firstReceivedAt: new Date(existing.receivedAt).toISOString(),
      });
    }

    if (!reprocessing && (SETTLED.has(existing.status) || existing.status === 'RECEIVED')) {
      return { proceed: false, recordId: existing.id, duplicate: true, priorStatus: existing.status };
    }
    return { proceed: true, recordId: existing.id, duplicate: true, priorStatus: existing.status };
  } catch (err) {
    logger.error('Stripe webhook duplicate bookkeeping failed; processing anyway', {
      event: 'stripe_webhook_ledger_error',
      endpoint,
      stripeEventId,
      error: err.message,
    });
    return { proceed: true, recordId: null, duplicate: true, priorStatus: null };
  }
}

/**
 * Out-of-order detection. Stripe orders nothing; a `checkout.session.expired`
 * can land after the `checkout.session.completed` for the same session. We do
 * not try to reorder — the handlers already resolve state from the object —
 * but an operator debugging a weird order needs to see that it happened.
 */
async function warnIfOutOfOrder(endpoint, data, recordId) {
  if (!data.objectId || !data.stripeCreatedAt) return;
  try {
    const newer = await prisma.stripeWebhookEvent.findFirst({
      where: {
        endpoint,
        objectId: data.objectId,
        id: { not: recordId },
        stripeCreatedAt: { gt: data.stripeCreatedAt },
      },
      orderBy: { stripeCreatedAt: 'desc' },
      select: { stripeEventId: true, type: true, stripeCreatedAt: true },
    });
    if (!newer) return;
    logger.warn('Stripe webhook delivered out of order', {
      event: 'stripe_webhook_out_of_order',
      endpoint,
      objectId: data.objectId,
      lateEventId: data.stripeEventId,
      lateType: data.type,
      lateCreatedAt: data.stripeCreatedAt.toISOString(),
      alreadySeenEventId: newer.stripeEventId,
      alreadySeenType: newer.type,
      alreadySeenCreatedAt: newer.stripeCreatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    logger.error('Stripe webhook ordering check failed', { error: err.message });
  }
}

/** Record the outcome. `status` is PROCESSED | IGNORED | FAILED. */
export async function settle(recordId, status, error = null) {
  if (!recordId) return;
  try {
    await prisma.stripeWebhookEvent.update({
      where: { id: recordId },
      data: { status, error: error ? String(error).slice(0, 1000) : null, processedAt: new Date() },
    });
  } catch (err) {
    logger.error('Stripe webhook ledger settle failed', {
      event: 'stripe_webhook_ledger_error',
      recordId,
      status,
      error: err.message,
    });
  }
}

export default { ENDPOINTS, claim, settle };
