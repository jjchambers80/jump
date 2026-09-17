// Stripe webhook signature verification (contract)
// The Stripe webhook route must see the raw request bytes:
// a global express.json() ahead of express.raw() makes constructEvent throw
// "Webhook payload must be provided as a string or a Buffer" for every event
// once STRIPE_WEBHOOK_SECRET is set. Uses the real stripe library's signing
// helper — no mocks — so this fails if the middleware order regresses.

import request from 'supertest';
import Stripe from 'stripe';

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_webhook_signature';
const { default: app } = await import('../../src/api/server.js');

const SECRET = 'whsec_contract_test_secret';

function signed(payload, secret) {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

describe('Stripe webhook signature', () => {
  const previous = process.env.STRIPE_WEBHOOK_SECRET;
  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previous;
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

  it('other JSON routes still parse bodies', async () => {
    const res = await request(app).post('/orders').send({ nope: true });
    expect(res.status).not.toBe(500);
    expect(res.headers['content-type']).toMatch(/json/);
  });
});
