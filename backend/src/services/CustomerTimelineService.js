import { prisma } from '@jump/db';
import { ForbiddenError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

const iso = (value) => new Date(value).toISOString();
const money = (value) => Number(value || 0);
const eventId = (type, id) => `${type.toLowerCase()}:${id}`;

function orderContext(order) {
  return {
    orderId: order.id,
    orderRef: order.orderRef,
    event: order.event || null,
  };
}

function applicationContext(application) {
  return {
    applicationId: application.id,
    event: application.event || null,
    form: application.form || null,
  };
}

function compareNewest(a, b) {
  const time = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return time || String(b.id).localeCompare(String(a.id));
}

export function buildTimeline({ contact, comments = [], orders = [], applications = [], rsvps = [] }) {
  const items = [];

  for (const comment of comments) {
    const type = comment.kind === 'EMAIL_CHANGED' ? 'EMAIL_CHANGED' : 'COMMENT';
    items.push({
      id: eventId(type, comment.id),
      sourceId: comment.id,
      type,
      body: comment.body,
      createdAt: iso(comment.createdAt),
      author: comment.author || null,
    });
  }

  for (const order of orders) {
    if (order.payment?.status === 'SUCCEEDED' && (order.paidAt || order.payment.createdAt)) {
      items.push({
        id: eventId('ORDER_PAID', order.payment.id),
        type: 'ORDER_PAID',
        amount: money(order.payment.amount ?? order.totalAmount),
        createdAt: iso(order.paidAt || order.payment.createdAt),
        ...orderContext(order),
      });
    }

    let refunded = 0;
    const successful = (order.refunds || [])
      .filter((refund) => refund.status === 'SUCCEEDED')
      .sort(
        (a, b) =>
          new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id))
      );
    for (const refund of successful) {
      refunded += money(refund.amount);
      const type =
        refunded >= money(order.totalAmount) ? 'ORDER_REFUNDED' : 'ORDER_PARTIALLY_REFUNDED';
      items.push({
        id: eventId(type, refund.id),
        type,
        amount: money(refund.amount),
        refundedTotal: refunded,
        createdAt: iso(refund.createdAt),
        ...orderContext(order),
      });
    }
  }

  for (const application of applications) {
    if (application.submittedAt) {
      items.push({
        id: eventId('APPLICATION_SUBMITTED', application.id),
        type: 'APPLICATION_SUBMITTED',
        createdAt: iso(application.submittedAt),
        ...applicationContext(application),
      });
    }
    for (const decision of application.decisions || []) {
      if (!['APPROVED', 'REJECTED'].includes(decision.action)) continue;
      const type = `APPLICATION_${decision.action}`;
      items.push({
        id: eventId(type, decision.id),
        type,
        createdAt: iso(decision.createdAt),
        ...applicationContext(application),
      });
    }
  }

  for (const rsvp of rsvps) {
    const context = {
      rsvpId: rsvp.id,
      partySize: rsvp.partySize,
      event: rsvp.event || null,
    };
    items.push({
      id: eventId('RSVP_CREATED', rsvp.id),
      type: 'RSVP_CREATED',
      createdAt: iso(rsvp.createdAt),
      ...context,
    });
    if (rsvp.cancelledAt) {
      items.push({
        id: eventId('RSVP_CANCELLED', rsvp.id),
        type: 'RSVP_CANCELLED',
        createdAt: iso(rsvp.cancelledAt),
        ...context,
      });
    }
  }

  if (contact.accountCreatedAt) {
    items.push({
      id: eventId('ACCOUNT_CREATED', contact.id),
      type: 'ACCOUNT_CREATED',
      createdAt: iso(contact.accountCreatedAt),
    });
  }
  if (contact.emailSubscribedAt) {
    items.push({
      id: eventId('MARKETING_SUBSCRIBED', contact.id),
      type: 'MARKETING_SUBSCRIBED',
      source: contact.emailSubscribedSource || null,
      createdAt: iso(contact.emailSubscribedAt),
    });
  }
  if (contact.emailUnsubscribedAt) {
    items.push({
      id: eventId('MARKETING_UNSUBSCRIBED', contact.id),
      type: 'MARKETING_UNSUBSCRIBED',
      createdAt: iso(contact.emailUnsubscribedAt),
    });
  }
  items.push({
    id: eventId('CONTACT_CREATED', contact.id),
    type: 'CONTACT_CREATED',
    createdAt: iso(contact.createdAt),
  });

  return items.sort(compareNewest);
}

