// Refund sweep of cancelled paid events (spec 054-B). Every paid order of a
// cancelled event is one EventCancellationItem: its work queue entry,
// idempotency record and progress line. The sweep claims PENDING items,
// refunds the order (REFUND_ALL) or not (MANUAL), emails the buyer once
// (`notifiedAt`), and closes the cancellation with one staff summary when no
// item is left PENDING.
//
// Safe to run on several backend instances and to re-run after a crash:
// - a claim is a conditional update on the item's `updatedAt`, so two runs
//   never take the same item, and a claimed item waits out its backoff;
// - a refund repeated after a crash finds the order already REFUNDED and
//   records it, and Stripe's idempotency key `order:<id>:full` (gotcha 29)
//   makes a repeated Stripe call a no-op;
// - an email is sent only while `notifiedAt` is null.

import { prisma } from '@jump/db';
import refundService from './RefundService.js';
import emailService from './EmailService.js';
import applicationDigestService from './ApplicationDigestService.js';
import { platformBaseUrl } from '../utils/storefrontUrl.js';
import logger from '../utils/logger.js';

export const MAX_ATTEMPTS = 3;
const BATCH = 25;
// A 5,000-ticket event is ~200 batches: keep going for up to this long, then yield to the next tick.
const TIME_BUDGET_MS = 50 * 1000;
const RETRY_AFTER_MS = 60 * 1000;

const ORDER_SELECT = {
  id: true,
  orderRef: true,
  status: true,
  totalAmount: true,
  quantity: true,
  contact: { select: { email: true, firstName: true, lastName: true } },
  event: { select: { name: true, date: true, venue: { select: { timezone: true } } } },
  organization: { select: { id: true, name: true, email: true, logoUrl: true, brandColor: true } },
};

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

class EventCancellationService {
  /**
   * Work through PENDING items until none is ready or the time budget is
   * spent, then close finished cancellations. Returns what this run settled.
   */
  async sweep({ now = () => new Date(), budgetMs = TIME_BUDGET_MS } = {}) {
    const started = Date.now();
    // One clock for the whole run, and each item at most once: a retry that
    // fails again waits for the next run's backoff, not this loop.
    const at = now();
    const seen = new Set();
    const settled = { refunded: 0, skipped: 0, failed: 0, retrying: 0 };
    for (;;) {
      const items = (await this._ready(at)).filter((i) => !seen.has(i.id));
      if (items.length === 0) break;
      for (const item of items) {
        seen.add(item.id);
        if (!(await this._claim(item))) continue;
        const outcome = await this._settle(item);
        settled[outcome] += 1;
      }
      if (Date.now() - started > budgetMs) break;
    }
    await this._closeFinished();
    return settled;
  }

