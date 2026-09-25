// Stripe webhook signature verification (contract)
// The platform and Connect webhook routes must see the raw request bytes:
// a global express.json() ahead of express.raw() makes constructEvent throw
// "Webhook payload must be provided as a string or a Buffer" for every event
// once STRIPE_WEBHOOK_SECRET is set. Uses the real stripe library's signing
// helper — no mocks — so this fails if the middleware order regresses.

import { jest } from '@jest/globals';
import request from 'supertest';
import Stripe from 'stripe';

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_webhook_signature';

// The ledger entry point behind checkout.session.completed. Stubbed so the
// unsigned-event cases can assert the strong thing — that a forged event never
// reaches it — and so the handler-failure case can throw deterministically
// without mocking the database. Nothing else in this file touches it.
const handleCheckoutCompleted = jest.fn(async () => {});
jest.unstable_mockModule('../../src/services/PaymentService.js', () => ({
  default: {
    handleCheckoutCompleted,
    handleCheckoutFailed: jest.fn(async () => {}),
  },
}));

// Same idea for the Connect endpoint's dispatch target.
const applyAccount = jest.fn(async () => null);
jest.unstable_mockModule('../../src/services/ConnectService.js', () => ({
  default: {
    applyAccount,
    markDisconnected: jest.fn(async () => {}),
    recordPayout: jest.fn(async () => {}),
  },
}));

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

// An endpoint with no signing secret is an unauthenticated write path into the
// ledger: a forged checkout.session.completed issues tickets for free, and the
// same body with metadata.applicationId confirms a vendor booth for free. The
// fail-open branch survived because every case above configures a secret.
describe('Stripe webhook without a signing secret', () => {
  const previous = {
    platform: process.env.STRIPE_WEBHOOK_SECRET,
    connect: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    billing: process.env.STRIPE_BILLING_WEBHOOK_SECRET,
    allowUnsigned: process.env.STRIPE_WEBHOOK_ALLOW_UNSIGNED,
  };
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = '';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = '';
    process.env.STRIPE_BILLING_WEBHOOK_SECRET = '';
  });
  afterAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = previous.platform ?? '';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = previous.connect ?? '';
    process.env.STRIPE_BILLING_WEBHOOK_SECRET = previous.billing ?? '';
    process.env.STRIPE_WEBHOOK_ALLOW_UNSIGNED = previous.allowUnsigned ?? '';
  });

  // The exact shape that reached PaymentService.handleCheckoutCompleted in the
  // EVE-18 probe: no stripe-signature header at all.
  const forgedPaid = JSON.stringify({
    id: 'evt_unsigned_forged',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_forged_by_attacker', payment_status: 'paid', payment_intent: 'pi_forged' } },
  });
  const connectEvent = JSON.stringify({
    id: 'evt_unsigned_connect',
    object: 'event',
    account: 'acct_unsigned',
    type: 'account.updated',
    data: { object: { id: 'acct_unsigned' } },
  });
  const billingEvent = JSON.stringify({
    id: 'evt_unsigned_billing',
    object: 'event',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_unsigned' } },
  });

  const post = (path, body) => request(app).post(path).set('Content-Type', 'application/json').send(body);

  describe('with unsigned events not opted in (production default)', () => {
    beforeEach(() => {
      delete process.env.STRIPE_WEBHOOK_ALLOW_UNSIGNED;
      handleCheckoutCompleted.mockClear();
    });

    it.each([
      ['/webhooks/stripe', forgedPaid],
      ['/webhooks/stripe/connect', connectEvent],
      ['/webhooks/stripe/billing', billingEvent],
    ])('refuses an unsigned event on %s', async (path, body) => {
      const res = await post(path, body);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Webhook signature verification is not configured' });
      // Never acknowledged, so a real event stays on Stripe's retry schedule
      expect(res.body.received).toBeUndefined();
    });

    it('never dispatches the forged paid checkout to the ledger', async () => {
      await post('/webhooks/stripe', forgedPaid);
      expect(handleCheckoutCompleted).not.toHaveBeenCalled();
    });

    it('refuses even with a plausible-looking signature header', async () => {
      const res = await post('/webhooks/stripe', forgedPaid).set('stripe-signature', signed(forgedPaid, SECRET));
      expect(res.status).toBe(500);
      expect(res.body.received).toBeUndefined();
    });

    it('is not swayed by NODE_ENV — the guard is the explicit flag', async () => {
      const node = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const res = await post('/webhooks/stripe', forgedPaid);
        expect(res.status).toBe(500);
      } finally {
        process.env.NODE_ENV = node;
      }
    });

    it.each([['false'], [''], ['1'], ['yes'], ['TRUE']])(
      'treats STRIPE_WEBHOOK_ALLOW_UNSIGNED=%p as not opted in',
      async (value) => {
        process.env.STRIPE_WEBHOOK_ALLOW_UNSIGNED = value;
        const res = await post('/webhooks/stripe', forgedPaid);
        expect(res.status).toBe(500);
      },
    );
  });

  describe('with STRIPE_WEBHOOK_ALLOW_UNSIGNED=true (local development)', () => {
    beforeEach(() => {
      process.env.STRIPE_WEBHOOK_ALLOW_UNSIGNED = 'true';
    });

    it('accepts an unsigned event so `stripe trigger` still works locally', async () => {
      const ping = JSON.stringify({ id: 'evt_unsigned_ping', object: 'event', type: 'ping.contract_test', data: { object: { id: 'x' } } });
      const res = await post('/webhooks/stripe', ping);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
    });
  });
});

