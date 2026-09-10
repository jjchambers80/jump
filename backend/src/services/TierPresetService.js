// Tier Preset Service
// Handles CRUD for reusable ticket type presets (org-scoped)
// Presets are templates — no inventory, no sale windows

import { prisma } from '@jump/db';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

class TierPresetService {
  /**
   * Create a tier preset for an organization
   * @param {string} orgId - Organization ID
   * @param {Object} data - Preset data
   * @returns {Promise<Object>} Created preset
   */
  async createPreset(orgId, data) {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Determine next display order
    const existing = await prisma.tierPreset.findMany({
      where: { organizationId: orgId },
      select: { displayOrder: true },
    });
    const maxOrder = existing.reduce((max, p) => Math.max(max, p.displayOrder), -1);

    const preset = await prisma.tierPreset.create({
      data: {
        organizationId: orgId,
        name: data.name,
        description: data.description ?? null,
        price: data.price,
        displayOrder: maxOrder + 1,
        minPerOrder: data.minPerOrder ?? null,
        maxPerOrder: data.maxPerOrder ?? null,
        visibility: data.visibility ?? 'PUBLIC',
        isRefundable: data.isRefundable ?? false,
      },
    });

    logger.info('Tier preset created', {
      event: 'tier_preset_created',
      orgId,
      presetId: preset.id,
      presetName: preset.name,
    });

    return this._formatPreset(preset);
  }

  /**
   * Update a tier preset
   * @param {string} orgId - Organization ID
   * @param {string} presetId - Preset ID
   * @param {Object} data - Fields to update
   * @returns {Promise<Object>} Updated preset
   */
  async updatePreset(orgId, presetId, data) {
    const preset = await prisma.tierPreset.findFirst({
      where: { id: presetId, organizationId: orgId },
    });

    if (!preset) {
      throw new NotFoundError('Tier preset not found');
    }

    const updateData = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.price !== undefined) updateData.price = data.price;
    if (data.minPerOrder !== undefined) updateData.minPerOrder = data.minPerOrder;
    if (data.maxPerOrder !== undefined) updateData.maxPerOrder = data.maxPerOrder;
    if (data.visibility !== undefined) updateData.visibility = data.visibility;
    if (data.isRefundable !== undefined) updateData.isRefundable = data.isRefundable;

    const updated = await prisma.tierPreset.update({
      where: { id: presetId },
      data: updateData,
    });

    logger.info('Tier preset updated', {
      event: 'tier_preset_updated',
      presetId,
      updatedFields: Object.keys(updateData),
    });

    return this._formatPreset(updated);
  }

  /**
   * Delete a tier preset
   * @param {string} orgId - Organization ID
   * @param {string} presetId - Preset ID
   * @returns {Promise<Object>} Success indicator
   */
  async deletePreset(orgId, presetId) {
    const preset = await prisma.tierPreset.findFirst({
      where: { id: presetId, organizationId: orgId },
    });

    if (!preset) {
      throw new NotFoundError('Tier preset not found');
    }

    await prisma.tierPreset.delete({ where: { id: presetId } });

    logger.info('Tier preset deleted', {
      event: 'tier_preset_deleted',
      orgId,
      presetId,
      presetName: preset.name,
    });

    return { success: true };
  }

  /**
   * List all tier presets for an organization
   * @param {string} orgId - Organization ID
   * @returns {Promise<Object>} Presets list
   */
  async listPresets(orgId) {
    const presets = await prisma.tierPreset.findMany({
      where: { organizationId: orgId },
      orderBy: { displayOrder: 'asc' },
    });

    return { tierPresets: presets.map((p) => this._formatPreset(p)) };
  }

  /**
   * Get a single tier preset
   * @param {string} orgId - Organization ID
   * @param {string} presetId - Preset ID
   * @returns {Promise<Object>} Preset
   */
  async getPreset(orgId, presetId) {
    const preset = await prisma.tierPreset.findFirst({
      where: { id: presetId, organizationId: orgId },
    });

    if (!preset) {
      throw new NotFoundError('Tier preset not found');
    }

    return this._formatPreset(preset);
  }

  /**
   * Format preset for API response
   */
  _formatPreset(preset) {
    return {
      id: preset.id,
      organizationId: preset.organizationId,
      name: preset.name,
      description: preset.description || null,
      price: Number(preset.price),
      displayOrder: preset.displayOrder,
      minPerOrder: preset.minPerOrder,
      maxPerOrder: preset.maxPerOrder,
      visibility: preset.visibility,
      isRefundable: preset.isRefundable,
      createdAt: preset.createdAt,
      updatedAt: preset.updatedAt,
    };
  }
}

export default new TierPresetService();
