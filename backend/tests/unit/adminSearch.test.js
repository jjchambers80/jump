import { jest } from '@jest/globals';

const delegates = {
  event: { findMany: jest.fn() },
  venue: { findMany: jest.fn() },
  contact: { findMany: jest.fn() },
  order: { findMany: jest.fn() },
  ticket: { findMany: jest.fn() },
  application: { findMany: jest.fn() },
  page: { findMany: jest.fn() },
  blogPost: { findMany: jest.fn() },
  storeFile: { findMany: jest.fn() },
};

jest.unstable_mockModule('@jump/db', () => ({ prisma: delegates }));

const { default: adminSearchService } = await import('../../src/services/AdminSearchService.js');

describe('AdminSearchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delegates.event.findMany.mockResolvedValue([
      {
        id: 'event-1',
        name: 'Needle Festival',
        date: new Date('2027-06-21T18:00:00.000Z'),
        status: 'PUBLISHED',
        venue: { name: 'Needle Hall', organizationId: 'org-1' },
      },
    ]);
    delegates.venue.findMany.mockResolvedValue([
      { id: 'venue-1', name: 'Needle Hall', address: '1 Main Street', city: null, state: null },
    ]);
    delegates.contact.findMany.mockResolvedValue([
      { id: 'contact-1', firstName: 'Needle', lastName: 'Buyer', email: 'needle@example.test' },
    ]);
    delegates.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        orderRef: 'NEEDLE-001',
        kind: 'TICKET',
        status: 'COMPLETED',
        contact: { firstName: 'Needle', lastName: 'Buyer', email: 'needle@example.test' },
        event: { name: 'Needle Festival' },
        application: null,
      },
    ]);
    delegates.ticket.findMany.mockResolvedValue([
      {
        id: 'ticket-1',
        barcode: 'JUMP-NEEDLE-001',
        status: 'VALID',
        eventId: 'event-1',
        event: { name: 'Needle Festival' },
        contact: { firstName: 'Needle', lastName: 'Buyer', email: 'needle@example.test' },
        order: {
          orderRef: 'NEEDLE-001',
          contact: { firstName: 'Needle', lastName: 'Buyer', email: 'needle@example.test' },
        },
      },
    ]);
    delegates.application.findMany.mockResolvedValue([
      {
        id: 'application-1',
        eventId: 'event-1',
        status: 'SUBMITTED',
        contact: { firstName: 'Needle', lastName: 'Buyer', email: 'needle@example.test' },
        profile: { businessName: 'Needle Studio' },
        event: { name: 'Needle Festival' },
      },
    ]);
    delegates.page.findMany.mockResolvedValue([{ id: 'page-1', title: 'Needle FAQ' }]);
    delegates.blogPost.findMany.mockResolvedValue([
      { id: 'post-1', title: 'Needle announcement', publishedAt: null },
    ]);
    delegates.storeFile.findMany.mockResolvedValue([
      { id: 'file-1', name: 'Needle guide', extension: 'pdf' },
    ]);
  });

  it('runs nine scoped, capped database queries and returns fixed-order rows', async () => {
    const result = await adminSearchService.search({ organizationId: 'org-1' }, 'Needle');

    expect(result.map((row) => row.type)).toEqual([
      'EVENT',
      'VENUE',
      'CUSTOMER',
      'ORDER',
      'TICKET',
      'APPLICATION',
      'PAGE',
      'BLOG_POST',
      'FILE',
    ]);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'EVENT',
          id: 'event-1',
          href: '/admin/events/event-1/edit?orgId=org-1',
          meta: { date: '2027-06-21T18:00:00.000Z', status: 'PUBLISHED' },
        }),
        expect.objectContaining({
          type: 'APPLICATION',
          href: '/admin/events/event-1/applications/application-1',
          meta: { eventId: 'event-1', status: 'SUBMITTED' },
        }),
        expect.objectContaining({
          type: 'TICKET',
          href: '/admin/orders?view=tickets&search=Needle',
        }),
        expect.objectContaining({
          type: 'PAGE',
          href: '/admin/online-store/pages/page-1',
        }),
      ])
    );
    expect(delegates.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ venue: { organizationId: 'org-1' } }),
        take: 5,
      })
    );
    expect(delegates.venue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1' }),
        take: 3,
      })
    );
    expect(delegates.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1', status: { not: 'DRAFT' } }),
        take: 5,
      })
    );
    expect(delegates.storeFile.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
  });

  it('uses unscoped predicates for a SYSTEM_ADMIN search', async () => {
    await adminSearchService.search({ organizationId: null }, 'Needle');

    expect(delegates.event.findMany.mock.calls[0][0].where).not.toHaveProperty('venue');
    expect(delegates.contact.findMany.mock.calls[0][0].where).not.toHaveProperty('organizationId');
    expect(delegates.page.findMany.mock.calls[0][0].where).not.toHaveProperty('organizationId');
  });

  it('matches Stripe identifiers by equality instead of contains', async () => {
    await adminSearchService.search({ organizationId: 'org-1' }, 'pi_exact');

    const where = delegates.order.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { payment: { stripePaymentIntentId: 'pi_exact' } },
      { refunds: { some: { stripeRefundId: 'pi_exact' } } },
      { stripeSessionId: 'pi_exact' },
      { application: { stripeCheckoutSessionId: 'pi_exact' } },
    ]);
  });

  it('propagates database errors to the route error handler', async () => {
    delegates.event.findMany.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      adminSearchService.search({ organizationId: 'org-1' }, 'Needle')
    ).rejects.toThrow('database unavailable');
  });
});