function encodeCursor(item) {
  return Buffer.from(JSON.stringify({ createdAt: item.createdAt, id: item.id })).toString(
    'base64url'
  );
}

function decodeCursor(cursor) {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value?.createdAt !== 'string' || typeof value?.id !== 'string')
      throw new Error('shape');
    return value;
  } catch {
    throw new ValidationError('Invalid timeline cursor');
  }
}

export function paginateTimeline(items, { limit = 20, cursor } = {}) {
  let start = 0;
  if (cursor) {
    const decoded = decodeCursor(cursor);
    const index = items.findIndex(
      (item) => item.id === decoded.id && item.createdAt === decoded.createdAt
    );
    if (index < 0) throw new ValidationError('Invalid timeline cursor');
    start = index + 1;
  }
  const data = items.slice(start, start + limit);
  const hasMore = start + data.length < items.length;
  return {
    data,
    hasMore,
    nextCursor: hasMore && data.length ? encodeCursor(data[data.length - 1]) : null,
  };
}

class CustomerTimelineService {
  async _contact(contactId, organizationId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, ...(organizationId && { organizationId }) },
      select: {
        id: true,
        organizationId: true,
        createdAt: true,
        accountCreatedAt: true,
        emailSubscribedAt: true,
        emailSubscribedSource: true,
        emailUnsubscribedAt: true,
      },
    });
    if (!contact) throw new NotFoundError('Customer not found');
    return contact;
  }

  async getTimeline(contactId, organizationId, options = {}) {
    const contact = await this._contact(contactId, organizationId);
    const [comments, orders, applications, rsvps] = await Promise.all([
      prisma.contactComment.findMany({
        where: { contactId, organizationId: contact.organizationId },
        include: { author: { select: { id: true, name: true, email: true } } },
      }),
      prisma.order.findMany({
        where: { contactId },
        select: {
          id: true,
          orderRef: true,
          totalAmount: true,
          paidAt: true,
          event: { select: { id: true, name: true, date: true } },
          payment: { select: { id: true, amount: true, status: true, createdAt: true } },
          refunds: { select: { id: true, amount: true, status: true, createdAt: true } },
        },
      }),
      prisma.application.findMany({
        where: { contactId, organizationId: contact.organizationId },
        select: {
          id: true,
          submittedAt: true,
          event: { select: { id: true, name: true, date: true } },
          form: { select: { id: true, name: true } },
          decisions: {
            where: { action: { in: ['APPROVED', 'REJECTED'] } },
            select: { id: true, action: true, createdAt: true },
          },
        },
      }),
      prisma.eventRsvp.findMany({
        where: { contactId },
        select: {
          id: true,
          partySize: true,
          createdAt: true,
          cancelledAt: true,
          event: { select: { id: true, name: true, date: true } },
        },
      }),
    ]);
    return paginateTimeline(buildTimeline({ contact, comments, orders, applications, rsvps }), options);
  }

  async createComment(contactId, organizationId, authorUserId, body) {
    const contact = await this._contact(contactId, organizationId);
    return prisma.contactComment.create({
      data: {
        contactId,
        organizationId: contact.organizationId,
        authorUserId,
        body,
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
  }

  async deleteComment(contactId, commentId, organizationId, user) {
    await this._contact(contactId, organizationId);
    const comment = await prisma.contactComment.findFirst({
      where: { id: commentId, contactId, ...(organizationId && { organizationId }) },
    });
    if (!comment) throw new NotFoundError('Comment not found');
    if (comment.kind !== 'COMMENT')
      throw new ForbiddenError('System timeline entries cannot be deleted');
    if (comment.authorUserId !== user.id && !['ADMIN', 'SYSTEM_ADMIN'].includes(user.role)) {
      throw new ForbiddenError('Only the comment author or an admin may delete this comment');
    }
    await prisma.contactComment.delete({ where: { id: comment.id } });
  }
}

export default new CustomerTimelineService();
