// Administration header search — bounded, organization-scoped queries for the
// nine resources exposed by the admin launcher (spec 029).

import { prisma } from '@jump/db';
import { PAID_ORDER_STATUSES } from './paidStatuses.js';

const contains = (value) => ({ contains: value, mode: 'insensitive' });
const fullName = (contact) =>
  [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim();
const eventDate = (date) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
const eventHref = (eventId, organizationId) =>
  `/admin/events/${eventId}/edit${organizationId ? `?orgId=${encodeURIComponent(organizationId)}` : ''}`;

class AdminSearchService {
  /**
   * Search the admin launcher resources. Every query is database-filtered and
   * capped; `organizationId: null` is reserved for an unscoped SYSTEM_ADMIN.
   */
  async search({ organizationId }, query) {
    const term = query.trim();
    const stripeId = /^(pi|re|pyr|cs)_/.test(term);
    const eventScope = organizationId ? { venue: { organizationId } } : {};
    const directScope = organizationId ? { organizationId } : {};

    const [events, venues, customers, orders, tickets, applications, pages, blogPosts, files] =
      await Promise.all([
        prisma.event.findMany({
          where: {
            ...eventScope,
            OR: [{ name: contains(term) }, { venue: { name: contains(term) } }],
          },
          select: {
            id: true,
            name: true,
            date: true,
            status: true,
            venue: { select: { name: true, organizationId: true } },
          },
          orderBy: [{ date: 'desc' }, { id: 'asc' }],
          take: 5,
        }),
        prisma.venue.findMany({
          where: { ...directScope, name: contains(term) },
          select: { id: true, name: true, address: true, city: true, state: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: 3,
        }),
        prisma.contact.findMany({
          where: {
            ...directScope,
            orders: { some: { status: { in: PAID_ORDER_STATUSES } } },
            OR: [
              { email: contains(term.toLowerCase()) },
              { firstName: contains(term) },
              { lastName: contains(term) },
              { applicantProfiles: { some: { businessName: contains(term) } } },
            ],
          },
          select: { id: true, firstName: true, lastName: true, email: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 5,
        }),
        prisma.order.findMany({
          where: {
            ...(organizationId && { event: { venue: { organizationId } } }),
            OR: stripeId
              ? [
                  { payment: { stripePaymentIntentId: term } },
                  { refunds: { some: { stripeRefundId: term } } },
                  { stripeSessionId: term },
                  { application: { stripeCheckoutSessionId: term } },
                ]
              : [
                  { orderRef: contains(term.toUpperCase()) },
                  { contact: { email: contains(term.toLowerCase()) } },
                  { contact: { firstName: contains(term) } },
                  { contact: { lastName: contains(term) } },
                  { application: { profile: { businessName: contains(term) } } },
                ],
          },
          select: {
            id: true,
            orderRef: true,
            kind: true,
            status: true,
            contact: { select: { firstName: true, lastName: true, email: true } },
            event: { select: { name: true } },
            application: { select: { profile: { select: { businessName: true } } } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 5,
        }),
        prisma.ticket.findMany({
          where: {
            ...(organizationId && { event: { venue: { organizationId } } }),
            order: { status: 'COMPLETED' },
            OR: [
              { barcode: contains(term.toUpperCase()) },
              { order: { orderRef: contains(term.toUpperCase()) } },
              { contact: { email: contains(term.toLowerCase()) } },
              { contact: { firstName: contains(term) } },
              { contact: { lastName: contains(term) } },
              { order: { contact: { email: contains(term.toLowerCase()) } } },
              { order: { contact: { firstName: contains(term) } } },
              { order: { contact: { lastName: contains(term) } } },
            ],
          },
          select: {
            id: true,
            barcode: true,
            status: true,
            eventId: true,
            event: { select: { name: true } },
            contact: { select: { firstName: true, lastName: true, email: true } },
            order: {
              select: {
                orderRef: true,
                contact: { select: { firstName: true, lastName: true, email: true } },
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 5,
        }),
        prisma.application.findMany({
          where: {
            ...directScope,
            status: { not: 'DRAFT' },
            OR: [
              { contact: { email: contains(term.toLowerCase()) } },
              { contact: { firstName: contains(term) } },
              { contact: { lastName: contains(term) } },
              { profile: { businessName: contains(term) } },
            ],
          },
          select: {
            id: true,
            eventId: true,
            status: true,
            contact: { select: { firstName: true, lastName: true, email: true } },
            profile: { select: { businessName: true } },
            event: { select: { name: true } },
          },
          orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
          take: 5,
        }),
        prisma.page.findMany({
          where: { ...directScope, title: contains(term) },
          select: { id: true, title: true },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          take: 3,
        }),
        prisma.blogPost.findMany({
          where: { ...directScope, title: contains(term) },
          select: { id: true, title: true, publishedAt: true },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          take: 3,
        }),
        prisma.storeFile.findMany({
          where: { ...directScope, name: contains(term) },
          select: { id: true, name: true, extension: true },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          take: 3,
        }),
      ]);

    return [
      ...events.map((event) => ({
        type: 'EVENT',
        id: event.id,
        title: event.name,
        subtitle: `${eventDate(event.date)} · ${event.venue.name}`,
        href: eventHref(event.id, organizationId),
        meta: { date: event.date.toISOString(), status: event.status },
      })),
      ...venues.map((venue) => ({
        type: 'VENUE',
        id: venue.id,
        title: venue.name,
        subtitle: [venue.address, venue.city, venue.state].filter(Boolean).join(', '),
        href: '/admin/venues',
      })),
      ...customers.map((contact) => ({
        type: 'CUSTOMER',
        id: contact.id,
        title: fullName(contact),
        subtitle: contact.email,
        href: `/admin/customers/${contact.id}`,
        meta: { email: contact.email },
      })),
      ...orders.map((order) => ({
        type: 'ORDER',
        id: order.id,
        title: order.orderRef,
        subtitle: [
          order.application?.profile?.businessName || fullName(order.contact),
          order.event?.name,
        ]
          .filter(Boolean)
          .join(' · '),
        href: `/admin/orders/${order.id}`,
        meta: { kind: order.kind, status: order.status },
      })),
      ...tickets.map((ticket) => ({
        type: 'TICKET',
        id: ticket.id,
        title: ticket.barcode,
        subtitle: [fullName(ticket.contact) || fullName(ticket.order?.contact), ticket.event?.name]
          .filter(Boolean)
          .join(' · '),
        href: `/admin/orders?view=tickets&search=${encodeURIComponent(term)}`,
        meta: { eventId: ticket.eventId, status: ticket.status },
      })),
      ...applications.map((application) => ({
        type: 'APPLICATION',
        id: application.id,
        title: application.profile?.businessName || fullName(application.contact),
        subtitle: [fullName(application.contact), application.event?.name].filter(Boolean).join(' · '),
        href: `/admin/events/${application.eventId}/applications/${application.id}`,
        meta: { eventId: application.eventId, status: application.status },
      })),
      ...pages.map((page) => ({
        type: 'PAGE',
        id: page.id,
        title: page.title,
        subtitle: 'Online store page',
        href: `/admin/online-store/pages/${page.id}`,
      })),
      ...blogPosts.map((post) => ({
        type: 'BLOG_POST',
        id: post.id,
        title: post.title,
        subtitle: 'Blog post',
        href: `/admin/content/blog-posts/${post.id}`,
        meta: { publishedAt: post.publishedAt?.toISOString() ?? null },
      })),
      ...files.map((file) => ({
        type: 'FILE',
        id: file.id,
        title: file.name,
        subtitle: file.extension.toUpperCase(),
        href: `/admin/content/files/${file.id}`,
        meta: { extension: file.extension },
      })),
    ];
  }
}

export default new AdminSearchService();