// A 200 on an unexpected exception tells Stripe the event was handled, so the
// transition it carried is lost for good. Only the billing endpoint got this
// right before; the platform and Connect endpoints swallowed the failure.
describe('Stripe webhook handler failures', () => {
  const previous = { platform: process.env.STRIPE_WEBHOOK_SECRET, connect: process.env.STRIPE_CONNECT_WEBHOOK_SECRET };
  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;
  });
  afterAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = previous.platform ?? '';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = previous.connect ?? '';
  });

  it('answers 500 when the platform handler throws, so Stripe retries', async () => {
    // Stand in for the transient database failure from the EVE-18 probe: a
    // correctly signed, genuine paid checkout whose handler blows up.
    handleCheckoutCompleted.mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
    const body = JSON.stringify({
      id: 'evt_handler_throws',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_handler_throws', payment_status: 'paid', payment_intent: 'pi_handler_throws' } },
    });
    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', signed(body, SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(handleCheckoutCompleted).toHaveBeenCalledWith('cs_handler_throws', 'pi_handler_throws');
    expect(res.status).toBe(500);
    // Nothing that reads as an acknowledgement — a 200 here loses the order
    expect(res.body.received).toBeUndefined();
  });

  it('still answers 200 for an event it deliberately ignores', async () => {
    // A billing event registered on the platform endpoint by mistake is not a
    // failure — acknowledging it stops Stripe retrying something we will never
    // process here.
    const body = JSON.stringify({
      id: 'evt_billing_on_platform',
      object: 'event',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_ignored' } },
    });
    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', signed(body, SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, ignored: true });
  });

  it('answers 500 when the Connect handler throws', async () => {
    applyAccount.mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
    const body = JSON.stringify({
      id: 'evt_connect_throws',
      object: 'event',
      account: 'acct_throws',
      type: 'account.updated',
      data: { object: { id: 'acct_throws' } },
    });
    const res = await request(app)
      .post('/webhooks/stripe/connect')
      .set('stripe-signature', signed(body, CONNECT_SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(500);
    expect(res.body.received).toBeUndefined();
  });

  it('still answers 200 for a Connect event with no account id', async () => {
    const body = JSON.stringify({ id: 'evt_connect_no_acct', object: 'event', type: 'account.updated', data: { object: {} } });
    const res = await request(app)
      .post('/webhooks/stripe/connect')
      .set('stripe-signature', signed(body, CONNECT_SECRET))
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
