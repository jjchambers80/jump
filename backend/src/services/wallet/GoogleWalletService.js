// Google Wallet pass issuance
// One EventTicketClass per event and one EventTicketObject per ticket are
// created through the Wallet REST API; the "Add to Google Wallet" link is a
// short ("skinny") JWT that references the object id, which keeps the URL
// well under Google's 1800-character limit. When the REST API cannot be
// reached the service falls back to a fat JWT that embeds class + object.
// Docs: https://developers.google.com/wallet/tickets/events

import jwt from 'jsonwebtoken';
import { JWT as GoogleJWT } from 'google-auth-library';
import { prisma } from '@jump/db';
import { googleConfig, isGoogleConfigured, backendPublicUrl } from '../../config/wallet.js';
import { loadPassTicket, passBarcodePayload, passExpiry, holderName, venueAddress, normalizeHex } from './passData.js';
import logger from '../../utils/logger.js';

const API_BASE = 'https://walletobjects.googleapis.com/walletobjects/v1';
const SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const SAVE_URL = 'https://pay.google.com/gp/v/save/';

function localized(value) {
  return { defaultValue: { language: 'en-US', value: String(value ?? '') } };
}

class GoogleWalletService {
  constructor() {
    this._client = null;
  }

  isConfigured() {
    return isGoogleConfigured();
  }

  classId(eventId) {
    return `${googleConfig.issuerId}.event-${eventId}`;
  }

  objectId(ticketId) {
    return `${googleConfig.issuerId}.ticket-${ticketId}`;
  }

  /** EventTicketClass document for an event. Exposed for unit tests. */
  buildClass(event) {
    const venue = event.venue;
    const organization = venue?.organization;
    const base = backendPublicUrl();
    const logoUrl = organization?.logoUrl
      ? /^https?:\/\//i.test(organization.logoUrl)
        ? organization.logoUrl
        : `${base}/${organization.logoUrl.replace(/^\//, '')}`
      : null;

    return {
      id: this.classId(event.id),
      issuerName: organization?.name || 'Jump',
      reviewStatus: 'UNDER_REVIEW',
      eventName: localized(event.name),
      venue: {
        name: localized(venue?.name || ''),
        address: localized(venueAddress(venue)),
      },
      dateTime: { start: new Date(event.date).toISOString() },
      hexBackgroundColor: normalizeHex(organization?.brandColor),
      // Google fetches logos itself, so only public https URLs are usable.
      ...(logoUrl && logoUrl.startsWith('https://')
        ? { logo: { sourceUri: { uri: logoUrl }, contentDescription: localized(organization?.name || 'Organizer logo') } }
        : {}),
    };
  }

  /** EventTicketObject document for a ticket. Exposed for unit tests. */
  buildObject(ticket) {
    return {
      id: this.objectId(ticket.id),
      classId: this.classId(ticket.eventId),
      state: 'ACTIVE',
      ticketHolderName: holderName(ticket.contact),
      ticketNumber: String(ticket.ticketNumber),
      ticketType: localized(ticket.priceTier?.name || 'General'),
      barcode: {
        type: 'QR_CODE',
        value: passBarcodePayload(ticket),
        alternateText: ticket.barcode,
      },
      validTimeInterval: {
        end: { date: passExpiry(ticket.event.date).toISOString() },
      },
      // Tickets from one order stack together in the Wallet UI.
      groupingInfo: { groupingId: ticket.orderId, sortIndex: ticket.ticketNumber },
      textModulesData: [
        { id: 'order', header: 'Order reference', body: ticket.order?.orderRef || '' },
      ],
    };
  }

  // ─── REST client ───

  _authClient() {
    if (!this._client) {
      this._client = new GoogleJWT({
        email: googleConfig.serviceAccountEmail,
        key: googleConfig.privateKey,
        scopes: [SCOPE],
      });
    }
    return this._client;
  }

  async _request(method, path, data) {
    const res = await this._authClient().request({
      url: `${API_BASE}${path}`,
      method,
      data,
      validateStatus: () => true,
    });
    return { status: res.status, data: res.data };
  }