  /** PENDING items whose backoff has passed: a first try at once, the 2nd after 1 min, the 3rd after 2 min. */
  _ready(at) {
    const ago = (ms) => new Date(at.getTime() - ms);
    return prisma.eventCancellationItem.findMany({
      where: {
        status: 'PENDING',
        OR: [{ attempts: 0 }, { attempts: 1, updatedAt: { lt: ago(RETRY_AFTER_MS) } }, { attempts: { gte: 2 }, updatedAt: { lt: ago(2 * RETRY_AFTER_MS) } }],
      },
      include: { cancellation: { select: { id: true, mode: true, message: true, initiatedById: true } } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
  }

  /** Take the item for this run: only one run's conditional update matches the `updatedAt` it read. */
  async _claim(item) {
    const { count } = await prisma.eventCancellationItem.updateMany({
      where: { id: item.id, status: 'PENDING', updatedAt: item.updatedAt },
      data: { attempts: { increment: 1 } },
    });
    return count === 1;
  }

  /** One claimed item: refund (or not), record, email. Never throws. `retry: false` fails it on the first error. */
  async _settle(item, { retry = true } = {}) {
    const attempt = item.attempts + 1;
    try {
      const order = await prisma.order.findUnique({ where: { id: item.orderId }, select: ORDER_SELECT });
      const result = await this._decide(item, order);
      await prisma.eventCancellationItem.update({ where: { id: item.id }, data: { ...result.data, error: null } });
      await this._notify(item, order, result);
      return result.data.status === 'REFUNDED' ? 'refunded' : 'skipped';
    } catch (error) {
      const failed = !retry || attempt >= MAX_ATTEMPTS;
      await prisma.eventCancellationItem.update({
        where: { id: item.id },
        data: { status: failed ? 'FAILED' : 'PENDING', error: error.message?.slice(0, 1000) || 'Refund failed' },
      });
      logger.error('Event cancellation refund failed', { event: 'event_cancellation_item_failed', itemId: item.id, orderId: item.orderId, attempt, failed, error: error.message });
      return failed ? 'failed' : 'retrying';
    }
  }

  /** What happens to one order; throws when the refund itself fails (retried). */
  async _decide(item, order) {
    if (!order) return { data: { status: 'SKIPPED', skippedReason: 'ORDER_MISSING' }, refund: null };
    if (Number(order.totalAmount) <= 0) return { data: { status: 'SKIPPED', skippedReason: 'FREE_ORDER' }, refund: 'none' };
    if (item.cancellation.mode === 'MANUAL') return { data: { status: 'SKIPPED', skippedReason: 'MANUAL_MODE' }, refund: 'manual' };

    // The dispute flow owns money a buyer is disputing (spec 037).
    const disputed = await prisma.dispute.count({ where: { orderId: order.id, state: 'OPEN' } });
    if (disputed > 0) return { data: { status: 'SKIPPED', skippedReason: 'OPEN_DISPUTE' }, refund: 'none' };

    if (order.status === 'REFUNDED') {
      // Refunded by an earlier attempt of ours that crashed before recording it, or by staff in Orders.
      if (item.attempts > 0) {
        const refunded = await this._refundedTotal(order.id);
        return { data: { status: 'REFUNDED', refundedAmount: refunded }, refund: 'issued', amount: refunded };
      }
      return { data: { status: 'SKIPPED', skippedReason: 'ALREADY_REFUNDED' }, refund: 'none' };
    }

    const refund = await refundService.refundOrder(order.id, { reason: 'Event cancelled', initiatedBy: item.cancellation.initiatedById });
    return { data: { status: 'REFUNDED', refundedAmount: refund.amount }, refund: 'issued', amount: refund.amount };
  }

  async _refundedTotal(orderId) {
    const { _sum } = await prisma.refund.aggregate({ where: { orderId, status: 'SUCCEEDED' }, _sum: { amount: true } });
    return Number(_sum.amount ?? 0);
  }

  /** The buyer's email, once per order. A failure is logged and the item keeps `notifiedAt` null. */
  async _notify(item, order, result) {
    if (!result.refund || !order?.contact?.email) return;
    const { count } = await prisma.eventCancellationItem.updateMany({ where: { id: item.id, notifiedAt: null }, data: { notifiedAt: new Date() } });
    if (count !== 1) return;
    try {
      await emailService.sendEventCancelled(order, { refund: result.refund, refundAmount: result.amount ?? null, message: item.cancellation.message });
    } catch (error) {
      await prisma.eventCancellationItem.update({ where: { id: item.id }, data: { notifiedAt: null } });
      logger.error('Event cancellation email failed', { event: 'event_cancellation_email_failed', orderId: order.id, error: error.message });
    }
  }

  /**
   * Refund one late payment for a cancelled event (PaymentService) and email
   * its buyer, recorded on the cancellation like a sweep item.
   */
  async settleLatePayment(cancellation, orderId) {
    const item = await prisma.eventCancellationItem.upsert({
      where: { orderId },
      update: { status: 'PENDING' },
      create: { cancellationId: cancellation.id, orderId, status: 'PENDING' },
      include: { cancellation: { select: { id: true, mode: true, message: true, initiatedById: true } } },
    });
    if (!(await this._claim(item))) return null;
    // A late payment is always refunded, whatever the cancellation's mode; a
    // failure goes straight to FAILED for staff (the webhook is not redelivered).
    return this._settle({ ...item, cancellation: { ...item.cancellation, mode: 'REFUND_ALL' } }, { retry: false });
  }

  /** Close every cancellation with nothing left PENDING, and send its staff summary once. */
  async _closeFinished() {
    const open = await prisma.eventCancellation.findMany({
      where: { completedAt: null, items: { none: { status: 'PENDING' } } },
      select: { id: true },
    });
    for (const { id } of open) {
      const { count } = await prisma.eventCancellation.updateMany({ where: { id, completedAt: null }, data: { completedAt: new Date() } });
      if (count === 1) await this._sendSummary(id);
    }
  }

  /** Eventimus-branded summary to the organization's staff (gotcha 34): refunded, skipped, failed. */
  async _sendSummary(cancellationId) {
    try {
      const cancellation = await prisma.eventCancellation.findUnique({
        where: { id: cancellationId },
        include: {
          event: { select: { id: true, name: true, venue: { select: { organization: { select: { id: true, name: true } } } } } },
          items: { include: { order: { select: { orderRef: true } } } },
        },
      });
      const organization = cancellation?.event?.venue?.organization;
      if (!organization || cancellation.items.length === 0) return;
      const recipients = await applicationDigestService.recipients(organization.id);
      if (recipients.length === 0) return;

      const by = (status) => cancellation.items.filter((i) => i.status === status);
      const refunded = by('REFUNDED');
      const failed = by('FAILED');
      const skipped = by('SKIPPED');
      const total = refunded.reduce((sum, i) => sum + Number(i.refundedAmount || 0), 0);
      const lines = [
        `${cancellation.event.name} is cancelled and every order has been handled.`,
        '',
        cancellation.mode === 'REFUND_ALL' ? `Refunded: ${refunded.length} ${refunded.length === 1 ? 'order' : 'orders'}, ${money(total)} in total.` : null,
        skipped.length ? `Not refunded: ${skipped.length} (${this._reasons(skipped)}).` : null,
        failed.length ? `Refund failed: ${failed.length}. Retry them or refund them in Orders: ${failed.map((i) => i.order?.orderRef).filter(Boolean).join(', ')}.` : null,
        'Every buyer has been emailed.',
        '',
        `${platformBaseUrl()}/admin/events/${cancellation.event.id}`,
      ].filter((line) => line !== null);

      for (const to of recipients) {
        try {
          await emailService.sendApplicationMessage({
            to,
            subject: `${failed.length ? 'Refunds need attention' : 'Refunds complete'} — ${cancellation.event.name}`,
            body: lines.join('\n'),
            organization: { name: organization.name },
            staff: true,
          });
        } catch (error) {
          logger.error('Event cancellation summary email failed', { cancellationId, to, error: error.message });
        }
      }
      logger.info('Event cancellation complete', { event: 'event_cancellation_completed', cancellationId, refunded: refunded.length, failed: failed.length, skipped: skipped.length });
    } catch (error) {
      logger.error('Event cancellation summary failed', { cancellationId, error: error.message });
    }
  }

  _reasons(items) {
    const LABEL = {
      FREE_ORDER: 'free',
      MANUAL_MODE: 'you handle refunds',
      OPEN_DISPUTE: 'open dispute',
      ALREADY_REFUNDED: 'already refunded',
      HANDLED_BY_STAFF: 'handled by staff',
      ORDER_MISSING: 'order missing',
    };
    const counts = new Map();
    for (const i of items) counts.set(LABEL[i.skippedReason] || 'other', (counts.get(LABEL[i.skippedReason] || 'other') || 0) + 1);
    return [...counts].map(([label, n]) => `${n} ${label}`).join(', ');
  }
}

export default new EventCancellationService();
