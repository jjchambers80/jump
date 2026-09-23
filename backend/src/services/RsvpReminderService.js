// RSVP Reminder Service (spec 034 §9.2)
// Hourly sweep that sends a reminder email to GOING RSVPs whose event starts
// in approximately 24 hours. Idempotent per RSVP via the `remindedAt` stamp:
// the stamp is set atomically with updateMany before any send, so concurrent
// replicas never double-send.

import { prisma } from '@jump/db';
import emailService from './EmailService.js';
import { cancelUrlFor } from './rsvpLinks.js';
import logger from '../utils/logger.js';

// Reminder window: 20-26 hours ahead of the sweep tick.
// The stamp (remindedAt IS NULL) is the idempotency gate, so the generous
// window survives sweep delays up to ~4 hours without missing an event.
const MIN_AHEAD_MS = 20 * 60 * 60 * 1000; // 20 h
const MAX_AHEAD_MS = 26 * 60 * 60 * 1000; // 26 h

class RsvpReminderService {
  /**
   * Find RSVPs due for a reminder, stamp them atomically, send the email.
   * @param {Date} [now] - Override point for testing.
   * @returns {Promise<{ checked: number, sent: number, failed: number }>}
   */
  async sendDue(now = new Date()) {
    const minBound = new Date(now.getTime() + MIN_AHEAD_MS);
    const maxBound = new Date(now.getTime() + MAX_AHEAD_MS);

    // Atomically claim eligible RSVPs by stamping remindedAt.
    // The WHERE clause ensures only GOING, un-reminded RSVPs on PUBLISHED
    // events whose date falls inside the reminder window are claimed.
    const claimed = await prisma.eventRsvp.updateMany({
      where: {
        status: 'GOING',
        remindedAt: null,
        event: {
          status: 'PUBLISHED',
          date: { gte: minBound, lt: maxBound },
        },
      },
      data: { remindedAt: now },
    });

    if (claimed.count === 0) {
      return { checked: 0, sent: 0, failed: 0 };
    }

    // Fetch the newly-stamped RSVPs with the relations needed to send.
    const rsvps = await prisma.eventRsvp.findMany({
      where: { remindedAt: now, status: 'GOING' },
      include: {
        event: { include: { venue: { include: { organization: true } } } },
        contact: true,
      },
    });

    let sent = 0;
    let failed = 0;

    for (const rsvp of rsvps) {
      try {
        const cancelUrl = await cancelUrlFor(rsvp);
        await emailService.sendRsvpReminder(rsvp, { cancelUrl });
        sent++;
      } catch (error) {
        failed++;
        logger.error('RSVP reminder send failed', {
          rsvpId: rsvp.id,
          eventId: rsvp.eventId,
          contactId: rsvp.contactId,
          error: error.message,
        });
      }
    }

    logger.info('RSVP reminder sweep', {
      event: 'rsvp_reminder_sweep',
      checked: claimed.count,
      sent,
      failed,
    });

    return { checked: claimed.count, sent, failed };
  }
}

export default new RsvpReminderService();