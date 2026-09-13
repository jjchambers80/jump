// Apple Wallet pass generation (.pkpass)
// Builds an `eventTicket` style pass for one ticket, signed with the Pass
// Type ID certificate configured in backend/src/config/wallet.js.
// The barcode carries the same jump:// payload as the web QR so the existing
// door scanner redeems wallet passes unchanged.
// Spec: https://developer.apple.com/documentation/walletpasses

import { PKPass } from 'passkit-generator';
import { appleConfig, isAppleConfigured, backendPublicUrl } from '../../config/wallet.js';
import walletTokenService from './WalletTokenService.js';
import { passImagesForOrganization } from './passImages.js';
import {
  loadPassTicket,
  passBarcodePayload,
  passExpiry,
  holderName,
  venueAddress,
  normalizeHex,
  rgbString,
  foregroundFor,
} from './passData.js';
import logger from '../../utils/logger.js';

export const PKPASS_MIME = 'application/vnd.apple.pkpass';

class AppleWalletService {
  isConfigured() {
    return isAppleConfigured();
  }

  /**
   * Build the pass.json document (without the keys passkit-generator manages
   * through its setters: barcodes, expirationDate, relevantDate, nfc).
   * Exposed for unit tests.
   */
  buildPassJson(ticket) {
    const event = ticket.event;
    const venue = event?.venue;
    const organization = venue?.organization;
    const brandHex = normalizeHex(organization?.brandColor);
    const fg = foregroundFor(brandHex);

    // iOS only talks to https web services; a localhost/http base would make
    // the pass fail to install on real devices, so leave the keys out then.
    // The web service itself (pass updates) lands in phase 2.
    const base = backendPublicUrl();
    const webService = base.startsWith('https://')
      ? { webServiceURL: `${base}/wallet/apple`, authenticationToken: walletTokenService.issue(ticket.id) }
      : {};

    return {
      formatVersion: 1,
      passTypeIdentifier: appleConfig.passTypeId,
      teamIdentifier: appleConfig.teamId,
      serialNumber: ticket.id,
      organizationName: organization?.name || 'Jump',
      description: `${event?.name || 'Event'} ticket`,
      logoText: organization?.name || 'Jump',
      backgroundColor: rgbString(brandHex),
      foregroundColor: rgbString(fg),
      labelColor: rgbString(fg),
      sharingProhibited: true,
      ...webService,
      eventTicket: {
        headerFields: [
          {
            key: 'date',
            label: 'DATE',
            value: new Date(event.date).toISOString(),
            dateStyle: 'PKDateStyleMedium',
            timeStyle: 'PKDateStyleShort',
          },
        ],
        primaryFields: [{ key: 'event', label: 'EVENT', value: event.name }],
        secondaryFields: [
          { key: 'venue', label: 'VENUE', value: venue?.name || '' },
          { key: 'tier', label: 'TICKET', value: ticket.priceTier?.name || 'General', textAlignment: 'PKTextAlignmentRight' },
        ],
        auxiliaryFields: [
          { key: 'holder', label: 'HOLDER', value: holderName(ticket.contact) },
          { key: 'number', label: 'TICKET #', value: String(ticket.ticketNumber), textAlignment: 'PKTextAlignmentRight' },
        ],
        backFields: [
          { key: 'orderRef', label: 'Order reference', value: ticket.order?.orderRef || '' },
          { key: 'barcode', label: 'Ticket code', value: ticket.barcode },
          { key: 'address', label: 'Address', value: venueAddress(venue) },
          {
            key: 'terms',
            label: 'Entry',
            value: 'Present this pass at the entrance. Each ticket admits one person and can be scanned once.',
          },
        ],
      },
    };
  }

  /**
   * Generate a signed .pkpass for a ticket.
   * @param {string|object} ticketOrId - ticket id, or a ticket already loaded via loadPassTicket
   * @returns {Promise<Buffer>}
   */
  async buildPass(ticketOrId) {
    if (!this.isConfigured()) {
      const err = new Error('Apple Wallet is not configured');
      err.code = 'WALLET_NOT_CONFIGURED';
      err.statusCode = 503;
      throw err;
    }

    const ticket = typeof ticketOrId === 'string' ? await loadPassTicket(ticketOrId) : ticketOrId;
    const organization = ticket.event?.venue?.organization;

    const files = {
      'pass.json': Buffer.from(JSON.stringify(this.buildPassJson(ticket))),
      ...(await passImagesForOrganization(organization)),
    };

    const pass = new PKPass(files, {
      wwdr: appleConfig.wwdr,
      signerCert: appleConfig.signerCert,
      signerKey: appleConfig.signerKey,
      signerKeyPassphrase: appleConfig.signerKeyPassphrase,
    });

    pass.setBarcodes({
      format: 'PKBarcodeFormatQR',
      message: passBarcodePayload(ticket),
      messageEncoding: 'iso-8859-1',
      altText: ticket.barcode,
    });
    pass.setRelevantDate(new Date(ticket.event.date));
    pass.setExpirationDate(passExpiry(ticket.event.date));

    const buffer = pass.getAsBuffer();
    logger.info('Apple Wallet pass generated', { ticketId: ticket.id, bytes: buffer.length });
    return buffer;
  }
}

export default new AppleWalletService();
