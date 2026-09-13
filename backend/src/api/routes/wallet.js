// Wallet pass routes
// GET /wallet/apple/:ticketId.pkpass?t=<token>  → signed Apple Wallet pass
// GET /wallet/google/:ticketId?t=<token>        → 302 to Google Wallet save URL
//
// Access: a per-ticket wallet token (from the order/ticket API or the
// confirmation email — works for guest checkout without signing in), or a
// signed-in user who owns the ticket / is an admin. Only VALID tickets are
// served; refunded or redeemed tickets answer 410.

import express from 'express';
import rateLimit from 'express-rate-limit';
import { optionalAuth } from '../../middleware/auth.js';
import walletTokenService from '../../services/wallet/WalletTokenService.js';
import appleWalletService, { PKPASS_MIME } from '../../services/wallet/AppleWalletService.js';
import googleWalletService from '../../services/wallet/GoogleWalletService.js';
import { loadPassTicket } from '../../services/wallet/passData.js';
import logger from '../../utils/logger.js';

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'RateLimited', message: 'Too many wallet requests, try again later' },
});

/**
 * Resolve + authorise the ticket for a wallet request.
 * Sends the error response itself and returns null when access is denied.
 */
async function authorizeTicket(req, res) {
  const { ticketId } = req.params;
  const token = typeof req.query.t === 'string' ? req.query.t : null;
  const ticket = await loadPassTicket(ticketId);

  const tokenOk = token ? walletTokenService.verify(ticketId, token) : false;
  const userOk =
    req.user &&
    (['ADMIN', 'SYSTEM_ADMIN'].includes(req.user.role) ||
      (ticket.contact?.email && ticket.contact.email.toLowerCase() === req.user.email?.toLowerCase()));

  if (!tokenOk && !userOk) {
    res.status(403).json({ error: 'ForbiddenError', message: 'Invalid wallet link' });
    return null;
  }

  if (ticket.status !== 'VALID') {
    res.status(410).json({
      error: 'TicketUnavailable',
      status: ticket.status,
      message: 'This ticket is no longer valid and cannot be added to a wallet',
    });
    return null;
  }

  return ticket;
}

function notConfigured(res, provider) {
  return res.status(503).json({
    error: 'WalletNotConfigured',
    message: `${provider} Wallet is not enabled on this server`,
  });
}

router.get('/apple/:ticketId.pkpass', limiter, optionalAuth, async (req, res, next) => {
  try {
    if (!appleWalletService.isConfigured()) return notConfigured(res, 'Apple');
    const ticket = await authorizeTicket(req, res);
    if (!ticket) return;

    const buffer = await appleWalletService.buildPass(ticket);
    res.setHeader('Content-Type', PKPASS_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="ticket-${ticket.barcode}.pkpass"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Last-Modified', new Date(ticket.passUpdatedAt || ticket.updatedAt).toUTCString());
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

router.get('/google/:ticketId', limiter, optionalAuth, async (req, res, next) => {
  try {
    if (!googleWalletService.isConfigured()) return notConfigured(res, 'Google');
    const ticket = await authorizeTicket(req, res);
    if (!ticket) return;

    const url = await googleWalletService.saveUrl(ticket);
    logger.info('Google Wallet save link issued', { ticketId: ticket.id });
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(302, url);
  } catch (error) {
    next(error);
  }
});

export default router;
