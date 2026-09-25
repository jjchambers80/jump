// Booth Service (spec 014 phases 1–2)
// Self-serve holds (chooseBooth / beginPayment / claimBooth / release / sweep)
// and manual assignment (assign, unassign, move, setStatus).
//
// Two vendors clicking the same booth in the same second is the default case,
// not the edge case, so this file has two layers of defence and both matter:
//
//  1. Every mutation runs inside one transaction and takes SELECT … FOR UPDATE
//     on the affected row(s), always Application → Booth (`move` sorts booth ids
//     to avoid deadlock). That is what turns a race into a clean 409.
//  2. Postgres holds the invariant even if a future caller forgets layer 1:
//     `Booth.applicationId` is unique (SOLD) and `Booth.holdApplicationId` is
//     unique (HELD), with a CHECK pinning status = 'HELD' to exactly the rows
//     that have a holder and a deadline. See the schema comment on `Booth` and
//     migration 20261009100000_booth_hold_uniqueness.
//
// A hold without an expiry leaks inventory, so every hold carries
// `holdExpiresAt` and `sweepExpiredHolds` reclaims it — except while Stripe may
// still settle the payment.
//
// Spec 037 adds a second kind of hold. `Booth.holdKind` names the clock a hold
// runs on. It is written once, when the hold is created, and never changed:
//
//   CHECKOUT     the vendor picked this booth after approval and money is about
//                to move. BOOTH_HOLD_MS (15 min). A declined card releases it,
//                because the pick was speculative — they simply choose again.
//   APPLICATION  the vendor picked this booth *on the apply form*, before anyone
//                had decided anything. It is their committed spot, so it
//                outlives a declined card and is released only by a decision
//                that ends the application (reject / waitlist / withdraw /
//                refund / overdue) or by the sweep once its deadline passes.
//                That deadline is the review deadline, moved out to the order's
//                payment due date when the application is approved.

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { BOOTH_HOLD_MS, BOOTH_REVIEW_HOLD_DAYS } from '../config/applications.js';
import logger from '../utils/logger.js';

function coded(error, code) {
  error.code = code;
  return error;
}

// `Booth_holdApplicationId_key` (migration 20261009100000_booth_hold_uniqueness)
// surfaces as P2002 through the Prisma client and as 23505 through raw SQL.
const UNIQUE_VIOLATION = ['P2002', '23505'];

function isUniqueViolation(error) {
  return UNIQUE_VIOLATION.includes(error?.code) || UNIQUE_VIOLATION.includes(String(error?.meta?.code));
}

/**
 * When a booth-first hold gives up if nobody ever decides: BOOTH_REVIEW_HOLD_DAYS
 * after submission, or the event's start, whichever comes first. Never in the
 * past — an application submitted for an event that already started would
 * otherwise take a hold the very next sweep reclaims.
 */
export function reviewDeadline(submittedAt = new Date(), eventStartsAt = null) {
  const byReview = new Date(submittedAt.getTime() + BOOTH_REVIEW_HOLD_DAYS * 86_400_000);
  const deadline = eventStartsAt && new Date(eventStartsAt) < byReview ? new Date(eventStartsAt) : byReview;
  return deadline > new Date() ? deadline : byReview;
}

