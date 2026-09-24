/**
 * Event description WYSIWYG (PR #157): backfill existing Event.description rows that are
 * plain text (no HTML tags) by running them through plainToHtml() then
 * sanitizeContentHtml().
 *
 * Idempotent: skips descriptions that already contain HTML tags. A second
 * run finds nothing to change and prints 0 converted.
 *
 * Usage:
 *   cd backend && npm run db:backfill:event-descriptions                  # dry run (DRY_RUN=true)
 *   cd backend && DRY_RUN=false npm run db:backfill:event-descriptions    # write changes
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
 * Pure decision logic for the backfill -- testable without a database.
 *
 * Accepts an array of objects with at least { id, name, description }
 * and returns an array of decision records.
 *
 * @param {Array<{id: string|number, name: string, description: string|null|undefined}>} events
 * @returns {Array<{id: string|number, name: string, action: 'CONVERT'|'SKIP_HTML'|'SKIP_EMPTY'|'SKIP_NOCHANGE'|'SKIP_ERROR', from?: string, to?: string, reason: string}>}
 */
export function planEventBackfill(events) {
  return events.map((event) => {
    const { id, name, description } = event;

    // Skip null / empty descriptions
    if (!description || description.trim() === '') {
      return { id, name, action: 'SKIP_EMPTY', reason: 'Description is null or empty' };
    }

    // Skip descriptions that already contain HTML tags
    if (isHtml(description)) {
      return { id, name, action: 'SKIP_HTML', reason: 'Already contains HTML tags' };
    }

    // Convert plain text to HTML
    try {
      const html = convertToHtml(description);

      // If the conversion didn't change anything (single word with no newlines
      // should always change since plainToHtml wraps in <p> when there's content,
      // but guard against edge cases)
      if (html === description) {
        return { id, name, action: 'SKIP_NOCHANGE', reason: 'Conversion produced identical output' };
      }

      return {
        id,
        name,
        action: 'CONVERT',
        from: description,
        to: html,
        reason: `${description.length} chars \u2192 ${html.length} chars`,
      };
    } catch (err) {
      return { id, name, action: 'SKIP_ERROR', reason: err.message };
    }
  });
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
  log(`[event-descriptions] Backfill event descriptions \u2014 ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  log('');

  const events = await prisma.event.findMany({
    select: { id: true, name: true, description: true },
    orderBy: { id: 'asc' },
  });

  log(`[event-descriptions] Found ${events.length} event(s)`);
  log('');

  const plan = planEventBackfill(events);

  let checked = 0;
  let wouldConvert = 0;
  let converted = 0;
  let skippedHtml = 0;
  let skippedEmpty = 0;
  let errors = 0;

  const total = events.length;
  const batchSize = 50;
  const convertDecisions = plan.filter((d) => d.action === 'CONVERT');

  for (let i = 0; i < convertDecisions.length; i += batchSize) {
    const batch = convertDecisions.slice(i, i + batchSize);
    const batchOps = [];

    for (const decision of batch) {
      checked++;

      // Progress indicator (compact: every 5th if > 20 total)
      if (total > 20 && checked % 5 === 0) {
        process.stderr.write(`\r[event-descriptions] Progress: ${checked}/${convertDecisions.length}`);
      }

      wouldConvert++;

      if (total > 20) {
        log(`  [${checked}/${total}] "${decision.name}" \u2014 ${decision.from.length} chars \u2192 ${decision.to.length} chars`);
      } else {
        log(`  [${checked}] "${decision.name}":`);
        log(`       from: ${JSON.stringify(decision.from.slice(0, 80))}${decision.from.length > 80 ? '\u2026' : ''}`);
        log(`         to: ${JSON.stringify(decision.to.slice(0, 120))}${decision.to.length > 120 ? '\u2026' : ''}`);
        log('');
      }

      if (!dryRun) {
        batchOps.push(
          prisma.event.update({
            where: { id: decision.id },
            data: { description: decision.to },
          })
        );
      }
    }

    if (batchOps.length > 0) {
      await prisma.$transaction(batchOps);
      converted += batchOps.length;
    }
  }

  if (total > 20) process.stderr.write('\n');

  // Tally SKIP counts from the full plan
  for (const d of plan) {
    if (d.action === 'SKIP_HTML') skippedHtml++;
    if (d.action === 'SKIP_EMPTY' || d.action === 'SKIP_NOCHANGE') skippedEmpty++;
    if (d.action === 'SKIP_ERROR') errors++;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log('');
  log(`[event-descriptions] Summary (${elapsed}s):`);
  log(`      Checked:         ${checked}`);
  log(`      Already HTML:    ${skippedHtml}`);
  log(`      Empty/skipped:   ${skippedEmpty}`);
  log(`      Would convert:   ${wouldConvert}`);
  log(`      Converted${dryRun ? ' (dry run)' : ''}: ${converted}`);
  log(`      Errors:          ${errors}`);

  if (dryRun && wouldConvert > 0) {
    log('');
    log(`  \u2192 Run with DRY_RUN=false to write ${wouldConvert} change(s).`);
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
      console.error('[event-descriptions] Fatal:', err.message);
      await prisma.$disconnect();
      process.exit(1);
    });
}