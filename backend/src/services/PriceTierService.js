// Price Tier Service
// Handles CRUD, capacity validation, activation, and reordering for price tiers
// Per FR-014, FR-015, FR-016, FR-017

import { prisma } from '@jump/db';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

class PriceTierService {
  /**
   * Create a price tier for an event
   * Validates that total tier inventory does not exceed event capacity
   * @param {string} orgId - Organization ID (for authorization)
   * @param {string} eventId - Event ID
   * @param {Object} data - Tier data
   * @returns {Promise<Object>} Created price tier
   */
  async createPriceTier(orgId, eventId, data) {
    // Find event and verify org ownership
    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        venue: { organizationId: orgId },
      },
      include: { priceTiers: true },
    });

    if (!event) {
      throw new NotFoundError('Event not found');
    }

    const quantityTotal = parseInt(data.quantityTotal);
    if (isNaN(quantityTotal) || quantityTotal < 1) {
      throw new ValidationError('quantityTotal must be a positive integer');
    }

    // Capacity validation: sum of all tier quantities must not exceed event capacity
    const existingTotal = event.priceTiers.reduce((sum, t) => sum + t.quantityTotal, 0);
    if (existingTotal + quantityTotal > event.capacity) {
      throw new ValidationError(
        `Total tier inventory (${existingTotal + quantityTotal}) would exceed event capacity (${event.capacity})`
      );
    }

    // Determine next display order
    const maxOrder = event.priceTiers.reduce((max, t) => Math.max(max, t.displayOrder), -1);

    const tier = await prisma.priceTier.create({
      data: {
        eventId,
        name: data.name,
        price: data.price,
        quantityTotal,
        displayOrder: data.displayOrder ?? maxOrder + 1,
        minPerOrder: data.minPerOrder ?? null,
        maxPerOrder: data.maxPerOrder ?? null,
        isActive: true,
      },
    });

    logger.info('Price tier created', {
      event: 'price_tier_created',
      eventId,
      tierId: tier.id,
      tierName: tier.name,
    });

    return this._formatTier(tier);
  }

  /**
   * Update a price tier
   * @param {string} orgId - Organization ID
   * @param {string} eventId - Event ID
   * @param {string} tierId - Price tier ID
   * @param {Object} data - Fields to update
   * @returns {Promise<Object>} Updated price tier
   */
  async updatePriceTier(orgId, eventId, tierId, data) {
    // Verify tier belongs to event and event belongs to org
    const tier = await prisma.priceTier.findFirst({
      where: {
        id: tierId,
        eventId,
        event: { venue: { organizationId: orgId } },
      },
    });

    if (!tier) {
      throw new NotFoundError('Price tier not found');
    }

    const updateData = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.price !== undefined) {
      if (Number(data.price) < 0) {
        throw new ValidationError('Price must be 0 or greater');
      }
      updateData.price = data.price;
    }

    if (data.quantityTotal !== undefined) {
      const newQuantity = parseInt(data.quantityTotal);
      if (isNaN(newQuantity) || newQuantity < 1) {
        throw new ValidationError('quantityTotal must be a positive integer');
      }

      // Verify capacity constraint with new quantity
      const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: { priceTiers: true },
      });

      const otherTiersTotal = event.priceTiers
        .filter((t) => t.id !== tierId)
        .reduce((sum, t) => sum + t.quantityTotal, 0);

      if (otherTiersTotal + newQuantity > event.capacity) {
        throw new ValidationError(
          `Total tier inventory (${otherTiersTotal + newQuantity}) would exceed event capacity (${event.capacity})`
        );
      }

      // Can't reduce below sold + reserved
      if (newQuantity < tier.quantitySold + tier.quantityReserved) {
        throw new ValidationError(
          `Cannot reduce quantity below sold + reserved (${tier.quantitySold + tier.quantityReserved})`
        );
      }

      updateData.quantityTotal = newQuantity;
    }

    if (data.displayOrder !== undefined) updateData.displayOrder = parseInt(data.displayOrder);
    if (data.minPerOrder !== undefined) updateData.minPerOrder = data.minPerOrder;
    if (data.maxPerOrder !== undefined) updateData.maxPerOrder = data.maxPerOrder;

    const updated = await prisma.priceTier.update({
      where: { id: tierId },
      data: updateData,
    });

    logger.info('Price tier updated', {
      event: 'price_tier_updated',
      tierId,
      updatedFields: Object.keys(updateData),
    });

    return this._formatTier(updated);
  }

  /**
   * Activate a price tier
   */
  async activatePriceTier(orgId, eventId, tierId) {
    const tier = await prisma.priceTier.findFirst({
      where: {
        id: tierId,
        eventId,
        event: { venue: { organizationId: orgId } },
      },
    });

    if (!tier) {
      throw new NotFoundError('Price tier not found');
    }

    const updated = await prisma.priceTier.update({
      where: { id: tierId },
      data: { isActive: true },
    });

    return this._formatTier(updated);
  }

  /**
   * Deactivate a price tier
   */
  async deactivatePriceTier(orgId, eventId, tierId) {
    const tier = await prisma.priceTier.findFirst({
      where: {
        id: tierId,
        eventId,
        event: { venue: { organizationId: orgId } },
      },
    });

    if (!tier) {
      throw new NotFoundError('Price tier not found');
    }

    const updated = await prisma.priceTier.update({
      where: { id: tierId },
      data: { isActive: false },
    });

    return this._formatTier(updated);
  }

  /**
   * Reorder price tiers for an event
   * @param {string} orgId - Organization ID
   * @param {string} eventId - Event ID
   * @param {string[]} tierIds - Ordered list of tier IDs
   * @returns {Promise<Object>} Reordered tiers
   */
  async reorderPriceTiers(orgId, eventId, tierIds) {
    // Verify event belongs to org
    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        venue: { organizationId: orgId },
      },
      include: { priceTiers: true },
    });

    if (!event) {
      throw new NotFoundError('Event not found');
    }

    // Update display orders in a transaction
    await prisma.$transaction(
      tierIds.map((id, index) =>
        prisma.priceTier.update({
          where: { id },
          data: { displayOrder: index },
        })
      )
    );

    // Fetch updated tiers
    const tiers = await prisma.priceTier.findMany({
      where: { eventId },
      orderBy: { displayOrder: 'asc' },
    });

    return { priceTiers: tiers.map((t) => this._formatTier(t)) };
  }

  /**
   * List price tiers for an event (public)
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Price tiers list
   */
  async listPriceTiers(eventId) {
    const tiers = await prisma.priceTier.findMany({
      where: { eventId },
      orderBy: { displayOrder: 'asc' },
    });

    return { priceTiers: tiers.map((t) => this._formatTier(t)) };
  }

  /**
   * Format tier for API response
   */
  _formatTier(tier) {
    return {
      id: tier.id,
      eventId: tier.eventId,
      name: tier.name,
      price: Number(tier.price),
      quantityTotal: tier.quantityTotal,
      quantitySold: tier.quantitySold,
      quantityReserved: tier.quantityReserved,
      quantityAvailable: tier.quantityTotal - tier.quantitySold - tier.quantityReserved,
      displayOrder: tier.displayOrder,
      minPerOrder: tier.minPerOrder,
      maxPerOrder: tier.maxPerOrder,
      isActive: tier.isActive,
      createdAt: tier.createdAt,
      updatedAt: tier.updatedAt,
    };
  }
}

export default new PriceTierService();
