// Comprehensive unit tests for CustomerService (spec 032 phase 1).
// Covers: list queries with scope/tag/search/pagination, detail with extended
// fields and segments, partial PATCH fields and email collision.
//
// Pattern: jest.unstable_mockModule for Prisma + opt-in service.
// The service dynamically imports storefrontUrl.js inside getCustomerById;
// unstable_mockModule intercepts that at import time.

import { jest } from '@jest/globals';

// ── Prisma mocks ──────────────────────────────────────────────────────────
const mockContactFindMany = jest.fn();
const mockContactCount = jest.fn();
const mockContactFindFirst = jest.fn();
const mockContactUpdate = jest.fn();
const mockContactFindUnique = jest.fn();
const mockBuyerLoginTokenFindFirst = jest.fn();

jest.unstable_mockModule('@jump/db', () => ({
  prisma: {
    contact: {
      findMany: mockContactFindMany,
      count: mockContactCount,
      findFirst: mockContactFindFirst,
      update: mockContactUpdate,
      findUnique: mockContactFindUnique,
    },
    buyerLoginToken: {
      findFirst: mockBuyerLoginTokenFindFirst,
    },
  },
}));

// ── ContactOptInService mock ──────────────────────────────────────────────
const mockMarketingChangeData = jest.fn();
jest.unstable_mockModule('../../src/services/ContactOptInService.js', () => ({
  default: { marketingChangeData: mockMarketingChangeData },
}));

// ── storefrontUrl.js mock (dynamic import inside getCustomerById) ─────────
const mockBuyerAccountUrl = jest.fn();
jest.unstable_mockModule('../../src/utils/storefrontUrl.js', () => ({
  buyerAccountUrl: mockBuyerAccountUrl,
  buyerVerifyUrl: jest.fn(),
}));

// ── Import the service under test ─────────────────────────────────────────
const { default: customerService } = await import('../../src/services/CustomerService.js');
const { NotFoundError, ConflictError } = await import('../../src/middleware/errorHandler.js');

// ── Helpers ───────────────────────────────────────────────────────────────
const makeContact = (overrides = {}) => ({
  id: 'contact-1',
  organizationId: 'org-1',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.test',
  phone: null,
  location: 'NYC',
  note: 'First note',
  emailSubscribed: false,
  emailSubscribedAt: null,
  emailSubscribedSource: null,
  emailUnsubscribedAt: null,
  accountCreatedAt: null,
  tags: [],
  createdAt: new Date('2026-09-01'),
  orders: [],
  ...overrides,
});

const makeOrder = (overrides = {}) => ({
  id: 'order-1',
  kind: 'TICKET',
  totalAmount: '50.00',
  paidAt: new Date('2026-09-10'),
  createdAt: new Date('2026-09-10'),
  refunds: [],
  event: { id: 'event-1', name: 'Test Event', date: new Date('2026-10-01'), logoUrl: null },
  tickets: [{ id: 'ticket-1', status: 'VALID' }],
  ...overrides,
});

