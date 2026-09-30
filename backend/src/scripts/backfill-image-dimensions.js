/**
 * Header logo layout shift: backfill File.width / File.height for image files
 * uploaded before those columns existed, then rewrite each organization's
 * stored logoUrl so it carries the size (`?w=&h=`, ImageService.dimensionQuery).
 * The storefront header reads it to reserve the logo's box before it loads.
 *
 * Idempotent: files that already have a size and logo URLs that already match
 * are skipped, so a second run changes nothing.
 *
 * Usage:
 *   cd backend && npm run db:backfill:image-dimensions                  # dry run
 *   cd backend && DRY_RUN=false npm run db:backfill:image-dimensions    # write
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { prisma } from '@jump/db';
import imageService, { originalKey, readDimensions } from '../services/ImageService.js';

/**
 * The logo URL an organization should store, or null to leave it alone.
 * Only URLs that serve this organization's own logo image are rewritten; an
 * external or legacy URL is never touched.
 */
export function planLogoUrl(organization) {
  const image = organization.logoImage;
  if (!image?.file || !organization.logoUrl) return null;
  if (!organization.logoUrl.includes(image.file.hash)) return null;
  const next = imageService.servingUrl(image, 'original');
  return next === organization.logoUrl ? null : next;
}

export async function backfillImageDimensions({ dryRun = true, log = console.log } = {}) {
  const files = await prisma.file.findMany({
    where: { width: null, mimeType: { startsWith: 'image/' } },
    select: { id: true, hash: true, mimeType: true },
  });
  let sized = 0;
  let unreadable = 0;
  for (const file of files) {
    const data = await imageService.storage.get(originalKey(file.hash, file.mimeType)).catch(() => null);
    const dimensions = data ? await readDimensions(data.buffer) : { width: null, height: null };
    if (!dimensions.width) {
      unreadable += 1;
      log(`skip file ${file.id}: original missing or unreadable`);
      continue;
    }
    sized += 1;
    if (!dryRun) await prisma.file.update({ where: { id: file.id }, data: dimensions });
  }

  const organizations = await prisma.organization.findMany({
    where: { logoImageId: { not: null } },
    select: { id: true, name: true, logoUrl: true, logoImage: { include: { file: true } } },
  });
  let rewritten = 0;
  for (const organization of organizations) {
    // In a dry run the files above were not written: size the logo from storage here too.
    const file = organization.logoImage?.file;
    if (dryRun && file && file.width == null && file.mimeType.startsWith('image/')) {
      const data = await imageService.storage.get(originalKey(file.hash, file.mimeType)).catch(() => null);
      if (data) Object.assign(file, await readDimensions(data.buffer));
    }
    const next = planLogoUrl(organization);
    if (!next) continue;
    rewritten += 1;
    log(`${organization.name}: ${organization.logoUrl} -> ${next}`);
    if (!dryRun) await prisma.organization.update({ where: { id: organization.id }, data: { logoUrl: next } });
  }

  log(`${dryRun ? '[dry run] ' : ''}files sized: ${sized}, unreadable: ${unreadable}, logo URLs rewritten: ${rewritten}`);
  return { sized, unreadable, rewritten };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  backfillImageDimensions({ dryRun: process.env.DRY_RUN !== 'false' })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
