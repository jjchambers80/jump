// Special guest lineup (spec 050 §6.3 / §7.6, card 050-Q).
//
// Organizer-published content on the event page: added by hand, or copied from
// an approved SPECIAL_GUEST application's profile. The bio is plain text and is
// rendered as text, never HTML. Links follow the organization socialLinks rules
// (SETTINGS_GROUPS.social: known keys, https, per-network hosts).

import { prisma } from '@jump/db';
import { SETTINGS_GROUPS, checkFields } from '@jump/theme';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import imageService, { SQUARE_VARIANT } from './ImageService.js';
import { mapEventIdFor } from './mapEvents.js';

const MAX_GUESTS_PER_EVENT = 200;
const LIMITS = { name: 120, role: 80, bio: 600 };

/** Include for one row: the image with its file, for the serving URL. */
export const GUESTS_INCLUDE = {
  orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  include: { image: { include: { file: true } } },
};
const ONE = { include: GUESTS_INCLUDE.include };

function coded(error, code) {
  error.code = code;
  return error;
}

/** Validate a links object; returns the cleaned object or null. Throws on a bad key or host. */
export function cleanLinks(links, path = 'links') {
  if (links === null || links === undefined) return null;
  const { value, errors } = checkFields(SETTINGS_GROUPS.social.fields, links, {}, path);
  const [at, message] = Object.entries(errors)[0] ?? [];
  if (at) throw new ValidationError(`${at === '.' ? path : at} ${message}`);
  const kept = Object.fromEntries(Object.entries(value).filter(([, url]) => url));
  return Object.keys(kept).length ? kept : null;
}

/** Profile socials + website → guest links, dropping anything the link rules refuse. */
function linksFromProfile(profile) {
  const candidates = { ...(profile?.socials && typeof profile.socials === 'object' ? profile.socials : {}), website: profile?.website };
  const out = {};
  for (const [key, url] of Object.entries(candidates)) {
    if (!url || !SETTINGS_GROUPS.social.fields[key]) continue;
    try {
      Object.assign(out, cleanLinks({ [key]: url }) || {});
    } catch {
      /* not an allowed host: leave it out */
    }
  }
  return Object.keys(out).length ? out : null;
}

