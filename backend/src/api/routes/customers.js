// Customer Routes
// POST /customers/:customerId/delete-data - GDPR data deletion (FR-027, FR-028)

import express from 'express';
import { prisma } from '@jump/db';
import { requireAuth } from '../../middleware/auth.js';
import { ForbiddenError, NotFoundError } from '../../middleware/errorHandler.js';
import logger from '../../utils/logger.js';
const router = express.Router();

// Require authentication for all customer routes
router.use(requireAuth);

/**
 * POST /customers/:customerId/delete-data
 * GDPR data deletion - Anonymize customer PII while preserving financial records
 * Per FR-027 (right to erasure) and FR-028 (financial record retention)
 */
router.post('/:customerId/delete-data', async (req, res, next) => {
  try {
    const { customerId } = req.params;

    // Only the customer themselves can request deletion
    if (req.user.id !== customerId || req.user.type !== 'customer') {
      throw new ForbiddenError('You can only request deletion of your own data');
    }

    // Verify customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundError('Customer not found');
    }

    // Perform anonymization in a transaction
    await prisma.$transaction(async (tx) => {
      // 1. Anonymize customer PII (preserve record for financial audit)
      const anonymizedEmail = `deleted-${customerId.slice(0, 8)}@anonymized.local`;
      await tx.customer.update({
        where: { id: customerId },
        data: {
          email: anonymizedEmail,
          name: 'Deleted User',
          passwordHash: '', // Clear password hash
        },
      });

      // 2. Delete all active sessions
      await tx.session.deleteMany({
        where: { customerId },
      });

      // 3. Anonymize QR code data on tickets (remove JWT which contains PII)
      // Preserve ticket records for financial auditing
      await tx.ticket.updateMany({
        where: { customerId },
        data: {
          qrCodeJwt: '', // Remove QR code with PII
        },
      });

      // Note: PaymentTransaction records are preserved for financial compliance
      // They link to the anonymized customer record
    });

    logger.info('Customer data deleted (GDPR)', {
      event: 'gdpr_data_deletion',
      customerId,
      anonymized: true,
    });

    res.json({
      message:
        'Your personal data has been anonymized. Financial records have been preserved as required by law.',
      customerId,
      deletedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
