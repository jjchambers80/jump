// RSVP service (spec 034): contact capture and capacity-safe free admission.

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import contactOptInService from './ContactOptInService.js';
import legalAcceptanceService from './LegalAcceptanceService.js';
import { checkoutAcceptanceRequired } from '../config/legal.js';
import emailService from './EmailService.js';
import { cancelUrlFor, rsvpIdFromCancelToken } from './rsvpLinks.js';

function coded(ErrorType, code, message, details = {}) {
  const error = new ErrorType(message, details);
  error.code = code;
  return error;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function remainingFor(limit, headcount) {
  return limit === null || limit === undefined ? null : Math.max(0, limit - headcount);
}

class RsvpService {
  async create(eventId, data, requestMeta = { ipHash: null, userAgent: null }) {
    let accepted = [];
    if (data.acceptances !== undefined || checkoutAcceptanceRequired()) {
      accepted = legalAcceptanceService.assertCurrent(data.acceptances, ['TERMS', 'PRIVACY']);
    } else {
      logger.warn('RSVP without legal acceptances', {
        event: 'legal_acceptance_missing',
        eventId,
        email: data.email,
      });
    }

    const rsvp = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
      const event = await tx.event.findUnique({
        where: { id: eventId },
        include: {
          venue: {
            include: {
              organization: {
                select: { id: true, name: true, logoUrl: true, email: true },
              },
            },
          },
        },
      });
      if (!event) throw new NotFoundError('Event not found');
      if (event.admissionMode !== 'RSVP')
        throw coded(ConflictError, 'EVENT_NOT_RSVP', 'This event does not accept RSVPs');
      if (event.status !== 'PUBLISHED')
        throw coded(ValidationError, 'RSVP_UNAVAILABLE', 'This event is not accepting RSVPs');
      if (new Date(event.date) <= new Date())
        throw coded(ValidationError, 'RSVP_UNAVAILABLE', 'This event has already occurred');
      if (data.partySize > event.rsvpMaxPartySize)
        throw new ValidationError(`partySize cannot exceed ${event.rsvpMaxPartySize}`, {
          maxPartySize: event.rsvpMaxPartySize,
        });

      const organizationId = event.venue.organizationId;
      let contact = await tx.contact.findUnique({
        where: { organizationId_email: { organizationId, email: data.email } },
      });
      if (!contact) {
        contact = await tx.contact.create({
          data: {
            organizationId,
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
          },
        });
      } else {
        const nameData = {};
        if (!contact.firstName?.trim()) nameData.firstName = data.firstName;
        if (!contact.lastName?.trim()) nameData.lastName = data.lastName;
        if (Object.keys(nameData).length)
          contact = await tx.contact.update({ where: { id: contact.id }, data: nameData });
      }

      const existing = await tx.eventRsvp.findUnique({
        where: { eventId_contactId: { eventId, contactId: contact.id } },
      });
      const currentPartySize = existing?.status === 'GOING' ? existing.partySize : 0;
      const totals = await tx.eventRsvp.aggregate({
        where: { eventId, status: 'GOING' },
        _sum: { partySize: true },
      });
      const nextHeadcount = Number(totals._sum.partySize || 0) - currentPartySize + data.partySize;
      if (event.rsvpLimit !== null && nextHeadcount > event.rsvpLimit) {
        throw coded(ConflictError, 'RSVP_FULL', 'This event does not have enough RSVP spots left', {
          remaining: remainingFor(event.rsvpLimit, Number(totals._sum.partySize || 0) - currentPartySize),
          requested: data.partySize,
        });
      }

      const saved = await tx.eventRsvp.upsert({
        where: { eventId_contactId: { eventId, contactId: contact.id } },
        create: { eventId, contactId: contact.id, partySize: data.partySize },
        update: { partySize: data.partySize, status: 'GOING', cancelledAt: null },
        include: {
          contact: true,
          event: {
            include: { venue: { include: { organization: true } } },
          },
        },
      });

      await contactOptInService.apply(tx, contact.id, {
        marketing: data.marketing,
        source: 'RSVP',
      });
      if (accepted.length) {
        await legalAcceptanceService.record(
          tx,
          {
            subjectType: 'CONTACT',
            subjectId: contact.id,
            email: data.email,
            organizationId,
            source: 'RSVP',
            referenceType: 'EventRsvp',
            referenceId: saved.id,
            ...requestMeta,
          },
          accepted
        );
      }
      return saved;
    });

    const cancelUrl = await cancelUrlFor(rsvp);
    await emailService.sendRsvpConfirmation(rsvp, { cancelUrl });
    return { status: 'ok' };
  }

  async cancel(token) {
    const id = rsvpIdFromCancelToken(token);
    if (!id) throw new ValidationError('Invalid RSVP cancellation token');
    const existing = await prisma.eventRsvp.findUnique({ where: { id } });
    if (!existing) throw new ValidationError('Invalid RSVP cancellation token');
    if (existing.status === 'GOING') {
      await prisma.eventRsvp.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
    }
    return { status: 'ok' };
  }

  async headcount(eventId, db = prisma) {
    const result = await db.eventRsvp.aggregate({
      where: { eventId, status: 'GOING' },
      _sum: { partySize: true },
      _count: { id: true },
    });
    return { headcount: Number(result._sum.partySize || 0), rsvpCount: result._count.id };
  }

  async list(organizationId, eventId) {
    const event = await prisma.event.findFirst({
      where: { id: eventId, venue: { organizationId } },
      select: { id: true, admissionMode: true },
    });
    if (!event) throw new NotFoundError('Event not found');
    const [rows, going, cancelledCount] = await Promise.all([
      prisma.eventRsvp.findMany({
        where: { eventId },
        include: { contact: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.headcount(eventId),
      prisma.eventRsvp.count({ where: { eventId, status: 'CANCELLED' } }),
    ]);
    return {
      ...going,
      cancelledCount,
      data: rows.map((row) => ({
        id: row.id,
        firstName: row.contact.firstName,
        lastName: row.contact.lastName,
        email: row.contact.email,
        partySize: row.partySize,
        status: row.status,
        subscribed: row.contact.emailSubscribed,
        createdAt: row.createdAt,
        cancelledAt: row.cancelledAt,
      })),
    };
  }

  async csv(organizationId, eventId, timeZone = 'UTC') {
    const list = await this.list(organizationId, eventId);
    const format = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timeZone || 'UTC',
    });
    const lines = [['First name', 'Last name', 'Email', 'Party size', 'Status', 'Subscribed', "RSVP'd at"]];
    for (const row of list.data) {
      lines.push([
        row.firstName,
        row.lastName,
        row.email,
        row.partySize,
        row.status,
        row.subscribed ? 'Yes' : 'No',
        format.format(new Date(row.createdAt)),
      ]);
    }
    return lines.map((line) => line.map(csvCell).join(',')).join('\r\n');
  }
}

export default new RsvpService();
