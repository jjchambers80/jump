import { jest } from '@jest/globals';

const mockContactFindMany = jest.fn();
const mockContactCount = jest.fn();
const mockContactFindFirst = jest.fn();

jest.unstable_mockModule('@jump/db', () => ({
  prisma: {
    contact: {
      findMany: mockContactFindMany,
      count: mockContactCount,
      findFirst: mockContactFindFirst,
    },
  },
}));

jest.unstable_mockModule('../../src/services/ContactOptInService.js', () => ({
  default: { marketingChangeData: jest.fn() },
}));

const { default: customerService } = await import('../../src/services/CustomerService.js');

describe('CustomerService prospect scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContactFindMany.mockResolvedValue([]);
    mockContactCount.mockResolvedValue(0);
  });

  it('defaults list queries to contacts with paid orders', async () => {
    await customerService.getCustomersByOrganization('org-1');

    const expectedWhere = {
      organizationId: 'org-1',
      orders: { some: { status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } },
    };
    expect(mockContactFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
    expect(mockContactCount).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('lists all organization contacts when scope is all', async () => {
    await customerService.getCustomersByOrganization('org-1', { scope: 'all' });

    expect(mockContactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } })
    );
    expect(mockContactCount).toHaveBeenCalledWith({ where: { organizationId: 'org-1' } });
  });

  it('returns a zero-value Prospect detail for an organization contact without paid orders', async () => {
    mockContactFindFirst.mockResolvedValue({
      id: 'contact-1',
      organizationId: 'org-1',
      firstName: 'Pat',
      lastName: 'Prospect',
      email: 'pat@example.test',
      location: null,
      note: null,
      emailSubscribed: false,
      createdAt: new Date('2026-09-20T00:00:00.000Z'),
      orders: [],
    });

    const detail = await customerService.getCustomerById('contact-1', 'org-1');

    expect(mockContactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'contact-1', organizationId: 'org-1' } })
    );
    expect(detail).toMatchObject({
      id: 'contact-1',
      segment: 'Prospect',
      transactionCount: 0,
      orderCount: 0,
      ticketOrderCount: 0,
      applicationCount: 0,
      totalSpent: 0,
      totalRefunded: 0,
      lastOrderDate: null,
      lastActivityAt: null,
      orders: [],
      applications: [],
    });
  });
});
