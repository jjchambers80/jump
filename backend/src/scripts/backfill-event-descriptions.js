/**
 * Spec 025 / WYSIWYG: backfill existing Event.description rows that are
 * plain text (no HTML tags) by running them through plainToHtml() then
 * sanitizeContentHtml().
 *
 * Idempotent: skips descriptions that already contain HTML tags. A second
 * run finds nothing to change and prints 0 converted.
 *
 * Usage:
 *   cd backend && npm run db:backfill:025                  # dry run (DRY_RUN=true)
 *   cd backend && DRY_RUN=false npm run db:backfill:025    # write changes
 *   DRY_RUN=false node src/scripts/backfill-event-descriptions.js
 *
 * On production: set DRY_RUN=false and monitor the counts.
 */

import 'dotenv/config';
import { prisma } from '@jump/db';
import { plainToHtml } from '../utils/plainToHtml.js';
import { sanitizeContentHtml } from '../utils/sanitizeHtml.js';

/**
 * Regex to detect the presence of common HTML tags. We check for any
 * <tag> pattern where tag is a known block/inline element that the
 * WYSIWYG or EventService could produce. If this matches, the description
 * is already HTML and we leave it untouched.
 *
 * We intentionally do NOT match every possible HTML tag (the WYSIWYG
 * output is a known subset, and a stray <this> in a plain-text description
 * is not HTML — but the backfill is conservative: if we see any < then >
 * pair it's treated as already-HTML so we never double-escape).
 */
const HTML_TAG_RE = /<\/?[a-z][\w:-]*\b[^>]*>/i;

/**
 * Decide whether a string is already HTML content.
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
function isHtml(text) {
  if (typeof text !== 'string' || text.trim() === '') return false;
  return HTML_TAG_RE.test(text);
}

/**
 * Convert a plain-text description to HTML-safe content.
 * @param {string} text
 * @returns {string}
 */
function convertToHtml(text) {
  return sanitizeContentHtml(plainToHtml(text));
}

/**
 * Run the backfill. Set DRY_RUN=true (default) to only log intended changes.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] - log only, don't persist
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ checked: number, wouldConvert: number, converted: number, skippedHtml: number, skippedEmpty: number, errors: number }>}
 */
export async function run({ dryRun = process.env.DRY_RUN !== 'false', log = console.log } = {}) {
  const start = Date.now();
  log(`[025] Backfill event descriptions — ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  log('');

  const events = await prisma.event.findMany({
    select: { id: true, name: true, description: true },
    orderBy: { id: 'asc' },
  });

  log(`[025] Found ${events.length} event(s)`);
  log('');

  let checked = 0;
  let wouldConvert = 0;
  let converted = 0;
  let skippedHtml = 0;
  let skippedEmpty = 0;
  let errors = 0;

  const total = events.length;
  const batchSize = 50;

  for (let i = 0; i < total; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    const batchOps = [];

    for (const event of batch) {
      checked++;

      // Progress indicator (compact: every 5th event if > 20 total, no per-event when small)
      if (total > 20 && checked % 5 === 0 && checked <= total) {
        process.stderr.write(`\r[025] Progress: ${checked}/${total}`);
      }

      const { id, name, description } = event;

      // Skip null / empty descriptions
      if (!description || description.trim() === '') {
        skippedEmpty++;
        continue;
      }

      // Skip descriptions that already contain HTML tags
      if (isHtml(description)) {
        skippedHtml++;
        continue;
      }

      // Convert plain text to HTML
      try {
        const html = convertToHtml(description);

        // If the conversion didn't change anything (e.g. a single word with no
        // newlines becomes <p>word</p> — it always changes when there's content)
        if (html === description) {
          skippedEmpty++;
          continue;
        }

        wouldConvert++;

        if (total > 20) {
          log(`  [${checked}/${total}] "${name}" — ${description.length} chars → ${html.length} chars`);
        } else {
          log(`  [${checked}] "${name}":`);
          log(`       from: ${JSON.stringify(description.slice(0, 80))}${description.length > 80 ? '…' : ''}`);
          log(`         to: ${JSON.stringify(html.slice(0, 120))}${html.length > 120 ? '…' : ''}`);
          log('');
        }

        if (!dryRun) {
          batchOps.push(
            prisma.event.update({
              where: { id },
              data: { description: html },
            })
          );
        }
      } catch (err) {
        errors++;
        log(`  [${checked}] ERROR "${name}": ${err.message}`);
      }
    }

    if (batchOps.length > 0) {
      await prisma.$transaction(batchOps);
      converted += batchOps.length;
    }
  }

  if (total > 20) process.stderr.write('\n');

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log('');
  log(`[025] Summary (${elapsed}s):`);
  log(`      Checked:         ${checked}`);
  log(`      Already HTML:    ${skippedHtml}`);
  log(`      Empty/skipped:   ${skippedEmpty}`);
  log(`      Would convert:   ${wouldConvert}`);
  log(`      Converted${dryRun ? ' (dry run)' : ''}: ${converted}`);
  log(`      Errors:          ${errors}`);

  if (dryRun && wouldConvert > 0) {
    log('');
    log(`  → Run with DRY_RUN=false to write ${wouldConvert} change(s).`);
  }

  return { checked, wouldConvert, converted, skippedHtml, skippedEmpty, errors };
}

// Run when invoked directly (not imported) — following the convention used by
// other scripts in this repo (e.g. backfill-application-orders.js)
import { fileURLToPath } from 'url';
import path from 'path';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error('[025] Fatal:', err.message);
      await prisma.$disconnect();
      process.exit(1);
    });
}