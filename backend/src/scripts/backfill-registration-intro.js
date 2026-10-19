/**
 * A registration event is one page (its Name step edits the event's name and
 * description; the form's own name and intro are no longer asked). Before
 * that, what registrants read was the form's plain-text intro: copy it into the
 * event description wherever the event has none, as sanitised HTML.
 *
 * Idempotent: an event with a description is skipped, so a second run changes
 * nothing. The form's intro is kept; the page shows it only without a
 * description.
 *
 * Usage:
 *   cd backend && npm run db:backfill:registration-intro                  # dry run
 *   cd backend && DRY_RUN=false npm run db:backfill:registration-intro    # write
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import path from 'path';
import { prisma } from '@jump/db';
import { plainToHtml } from '../utils/plainToHtml.js';
import { sanitizeContentHtml } from '../utils/sanitizeHtml.js';

export async function run({ dryRun = process.env.DRY_RUN !== 'false', log = console.log } = {}) {
  log(`[registration-intro] ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  const events = await prisma.event.findMany({
    where: { type: 'REGISTRATION', OR: [{ description: null }, { description: '' }], applicationForms: { some: { intro: { not: null } } } },
    select: { id: true, name: true, applicationForms: { where: { intro: { not: null } }, select: { intro: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
  });
  let copied = 0;
  for (const event of events) {
    const intro = event.applicationForms[0]?.intro?.trim();
    if (!intro) continue;
    log(`  "${event.name}": ${intro.length} chars`);
    if (!dryRun) await prisma.event.update({ where: { id: event.id }, data: { description: sanitizeContentHtml(plainToHtml(intro)) } });
    copied++;
  }
  log(`[registration-intro] ${dryRun ? 'Would copy' : 'Copied'}: ${copied}`);
  return { copied };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error('[registration-intro] Fatal:', err.message);
      await prisma.$disconnect();
      process.exit(1);
    });
}
