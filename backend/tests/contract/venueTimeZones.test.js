// Spec 033 phase 2: a venue's time zone is derived from its address, and
// `timezoneSource` records where it came from so a later address edit knows
// whether it may re-derive.

import request from 'supertest';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';
import { staffToken, joinOrgByToken } from '../helpers/staff.js';

const DENVER = 'America/Denver';
const EASTERN = 'America/New_York';

describe('Venue time zone derivation contract (spec 033 phase 2)', () => {
  let adminToken;
  let orgId;
  const created = [];

  const post = (body) =>
    request(app)
      .post(`/organizations/${orgId}/venues`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Jump-Org', orgId)
      .send(body);

  const patch = (id, body) =>
    request(app)
      .patch(`/organizations/${orgId}/venues/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Jump-Org', orgId)
      .send(body);

  async function makeVenue(body) {
    const res = await post(body).expect(201);
    created.push(res.body.id);
    return res.body;
  }

  beforeAll(async () => {
    adminToken = await staffToken({ role: 'ADMIN', email: 'admin@venue-timezones.test' });
    const org = await prisma.organization.create({
      data: { name: 'Venue Time Zone Org', status: 'ACTIVE' },
    });
    orgId = org.id;
    await joinOrgByToken(adminToken, orgId, 'ADMIN');
  });

  afterAll(async () => {
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it('derives the zone from a Denver address when none is sent', async () => {
    const venue = await makeVenue({
      name: 'Derived Denver',
      address: '1510 Clarkson St',
      city: 'Denver',
      state: 'CO',
      postalCode: '80218',
    });
    expect(venue.timezone).toBe(DENVER);
    expect(venue.timezoneSource).toBe('DERIVED');
    expect(venue.country).toBe('US');
  });

  it('keeps an explicitly sent zone and marks it MANUAL', async () => {
    const venue = await makeVenue({
      name: 'Manual Denver',
      address: '1510 Clarkson St',
      state: 'CO',
      postalCode: '80218',
      timezone: 'America/Phoenix',
    });
    expect(venue.timezone).toBe('America/Phoenix');
    expect(venue.timezoneSource).toBe('MANUAL');
  });

  it('falls back to the default and stays DEFAULT when the address says nothing', async () => {
    const venue = await makeVenue({ name: 'Addressless', address: '1 Nowhere Rd' });
    expect(venue.timezone).toBe(EASTERN);
    // DEFAULT, not DERIVED, so a later edit can still resolve it.
    expect(venue.timezoneSource).toBe('DEFAULT');
  });

  it('re-derives a DERIVED venue when the address moves', async () => {
    const venue = await makeVenue({
      name: 'Moving Venue',
      address: '1510 Clarkson St',
      state: 'CO',
      postalCode: '80218',
    });
    expect(venue.timezone).toBe(DENVER);

    const moved = await patch(venue.id, { state: 'NC', postalCode: '27601' }).expect(200);
    expect(moved.body.timezone).toBe(EASTERN);
    expect(moved.body.timezoneSource).toBe('DERIVED');
  });

  it('never re-derives over a MANUAL choice', async () => {
    const venue = await makeVenue({
      name: 'Pinned Venue',
      address: '1510 Clarkson St',
      state: 'CO',
      postalCode: '80218',
      timezone: 'America/Phoenix',
    });

    const moved = await patch(venue.id, { state: 'NC', postalCode: '27601' }).expect(200);
    expect(moved.body.timezone).toBe('America/Phoenix');
    expect(moved.body.timezoneSource).toBe('MANUAL');
  });

  it('resolves a DEFAULT venue once an address arrives', async () => {
    const venue = await makeVenue({ name: 'Later Address', address: '1 Nowhere Rd' });
    expect(venue.timezoneSource).toBe('DEFAULT');

    const filled = await patch(venue.id, { state: 'CO', postalCode: '80218' }).expect(200);
    expect(filled.body.timezone).toBe(DENVER);
    expect(filled.body.timezoneSource).toBe('DERIVED');
  });

  it('an address-only PATCH leaves a MANUAL venue pinned', async () => {
    const venue = await makeVenue({
      name: 'Still Pinned Venue',
      address: '1510 Clarkson St',
      state: 'CO',
      postalCode: '80218',
      timezone: 'America/Phoenix',
    });
    const touched = await patch(venue.id, { city: 'Denver' }).expect(200);
    expect(touched.body.timezone).toBe('America/Phoenix');
    expect(touched.body.timezoneSource).toBe('MANUAL');
  });

  it('an explicit null drops the override and re-derives from the address', async () => {
    // This is what "Use the address instead" sends. Without it the organizer
    // could pin a zone and never get back to the derived one.
    const venue = await makeVenue({
      name: 'Unpinned Venue',
      address: '1510 Clarkson St',
      state: 'CO',
      postalCode: '80218',
      timezone: 'America/Phoenix',
    });
    const released = await patch(venue.id, { timezone: null }).expect(200);
    expect(released.body.timezone).toBe(DENVER);
    expect(released.body.timezoneSource).toBe('DERIVED');
  });

  it('dropping the override with nothing to derive from falls back and stays DEFAULT', async () => {
    const venue = await makeVenue({
      name: 'Unpinned Addressless',
      address: '1 Nowhere Rd',
      timezone: 'America/Phoenix',
    });
    const released = await patch(venue.id, { timezone: null }).expect(200);
    expect(released.body.timezone).toBe(EASTERN);
    expect(released.body.timezoneSource).toBe('DEFAULT');
  });

  it('does not apply the US state table to a non-US address', async () => {
    const venue = await makeVenue({
      name: 'Toronto Venue',
      address: '60 Simcoe St',
      country: 'CA',
      postalCode: 'M5J 2H5',
    });
    expect(venue.country).toBe('CA');
    expect(venue.timezone).toBe(EASTERN); // the fallback, not a guess from the table
    expect(venue.timezoneSource).toBe('DEFAULT');
  });

  it('rejects a country that is not a two-letter code', async () => {
    await post({ name: 'Bad Country', address: '1 Rd', country: 'United States' }).expect(400);
  });

  it('still rejects an invalid IANA zone', async () => {
    await post({ name: 'Bad Zone', address: '1 Rd', timezone: 'Mars/Olympus' }).expect(400);
  });
});
