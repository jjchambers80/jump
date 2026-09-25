// Vendor door check-in (spec 034)
//
// Event-day surface: staff stand at a loading dock with a phone on venue wifi,
// find an approved vendor by name or by scanning the vendor's status-link QR,
// and stamp the arrival. The arrival record is `Application.checkedInAt` — the
// same column the submissions table, the detail page, the CSV export and the
// organizer digest already read (spec 019 phase 3). There is deliberately no
// second arrivals table.
//
// Idempotency lives in the database, not in a read-then-write check. Check-in
// is a conditional `updateMany(… checkedInAt: null …)`: two staff scanning the
// same badge in the same second race on that predicate, exactly one row is
// written, and the loser reads back the winner's timestamp. A retry from a
// phone that never saw the first response is the same race with itself, so the
// client may retry blindly — which is what makes the door flow safe on a
// network that drops requests.

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import applicationFormService from './ApplicationFormService.js';
import qrService from './QRService.js';
import { hashToken, statusToken, verifyStatusToken } from './applicationLinks.js';
import logger from '../utils/logger.js';

const METHODS = new Set(['SEARCH', 'SCAN', 'TOGGLE']);

/** Everything the door needs about one vendor, and nothing it does not. */
const ROSTER_SELECT = {
  id: true,
  status: true,
  boothLabel: true,
  checkedInAt: true,
  checkedInById: true,
  checkedInVia: true,
  contact: { select: { email: true, firstName: true, lastName: true, phone: true } },
  profile: { select: { businessName: true } },
  form: { select: { id: true, name: true } },
  tier: { select: { id: true, name: true } },
};

