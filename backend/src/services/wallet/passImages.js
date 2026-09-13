// Image assets for Apple Wallet passes.
// Apple requires icon.png (29×29 @1x) and accepts logo.png (≤160×50 @1x);
// @2x/@3x variants are the same artwork at 2×/3× pixel dimensions. The
// organizer logo is pulled from ImageService and letterboxed onto a
// transparent canvas; organizations without a logo get a brand-coloured
// monogram so every pass still has a valid icon.

import sharp from 'sharp';
import imageService from '../ImageService.js';
import logger from '../../utils/logger.js';
import { normalizeHex, foregroundFor } from './passData.js';

const ICON = 29;
const LOGO_W = 160;
const LOGO_H = 50;
const SCALES = [1, 2, 3];

// Rendered assets keyed by logo image id + brand colour. Small and stable
// per organization, so a plain Map is enough.
const cache = new Map();
const CACHE_MAX = 200;

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

function monogramSvg(orgName, brandHex, size) {
  const letter = escapeXml((orgName || 'J').trim().charAt(0).toUpperCase() || 'J');
  const fg = foregroundFor(brandHex);
  const radius = Math.round(size * 0.22);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" fill="${brandHex}"/>` +
      `<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" ` +
      `font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${Math.round(size * 0.62)}" fill="${fg}">${letter}</text>` +
      `</svg>`
  );
}

async function fitPng(sourceBuffer, width, height) {
  return sharp(sourceBuffer)
    .resize({ width, height, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function coverPng(sourceBuffer, size, brandHex) {
  // Icons are shown in a rounded square; cover-fit the logo on a brand
  // background so transparent/odd-ratio logos still read well.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(brandHex.slice(i, i + 2), 16));
  return sharp(sourceBuffer)
    .resize({ width: size, height: size, fit: 'contain', background: { r, g, b, alpha: 1 } })
    .flatten({ background: { r, g, b } })
    .png()
    .toBuffer();
}

/**
 * Build the image file map for one organization.
 * @param {{ name: string, logoImageId?: string|null, brandColor?: string|null }} organization
 * @returns {Promise<Record<string, Buffer>>} file name → PNG buffer
 */
export async function passImagesForOrganization(organization) {
  const brandHex = normalizeHex(organization?.brandColor);
  const key = `${organization?.logoImageId || 'none'}:${brandHex}:${organization?.name || ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let logoSource = null;
  if (organization?.logoImageId) {
    try {
      const data = await imageService.getVariantData(organization.logoImageId, 'original');
      logoSource = data?.buffer || null;
    } catch (error) {
      logger.warn('Wallet pass: could not load organization logo, using monogram', {
        organizationId: organization.id,
        error: error.message,
      });
    }
  }

  const files = {};
  for (const scale of SCALES) {
    const suffix = scale === 1 ? '' : `@${scale}x`;
    const iconSize = ICON * scale;
    files[`icon${suffix}.png`] = logoSource
      ? await coverPng(logoSource, iconSize, brandHex)
      : await sharp(monogramSvg(organization?.name, brandHex, iconSize)).png().toBuffer();
    if (logoSource) {
      files[`logo${suffix}.png`] = await fitPng(logoSource, LOGO_W * scale, LOGO_H * scale);
    }
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, files);
  return files;
}

export function clearPassImageCache() {
  cache.clear();
}