class BoothService {
  /**
   * Hold one published, tier-matched booth for an approved applicant. The
   * application row is locked first so two simultaneous requests by the same
   * applicant cannot create separate holds; the booth row lock serializes
   * competing applicants for the same inventory.
   */
  async chooseBooth(applicationId, boothId, { tx = null } = {}) {
    if (!boothId || typeof boothId !== 'string') {
      throw coded(new ValidationError('boothId is required'), 'INVALID_PURCHASE');
    }
    if (!tx) return prisma.$transaction((inner) => this.chooseBooth(applicationId, boothId, { tx: inner }));

    const lockedApplication = await tx.$queryRawUnsafe(
      'SELECT "id" FROM "Application" WHERE "id" = $1 FOR UPDATE',
      applicationId
    );
    if (!lockedApplication[0]) throw new NotFoundError('Application not found');

    const application = await tx.application.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        tierId: true,
        eventId: true,
        boothLabel: true,
        tier: { select: { id: true, mapBound: true } },
      },
    });
    if (!application || application.status !== 'APPROVED') {
      throw coded(new ValidationError('Only an approved application can choose a booth'), 'APPLICATION_NOT_APPROVED');
    }
    if (application.paymentStatus !== 'PAYMENT_DUE') {
      throw coded(new ValidationError('This application is not awaiting payment'), 'NOT_PAYMENT_DUE');
    }
    if (!application.tierId) {
      throw coded(new ValidationError('This application has no tier'), 'NO_TIER');
    }
    if (!application.tier?.mapBound) {
      throw coded(new ValidationError('This application tier is not sold from a floor map'), 'FORM_NOT_MAP_BOUND');
    }

    const existing = await tx.booth.findFirst({
      where: {
        OR: [{ applicationId }, { holdApplicationId: applicationId }],
      },
      select: { id: true, status: true, applicationId: true, holdApplicationId: true },
    });
    if (existing?.applicationId === applicationId) {
      throw coded(new ConflictError('This application already has a booth'), 'ALREADY_HAS_BOOTH');
    }
    if (existing?.holdApplicationId === applicationId) {
      throw coded(new ConflictError('This application is already holding a booth'), 'ALREADY_HOLDING_BOOTH');
    }

    return this._takeHold(tx, {
      applicationId,
      boothId,
      eventId: application.eventId,
      tierId: application.tierId,
      holdKind: 'CHECKOUT',
      holdExpiresAt: new Date(Date.now() + BOOTH_HOLD_MS),
    });
  }

  /**
   * Booth-first (spec 037): hold a booth for an application that nobody has
   * decided on yet. Called from inside the submit transaction, right after the
   * Application row is created, so the booth and the application become
   * unavailable-to-everyone-else in the same commit — there is no window where
   * an application exists without its booth, or a booth is held by an
   * application that was rolled back.
   *
   * `submittedAt` anchors the review deadline; `eventStartsAt` clamps it,
   * because a hold that outlives the event reserves nothing.
   */
  async holdForReview(applicationId, boothId, { tx = null, submittedAt = new Date(), eventStartsAt = null } = {}) {
    if (!boothId || typeof boothId !== 'string') {
      throw coded(new ValidationError('boothId is required'), 'INVALID_PURCHASE');
    }
    if (!tx) {
      return prisma.$transaction((inner) =>
        this.holdForReview(applicationId, boothId, { tx: inner, submittedAt, eventStartsAt })
      );
    }

    const lockedApplication = await tx.$queryRawUnsafe(
      'SELECT "id" FROM "Application" WHERE "id" = $1 FOR UPDATE',
      applicationId
    );
    if (!lockedApplication[0]) throw new NotFoundError('Application not found');

    const application = await tx.application.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        status: true,
        tierId: true,
        eventId: true,
        tier: { select: { id: true, mapBound: true } },
      },
    });
    // Booth-first runs before any decision. DRAFT is the paid path (the card is
    // saved next); SUBMITTED is the already-banked path. Anything decided uses
    // chooseBooth instead.
    if (!application || !['DRAFT', 'SUBMITTED'].includes(application.status)) {
      throw coded(new ValidationError('Only an undecided application can reserve a booth'), 'APPLICATION_DECIDED');
    }
    if (!application.tierId) {
      throw coded(new ValidationError('This application has no tier'), 'NO_TIER');
    }
    if (!application.tier?.mapBound) {
      throw coded(new ValidationError('This application tier is not sold from a floor map'), 'FORM_NOT_MAP_BOUND');
    }

    return this._takeHold(tx, {
      applicationId,
      boothId,
      eventId: application.eventId,
      tierId: application.tierId,
      holdKind: 'APPLICATION',
      // A DRAFT is not under review yet — it is mid card-capture on Stripe, so
      // it runs on the checkout clock. Giving it the full review window would
      // mean every abandoned Checkout parks a booth for a month. `promoteToReview`
      // moves it to the review clock the moment the card actually lands.
      holdExpiresAt:
        application.status === 'DRAFT'
          ? new Date(Date.now() + BOOTH_HOLD_MS)
          : reviewDeadline(submittedAt, eventStartsAt),
    });
  }

  /**
   * The card landed and the application is now genuinely under review: move its
   * booth-first hold from the checkout clock to the review clock (spec 037).
   * Returns null when the hold is already gone — the applicant took longer on
   * Stripe than the hold lasted and somebody else bought the booth.
   */
  async promoteToReview(applicationId, { tx = null, submittedAt = new Date(), eventStartsAt = null } = {}) {
    return this.extendApplicationHold(applicationId, reviewDeadline(submittedAt, eventStartsAt), { tx });
  }

  /**
   * Lock the booth, prove the applicant may have it, and take the hold. Shared
   * by both entry points so the concurrency story and the tenant scoping are
   * written once. The caller has already locked the Application row.
   */
  async _takeHold(tx, { applicationId, boothId, eventId, tierId, holdKind, holdExpiresAt }) {
    const [booth] = await tx.$queryRawUnsafe(
      'SELECT * FROM "Booth" WHERE "id" = $1 FOR UPDATE',
      boothId
    );
    if (!booth) throw new NotFoundError('Booth not found');
    if (booth.status !== 'AVAILABLE') {
      throw coded(new ConflictError('This booth is no longer available'), 'BOOTH_TAKEN');
    }
    // Multi-tenant isolation: the booth must live on this application's own
    // event. Tier ids are cuids so a foreign booth would almost certainly fail
    // the tier check below anyway, but "almost certainly" is not a scoping rule
    // — an applicant must never be able to reach another organizer's inventory.
    const map = await tx.floorMap.findUnique({
      where: { id: booth.mapId },
      select: { status: true, eventId: true },
    });
    if (!map || map.eventId !== eventId) {
      throw new NotFoundError('Booth not found');
    }
    if (booth.tierId !== tierId) {
      throw coded(new ValidationError('This booth belongs to a different tier'), 'BOOTH_TIER_MISMATCH');
    }
    if (map.status !== 'PUBLISHED') {
      throw coded(new ValidationError('This floor map is not published'), 'MAP_NOT_PUBLISHED');
    }

    try {
      await tx.booth.update({
        where: { id: boothId },
        data: {
          status: 'HELD',
          holdApplicationId: applicationId,
          holdKind,
          holdExpiresAt,
          applicationId: null,
          assignedById: null,
        },
      });
    } catch (error) {
      // `Booth_holdApplicationId_key` is the database's own answer to "this
      // application already holds a booth". Reaching it means a caller skipped
      // the Application lock above; the constraint still refuses, and the
      // applicant gets the same actionable conflict the lock would have given.
      if (isUniqueViolation(error)) {
        throw coded(new ConflictError('This application is already holding a booth'), 'ALREADY_HOLDING_BOOTH');
      }
      throw error;
    }
    logger.info('Booth held', { event: 'booth_held', boothId, applicationId, holdKind, holdExpiresAt });
    return { boothId, label: booth.label, holdKind, holdExpiresAt, status: 'HELD' };
  }

  /**
   * Approval moves a booth-first hold off the review clock and onto the payment
   * clock (spec 037). A no-op for a CHECKOUT hold, which has its own short
   * deadline, and for an application with no hold at all.
   */
  async extendApplicationHold(applicationId, expiresAt, { tx = null } = {}) {
    if (!expiresAt) return null;
    if (!tx) return prisma.$transaction((inner) => this.extendApplicationHold(applicationId, expiresAt, { tx: inner }));
    const [booth] = await tx.$queryRawUnsafe(
      `SELECT * FROM "Booth" WHERE "holdApplicationId" = $1 FOR UPDATE`,
      applicationId
    );
    if (!booth || booth.status !== 'HELD' || booth.holdKind !== 'APPLICATION') return null;
    // Only ever push the deadline out; never shorten a hold the vendor already has.
    if (booth.holdExpiresAt && new Date(booth.holdExpiresAt) >= new Date(expiresAt)) {
      return { boothId: booth.id, holdExpiresAt: booth.holdExpiresAt };
    }
    await tx.booth.update({ where: { id: booth.id }, data: { holdExpiresAt: expiresAt } });
    return { boothId: booth.id, holdExpiresAt: expiresAt };
  }

  /** Guard a map-bound settlement and protect its booth while payment is in flight. */
  async beginPayment(applicationId, { tx = null, markProcessing = true } = {}) {
    if (!tx) {
      return prisma.$transaction((inner) =>
        this.beginPayment(applicationId, { tx: inner, markProcessing })
      );
    }

    const lockedApplication = await tx.$queryRawUnsafe(
      'SELECT "id" FROM "Application" WHERE "id" = $1 FOR UPDATE',
      applicationId
    );
    if (!lockedApplication[0]) throw new NotFoundError('Application not found');

    const [booth] = await tx.$queryRawUnsafe(
      `SELECT * FROM "Booth"
       WHERE "applicationId" = $1 OR "holdApplicationId" = $1
       ORDER BY CASE WHEN "applicationId" = $1 THEN 0 ELSE 1 END
       LIMIT 1 FOR UPDATE`,
      applicationId
    );
    if (!booth) {
      throw coded(new ConflictError('Select a booth before paying'), 'BOOTH_HOLD_MISSING');
    }
    if (booth.status === 'HELD') {
      if (booth.holdApplicationId !== applicationId) {
        throw coded(new ConflictError('This booth is held by another application'), 'BOOTH_TAKEN');
      }
      if (!booth.holdExpiresAt || new Date(booth.holdExpiresAt) <= new Date()) {
        throw coded(new ConflictError('This booth hold has expired'), 'BOOTH_HOLD_EXPIRED');
      }
    } else if (booth.status !== 'SOLD' || booth.applicationId !== applicationId) {
      throw coded(new ConflictError('No active booth assignment was found'), 'BOOTH_HOLD_MISSING');
    }

    if (markProcessing) {
      await tx.application.update({
        where: { id: applicationId },
        data: { paymentStatus: 'PROCESSING' },
      });
    }
    return { boothId: booth.id, label: booth.label, status: booth.status };
  }

  /** Move the application's current HELD booth to SOLD after Stripe confirms. */
  async claimBooth(applicationId, boothId = null, { tx = null } = {}) {
    if (!tx) return prisma.$transaction((inner) => this.claimBooth(applicationId, boothId, { tx: inner }));
    const [booth] = await tx.$queryRawUnsafe(
      `SELECT * FROM "Booth"
       WHERE ${boothId ? '"id" = $1 AND ' : ''}"holdApplicationId" = $${boothId ? 2 : 1}
       FOR UPDATE`,
      ...(boothId ? [boothId, applicationId] : [applicationId])
    );
    if (!booth) {
      const sold = await tx.booth?.findUnique?.({ where: { applicationId } });
      if (sold) return { boothId: sold.id, label: sold.label, status: 'SOLD' };
      throw coded(new ConflictError('No active booth hold was found for this application'), 'BOOTH_HOLD_MISSING');
    }
    if (booth.status !== 'HELD' || booth.holdApplicationId !== applicationId) {
      throw coded(new ConflictError('The booth hold is no longer valid'), 'BOOTH_HOLD_MISSING');
    }
    await tx.booth.update({
      where: { id: booth.id },
      data: { status: 'SOLD', applicationId, holdApplicationId: null, holdKind: null, holdExpiresAt: null, assignedById: null },
    });
    await tx.application.update({ where: { id: applicationId }, data: { boothLabel: booth.label } });
    logger.info('Booth purchase completed', { event: 'booth_sold', boothId: booth.id, applicationId });
    return { boothId: booth.id, label: booth.label, status: 'SOLD' };
  }

  /**
   * A charge failed, a checkout was abandoned or cancelled.
   *
   * A CHECKOUT hold goes back to the pool: that pick was speculative, made after
   * approval, and the vendor picks again from the map. An APPLICATION hold does
   * not (spec 037) — the vendor chose that booth on the apply form and was
   * approved for it, so a declined card must not hand their spot to the next
   * person. It stays held until the payment due date, and the overdue sweep or
   * an organizer decision is what finally releases it.
   */
  async releaseHoldOnFailure(applicationId, { tx = null } = {}) {
    if (!tx) return prisma.$transaction((inner) => this.releaseHoldOnFailure(applicationId, { tx: inner }));
    const [booth] = await tx.$queryRawUnsafe(
      'SELECT * FROM "Booth" WHERE "holdApplicationId" = $1 FOR UPDATE',
      applicationId
    );
    if (!booth || booth.status !== 'HELD') return null;
    if (booth.holdKind === 'APPLICATION') {
      logger.info('Booth-first hold kept through a payment failure', {
        event: 'booth_hold_kept', boothId: booth.id, applicationId, holdExpiresAt: booth.holdExpiresAt,
      });
      return { boothId: booth.id, status: 'HELD', kept: true };
    }
    await tx.booth.update({
      where: { id: booth.id },
      data: { status: 'AVAILABLE', holdApplicationId: null, holdKind: null, holdExpiresAt: null, applicationId: null, assignedById: null },
    });
    return { boothId: booth.id, status: 'AVAILABLE' };
  }

  /** Release a held or sold booth when its application is withdrawn, moved or fully refunded. */
  async releaseForApplication(applicationId, { tx = null } = {}) {
    if (!tx) return prisma.$transaction((inner) => this.releaseForApplication(applicationId, { tx: inner }));
    const [booth] = await tx.$queryRawUnsafe(
      'SELECT * FROM "Booth" WHERE "applicationId" = $1 OR "holdApplicationId" = $1 FOR UPDATE',
      applicationId
    );
    if (!booth) return null;
    await tx.booth.update({
      where: { id: booth.id },
      data: { status: 'AVAILABLE', applicationId: null, holdApplicationId: null, holdKind: null, holdExpiresAt: null, assignedById: null },
    });
    await tx.application.update({ where: { id: applicationId }, data: { boothLabel: null } });
    return { boothId: booth.id, status: 'AVAILABLE' };
  }

  async boothForApplication(applicationId, { tx = prisma } = {}) {
    return tx.booth.findFirst({
      where: { OR: [{ applicationId }, { holdApplicationId: applicationId }] },
      select: { id: true, mapId: true, label: true, status: true, w: true, h: true, holdKind: true, holdExpiresAt: true, applicationId: true, holdApplicationId: true },
    });
  }

  /**
   * Expire stale holds, except while Stripe may still settle the payment. One
   * query covers both clocks (spec 037): `holdExpiresAt` already carries the
   * right deadline for the hold's kind — minutes for CHECKOUT, the review or
   * payment-due date for APPLICATION — so the sweep only has to ask whether it
   * has passed. This is the reclaim path that keeps an abandoned booth-first
   * application from leaking inventory until the map is empty.
   */
  async sweepExpiredHolds(now = new Date()) {
    const expired = await prisma.booth.findMany({
      where: { status: 'HELD', holdExpiresAt: { lte: now }, holdApplicationId: { not: null } },
      select: { id: true, holdApplicationId: true },
      take: 500,
    });
    let released = 0;
    let protectedCount = 0;
    for (const candidate of expired) {
      const outcome = await prisma.$transaction(async (tx) => {
        const [booth] = await tx.$queryRawUnsafe('SELECT * FROM "Booth" WHERE "id" = $1 FOR UPDATE', candidate.id);
        if (!booth || booth.status !== 'HELD' || !booth.holdApplicationId || !booth.holdExpiresAt || booth.holdExpiresAt > now) return 'skip';
        const application = await tx.application.findUnique({ where: { id: booth.holdApplicationId }, select: { paymentStatus: true } });
        if (application && ['PROCESSING', 'PAID'].includes(application.paymentStatus)) return 'protected';
        await tx.booth.update({
          where: { id: booth.id },
          data: { status: 'AVAILABLE', holdApplicationId: null, holdKind: null, holdExpiresAt: null, applicationId: null, assignedById: null },
        });
        // A booth-first application carries its booth's label from submission,
        // so reclaiming the booth has to take the label back with it — otherwise
        // the status page and the organizer's list keep naming a booth that
        // somebody else can now buy.
        if (booth.holdKind === 'APPLICATION') {
          await tx.application
            .update({ where: { id: booth.holdApplicationId }, data: { boothLabel: null } })
            .catch(() => {});
        }
        return 'released';
      });
      if (outcome === 'released') released += 1;
      if (outcome === 'protected') protectedCount += 1;
    }
    if (released) logger.info('Booth holds expired', { event: 'booth_holds_expired', released });
    return { released, protected: protectedCount };
  }

  /**
   * Assign an APPROVED application to an AVAILABLE or RESERVED booth.
   * Sets SOLD, writes Application.boothLabel. No money movement.
   */
  async assign(orgId, mapId, boothId, applicationId, byUserId, { force = false } = {}) {
    // Verify the map belongs to the org
    const map = await prisma.floorMap.findFirst({ where: { id: mapId, organizationId: orgId }, select: { id: true, eventId: true } });
    if (!map) throw new NotFoundError('Map not found in this organization');

    return prisma.$transaction(async (tx) => {
      // All booth/application mutations lock Application first, then Booth.
      const lockedApplication = await tx.$queryRawUnsafe(
        'SELECT "id" FROM "Application" WHERE "id" = $1 FOR UPDATE',
        applicationId
      );
      if (!lockedApplication[0]) throw new NotFoundError('Approved application not found in this organization');
      // Lock the booth
      const [booth] = await tx.$queryRawUnsafe(
        `SELECT * FROM "Booth" WHERE "id" = $1 AND "mapId" = $2 FOR UPDATE`,
        boothId, mapId
      );
      if (!booth) throw new NotFoundError('Booth not found');
      if (!['AVAILABLE', 'RESERVED'].includes(booth.status)) {
        throw new ConflictError(`Booth is ${booth.status.toLowerCase()}, cannot assign`);
      }

      // Verify application is APPROVED and belongs to this event/org
      const application = await tx.application.findFirst({
        where: { id: applicationId, organizationId: orgId, status: 'APPROVED' },
        select: { id: true, tierId: true, eventId: true },
      });
      if (!application) throw new NotFoundError('Approved application not found in this organization');
      if (application.eventId !== map.eventId) {
        throw new ValidationError('Application belongs to a different event');
      }

      // Check application doesn't already hold a booth — sold, or held while a
      // payment is in flight (settling that hold would collide on applicationId).
      const existingBooth = await tx.booth.findFirst({
        where: { OR: [{ applicationId }, { holdApplicationId: applicationId, status: 'HELD' }] },
      });
      if (existingBooth && existingBooth.id !== boothId) {
        throw new ConflictError('APPLICATION_HAS_BOOTH — this application already holds another booth');
      }

      // Tier match check (overridable with force by ADMIN)
      if (booth.tierId && application.tierId !== booth.tierId && !force) {
        throw new ValidationError('TIER_MISMATCH — the booth belongs to a different tier than the application');
      }

      await tx.booth.update({
        where: { id: boothId },
        data: {
          status: 'SOLD',
          applicationId,
          holdApplicationId: null,
          holdKind: null,
          holdExpiresAt: null,
          assignedById: byUserId || null,
        },
      });

      await tx.application.update({
        where: { id: applicationId },
        data: { boothLabel: booth.label },
      });

      logger.info('Booth assigned', {
        event: 'booth_assigned',
        boothId, mapId, applicationId, assignedBy: byUserId,
      });

      return { boothId, label: booth.label, status: 'SOLD' };
    });
  }

  /**
   * Unassign — return a SOLD booth back to AVAILABLE.
   */
  async unassign(orgId, mapId, boothId) {
    const map = await prisma.floorMap.findFirst({ where: { id: mapId, organizationId: orgId }, select: { id: true } });
    if (!map) throw new NotFoundError('Map not found');
    const current = await prisma.booth.findFirst({
      where: { id: boothId, mapId },
      select: { applicationId: true },
    });
    if (!current) throw new NotFoundError('Booth not found');

    return prisma.$transaction(async (tx) => {
      if (current.applicationId) {
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "Application" WHERE "id" = $1 FOR UPDATE',
          current.applicationId
        );
      }
      const [booth] = await tx.$queryRawUnsafe(
        `SELECT * FROM "Booth" WHERE "id" = $1 AND "mapId" = $2 FOR UPDATE`,
        boothId, mapId
      );
      if (!booth) throw new NotFoundError('Booth not found');
      if (booth.status !== 'SOLD') throw new ValidationError('Booth is not sold or assigned');
      if (booth.applicationId !== current.applicationId) {
        throw new ConflictError('Booth assignment changed; refresh and try again');
      }

      const applicationId = booth.applicationId;

      await tx.booth.update({
        where: { id: boothId },
        data: { status: 'AVAILABLE', applicationId: null, holdApplicationId: null, holdKind: null, holdExpiresAt: null, assignedById: null },
      });

      if (applicationId) {
        await tx.application.update({
          where: { id: applicationId },
          data: { boothLabel: null },
        });
      }

      return { boothId, label: booth.label, status: 'AVAILABLE' };
    });
  }

  /**
   * Move a holder from one booth to another (both on the same map).
   * If the target is occupied, swaps the holders (exchange).
   * Locks both rows ordered by id to avoid deadlock.
   */
  async move(orgId, mapId, fromBoothId, toBoothId) {
    const map = await prisma.floorMap.findFirst({ where: { id: mapId, organizationId: orgId }, select: { id: true, eventId: true } });
    if (!map) throw new NotFoundError('Map not found');

    const ids = [fromBoothId, toBoothId].sort();
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const current = await prisma.booth.findMany({
      where: { id: { in: ids }, mapId },
      select: { id: true, applicationId: true },
    });
    if (current.length !== 2) throw new NotFoundError('One or both booths not found');
    const applicationIds = [...new Set(current.map((booth) => booth.applicationId).filter(Boolean))].sort();

    return prisma.$transaction(async (tx) => {
      for (const applicationId of applicationIds) {
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "Application" WHERE "id" = $1 FOR UPDATE',
          applicationId
        );
      }
      const locked = await tx.$queryRawUnsafe(
        `SELECT * FROM "Booth" WHERE "id" IN (${placeholders}) AND "mapId" = $${ids.length + 1} FOR UPDATE`,
        ...ids, mapId
      );

      const byId = {};
      for (const b of locked) byId[b.id] = b;

      const fromBooth = byId[fromBoothId];
      const toBooth = byId[toBoothId];

      if (!fromBooth || !toBooth) throw new NotFoundError('One or both booths not found');
      const previousById = Object.fromEntries(current.map((booth) => [booth.id, booth]));
      if (
        fromBooth.applicationId !== previousById[fromBoothId]?.applicationId ||
        toBooth.applicationId !== previousById[toBoothId]?.applicationId
      ) {
        throw new ConflictError('Booth assignment changed; refresh and try again');
      }
      if (fromBooth.status !== 'SOLD') throw new ValidationError('Source booth is not sold');
      if (!['AVAILABLE', 'RESERVED', 'SOLD'].includes(toBooth.status)) {
        throw new ConflictError('Target booth is not available');
      }

      const fromAppId = fromBooth.applicationId;
      if (!fromAppId) throw new ValidationError('Source booth has no assigned application');

      if (toBooth.status === 'SOLD' && toBooth.applicationId) {
        // Swap: exchange holders between the two booths
        const toAppId = toBooth.applicationId;

        await tx.booth.update({
          where: { id: fromBooth.id },
          data: { status: 'SOLD', applicationId: toAppId, assignedById: toBooth.assignedById },
        });

        await tx.booth.update({
          where: { id: toBooth.id },
          data: { status: 'SOLD', applicationId: fromAppId, assignedById: fromBooth.assignedById },
        });

        await tx.application.update({
          where: { id: fromAppId },
          data: { boothLabel: toBooth.label },
        });

        await tx.application.update({
          where: { id: toAppId },
          data: { boothLabel: fromBooth.label },
        });

        return { fromBooth: fromBooth.id, toBooth: toBooth.id, label: toBooth.label, swapped: true };
      }

      // Normal move: clear source, set target
      await tx.booth.update({
        where: { id: fromBooth.id },
        data: { status: 'AVAILABLE', applicationId: null, holdApplicationId: null, holdKind: null, holdExpiresAt: null, assignedById: null },
      });

      await tx.booth.update({
        where: { id: toBooth.id },
        data: { status: 'SOLD', applicationId: fromAppId, assignedById: fromBooth.assignedById },
      });

      await tx.application.update({
        where: { id: fromAppId },
        data: { boothLabel: toBooth.label },
      });

      return { fromBooth: fromBooth.id, toBooth: toBooth.id, label: toBooth.label, swapped: false };
    });
  }

  /**
   * Toggle RESERVED / BLOCKED / AVAILABLE on booths without a holder.
   */
  async setStatus(orgId, mapId, boothId, status) {
    const allowed = ['AVAILABLE', 'RESERVED', 'BLOCKED'];
    if (!allowed.includes(status)) {
      throw new ValidationError(`Status must be one of: ${allowed.join(', ')}`);
    }

    const map = await prisma.floorMap.findFirst({ where: { id: mapId, organizationId: orgId }, select: { id: true } });
    if (!map) throw new NotFoundError('Map not found');

    return prisma.$transaction(async (tx) => {
      const [booth] = await tx.$queryRawUnsafe(
        `SELECT * FROM "Booth" WHERE "id" = $1 AND "mapId" = $2 FOR UPDATE`,
        boothId, mapId
      );
      if (!booth) throw new NotFoundError('Booth not found');
      if (booth.status === 'SOLD' || booth.status === 'HELD') {
        throw new ValidationError(`Cannot change status of a ${booth.status.toLowerCase()} booth`);
      }

      await tx.booth.update({
        where: { id: boothId },
        data: { status },
      });

      return { boothId, label: booth.label, status };
    });
  }

  /**
   * List APPROVED applications that are assignable to a booth (no existing booth, same event).
   * Match by tier first, search on business name / contact.
   */
  async assignableApplications(orgId, mapId, boothId, query) {
    const map = await prisma.floorMap.findFirst({
      where: { id: mapId, organizationId: orgId },
      select: { id: true, eventId: true },
    });
    if (!map) throw new NotFoundError('Map not found');

    // Get the booth's tier if any
    const booth = await prisma.booth.findUnique({ where: { id: boothId }, select: { tierId: true } });

    // Applications already holding a booth on this map
    const heldBooths = await prisma.booth.findMany({
      where: { mapId, applicationId: { not: null } },
      select: { applicationId: true },
    });
    const heldIds = new Set(heldBooths.map((b) => b.applicationId));

    const where = {
      eventId: map.eventId,
      organizationId: orgId,
      status: 'APPROVED',
      id: { notIn: [...heldIds] },
    };

    if (query) {
      where.OR = [
        { profile: { businessName: { contains: query, mode: 'insensitive' } } },
        { contact: { firstName: { contains: query, mode: 'insensitive' } } },
        { contact: { lastName: { contains: query, mode: 'insensitive' } } },
        { contact: { email: { contains: query, mode: 'insensitive' } } },
      ];
    }

    const applications = await prisma.application.findMany({
      where,
      include: {
        profile: { select: { businessName: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
        tier: { select: { id: true, name: true, price: true, mapBound: true } },
      },
      orderBy: [{ tier: { displayOrder: 'asc' } }, { profile: { businessName: 'asc' } }],
    });

    return applications.map((a) => ({
      id: a.id,
      businessName: a.profile?.businessName || null,
      contactName: `${a.contact.firstName} ${a.contact.lastName}`.trim(),
      email: a.contact.email,
      tier: a.tier ? { id: a.tier.id, name: a.tier.name, price: Number(a.tier.price), mapBound: a.tier.mapBound } : null,
      tierMatch: booth?.tierId ? a.tierId === booth.tierId : true,
      status: a.status,
    }));
  }
}

export default new BoothService();