function text(body, key, { required = false } = {}) {
  const value = body[key];
  if (value === undefined) {
    if (required) throw new ValidationError(`${key} is required`);
    return undefined;
  }
  if (value === null && !required) return null;
  if (typeof value !== 'string') throw new ValidationError(`${key} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ValidationError(`${key} is required`);
  if (trimmed.length > LIMITS[key]) throw new ValidationError(`${key} must be ${LIMITS[key]} characters or fewer`);
  return trimmed || null;
}

class EventGuestService {
  async _requireEvent(organizationId, eventId) {
    const event = await prisma.event.findFirst({ where: { id: eventId, venue: { organizationId } }, select: { id: true } });
    if (!event) throw new NotFoundError('Event not found');
    return event;
  }

  async _requireGuest(organizationId, eventId, guestId) {
    await this._requireEvent(organizationId, eventId);
    const guest = await prisma.eventGuest.findFirst({ where: { id: guestId, eventId }, select: { id: true, imageId: true } });
    if (!guest) throw new NotFoundError('Guest not found');
    return guest;
  }

  _fields(body, { creating }) {
    const data = {};
    for (const key of ['name', 'role', 'bio']) {
      const value = text(body, key, { required: creating && key === 'name' });
      if (value !== undefined) data[key] = value;
    }
    if (!creating && data.name === null) throw new ValidationError('name is required');
    if (body.links !== undefined) data.links = cleanLinks(body.links);
    if (body.isVisible !== undefined) {
      if (typeof body.isVisible !== 'boolean') throw new ValidationError('isVisible must be a boolean');
      data.isVisible = body.isVisible;
    }
    return data;
  }

  /** Every row, in order, with visibility flags (organizer view and preview payload). */
  async list(organizationId, eventId) {
    await this._requireEvent(organizationId, eventId);
    const guests = await prisma.eventGuest.findMany({ where: { eventId }, ...GUESTS_INCLUDE });
    return guests.map((g) => this.serialize(g));
  }

  async _nextOrder(eventId) {
    const count = await prisma.eventGuest.count({ where: { eventId } });
    if (count >= MAX_GUESTS_PER_EVENT) throw new ValidationError(`At most ${MAX_GUESTS_PER_EVENT} guests per event`);
    const last = await prisma.eventGuest.findFirst({ where: { eventId }, orderBy: { displayOrder: 'desc' }, select: { displayOrder: true } });
    return (last?.displayOrder ?? -1) + 1;
  }

  async create(organizationId, eventId, body) {
    await this._requireEvent(organizationId, eventId);
    const data = this._fields(body, { creating: true });
    const guest = await prisma.eventGuest.create({ data: { eventId, ...data, displayOrder: await this._nextOrder(eventId) }, ...ONE });
    return this.serialize(guest);
  }

  async update(organizationId, eventId, guestId, body) {
    await this._requireGuest(organizationId, eventId, guestId);
    const data = this._fields(body, { creating: false });
    if (!Object.keys(data).length) throw new ValidationError('Nothing to update');
    return this.serialize(await prisma.eventGuest.update({ where: { id: guestId }, data, ...ONE }));
  }

  async remove(organizationId, eventId, guestId) {
    const guest = await this._requireGuest(organizationId, eventId, guestId);
    await prisma.eventGuest.delete({ where: { id: guestId } });
    if (guest.imageId) await imageService.deleteImage(guest.imageId).catch(() => {});
  }

  async reorder(organizationId, eventId, ids) {
    await this._requireEvent(organizationId, eventId);
    if (!Array.isArray(ids) || ids.length === 0) throw new ValidationError('ids must be a non-empty array');
    const existing = await prisma.eventGuest.findMany({ where: { eventId }, select: { id: true } });
    const known = new Set(existing.map((g) => g.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
      throw new ValidationError('ids must contain every guest of the event exactly once');
    }
    await prisma.$transaction(ids.map((id, displayOrder) => prisma.eventGuest.update({ where: { id }, data: { displayOrder } })));
    return this.list(organizationId, eventId);
  }

  /** Attach an uploaded image (already processed by ImageService) and drop the previous one. */
  async setImage(organizationId, eventId, guestId, imageId) {
    const guest = await this._requireGuest(organizationId, eventId, guestId);
    // Build the square crop now, so a public bucket (direct URLs) has it too.
    if (imageId) await imageService.getVariantData(imageId, SQUARE_VARIANT);
    const updated = await prisma.eventGuest.update({ where: { id: guestId }, data: { imageId }, ...ONE });
    if (guest.imageId && guest.imageId !== imageId) await imageService.deleteImage(guest.imageId).catch(() => {});
    return this.serialize(updated);
  }

  /**
   * POST /admin/events/:eventId/applications/:applicationId/add-to-lineup:
   * a row from an APPROVED application's profile (business name, description
   * → bio, first photo, socials). Any form's applicant can join: forms have no
   * type to gate on. A form may collect no profile (050-B), so the applicant's
   * name is the fallback. 409 when the
   * application is already in the lineup.
   */
  async addFromApplication(eventId, applicationId, organizationId) {
    const application = await prisma.application.findFirst({
      where: { id: applicationId, eventId, ...(organizationId && { event: { venue: { organizationId } } }) },
      include: {
        contact: { select: { firstName: true, lastName: true } },
        profile: { include: { images: { orderBy: { displayOrder: 'asc' }, take: 1, include: { image: { select: { fileId: true, focalX: true, focalY: true } } } } } },
      },
    });
    if (!application || application.status === 'DRAFT') throw new NotFoundError('Application not found');
    if (application.status !== 'APPROVED') throw coded(new ConflictError('Approve the application before adding it to the lineup'), 'NOT_APPROVED');
    if (await prisma.eventGuest.findUnique({ where: { applicationId }, select: { id: true } })) {
      throw coded(new ConflictError('This guest is already in the lineup'), 'ALREADY_IN_LINEUP');
    }

    const profile = application.profile;
    const contactName = [application.contact?.firstName, application.contact?.lastName].filter(Boolean).join(' ').trim();
    const name = (profile?.businessName?.trim() || contactName || 'Special guest').slice(0, LIMITS.name);
    const bio = profile?.description?.trim() ? profile.description.trim().slice(0, LIMITS.bio) : null;
    // The guest owns its own Image row over the same file, so removing it never touches the profile photo.
    const photo = profile?.images?.[0]?.image;
    const image = photo ? await prisma.image.create({ data: { fileId: photo.fileId, usageType: 'event_guest', focalX: photo.focalX, focalY: photo.focalY } }) : null;

    // Spec 057: a registration event's guests join the lineup of the live event it is for.
    const lineupEventId = await mapEventIdFor(eventId);
    let guest;
    try {
      guest = await prisma.eventGuest.create({
        data: { eventId: lineupEventId, applicationId, name, bio, links: linksFromProfile(profile) ?? undefined, imageId: image?.id ?? null, displayOrder: await this._nextOrder(lineupEventId) },
        ...ONE,
      });
    } catch (error) {
      if (image) await imageService.deleteImage(image.id).catch(() => {});
      // @@unique([applicationId]): a concurrent second click lost the race.
      if (error?.code === 'P2002') throw coded(new ConflictError('This guest is already in the lineup'), 'ALREADY_IN_LINEUP');
      throw error;
    }
    if (image) await imageService.getVariantData(image.id, SQUARE_VARIANT).catch(() => {});
    return this.serialize(guest);
  }

  _imageUrl(g) {
    return g.image?.file ? imageService.servingUrl({ id: g.image.id, file: { hash: g.image.file.hash } }, SQUARE_VARIANT) : null;
  }

  /** Organizer shape: every field, visibility included. */
  serialize(g) {
    return { ...this.serializePublic(g), isVisible: g.isVisible, displayOrder: g.displayOrder, applicationId: g.applicationId ?? null, imageId: g.imageId ?? null, eventId: g.eventId };
  }

  /** Public event payload shape (§7.6). */
  serializePublic(g) {
    return { id: g.id, name: g.name, role: g.role ?? null, bio: g.bio ?? null, imageUrl: this._imageUrl(g), links: g.links ?? null };
  }
}

export default new EventGuestService();
