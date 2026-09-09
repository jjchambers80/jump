/**
 * Migration script: convert existing disk-based logos to content-addressed images.
 *
 * Reads all Venue/Event records with a logoUrl pointing to /uploads/logos/,
 * hashes the file, creates File + Image records via ImageService,
 * and updates the entity with imageId.
 *
 * Usage: DATABASE_URL="..." node src/scripts/migrateLogos.js
 *
 * Safe to run multiple times — deduplicates by content hash.
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '@jump/db';
import ImageService from '../services/ImageService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '../../uploads/logos');

async function migrateEntity(entity, type) {
  const { id, logoUrl } = entity;

  if (!logoUrl?.startsWith('/uploads/logos/')) {
    console.log(`  [skip] ${type} ${id}: logoUrl not a local path (${logoUrl})`);
    return false;
  }

  const filename = path.basename(logoUrl);
  const filePath = path.join(UPLOADS_DIR, filename);

  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`  [skip] ${type} ${id}: file not found (${filePath})`);
      return false;
    }
    throw error;
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
  const mimeType = mimeMap[ext] || 'image/jpeg';

  const usageType = `${type}_logo`;
  const image = await ImageService.processUpload(buffer, filename, mimeType, usageType);

  const model = type === 'venue' ? prisma.venue : prisma.event;
  await model.update({
    where: { id },
    data: {
      imageId: image.id,
      logoUrl: image.urls.original,
    },
  });

  console.log(`  [done] ${type} ${id}: imageId=${image.id}, hash=${image.hash}`);
  return true;
}

async function main() {
  console.log('Starting logo migration...\n');

  const venues = await prisma.venue.findMany({
    where: { logoUrl: { not: null }, imageId: null },
    select: { id: true, logoUrl: true },
  });
  console.log(`Found ${venues.length} venue(s) with logos to migrate`);
  let venueCount = 0;
  for (const venue of venues) {
    if (await migrateEntity(venue, 'venue')) venueCount++;
  }

  const events = await prisma.event.findMany({
    where: { logoUrl: { not: null }, imageId: null },
    select: { id: true, logoUrl: true },
  });
  console.log(`\nFound ${events.length} event(s) with logos to migrate`);
  let eventCount = 0;
  for (const event of events) {
    if (await migrateEntity(event, 'event')) eventCount++;
  }

  console.log(`\nMigration complete: ${venueCount} venues, ${eventCount} events`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