  /**
   * Insert-or-update a class or object. Google returns 409 on duplicate
   * insert, in which case we PUT the full resource instead.
   */
  async _upsert(resource, doc) {
    const insert = await this._request('POST', `/${resource}`, doc);
    if (insert.status === 200) return insert.data;
    if (insert.status === 409) {
      const update = await this._request('PUT', `/${resource}/${encodeURIComponent(doc.id)}`, doc);
      if (update.status === 200) return update.data;
      throw new Error(`Google Wallet ${resource} update failed (${update.status}): ${JSON.stringify(update.data)}`);
    }
    throw new Error(`Google Wallet ${resource} insert failed (${insert.status}): ${JSON.stringify(insert.data)}`);
  }

  /**
   * Make sure the event's class exists and reflects the latest event data.
   * Re-syncs whenever the event row changed after the last sync.
   */
  async ensureClass(event) {
    const synced = event.googleClassSyncedAt && event.googleClassId === this.classId(event.id);
    if (synced && new Date(event.updatedAt) <= new Date(event.googleClassSyncedAt)) {
      return event.googleClassId;
    }
    const doc = this.buildClass(event);
    await this._upsert('eventTicketClass', doc);
    await prisma.event.update({
      where: { id: event.id },
      data: { googleClassId: doc.id, googleClassSyncedAt: new Date() },
    });
    logger.info('Google Wallet class synced', { eventId: event.id, classId: doc.id });
    return doc.id;
  }

  /** Make sure the ticket's object exists. Created once; updated in phase 2. */
  async ensureObject(ticket) {
    if (ticket.googleObjectId === this.objectId(ticket.id)) return ticket.googleObjectId;
    const doc = this.buildObject(ticket);
    await this._upsert('eventTicketObject', doc);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { googleObjectId: doc.id } });
    logger.info('Google Wallet object created', { ticketId: ticket.id, objectId: doc.id });
    return doc.id;
  }

  // ─── Save link ───

  _signSaveJwt(payload) {
    return jwt.sign(
      {
        iss: googleConfig.serviceAccountEmail,
        aud: 'google',
        typ: 'savetowallet',
        iat: Math.floor(Date.now() / 1000),
        origins: googleConfig.origins,
        payload,
      },
      googleConfig.privateKey,
      { algorithm: 'RS256' }
    );
  }

  /** Skinny JWT referencing an existing object. Exposed for unit tests. */
  skinnySaveJwt(ticketId) {
    return this._signSaveJwt({ eventTicketObjects: [{ id: this.objectId(ticketId) }] });
  }

  /** Fat JWT embedding class + object; used only when the REST API is unavailable. */
  fatSaveJwt(ticket) {
    return this._signSaveJwt({
      eventTicketClasses: [this.buildClass(ticket.event)],
      eventTicketObjects: [this.buildObject(ticket)],
    });
  }

  /**
   * Build the "Add to Google Wallet" URL for a ticket.
   * @param {string|object} ticketOrId
   * @returns {Promise<string>}
   */
  async saveUrl(ticketOrId) {
    if (!this.isConfigured()) {
      const err = new Error('Google Wallet is not configured');
      err.code = 'WALLET_NOT_CONFIGURED';
      err.statusCode = 503;
      throw err;
    }
    const ticket = typeof ticketOrId === 'string' ? await loadPassTicket(ticketOrId) : ticketOrId;

    let token;
    try {
      await this.ensureClass(ticket.event);
      await this.ensureObject(ticket);
      token = this.skinnySaveJwt(ticket.id);
    } catch (error) {
      logger.warn('Google Wallet REST sync failed; falling back to fat JWT', {
        ticketId: ticket.id,
        error: error.message,
      });
      token = this.fatSaveJwt(ticket);
    }

    const url = `${SAVE_URL}${token}`;
    if (url.length > 1800) {
      logger.warn('Google Wallet save URL exceeds 1800 chars', { ticketId: ticket.id, length: url.length });
    }
    return url;
  }
}

export default new GoogleWalletService();
