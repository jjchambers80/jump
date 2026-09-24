// Contract tests for the Event description backfill script (spec 025).
//
// Tests the pure planEventBackfill() function against the database:
// creates events, runs the planner on only those events, applies
// CONVERT decisions, and verifies from the DB. Also tests dry-run
// mode and idempotency.
//
// Pattern: venueTimeZoneBackfill.test.js — the pure planner lets us
// scope writes to our own fixtures instead of scanning every event.

import { prisma } from '@jump/db';
import { planEventBackfill } from '../../src/scripts/backfill-event-descriptions.js';

/** Apply CONVERT decisions from the planner directly to the DB. */
async function applyPlan(decisions) {
  const converts = decisions.filter((d) => d.action === 'CONVERT');
  for (const d of converts) {
    await prisma.event.update({
      where: { id: d.id },
      data: { description: d.to },
    });
  }
  return decisions;
}

/** Run the full backfill on a specific set of event ids (scoped, no DB scan). */
async function runBackfill(eventIds, { dryRun = false } = {}) {
  const events = await prisma.event.findMany({
    where: { id: { in: Object.values(eventIds) } },
    select: { id: true, name: true, description: true },
    orderBy: { name: 'asc' },
  });
  const plan = planEventBackfill(events);
  if (!dryRun) await applyPlan(plan);
  return plan;
}

const FUTURE = new Date('2030-09-15T19:00:00.000Z');