describe('CustomerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContactFindMany.mockResolvedValue([]);
    mockContactCount.mockResolvedValue(0);
    mockContactFindFirst.mockRejectedValue(new NotFoundError('Customer not found'));
    mockBuyerLoginTokenFindFirst.mockResolvedValue(null);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getCustomersByOrganization
  // ═══════════════════════════════════════════════════════════════════════
  describe('getCustomersByOrganization', () => {
    it('defaults list queries to contacts with paid orders', async () => {
      const result = await customerService.getCustomersByOrganization('org-1');

      expect(mockContactFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            orders: { some: { status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } },
          },
        })
      );
      expect(mockContactCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            orders: { some: { status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } },
          },
        })
      );
      expect(result).toEqual({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    });

    it('lists all contacts when scope is all', async () => {
      await customerService.getCustomersByOrganization('org-1', { scope: 'all' });

      expect(mockContactFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1' } })
      );
      expect(mockContactCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1' } })
      );
    });

    it('passes tag filter to the query', async () => {
      await customerService.getCustomersByOrganization('org-1', { tag: 'VIP' });

      expect(mockContactFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tags: { has: 'VIP' },
          }),
        })
      );
    });

    it('passes search to the query with OR across fields', async () => {
      await customerService.getCustomersByOrganization('org-1', { search: 'Jane' });

      const where = mockContactFindMany.mock.calls[0][0].where;
      const searchClause = where.AND[0].OR;
      expect(searchClause).toBeInstanceOf(Array);
      expect(searchClause.some((c) => c.email?.contains === 'jane')).toBe(true);
      expect(searchClause.some((c) => c.firstName?.contains === 'Jane')).toBe(true);
      expect(searchClause.some((c) => c.lastName?.contains === 'Jane')).toBe(true);
    });

    it('accepts null organizationId (SYSTEM_ADMIN unscoped)', async () => {
      await customerService.getCustomersByOrganization(null);

      expect(mockContactFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ organizationId: 'org-1' }),
        })
      );
    });

    it('respects custom page and limit', async () => {
      await customerService.getCustomersByOrganization('org-1', { page: 2, limit: 5 });

      expect(mockContactFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 })
      );
      const pagination = (await customerService.getCustomersByOrganization('org-1', { page: 2, limit: 5 })).pagination;
      expect(pagination.page).toBe(2);
      expect(pagination.limit).toBe(5);
    });

    it('maps orders to aggregates in the response', async () => {
      mockContactFindMany.mockResolvedValue([
        makeContact({
          orders: [
            makeOrder({ kind: 'TICKET', totalAmount: '50.00' }),
            makeOrder({ kind: 'TICKET', totalAmount: '30.00' }),
          ],
        }),
      ]);
      mockContactCount.mockResolvedValue(1);

      const result = await customerService.getCustomersByOrganization('org-1');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].transactionCount).toBe(2);
      expect(result.data[0].totalSpent).toBe(80);
      expect(result.data[0].orderCount).toBe(2);
    });

    it('includes tags in the list response', async () => {
      mockContactFindMany.mockResolvedValue([
        makeContact({ tags: ['VIP', 'Press'], orders: [makeOrder()] }),
      ]);
      mockContactCount.mockResolvedValue(1);

      const result = await customerService.getCustomersByOrganization('org-1');
      expect(result.data[0].tags).toEqual(['VIP', 'Press']);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getCustomerById
  // ═══════════════════════════════════════════════════════════════════════
  describe('getCustomerById', () => {
    it('returns contact with extended fields for an account holder', async () => {
      const contact = makeContact({
        phone: '+14155551234',
        tags: ['VIP'],
        accountCreatedAt: new Date('2026-08-15'),
        emailSubscribed: true,
        emailSubscribedAt: new Date('2026-09-01'),
        emailSubscribedSource: 'CHECKOUT',
        emailUnsubscribedAt: null,
        orders: [makeOrder({ paidAt: new Date('2026-09-10') })],
      });
      mockContactFindFirst.mockResolvedValue(contact);
      mockBuyerLoginTokenFindFirst.mockResolvedValue({
        usedAt: new Date('2026-09-12'),
      });
      mockBuyerAccountUrl.mockResolvedValue('http://example.test/account/login');

      const result = await customerService.getCustomerById('contact-1', 'org-1');

      expect(result.phone).toBe('+14155551234');
      expect(result.tags).toEqual(['VIP']);
      expect(result.accountCreatedAt).toEqual(contact.accountCreatedAt);
      expect(result.lastSignInAt).toEqual(new Date('2026-09-12'));
      expect(result.accountUrl).toBe('http://example.test/account/login');
      expect(result.emailSubscribed).toBe(true);
      expect(result.emailSubscribedAt).toEqual(contact.emailSubscribedAt);
      expect(result.emailSubscribedSource).toBe('CHECKOUT');
      expect(result.emailUnsubscribedAt).toBeNull();
      expect(mockBuyerAccountUrl).toHaveBeenCalledWith('org-1');
    });

    it('returns null lastSignInAt when no buyer tokens exist', async () => {
      const contact = makeContact({
        accountCreatedAt: new Date('2026-08-15'),
        orders: [makeOrder()],
      });
      mockContactFindFirst.mockResolvedValue(contact);
      mockBuyerLoginTokenFindFirst.mockResolvedValue(null);
      mockBuyerAccountUrl.mockResolvedValue('http://example.test/account/login');

      const result = await customerService.getCustomerById('contact-1', 'org-1');
      expect(result.lastSignInAt).toBeNull();
    });

    it('returns null accountUrl for guest contacts (no account)', async () => {
      const contact = makeContact({ accountCreatedAt: null, orders: [makeOrder()] });
      mockContactFindFirst.mockResolvedValue(contact);

      const result = await customerService.getCustomerById('contact-1', 'org-1');
      expect(result.accountUrl).toBeNull();
      expect(mockBuyerAccountUrl).not.toHaveBeenCalled();
    });

    it('detects Prospect segment when contact has no paid orders', async () => {
      const contact = makeContact({ orders: [] });
      mockContactFindFirst.mockResolvedValue(contact);

      const result = await customerService.getCustomerById('contact-1', 'org-1');
      expect(result.segment).toBe('Prospect');
    });

    it('detects New segment for a single paid order', async () => {
      const contact = makeContact({ orders: [makeOrder()] });
      mockContactFindFirst.mockResolvedValue(contact);

      const result = await customerService.getCustomerById('contact-1', 'org-1');
      expect(result.segment).toBe('New');
    });

    it('detects Repeat segment for two or more paid orders', async () => {
      const contact = makeContact({ orders: [makeOrder({ id: 'o-1' }), makeOrder({ id: 'o-2' })] });
      mockContactFindFirst.mockResolvedValue(contact);

      const result = await customerService.getCustomerById('contact-1', 'org-1');
      expect(result.segment).toBe('Repeat');
    });

    it('throws NotFoundError when contact does not exist', async () => {
      mockContactFindFirst.mockRejectedValue(new NotFoundError('Customer not found'));
      await expect(customerService.getCustomerById('missing-id', 'org-1')).rejects.toThrow(NotFoundError);
    });

    it('scopes the query to organizationId when provided', async () => {
      const contact = makeContact({ orders: [makeOrder()] });
      mockContactFindFirst.mockResolvedValue(contact);

      await customerService.getCustomerById('contact-1', 'org-1');
      expect(mockContactFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'contact-1', organizationId: 'org-1' },
        })
      );
    });

    it('accepts null organizationId (SYSTEM_ADMIN unscoped)', async () => {
      const contact = makeContact({ orders: [makeOrder()] });
      mockContactFindFirst.mockResolvedValue(contact);

      await customerService.getCustomerById('contact-1', null);
      const call = mockContactFindFirst.mock.calls[0][0];
      expect(call.where.id).toBe('contact-1');
      expect(call.where).not.toHaveProperty('organizationId');
    });

    it('includes order and application aggregates in the response', async () => {
      const contact = makeContact({
        orders: [
          makeOrder({ kind: 'TICKET', totalAmount: '50.00' }),
          makeOrder({ kind: 'APPLICATION', totalAmount: '100.00' }),
        ],
      });
      mockContactFindFirst.mockResolvedValue(contact);

      const result = await customerService.getCustomerById('contact-1', 'org-1');
      expect(result.transactionCount).toBe(2);
      expect(result.ticketOrderCount).toBe(1);
      expect(result.applicationCount).toBe(1);
      expect(result.totalSpent).toBe(150);
    });

    it('handles buyerLoginToken query failure gracefully', async () => {
      const contact = makeContact({
        accountCreatedAt: new Date('2026-08-15'),
        orders: [makeOrder()],
      });
      mockContactFindFirst.mockResolvedValue(contact);
      mockBuyerLoginTokenFindFirst.mockRejectedValue(new Error('Table not available'));
      mockBuyerAccountUrl.mockResolvedValue('http://example.test/account/login');

      const result = await customerService.getCustomerById('contact-1', 'org-1');
      expect(result.lastSignInAt).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // updateCustomer
  // ═══════════════════════════════════════════════════════════════════════
  describe('updateCustomer', () => {
    const existingContact = makeContact();

    beforeEach(() => {
      mockContactFindFirst.mockResolvedValue(existingContact);
      mockContactUpdate.mockResolvedValue(existingContact);
    });

    it('updates firstName and lastName', async () => {
      mockContactUpdate.mockResolvedValue({ ...existingContact, firstName: 'Updated', lastName: 'Name' });

      const result = await customerService.updateCustomer('contact-1', 'org-1', {
        firstName: 'Updated',
        lastName: 'Name',
      });

      expect(mockContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'contact-1' },
          data: { firstName: 'Updated', lastName: 'Name' },
        })
      );
    });

    it('updates phone', async () => {
      mockContactUpdate.mockResolvedValue({ ...existingContact, phone: '+12125551234' });

      await customerService.updateCustomer('contact-1', 'org-1', { phone: '+12125551234' });

      expect(mockContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { phone: '+12125551234' },
        })
      );
    });

    it('clears phone with null', async () => {
      mockContactUpdate.mockResolvedValue({ ...existingContact, phone: null });

      await customerService.updateCustomer('contact-1', 'org-1', { phone: null });

      expect(mockContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { phone: null },
        })
      );
    });

    it('updates tags', async () => {
      mockContactUpdate.mockResolvedValue({ ...existingContact, tags: ['VIP', 'Press'] });

      await customerService.updateCustomer('contact-1', 'org-1', { tags: ['VIP', 'Press'] });

      expect(mockContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { tags: ['VIP', 'Press'] },
        })
      );
    });

    it('updates location and note', async () => {
      const updates = { location: 'Brooklyn, NY', note: 'New note text' };
      mockContactUpdate.mockResolvedValue({ ...existingContact, ...updates });

      await customerService.updateCustomer('contact-1', 'org-1', updates);

      expect(mockContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: updates,
        })
      );
    });

    it('delegates emailSubscribed changes to ContactOptInService.marketingChangeData', async () => {
      mockMarketingChangeData.mockReturnValue({
        emailSubscribed: true,
        emailSubscribedAt: new Date(),
        emailSubscribedSource: 'ADMIN',
        emailUnsubscribedAt: null,
      });
      mockContactUpdate.mockResolvedValue({ ...existingContact, emailSubscribed: true });

      await customerService.updateCustomer('contact-1', 'org-1', { emailSubscribed: true });

      expect(mockMarketingChangeData).toHaveBeenCalledWith(
        expect.objectContaining({ emailSubscribed: false }),
        true
      );
      expect(mockContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            emailSubscribed: true,
            emailSubscribedSource: 'ADMIN',
          }),
        })
      );
    });

    it('updates email when unique in the organization', async () => {
      mockContactFindUnique.mockResolvedValue(null); // no collision
      mockContactUpdate.mockResolvedValue({ ...existingContact, email: 'new@example.test' });

      await customerService.updateCustomer('contact-1', 'org-1', { email: 'new@example.test' });

      expect(mockContactFindUnique).toHaveBeenCalledWith({
        where: { organizationId_email: { organizationId: 'org-1', email: 'new@example.test' } },
        select: { id: true },
      });
      expect(mockContactUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { email: 'new@example.test' },
        })
      );
    });

    it('throws ConflictError with EMAIL_TAKEN when email collides with another contact', async () => {
      mockContactFindUnique.mockResolvedValue({ id: 'other-contact-id' });

      await expect(
        customerService.updateCustomer('contact-1', 'org-1', { email: 'taken@example.test' })
      ).rejects.toThrow(ConflictError);
      await expect(
        customerService.updateCustomer('contact-1', 'org-1', { email: 'taken@example.test' })
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('allows email change to the same email (no unnecessary write)', async () => {
      // The contact already has email 'jane@example.test', so the service skips
      // the email write (data stays empty) since it's not changing.
      await customerService.updateCustomer('contact-1', 'org-1', { email: 'jane@example.test' });

      expect(mockContactFindUnique).not.toHaveBeenCalled();
      const updateData = mockContactUpdate.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('email');
    });

    it('throws NotFoundError when contact does not exist', async () => {
      mockContactFindFirst.mockRejectedValue(new NotFoundError('Customer not found'));

      await expect(
        customerService.updateCustomer('missing-id', 'org-1', { firstName: 'X' })
      ).rejects.toThrow(NotFoundError);
    });
  });
});