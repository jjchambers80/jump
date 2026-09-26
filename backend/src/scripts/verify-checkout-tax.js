#!/usr/bin/env node
/**
 * End-to-end checkout + tax verification against Stripe test mode (EVE-3).
 *
 * Builds a throwaway organization / venue / event / tier in the database,
 * drives the *real* `OrderService.createOrder`, and compares three numbers that
 * must agree to the cent:
 *
 *   TaxService's resolved rate  →  the Order row's amounts  →  what Stripe
 *   will actually charge the buyer (`checkout.session.amount_total`).
 *
 * A code read cannot tell you those three agree. This can.
 *
 *   npm run verify:checkout-tax
 *
 * REFUSES a live key. Creates one real test-mode Checkout Session (never paid,
 * so no money moves) and deletes every row it made. Point it at the test
 * database, not a database with real orders:
 *
 *   TEST_DATABASE_URL=postgresql://…/jump_test npm run verify:checkout-tax
 */

import 'dotenv/config';

const key = process.env.STRIPE_SECRET_KEY;
if (!key || (!key.startsWith('sk_test_') && !key.startsWith('rk_test_'))) {
  console.error('Refusing to run: STRIPE_SECRET_KEY must be a test-mode key.');
  process.exit(1);
}
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { prisma } = await import('@jump/db');
const { default: OrderService } = await import('../services/OrderService.js');
const { default: TaxService } = await import('../services/TaxService.js');
const { default: stripe } = await import('../config/stripe.js');

const RUN = `${Date.now()}`;
const TAG = `taxverify${RUN}`;
const cents = (d) => Math.round(Number(d) * 100);
const usd = (d) => `$${Number(d).toFixed(2)}`;
const log = console.log;
const h = (t) => {
  log('');
  log(`── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`);
};

