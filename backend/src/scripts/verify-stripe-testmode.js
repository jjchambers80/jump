#!/usr/bin/env node
/**
 * Stripe test-mode verification (EVE-3).
 *
 * Reads the platform account's configuration and then *exercises* the money
 * paths that matter, because "the code looks right" is not evidence that a
 * dollar behaved. Prints a transcript with real Stripe object ids.
 *
 *   npm run verify:stripe            # read-only configuration report
 *   npm run verify:stripe -- --charge  # also run a live test-mode charge + refund
 *
 * REFUSES to run against a live key. Every id it prints is a test-mode object.
 * Nothing here is part of `npm test`: the suite must stay offline and
 * deterministic (root AGENTS.md), and this talks to Stripe over the network.
 */

import 'dotenv/config';
import Stripe from 'stripe';
import { refundIdempotencyKey } from '../services/stripeRefund.js';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}
if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) {
  console.error('Refusing to run: STRIPE_SECRET_KEY is not a test-mode key.');
  console.error('This script creates and refunds charges. It must never touch live mode.');
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: '2024-11-20.acacia' });
const doCharge = process.argv.includes('--charge');

const out = [];
const log = (line = '') => {
  out.push(line);
  console.log(line);
};
const h = (title) => {
  log('');
  log(`── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
};
const yn = (v) => (v ? 'yes' : 'NO');
const money = (cents, currency = 'usd') => `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;

async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    log(`  ${label}: unavailable — ${err.message}`);
    return null;
  }
}

async function account() {
  h('Platform account');
  const acct = await stripe.accounts.retrieve();
  log(`  account            ${acct.id}`);
  log(`  country / currency ${acct.country} / ${(acct.default_currency || '').toUpperCase()}`);
  log(`  charges enabled    ${yn(acct.charges_enabled)}`);
  log(`  payouts enabled    ${yn(acct.payouts_enabled)}`);
  log(`  statement prefix   ${acct.settings?.card_payments?.statement_descriptor_prefix || '(unset)'}`);
  return acct;
}

async function connect() {
  h('Stripe Connect');
  log(`  STRIPE_CONNECT_ENABLED   ${process.env.STRIPE_CONNECT_ENABLED || '(unset — destination charges are off)'}`);
  const accounts = await safe('connected accounts', () => stripe.accounts.list({ limit: 5 }));
  if (!accounts) return;
  log(`  connected accounts       ${accounts.data.length}`);
  for (const a of accounts.data) {
    const caps = a.capabilities || {};
    log(
      `    ${a.id}  type=${a.type}  charges=${yn(a.charges_enabled)}  payouts=${yn(a.payouts_enabled)}` +
        `  transfers=${caps.transfers || 'none'}  card_payments=${caps.card_payments || 'none'}`
    );
    if (a.requirements?.currently_due?.length) {
      log(`      currently due: ${a.requirements.currently_due.join(', ')}`);
    }
  }
  if (accounts.data.length === 0) {
    log('    (none — no organizer has onboarded in test mode yet)');
  }
}

async function tax() {
  h('Stripe Tax');
  const settings = await safe('tax settings', () => stripe.tax.settings.retrieve());
  if (settings) {
    log(`  status                   ${settings.status}`);
    if (settings.status_details?.pending?.missing_fields?.length) {
      log(`  missing before active    ${settings.status_details.pending.missing_fields.join(', ')}`);
    }
    log(`  default tax behavior     ${settings.defaults?.tax_behavior || '(unset)'}`);
    log(`  default tax code         ${settings.defaults?.tax_code || '(unset)'}`);
    const origin = settings.head_office?.address;
    log(`  head office              ${origin ? `${origin.line1 || ''} ${origin.city || ''} ${origin.state || ''} ${origin.postal_code || ''}`.trim() : '(unset)'}`);
  }
  const regs = await safe('registrations', () => stripe.tax.registrations.list({ limit: 20 }));
  if (regs) {
    const active = regs.data.filter((r) => r.status === 'active');
    log(`  active registrations     ${active.length}`);
    for (const r of regs.data) {
      log(`    ${r.country}${r.country_options ? `/${Object.keys(r.country_options.us || {}).join(',') || ''}` : ''} ${r.id}  status=${r.status}`);
    }
    if (regs.data.length === 0) {
      log('    (none — every Stripe Tax lookup will return 0%, which means');
      log('     "not registered here", NOT "this sale is tax-free")');
    }
  }
}

/** A real tax calculation. The number below is Stripe's, not ours. */
async function taxCalculation() {
  h('Stripe Tax — live calculation (test mode)');
  const calc = await safe('calculation', () =>
    stripe.tax.calculations.create({
      currency: 'usd',
      line_items: [
        { amount: 5000, reference: 'ga-ticket-x2', tax_behavior: 'exclusive', tax_code: 'txcd_90020001' },
      ],
      customer_details: {
        address: { line1: '500 S McDowell St', city: 'Raleigh', state: 'NC', postal_code: '27601', country: 'US' },
        address_source: 'billing',
      },
    })
  );
  if (!calc) return;
  log(`  calculation        ${calc.id}`);
  log(`  subtotal           ${money(calc.amount_total - calc.tax_amount_exclusive, calc.currency)}`);
  log(`  tax               ${calc.tax_amount_exclusive === 0 ? ' ' : ' '}${money(calc.tax_amount_exclusive, calc.currency)}`);
  log(`  total              ${money(calc.amount_total, calc.currency)}`);
  for (const b of calc.tax_breakdown || []) {
    log(`    ${b.jurisdiction?.display_name || b.jurisdiction?.level || 'jurisdiction'}: ${(Number(b.tax_rate_details?.percentage_decimal) || 0).toFixed(4)}%  ${money(b.amount, calc.currency)}  taxability=${b.taxability_reason}`);
  }
  if (calc.tax_amount_exclusive === 0) {
    log('  ⚠ 0.00 tax. With no active registration this is "not registered",');
    log('    not "tax-free" — TaxService.getTaxRateForVenue throws on this so a');
    log('    0% is never silently billed to a buyer.');
  }
}

