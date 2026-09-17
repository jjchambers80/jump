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
