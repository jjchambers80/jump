/**
 * Spec 039 (vendor space selection), card 039A: set `ApplicationForm.spaceSelection`
 * on existing PAID forms so the choose step keeps showing what it shows today.
 *
 *   PAID form whose event has a PUBLISHED floor map with at least one booth
 *   bound to one of the form's tiers   → MAP (vendors see a Map tab today)
 *   every other form                    → TIERS (the column default; untouched)
 *
 * Only forms still on the default (TIERS) are considered, so a form an
 * organizer already set is never changed and a second run finds nothing.
 * In-flight applications keep their tier, so they work in either mode.
 *
 * Usage (dry run unless DRY_RUN=false, like the other backfills):
 *   cd backend && npm run db:backfill:039-space-selection
 *   cd backend && DRY_RUN=false npm run db:backfill:039-space-selection
 * Run it right after the 039A deploy (migration 20261014100000 applied).
 */

import 'dotenv/config';
import { prisma } from '@jump/db';

export async function run({ dryRun = process.env.DRY_RUN !== 'false', log = console.log, formIds = null } = {}) {
  const forms = await prisma.applicationForm.findMany({
    where: {
      kind: 'PAID',
      spaceSelection: 'TIERS',
      ...(formIds && { id: { in: formIds } }),
      tiers: { some: { booths: { some: { map: { status: 'PUBLISHED' } } } } },
    },
    select: { id: true, name: true, event: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  log(`[039-space-selection] ${dryRun ? 'DRY RUN — ' : ''}${forms.length} PAID form(s) sell from a published map`);
  for (const form of forms) log(`  MAP  ${form.id}  ${form.event?.name ?? '?'} · ${form.name}`);
  let moved = 0;
  if (!dryRun && forms.length > 0) {
    // Re-check the default in the write so a form set meanwhile is left alone.
    const result = await prisma.applicationForm.updateMany({
      where: { id: { in: forms.map((f) => f.id) }, spaceSelection: 'TIERS' },
      data: { spaceSelection: 'MAP' },
    });
    moved = result.count;
  }
  log(`[039-space-selection] ${dryRun ? 'Would set' : 'Set'} ${dryRun ? forms.length : moved} form(s) to MAP`);
  if (dryRun && forms.length > 0) log('  → Run with DRY_RUN=false to write.');
  return { checked: forms.length, moved };
}

// Run when invoked directly (not imported), like the other backfill scripts.
import { fileURLToPath } from 'url';
import path from 'path';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error('[039-space-selection] Fatal:', err.message);
      await prisma.$disconnect();
      process.exit(1);
    });
}
