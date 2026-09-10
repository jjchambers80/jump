// Customer Service
// Aggregated customer view: contacts who have placed orders, scoped by organization

import { prisma } from '@jump/db';
import { NotFoundError } from '../middleware/errorHandler.js';

class CustomerService {
  /**
   * List customers (contacts with completed orders) for an organization.
   *
   * @param {string|null} organizationId - null for system admins (unscoped)
   * @param {Object} options - { page, limit, search }
   * @returns {Promise<{ data: Customer[], pagination }>}
   */
  async getCustomersByOrganization(organizationId, { page = 1, limit = 20, search } = {}) {
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 20;

    const orgFilter = organizationId
      ? { some: { status: 'COMPLETED', event: { venue: { organizationId } } } }
      : { some: { status: 'COMPLETED' } };

    const where = {
      orders: orgFilter,
      ...(search && {
        OR: [
          { email: { contains: search.toLowerCase(), mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: {
          orders: {
            where: {
              status: 'COMPLETED',
              ...(organizationId && { event: { venue: { organizationId } } }),
            },
            select: {
              id: true,
              totalAmount: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.contact.count({ where }),
    ]);

    const data = contacts.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      location: c.location,
      note: c.note,
      emailSubscribed: c.emailSubscribed,
      orderCount: c.orders.length,
      totalSpent: c.orders.reduce((sum, o) => sum + parseFloat(o.totalAmount || 0), 0),
      lastOrderDate: c.orders.length
        ? c.orders.reduce((latest, o) => (o.createdAt > latest ? o.createdAt : latest), c.orders[0].createdAt)
        : null,
      createdAt: c.createdAt,
    }));

    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Get a single customer with their order history, scoped by organization.
   *
   * @param {string} contactId
   * @param {string|null} organizationId
   * @returns {Promise<Object>}
   */
  async getCustomerById(contactId, organizationId) {
    const orgFilter = organizationId
      ? { status: 'COMPLETED', event: { venue: { organizationId } } }
      : { status: 'COMPLETED' };

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: {
        orders: {
          where: orgFilter,
          include: {
            event: {
              select: { id: true, name: true, date: true, logoUrl: true },
            },
            tickets: {
              select: { id: true, status: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!contact) {
      throw new NotFoundError('Customer not found');
    }

    // Verify customer has at least one completed order in this org
    if (contact.orders.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    const orders = contact.orders.map((o) => ({
      id: o.id,
      orderRef: o.orderRef,
      totalAmount: parseFloat(o.totalAmount || 0),
      quantity: o.quantity,
      status: o.status,
      createdAt: o.createdAt,
      ticketCount: o.tickets.length,
      event: o.event,
    }));

    return {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      location: contact.location,
      note: contact.note,
      emailSubscribed: contact.emailSubscribed,
      createdAt: contact.createdAt,
      orderCount: orders.length,
      totalSpent: orders.reduce((sum, o) => sum + o.totalAmount, 0),
      lastOrderDate: orders.length ? orders[0].createdAt : null,
      orders,
    };
  }

  /**
   * Update editable customer fields (note, location, emailSubscribed).
   *
   * @param {string} contactId
   * @param {Object} updates - { note?, location?, emailSubscribed? }
   * @returns {Promise<Contact>}
   */
  async updateCustomer(contactId, organizationId, updates) {
    // Verify contact belongs to this org via completed orders
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        orders: {
          some: {
            status: 'COMPLETED',
            event: { venue: { organizationId } },
          },
        },
      },
    });
    if (!contact) {
      throw new NotFoundError('Customer not found');
    }

    const allowed = {};
    if (updates.note !== undefined) allowed.note = updates.note;
    if (updates.location !== undefined) allowed.location = updates.location;
    if (updates.emailSubscribed !== undefined) allowed.emailSubscribed = Boolean(updates.emailSubscribed);

    return prisma.contact.update({
      where: { id: contactId },
      data: allowed,
    });
  }
}

export default new CustomerService();
