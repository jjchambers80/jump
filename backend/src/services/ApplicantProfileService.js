// Applicant Profile Service (spec 011)
// The business identity an applicant maintains per organization: name,
// description, website, socials and up to MAX_PROFILE_PHOTOS photos. Reused
// across the organization's events so a returning vendor applies in seconds.

import { prisma } from '@jump/db';
import { MAX_PROFILE_PHOTOS, SOCIAL_KEYS } from '../config/applications.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import imageService from './ImageService.js';

const URL_RE = /^https?:\/\/[^\s]+$/i;

export function normalizeWebsite(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || String(raw).trim() === '') return null;
  let value = String(raw).trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  if (!URL_RE.test(value) || value.length > 500) throw new ValidationError('website must be a valid URL');
  return value;
}

export function normalizeSocials(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('socials must be an object');
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!SOCIAL_KEYS.includes(key)) throw new ValidationError(`Unknown social key: ${key}`);
    const value = raw[key];
    if (value === null || value === undefined || String(value).trim() === '') continue;
    const clean = String(value).trim();
    if (clean.length > 200) throw new ValidationError(`${key} must be 200 characters or fewer`);
    out[key] = clean;
  }
  return Object.keys(out).length ? out : null;
}

const PROFILE_INCLUDE = { images: { include: { image: { include: { file: true } } }, orderBy: { displayOrder: 'asc' } } };

class ApplicantProfileService {
  async getForContact(organizationId, contactId) {
    const profile = await prisma.applicantProfile.findUnique({
      where: { organizationId_contactId: { organizationId, contactId } },
      include: PROFILE_INCLUDE,
    });
    return profile ? this.serialize(profile) : null;
  }

  /**
   * Create or update the profile from a submission / account edit. Runs inside
   * the caller's transaction when `tx` is given.
   */
  async upsert(organizationId, contactId, body, tx = prisma) {
    const data = this.validate(body);
    const existing = await tx.applicantProfile.findUnique({ where: { organizationId_contactId: { organizationId, contactId } } });
    if (existing) {
      if (Object.keys(data).length === 0) return existing;
      return tx.applicantProfile.update({ where: { id: existing.id }, data });
    }
    if (!data.businessName) throw new ValidationError('businessName is required');
    return tx.applicantProfile.create({
      data: { organizationId, contactId, businessName: data.businessName, description: data.description ?? null, website: data.website ?? null, socials: data.socials ?? null },
    });
  }

  validate(body) {
    const data = {};
    if (body.businessName !== undefined) {
      const name = String(body.businessName ?? '').trim();
      if (name.length < 1 || name.length > 120) throw new ValidationError('businessName must be 1-120 characters');
      data.businessName = name;
    }
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== 'string') throw new ValidationError('description must be a string');
      if (body.description && body.description.length > 2000) throw new ValidationError('description must be 2000 characters or fewer');
      data.description = body.description ? body.description.trim() : null;
    }
    const website = normalizeWebsite(body.website);
    if (website !== undefined) data.website = website;
    const socials = normalizeSocials(body.socials);
    if (socials !== undefined) data.socials = socials;
    return data;
  }

  /**
   * Attach uploaded photos (multer files) to the profile, appending after the
   * existing ones up to the cap. Returns the profile.
   */
  async addPhotos(profileId, files, tx = prisma) {
    if (!files || files.length === 0) return;
    const existing = await tx.applicantProfileImage.count({ where: { profileId } });
    if (existing + files.length > MAX_PROFILE_PHOTOS) {
      throw new ValidationError(`At most ${MAX_PROFILE_PHOTOS} profile photos`);
    }
    let order = existing;
    for (const file of files) {
      const image = await imageService.processUpload(file.buffer, file.originalname, file.mimetype, 'applicant_profile');
      await tx.applicantProfileImage.upsert({
        where: { profileId_imageId: { profileId, imageId: image.id } },
        update: {},
        create: { profileId, imageId: image.id, displayOrder: order },
      });
      order += 1;
    }
  }

  async removePhoto(organizationId, contactId, imageId) {
    const profile = await prisma.applicantProfile.findUnique({ where: { organizationId_contactId: { organizationId, contactId } } });
    if (!profile) throw new NotFoundError('Profile not found');
    const row = await prisma.applicantProfileImage.findUnique({ where: { profileId_imageId: { profileId: profile.id, imageId } } });
    if (!row) throw new NotFoundError('Photo not found');
    await prisma.applicantProfileImage.delete({ where: { id: row.id } });
    // Image rows are shared by hash; orphan cleanup removes unreferenced files.
    return this.getForContact(organizationId, contactId);
  }

  serialize(profile) {
    return {
      id: profile.id,
      businessName: profile.businessName,
      description: profile.description,
      website: profile.website,
      socials: profile.socials || {},
      photos: (profile.images || []).map((pi) => ({
        imageId: pi.imageId,
        displayOrder: pi.displayOrder,
        ...(pi.image ? { urls: imageService.formatImageResponse(pi.image).urls } : {}),
      })),
      updatedAt: profile.updatedAt,
    };
  }
}

export default new ApplicantProfileService();
