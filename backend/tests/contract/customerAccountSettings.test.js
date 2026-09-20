// Contract tests for Settings › Customer accounts (spec 031 phase 1).

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { platformBaseUrl } from '../../src/utils/storefrontUrl.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'cust-acct-ct';
const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];
const PATH = '/admin/settings/customer-accounts';

describe('Customer account settings contract', () => {
  let organization;
  let otherOrganization;
  let adminToken;
  let organizerToken;
  let otherToken;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});

    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[2], role: 'ADMIN' });

    organization = await prisma.organization.create({ data: { name: `${TAG} Store` } });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrganization.id, 'ADMIN');
  });

  afterAll(async () => {
    await prisma.organizationDomain
      .deleteMany({ where: { organizationId: { in: [organization.id, otherOrganization.id] } } })
      .catch(() => {});
    await prisma.organization
      .deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } })
      .catch(() => {});
    await cleanupStaff(emails);
  });

  it('returns defaults with the platform account URL for a fresh organization', async () => {
    const response = await request(app).get(PATH).set(...auth(organizerToken));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      buyerSignInLinks: true,
      refundPolicy: { enabled: true, cutoffHours: null, feeType: 'NONE', feeValue: null },
      signInMethod: 'LINK',
      accountUrl: `${platformBaseUrl()}/organizations/${organization.id}/account`,
      domain: null,
    });
  });

  it('organizers can read but not write; unknown and non-boolean fields are rejected', async () => {
    const forbidden = await request(app).patch(PATH).set(...auth(organizerToken)).send({ buyerSignInLinks: false });
    expect(forbidden.status).toBe(403);

    const unknown = await request(app).patch(PATH).set(...auth(adminToken)).send({ storefrontPrivate: true });
    expect(unknown.status).toBe(400);
    expect(unknown.body.details[0].field).toBe('storefrontPrivate');

    const wrongType = await request(app).patch(PATH).set(...auth(adminToken)).send({ buyerSignInLinks: 'no' });
    expect(wrongType.status).toBe(400);

    const empty = await request(app).patch(PATH).set(...auth(adminToken)).send({});
    expect(empty.status).toBe(400);
  });

  it('turns the sign-in links off and on per organization, and the public payload follows', async () => {
    const off = await request(app).patch(PATH).set(...auth(adminToken)).send({ buyerSignInLinks: false });
    expect(off.status).toBe(200);
    expect(off.body.buyerSignInLinks).toBe(false);

    const pub = await request(app).get(`/organizations/${organization.id}/public`);
    expect(pub.status).toBe(200);
    expect(pub.body.organization.buyerSignInLinks).toBe(false);

    // The other organization is untouched and its admin cannot reach this one.
    const other = await request(app).get(PATH).set(...auth(otherToken));
    expect(other.body.buyerSignInLinks).toBe(true);
    const crossOrg = await request(app)
      .get(PATH)
      .set(...auth(otherToken))
      .set('X-Jump-Org', organization.id);
    expect(crossOrg.body.buyerSignInLinks).toBe(true);

    const on = await request(app).patch(PATH).set(...auth(adminToken)).send({ buyerSignInLinks: true });
    expect(on.body.buyerSignInLinks).toBe(true);
  });

  it('saves the refund policy and enforces fee-type / value pairing', async () => {
    const saved = await request(app)
      .patch(PATH)
      .set(...auth(adminToken))
      .send({ selfServeRefundCutoffHours: 48, selfServeRefundFeeType: 'FIXED', selfServeRefundFeeValue: 2.5 });
    expect(saved.status).toBe(200);
    expect(saved.body.refundPolicy).toEqual({ enabled: true, cutoffHours: 48, feeType: 'FIXED', feeValue: 2.5 });

    // A fee type without a value (existing null) is refused; NONE clears the value.
    await request(app).patch(PATH).set(...auth(adminToken)).send({ selfServeRefundFeeType: 'NONE' });
    const missing = await request(app).patch(PATH).set(...auth(adminToken)).send({ selfServeRefundFeeType: 'PERCENT' });
    expect(missing.status).toBe(400);
    expect(missing.body.details[0].field).toBe('selfServeRefundFeeValue');
    const over = await request(app).patch(PATH).set(...auth(adminToken)).send({ selfServeRefundFeeType: 'PERCENT', selfServeRefundFeeValue: 150 });
    expect(over.status).toBe(400);
    const badCutoff = await request(app).patch(PATH).set(...auth(adminToken)).send({ selfServeRefundCutoffHours: 1.5 });
    expect(badCutoff.status).toBe(400);
    const badType = await request(app).patch(PATH).set(...auth(adminToken)).send({ selfServeRefundFeeType: 'FLAT' });
    expect(badType.status).toBe(400);

    const cleared = await request(app).patch(PATH).set(...auth(adminToken)).send({ selfServeRefundsEnabled: false, selfServeRefundCutoffHours: null });
    expect(cleared.body.refundPolicy).toEqual({ enabled: false, cutoffHours: null, feeType: 'NONE', feeValue: null });
    await request(app).patch(PATH).set(...auth(adminToken)).send({ selfServeRefundsEnabled: true });
  });

  it('resolves the account URL on the active custom domain', async () => {
    await prisma.organizationDomain.create({
      data: {
        organizationId: organization.id,
        hostname: `tickets.${TAG}.example`,
        status: 'ACTIVE',
        isPrimary: true,
        verificationToken: 'jump-verify=test',
        cnameTarget: 'edge.example',
      },
    });
    const response = await request(app).get(PATH).set(...auth(adminToken));
    expect(response.body.accountUrl).toBe(`https://tickets.${TAG}.example/account`);
    expect(response.body.domain).toEqual({ hostname: `tickets.${TAG}.example` });
  });
});
