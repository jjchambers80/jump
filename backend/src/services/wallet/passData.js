// Shared data loading + presentation helpers for wallet passes.
// Both AppleWalletService and GoogleWalletService project the same Ticket
// graph (event → venue → organization, price tier, contact, order) into
// their provider-specific formats.

import { prisma } from '@jump/db';
import qrService from '../QRService.js';
import { NotFoundError } from '../../middleware/errorHandler.js';

/**
 * Load everything a pass needs for one ticket.
 * @param {string} ticketId
 */
export async function loadPassTicket(ticketId) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      event: {
        include: {
          venue: {
            include: {
              organization: {
                select: { id: true, name: true, logoUrl: true, logoImageId: true, brandColor: true },
              },
            },
          },
        },
      },
      priceTier: { select: { name: true } },
      contact: { select: { firstName: true, lastName: true, email: true } },
      order: { select: { id: true, orderRef: true } },
    },
  });
  if (!ticket) throw new NotFoundError('Ticket not found');
  return ticket;
}

/**
 * The scannable payload embedded in the pass barcode — identical to the QR
 * shown on the web so the door scanner needs no changes.
 */
export function passBarcodePayload(ticket) {
  if (ticket.qrCodeJwt && qrService.isJumpPayload(ticket.qrCodeJwt)) return ticket.qrCodeJwt;
  return qrService.generateQRPayload(ticket.id, ticket.eventId, ticket.barcode);
}

/** Passes stop being relevant 24h after the event starts. */
export function passExpiry(eventDate) {
  const d = new Date(eventDate);
  d.setHours(d.getHours() + 24);
  return d;
}

export function holderName(contact) {
  return `${contact?.firstName ?? ''} ${contact?.lastName ?? ''}`.trim() || contact?.email || '';
}

export function venueAddress(venue) {
  if (!venue) return '';
  return [venue.address, venue.city, venue.state, venue.postalCode].filter(Boolean).join(', ');
}

// ─── Colour helpers ───

const DEFAULT_BRAND = '#2563eb';

export function normalizeHex(input) {
  if (!input) return DEFAULT_BRAND;
  let h = String(input).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return DEFAULT_BRAND;
  return `#${h.toLowerCase()}`;
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function rgbString(hex) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

function relativeLuminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** White or near-black text depending on brand colour brightness. */
export function foregroundFor(hex) {
  return relativeLuminance(hexToRgb(hex)) > 0.4 ? '#111827' : '#ffffff';
}