let org;
let failures = 0;
const check = (ok, label, detail) => {
  log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function main() {
  log(`Checkout + tax verification — ${new Date().toISOString()}`);
  log(`Stripe key mode: TEST · database: ${(process.env.DATABASE_URL || '').replace(/\/\/[^@]*@/, '//***@')}`);

  h('Fixture');
  org = await prisma.organization.create({
    data: { name: `${TAG} Co`, email: `owner@${TAG}.test` },
  });
  // North Carolina at a flat 7.25%, which is how the platform is configured
  // today: Stripe Tax is not active, so MANUAL is the mode that will run at
  // launch. Changing this row to source STRIPE is what activation switches on.
  await prisma.taxRegion.create({
    data: { organizationId: org.id, country: 'US', region: 'NC', collecting: true, source: 'MANUAL', manualRate: 0.0725 },
  });
  const venue = await prisma.venue.create({
    data: {
      organizationId: org.id,
      name: `${TAG} Hall`,
      address: '500 S McDowell St',
      city: 'Raleigh',
      state: 'NC',
      postalCode: '27601',
    },
  });
  const resolved = await TaxService.rateForVenue(org.id, venue);
  log(`  organization       ${org.id}`);
  log(`  venue              Raleigh, NC 27601`);
  log(`  resolved tax rate  ${(resolved.rate * 100).toFixed(3)}%  source=${resolved.source}  error=${resolved.error ?? 'none'}`);

  const event = await prisma.event.create({
    data: {
      venueId: venue.id,
      name: `${TAG} Expo`,
      date: new Date(Date.now() + 30 * 864e5),
      status: 'PUBLISHED',
      capacity: 100,
      taxRate: resolved.rate,
      taxRateSource: resolved.source,
    },
  });
  const tier = await prisma.priceTier.create({
    data: { eventId: event.id, name: 'General Admission', price: 50, quantityTotal: 100 },
  });
  log(`  event              ${event.id}  tier $50.00 × 2`);

  h('Real checkout through OrderService.createOrder');
  const created = await OrderService.createOrder({
    eventId: event.id,
    items: [{ priceTierId: tier.id, quantity: 2 }],
    contact: { email: `buyer@${TAG}.test`, firstName: 'Tess', lastName: 'Buyer' },
  });

  const row = await prisma.order.findUnique({ where: { id: created.orderId } });
  const subtotal = Number(row.subtotalAmount);
  const tax = Number(row.taxAmount);
  const total = Number(row.totalAmount);
  const fees = total - subtotal - tax;

  log(`  order              ${row.orderRef}  (${row.id})`);
  log('');
  log(`    subtotal (2 × $50.00)      ${usd(subtotal).padStart(9)}`);
  log(`    platform + processing fees ${usd(fees).padStart(9)}`);
  log(`    tax @ ${(resolved.rate * 100).toFixed(3)}% of subtotal   ${usd(tax).padStart(9)}   ← the tax line`);
  log(`    ${'─'.repeat(42)}`);
  log(`    buyer pays                 ${usd(total).padStart(9)}`);

  h('What Stripe will actually charge');
  const stripeSessionId = row.stripeSessionId;
  const session = await stripe.checkout.sessions.retrieve(stripeSessionId, { expand: ['line_items'] });
  log(`  checkout session   ${session.id}`);
  log(`  status             ${session.status} / ${session.payment_status}  (never paid — no money moves here)`);
  log(`  amount_total       ${usd(session.amount_total / 100)}`);
  for (const li of session.line_items?.data ?? []) {
    log(`    ${li.quantity} × ${usd(li.price.unit_amount / 100)}  "${li.description}"`);
  }
  log(`  url                ${String(created.stripeCheckoutUrl ?? session.url).slice(0, 72)}…`);

  h('Assertions');
  const expectedTax = Math.round(subtotal * resolved.rate * 100) / 100;
  check(resolved.source === 'MANUAL' && resolved.rate === 0.0725, 'TaxService resolved the venue state to the configured 7.25% MANUAL rate');
  check(tax === expectedTax, `Order.taxAmount equals subtotal × rate`, `${usd(tax)} == ${usd(expectedTax)}`);
  check(Math.abs(total - (subtotal + fees + tax)) < 0.005, 'Order total is subtotal + fees + tax');
  check(session.amount_total === cents(total), 'Stripe will charge exactly the order total', `${session.amount_total} == ${cents(total)} cents`);
  check(cents(total) === session.line_items.data.reduce((s, li) => s + li.amount_total, 0), 'Line items sum to the total (all-in FTC pricing: tax is inside the ticket price, not a separate Stripe line)');

  h('Control: what a Stripe-Tax-sourced region does right now');
  // The dangerous failure is a silent 0% that looks like "this sale is tax
  // free" when it really means "the platform is not registered here". Prove
  // the lookup fails loudly instead.
  try {
    const rate = await TaxService.getTaxRateForVenue('27601', 'US');
    check(false, `getTaxRateForVenue returned ${(rate * 100).toFixed(3)}% instead of throwing`);
  } catch (err) {
    check(true, 'getTaxRateForVenue throws rather than returning a silent 0%', `→ ${err.message.split('\n')[0].slice(0, 90)}`);
  }
  const stripeRegion = await prisma.taxRegion.create({
    data: { organizationId: org.id, country: 'US', region: 'NY', collecting: true, source: 'STRIPE' },
  });
  const nyVenue = await prisma.venue.create({
    data: { organizationId: org.id, name: `${TAG} NY`, address: '1 Broadway', city: 'New York', state: 'NY', postalCode: '10004' },
  });
  const nyResult = await TaxService.rateForVenue(org.id, nyVenue);
  log(`  NY (source=STRIPE) → rate ${(nyResult.rate * 100).toFixed(3)}%  error="${nyResult.error ?? 'none'}"`);
  check(nyResult.rate === 0 && Boolean(nyResult.error), 'a STRIPE-sourced region with no registration records the error on the region row, so Settings shows why it is 0%');
  const persisted = await prisma.taxRegion.findUnique({ where: { id: stripeRegion.id } });
  check(Boolean(persisted.lastError), 'TaxRegion.lastError is persisted for the settings page', `"${(persisted.lastError || '').slice(0, 60)}"`);

  h(failures === 0 ? 'PASS' : 'FAIL');
  log(`  ${failures === 0 ? 'Every assertion held.' : `${failures} assertion(s) failed.`}`);
  log(`  Stripe test-mode objects created: ${session.id}`);
  log('');
  if (failures > 0) process.exitCode = 1;
}

async function cleanup() {
  if (!org) return;
  const where = { event: { venue: { organizationId: org.id } } };
  await prisma.orderItem.deleteMany({ where: { order: where } }).catch(() => {});
  await prisma.paymentTransaction.deleteMany({ where: { order: where } }).catch(() => {});
  await prisma.order.deleteMany({ where }).catch(() => {});
  await prisma.priceTier.deleteMany({ where }).catch(() => {});
  await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } }).catch(() => {});
  await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
  await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
  await prisma.taxRegion.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
}

try {
  await main();
} catch (err) {
  console.error(`\nverify-checkout-tax failed: ${err.stack || err.message}`);
  process.exitCode = 1;
} finally {
  await cleanup();
  await prisma.$disconnect();
}