async function billing() {
  h('Subscription billing');
  log(`  BILLING_ENABLED          ${process.env.BILLING_ENABLED || '(unset — signup skips the subscribe step)'}`);
  log(`  JUMP_STARTER_PRICE_ID    ${process.env.JUMP_STARTER_PRICE_ID || '(unset — billing stays off even if enabled)'}`);
  log(`  BILLING_TRIAL_DAYS       ${process.env.BILLING_TRIAL_DAYS || '(unset — defaults to 30)'}`);
  const prices = await safe('prices', () => stripe.prices.list({ active: true, type: 'recurring', limit: 20, expand: ['data.product'] }));
  if (!prices) return;
  log(`  active recurring prices  ${prices.data.length}`);
  for (const p of prices.data) {
    const r = p.recurring;
    log(`    ${p.id}  ${money(p.unit_amount ?? 0, p.currency)} / ${r?.interval_count && r.interval_count > 1 ? `${r.interval_count} ` : ''}${r?.interval}  product="${p.product?.name ?? p.product}"`);
  }
  if (prices.data.length === 0) {
    log('    (none — the founder has not created a plan price yet; this is the');
    log('     open pricing decision, not a code gap)');
  }
}

async function webhooks() {
  h('Registered webhook endpoints');
  const eps = await safe('endpoints', () => stripe.webhookEndpoints.list({ limit: 20 }));
  if (!eps) return;
  if (eps.data.length === 0) log('  (none registered in test mode)');
  for (const e of eps.data) {
    log(`  ${e.id}  ${e.status}  ${e.url}`);
    log(`    connect=${yn(e.application === null ? false : true)}  api_version=${e.api_version || '(account default)'}`);
    log(`    events: ${e.enabled_events.join(', ')}`);
  }
  log('');
  log('  Local env (names only, never values):');
  for (const n of ['STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET', 'STRIPE_BILLING_WEBHOOK_SECRET']) {
    log(`    ${n.padEnd(30)} ${process.env[n] ? 'set' : 'NOT SET'}`);
  }
}

/**
 * The part that is actually evidence: charge a test card, then refund it twice
 * with the same idempotency key and show Stripe returned one refund, not two.
 */
async function chargeAndRefund() {
  h('Test-mode charge → double refund with one idempotency key');

  const intent = await stripe.paymentIntents.create(
    {
      amount: 5000,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      description: 'EVE-3 refund idempotency verification',
      metadata: { source: 'jump-platform', purpose: 'eve-3-verification' },
    },
    { idempotencyKey: `jump:verify:pi:${Date.now()}` }
  );
  log(`  payment intent     ${intent.id}  ${money(intent.amount, intent.currency)}  status=${intent.status}`);
  if (intent.status !== 'succeeded') {
    log('  charge did not succeed; skipping the refund comparison');
    return;
  }

  // A stable key derived from the operation, exactly as RefundService builds it.
  const scope = `order:verify_${intent.id}:full`;
  const idempotencyKey = refundIdempotencyKey(scope);
  log(`  idempotency key    ${idempotencyKey}`);

  const body = {
    payment_intent: intent.id,
    amount: 5000,
    metadata: { source: 'jump-platform', purpose: 'eve-3-verification' },
  };

  const first = await stripe.refunds.create(body, { idempotencyKey });
  log(`  refund #1          ${first.id}  ${money(first.amount, first.currency)}  status=${first.status}`);

  // The retry an operator's second click, or a rolled-back transaction, causes.
  const second = await stripe.refunds.create(body, { idempotencyKey });
  log(`  refund #2 (retry)  ${second.id}  ${money(second.amount, second.currency)}  status=${second.status}`);

  const all = await stripe.refunds.list({ payment_intent: intent.id, limit: 10 });
  const total = all.data.reduce((sum, r) => sum + r.amount, 0);
  log('');
  log(`  refunds on this intent, per Stripe: ${all.data.length}`);
  log(`  total refunded:                     ${money(total, intent.currency)} of ${money(intent.amount, intent.currency)}`);

  const ok = first.id === second.id && all.data.length === 1 && total === intent.amount;
  log('');
  log(ok ? '  ✅ PASS — the retry replayed the first refund. The customer was refunded once.' : '  ❌ FAIL — the retry created a second refund.');

  // Control: the same charge, a *different* key, is a different operation and
  // Stripe would happily refund again. This is what the key is preventing.
  log('');
  log('  Control: without the key, Stripe treats a retry as a new refund —');
  log('  it is rejected here only because the charge is already fully refunded:');
  try {
    await stripe.refunds.create(body);
    log('    (unexpectedly accepted)');
  } catch (err) {
    log(`    ${err.code || err.type}: ${err.message}`);
  }

  if (!ok) process.exitCode = 1;
}

async function main() {
  log(`Stripe test-mode verification — ${new Date().toISOString()}`);
  log(`API version 2024-11-20.acacia · key mode: TEST`);
  await account();
  await connect();
  await tax();
  await taxCalculation();
  await billing();
  await webhooks();
  if (doCharge) await chargeAndRefund();
  else {
    h('Skipped');
    log('  Re-run with `-- --charge` to execute a test-mode charge and the');
    log('  double-refund idempotency check.');
  }
  log('');
}

main().catch((err) => {
  console.error(`\nverify-stripe-testmode failed: ${err.message}`);
  process.exit(1);
});