describe('Event description backfill (spec 025)', () => {
  let orgId;
  let venueId;
  const ids = {};

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: 'Desc Backfill Org', status: 'ACTIVE' },
    });
    orgId = org.id;

    const venue = await prisma.venue.create({
      data: { organizationId: orgId, name: 'Backfill Venue', address: '1 Test Blvd' },
    });
    venueId = venue.id;

    const rows = [
      {
        key: 'multiPara',
        name: 'Multi-paragraph plain text',
        description:
          'Welcome to the event!\n\nThis is the second paragraph with a\nline break inside it.\n\nAnd a third one.',
      },
      {
        key: 'singleLine',
        name: 'Single-line text',
        description: 'Just a single line with no newlines.',
      },
      {
        key: 'alreadyHtml',
        name: 'Already HTML content',
        description: '<p>Hello <strong>world</strong></p><ul><li>Item</li></ul>',
      },
      {
        key: 'hasHtmlFragments',
        name: 'Has HTML-like fragments',
        description: 'Line one<br>Line two<p>Another paragraph</p>',
      },
      {
        key: 'scriptTag',
        name: 'Contains a script tag',
        description: '<p>Clean</p><script>alert(1)</script>',
      },
      {
        key: 'emptyString',
        name: 'Empty string',
        description: '',
      },
      {
        key: 'nullDesc',
        name: 'Null description',
        description: null,
      },
      {
        key: 'specialChars',
        name: 'Special characters',
        description:
          'Price: $10.00\n\nTerms: 1 < 2 and 2 > 1\n\nA&B Company\n\nLine <with> angle brackets <strong>not</strong> HTML',
      },
    ];

    for (const { key, ...data } of rows) {
      const event = await prisma.event.create({
        data: { venueId, date: FUTURE, capacity: 100, ...data },
      });
      ids[key] = event.id;
    }
  });

  afterAll(async () => {
    await prisma.priceTier.deleteMany({
      where: { event: { venue: { organizationId: orgId } } },
    });
    await prisma.event.deleteMany({ where: { venue: { organizationId: orgId } } });
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  // ── Planner decisions (pure, no DB needed) ────────────────────────

  it('planner marks multi-paragraph plain text for CONVERT', () => {
    const plan = planEventBackfill([
      {
        id: '1',
        name: 'Test',
        description: 'Para 1\n\nPara 2\nwith break',
      },
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0].action).toBe('CONVERT');
    expect(plan[0].to).toContain('<p>');
    // sanitize-html outputs self-closing <br />
    expect(plan[0].to).toMatch(/<br\s*\/?>/);
  });

  it('planner marks single-line text for CONVERT with <p> wrapper', () => {
    const plan = planEventBackfill([
      { id: '1', name: 'Test', description: 'Just a line.' },
    ]);
    expect(plan[0].action).toBe('CONVERT');
    expect(plan[0].to).toBe('<p>Just a line.</p>');
  });

  it('planner skips descriptions that already contain HTML tags', () => {
    const plan = planEventBackfill([
      { id: '1', name: 'Test', description: '<p>Hello</p>' },
    ]);
    expect(plan[0].action).toBe('SKIP_HTML');
  });

  it('planner skips descriptions with HTML-like fragments such as <br>', () => {
    const plan = planEventBackfill([
      { id: '1', name: 'Test', description: 'Line one<br>Line two' },
    ]);
    expect(plan[0].action).toBe('SKIP_HTML');
  });

  it('planner skips descriptions with <script> tags', () => {
    const plan = planEventBackfill([
      { id: '1', name: 'Test', description: '<p>Clean</p><script>x()</script>' },
    ]);
    expect(plan[0].action).toBe('SKIP_HTML');
  });

  it('planner skips empty and null descriptions', () => {
    const plan = planEventBackfill([
      { id: '1', name: 'Empty', description: '' },
      { id: '2', name: 'Null', description: null },
      { id: '3', name: 'Undefined', description: undefined },
    ]);
    expect(plan.every((d) => d.action === 'SKIP_EMPTY')).toBe(true);
  });

  it('planner escapes < and > in plain-text descriptions', () => {
    const plan = planEventBackfill([
      {
        id: '1',
        name: 'Test',
        description: '1 < 2 and 2 > 1',
      },
    ]);
    expect(plan[0].action).toBe('CONVERT');
    expect(plan[0].to).toBe('<p>1 &lt; 2 and 2 &gt; 1</p>');
  });

  // ── Full backfill (DB-write path) ─────────────────────────────────

  it('converts multi-paragraph plain text to <p> with <br> for internal line breaks', async () => {
    await runBackfill(ids);

    const event = await prisma.event.findUnique({ where: { id: ids.multiPara } });
    expect(event.description).toBe(
      '<p>Welcome to the event!</p>\n' +
        '<p>This is the second paragraph with a<br />line break inside it.</p>\n' +
        '<p>And a third one.</p>'
    );
  });

  it('wraps single-line plain text in <p>', async () => {
    const event = await prisma.event.findUnique({ where: { id: ids.singleLine } });
    expect(event.description).toBe('<p>Just a single line with no newlines.</p>');
  });

  it('skips descriptions that already contain HTML tags', async () => {
    const event = await prisma.event.findUnique({ where: { id: ids.alreadyHtml } });
    expect(event.description).toBe(
      '<p>Hello <strong>world</strong></p><ul><li>Item</li></ul>'
    );
  });

  it('skips descriptions with HTML-like fragments', async () => {
    const event = await prisma.event.findUnique({ where: { id: ids.hasHtmlFragments } });
    expect(event.description).toBe('Line one<br>Line two<p>Another paragraph</p>');
  });

  it('skips descriptions with <script> tags', async () => {
    const event = await prisma.event.findUnique({ where: { id: ids.scriptTag } });
    expect(event.description).toBe('<p>Clean</p><script>alert(1)</script>');
  });

  it('skips descriptions containing HTML-like bracket content like <word>', async () => {
    const event = await prisma.event.findUnique({ where: { id: ids.specialChars } });
    // The description contains `<with>` which matches HTML_TAG_RE, so the
    // backfill conservatively skips it (never double-escapes).
    expect(event.description).toBe(
      'Price: $10.00\n\nTerms: 1 < 2 and 2 > 1\n\nA&B Company\n\nLine <with> angle brackets <strong>not</strong> HTML'
    );
  });

  it('skips empty-string descriptions', async () => {
    const event = await prisma.event.findUnique({ where: { id: ids.emptyString } });
    expect(event.description).toBe('');
  });

  it('skips null descriptions', async () => {
    const event = await prisma.event.findUnique({ where: { id: ids.nullDesc } });
    expect(event.description).toBeNull();
  });

  // ── Dry-run ───────────────────────────────────────────────────────

  it('dry-run does not write changes to the DB', async () => {
    const dryEvent = await prisma.event.create({
      data: {
        venueId,
        date: FUTURE,
        capacity: 100,
        name: 'Dry-run test event',
        description: 'This should stay plain in dry-run.',
      },
    });

    const plan = await runBackfill({ dry: dryEvent.id }, { dryRun: true });

    const converts = plan.filter((d) => d.action === 'CONVERT');
    expect(converts.length).toBeGreaterThanOrEqual(1);

    // DB should still hold the plain text
    const after = await prisma.event.findUnique({ where: { id: dryEvent.id } });
    expect(after.description).toBe('This should stay plain in dry-run.');

    await prisma.event.deleteMany({ where: { id: dryEvent.id } });
  });

  // ── Idempotency ───────────────────────────────────────────────────

  it('second run produces no CONVERT decisions (idempotent)', async () => {
    const plan = await runBackfill(ids, { dryRun: true });
    expect(plan.every((d) => d.action !== 'CONVERT')).toBe(true);
  });
});