class VendorCheckInService {
  /**
   * Approved vendors expected at an event, with arrival state and booth.
   *
   * `q` narrows on business name, contact name, email and the short id — the
   * same fields a staffer would read off a vendor's phone. Unarrived vendors
   * sort first so the list is a work queue; within each group, by business
   * name. The roster is small by nature (the vendors of one event), so it is
   * returned whole: one request at the start of the shift, then the door page
   * filters locally and keeps working when the network does not.
   */
  async roster(eventId, organizationId, { q } = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const where = { eventId, status: 'APPROVED' };
    const term = typeof q === 'string' ? q.trim() : '';
    if (term) {
      where.OR = [
        { profile: { businessName: { contains: term, mode: 'insensitive' } } },
        { contact: { firstName: { contains: term, mode: 'insensitive' } } },
        { contact: { lastName: { contains: term, mode: 'insensitive' } } },
        { contact: { email: { contains: term, mode: 'insensitive' } } },
        { boothLabel: { contains: term, mode: 'insensitive' } },
        { id: { endsWith: term.toLowerCase() } },
      ];
    }

    const rows = await prisma.application.findMany({ where, select: ROSTER_SELECT });
    await this._attachBooths(rows);
    const vendors = rows
      .map((row) => this._serialize(row))
      .sort((a, b) => {
        if (Boolean(a.checkedInAt) !== Boolean(b.checkedInAt)) return a.checkedInAt ? 1 : -1;
        return a.businessName.localeCompare(b.businessName);
      });

    // Counts describe the whole event, not the filtered page, so the header
    // does not appear to change what has happened when staff type a search.
    const expected = term ? await prisma.application.count({ where: { eventId, status: 'APPROVED' } }) : vendors.length;
    const arrived = term
      ? await prisma.application.count({ where: { eventId, status: 'APPROVED', checkedInAt: { not: null } } })
      : vendors.filter((v) => v.checkedInAt).length;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, date: true, venue: { select: { name: true, timezone: true } } },
    });

    return {
      event: event && { id: event.id, name: event.name, date: event.date, venueName: event.venue?.name ?? null, timezone: event.venue?.timezone ?? null },
      counts: { expected, arrived, awaiting: Math.max(0, expected - arrived) },
      data: vendors,
    };
  }

  /**
   * Resolve a scanned credential to one vendor on this event.
   *
   * The credential is the status token already in the vendor's approval email
   * (`applicationLinks.statusToken`), so nothing new has to be issued before
   * the first event. Wrong event, wrong organization, unknown id and bad token
   * all return the same 404: the door is an unauthenticated-adjacent surface
   * and must not confirm that an application id exists somewhere else.
   */
  async resolveScan(eventId, organizationId, payload) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const parsed = qrService.parseVendorPayload(payload);
    if (!parsed) throw new ValidationError('That code is not a vendor pass');

    const row = await prisma.application.findFirst({
      where: { ...this._scope(eventId, organizationId), id: parsed.applicationId },
      select: { ...ROSTER_SELECT, statusTokenHash: true },
    });
    // Verify the token before deciding anything, so a caller cannot use the
    // response to probe which application ids belong to this event.
    const tokenOk = row
      ? verifyStatusToken(row.id, parsed.token) || row.statusTokenHash === hashToken(parsed.token)
      : false;
    if (!row || !tokenOk) throw new NotFoundError('No vendor on this event matches that pass');
    if (row.status !== 'APPROVED') throw new ConflictError('Only approved vendors can be checked in');

    delete row.statusTokenHash;
    await this._attachBooths([row]);
    return this._serialize(row);
  }

  /**
   * Stamp an arrival. Idempotent by construction: the conditional update only
   * writes when `checkedInAt` is still null, so a double-tap, a retry after a
   * timeout and two staff scanning at once all converge on the first stamp.
   *
   * Returns `alreadyCheckedIn` so the door page can say "arrived 10:04" rather
   * than leaving a staffer unsure whether their tap landed.
   */
  async checkIn(eventId, applicationId, organizationId, { byUserId = null, via = 'SEARCH' } = {}) {
    await applicationFormService.requireEvent(eventId, organizationId);
    if (!METHODS.has(via)) throw new ValidationError('via must be SEARCH, SCAN or TOGGLE');

    const existing = await prisma.application.findFirst({
      where: { ...this._scope(eventId, organizationId), id: applicationId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundError('Application not found');
    if (existing.status !== 'APPROVED') throw new ConflictError('Only approved vendors can be checked in');

    const { count } = await prisma.application.updateMany({
      where: { ...this._scope(eventId, organizationId), id: applicationId, status: 'APPROVED', checkedInAt: null },
      data: { checkedInAt: new Date(), checkedInById: byUserId, checkedInVia: via },
    });

    const row = await prisma.application.findUnique({ where: { id: applicationId }, select: ROSTER_SELECT });
    await this._attachBooths([row]);
    if (count === 1) logger.info('Vendor checked in', { applicationId, eventId, via, byUserId });

    return { alreadyCheckedIn: count === 0, vendor: this._serialize(row) };
  }

  /**
   * Undo an arrival — a mis-scan at a busy door has to be fixable on the spot.
   * Also idempotent: clearing an already-clear stamp is a no-op, never an error.
   */
  async undoCheckIn(eventId, applicationId, organizationId) {
    await applicationFormService.requireEvent(eventId, organizationId);
    const existing = await prisma.application.findFirst({
      where: { ...this._scope(eventId, organizationId), id: applicationId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundError('Application not found');

    await prisma.application.updateMany({
      where: { ...this._scope(eventId, organizationId), id: applicationId, checkedInAt: { not: null } },
      data: { checkedInAt: null, checkedInById: null, checkedInVia: null },
    });

    const row = await prisma.application.findUnique({ where: { id: applicationId }, select: ROSTER_SELECT });
    await this._attachBooths([row]);
    return { alreadyCheckedIn: false, vendor: this._serialize(row) };
  }

  /**
   * Tenant predicate for every door query. `organizationId` is null only for
   * SYSTEM_ADMIN (unscoped), which is how the rest of the admin routes read;
   * for everyone else it is the second lock behind `requireEvent`, so a
   * mismatched event id can never reach another organization's vendors.
   */
  _scope(eventId, organizationId) {
    return organizationId ? { eventId, organizationId } : { eventId };
  }

  /** The vendor's own door pass payload, for the status page QR (spec 034). */
  passPayloadFor(application) {
    return qrService.generateVendorQRPayload(application.id, application.eventId, statusToken(application.id));
  }

  /** Booths owned by these applications, keyed onto the rows as `mapBooth`. */
  async _attachBooths(rows) {
    const ids = rows.filter(Boolean).map((r) => r.id);
    if (ids.length === 0) return rows;
    const booths = await prisma.booth.findMany({
      where: { applicationId: { in: ids } },
      select: { id: true, mapId: true, label: true, status: true, applicationId: true },
    });
    const owned = new Map(booths.map((b) => [b.applicationId, b]));
    for (const row of rows) if (row) row.mapBooth = owned.get(row.id) ?? null;
    return rows;
  }

  _serialize(a) {
    const name = [a.contact?.firstName, a.contact?.lastName].filter(Boolean).join(' ');
    return {
      id: a.id,
      shortId: String(a.id).slice(-8).toUpperCase(),
      businessName: a.profile?.businessName || name || a.contact?.email || 'Vendor',
      contactName: name || null,
      email: a.contact?.email ?? null,
      phone: a.contact?.phone ?? null,
      formName: a.form?.name ?? null,
      tierName: a.tier?.name ?? null,
      // The map booth is the real assignment; `boothLabel` is the manual
      // fallback for events with no floor map.
      booth: a.mapBooth ? { id: a.mapBooth.id, mapId: a.mapBooth.mapId, label: a.mapBooth.label, status: a.mapBooth.status } : null,
      boothLabel: a.mapBooth?.label ?? a.boothLabel ?? null,
      checkedInAt: a.checkedInAt ?? null,
      checkedInById: a.checkedInById ?? null,
      checkedInVia: a.checkedInVia ?? null,
    };
  }
}

export default new VendorCheckInService();
