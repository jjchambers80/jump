// Stripe webhook signature verification (contract)
// The platform and Connect webhook routes must see the raw request bytes:
// a global express.json() ahead of express.raw() makes constructEvent throw
// "Webhook payload must be provided as a string or a Buffer" for every event
// once STRIPE_WEBHOOK_SECRET is set. Uses the real stripe library's signing
// helper — no mocks — so this fails if the middleware order regresses.

import request from 'supertest';
import Stripe from 'stripe';

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_webhook_signature';
const { default: app } = await import('../../src/api/server.js');

const SECRET = 'whsec_contract_test_secret';
const CONNECT_SECRET = 'whsec_contract_test_connect';

function signed(payload, secret) {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

describe('Stripe webhook signature', () => {
  const previous = { platform: process.env.STRIPE_WEBHOOK_SECRET, connect: process.env.STRIPE_CONNECT_WEBHOOK_SECRET };
  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;
  });
  afterAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = previous.platform ?? '';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = previous.connect ?? '';
  });

  const event = JSON.stringify({ id: 'evt_sig_test', object: 'event', type: 'ping.contract_test', data: { object: { id: 'x' } } });

  it('accepts a correctly signed platform event (raw body reaches constructEvent)', async () => {
    const res = await request(app).post('/webhooks/stripe').set('stripe-signature', signed(event, SECRET)).set('Content-Type', 'application/json').send(event);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('rejects a bad signature and a tampered body', async () => {
    let res = await request(app).post('/webhooks/stripe').set('stripe-signature', 't=1,v1=deadbeef').set('Content-Type', 'application/json').send(event);
    expect(res.status).toBe(400);
    res = await request(app).post('/webhooks/stripe').set('stripe-signature', signed(event, SECRET)).set('Content-Type', 'application/json').send(event.replace('evt_sig_test', 'evt_other'));
    expect(res.status).toBe(400);
  });

  it('accepts a correctly signed Connect event', async () => {
    const connectEvent = JSON.stringify({ id: 'evt_sig_connect', object: 'event', account: 'acct_contract', type: 'ping.contract_test', data: { object: { id: 'x' } } });
    const res = await request(app).post('/webhooks/stripe/connect').set('stripe-signature', signed(connectEvent, CONNECT_SECRET)).set('Content-Type', 'application/json').send(connectEvent);
    expect(res.status).toBe(200);
  });

  it('other JSON routes still parse bodies', async () => {
    const res = await request(app).post('/orders').send({ nope: true });
    expect(res.status).not.toBe(500);
    expect(res.headers['content-type']).toMatch(/json/);
  });
});

// An endpoint that accepts unsigned events is an unauthenticated write path
// into the ledger. Outside production a missing secret is a convenience (the
// Stripe CLI signs with its own secret); in production it must fail closed, so
// a missing or mistyped Railway variable cannot silently open that path.
describe('Stripe webhook endpoints with no signing secret configured', () => {
  const ENDPOINTS = [
    ['platform', '/webhooks/stripe', 'STRIPE_WEBHOOK_SECRET'],
    ['Connect', '/webhooks/stripe/connect', 'STRIPE_CONNECT_WEBHOOK_SECRET'],
    ['billing', '/webhooks/stripe/billing', 'STRIPE_BILLING_WEBHOOK_SECRET'],
  ];
  const SECRET_NAMES = ENDPOINTS.map(([, , name]) => name);
  const previous = {};
  const event = JSON.stringify({ id: 'evt_unsigned', object: 'event', account: 'acct_x', type: 'ping.contract_test', data: { object: { id: 'x' } } });

  beforeAll(() => {
    previous.nodeEnv = process.env.NODE_ENV;
    for (const name of SECRET_NAMES) previous[name] = process.env[name];
  });
  afterAll(() => {
    process.env.NODE_ENV = previous.nodeEnv;
    for (const name of SECRET_NAMES) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });

  beforeEach(() => {
    for (const name of SECRET_NAMES) delete process.env[name];
  });

  describe.each(ENDPOINTS)('%s endpoint', (label, path) => {
    it('rejects an unsigned event with 503 under NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production';
      const res = await request(app).post(path).set('Content-Type', 'application/json').send(event);
      // 503, not 400: Stripe keeps retrying, so the events survive until the
      // secret is configured rather than being dropped on the floor.
      expect(res.status).toBe(503);
      expect(res.text).toMatch(/signing secret not configured/);
    });

    it('rejects an attacker-signed event with 503 under NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production';
      const res = await request(app)
        .post(path)
        .set('stripe-signature', signed(event, 'whsec_attacker_chosen'))
        .set('Content-Type', 'application/json')
        .send(event);
      expect(res.status).toBe(503);
    });

    it('still accepts an unsigned event outside production', async () => {
      process.env.NODE_ENV = 'test';
      const res = await request(app).post(path).set('Content-Type', 'application/json').send(event);
      expect(res.status).toBe(200);
    });
  });
});
