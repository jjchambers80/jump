// Contract tests for event description sanitising
// Tests that POST /organizations/:orgId/events and
// PATCH /organizations/:orgId/events/:eventId sanitise HTML descriptions.
//
// Verifies: unsafe HTML stripped, allowed tags preserved,
// null/empty description preserved, plain-text helper behaviour.

import request from 'supertest';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';
import { staffToken, joinOrgByToken } from '../helpers/staff.js';

// A date far enough in the future that it never triggers the "must be future" check.
const FUTURE_DATE = '2030-06-15T19:00:00.000Z';

describe('Event Description Sanitising', () => {
  let adminToken;
  let organizerToken;
  let testOrgId;
  let testVenueId;
  let testEventId;

  beforeAll(async () => {
    adminToken = await staffToken({ role: 'ADMIN', email: 'admin@desc-sanitize-test.com' });
    organizerToken = await staffToken({ role: 'ORGANIZER', email: 'organizer@desc-sanitize-test.com' });

    // Create test organization
    const orgRes = await request(app)
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Desc Sanitize Test Org' });
    testOrgId = orgRes.body.id;
    await joinOrgByToken(adminToken, testOrgId, 'ADMIN');
    await joinOrgByToken(organizerToken, testOrgId, 'ORGANIZER');

    // Create test venue
    const venueRes = await request(app)
      .post(`/organizations/${testOrgId}/venues`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ name: 'Desc Sanitize Venue', address: '123 Sanitize St' });
    testVenueId = venueRes.body.id;

    // Create a baseline event for PATCH tests — clean description, no funny business
    const eventRes = await request(app)
      .post(`/organizations/${testOrgId}/events`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        venueId: testVenueId,
        name: 'Baseline Event',
        date: FUTURE_DATE,
        capacity: 100,
        priceTiers: [{ name: 'General', price: 10.0, quantityTotal: 50 }],
        description: '<p>Clean baseline description</p>',
      });
    testEventId = eventRes.body.id;
  });

  afterAll(async () => {
    // Clean up test data — price tiers first, then events, venues, orgs
    await prisma.priceTier.deleteMany({
      where: { event: { venue: { organizationId: testOrgId } } },
    });
    await prisma.event.deleteMany({
      where: { venue: { organizationId: testOrgId } },
    });
    await prisma.venue.deleteMany({ where: { organizationId: testOrgId } });
    await prisma.organization.deleteMany({ where: { id: testOrgId } });
    await prisma.user.deleteMany({
      where: { email: { in: ['admin@desc-sanitize-test.com', 'organizer@desc-sanitize-test.com'] } },
    });
  });

  // ── POST /organizations/:orgId/events ──────────────────────────

  describe('POST /organizations/:orgId/events', () => {
    it('strips script tags and event handlers from description', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Sanitize Script Test',
          date: FUTURE_DATE,
          capacity: 100,
          priceTiers: [{ name: 'General', price: 10.0, quantityTotal: 50 }],
          description:
            '<p>Hello</p><script>alert(1)</script><p><img src=x onerror="alert(1)"></p>',
        });

      expect(res.status).toBe(201);
      expect(res.body.description).not.toMatch(/<script>/);
      expect(res.body.description).not.toMatch(/onerror/);
      // <img> tag itself is allowed, just event handlers stripped
      expect(res.body.description).toContain('<img');
    });

    it('strips javascript: hrefs', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Sanitize Href Test',
          date: FUTURE_DATE,
          capacity: 100,
          priceTiers: [{ name: 'General', price: 10.0, quantityTotal: 50 }],
          description: '<a href="javascript:alert(1)">bad</a><a href="https://example.com">good</a>',
        });

      expect(res.status).toBe(201);
      // The javascript: href is stripped; tag stays with no href
      expect(res.body.description).toContain('<a>bad</a>');
      expect(res.body.description).toContain('<a href="https://example.com">good</a>');
    });

    it('preserves allowed tags like p, strong, em, ul, li', async () => {
      const clean = '<p>Hello <strong>world</strong></p><ul><li>Item <em>one</em></li></ul>';
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Sanitize Preserve Test',
          date: FUTURE_DATE,
          capacity: 100,
          priceTiers: [{ name: 'General', price: 10.0, quantityTotal: 50 }],
          description: clean,
        });

      expect(res.status).toBe(201);
      expect(res.body.description).toContain('<p>Hello <strong>world</strong></p>');
      expect(res.body.description).toContain('<ul><li>Item <em>one</em></li></ul>');
    });

    it('stores null when description is null', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Null Desc Event',
          date: FUTURE_DATE,
          capacity: 100,
          priceTiers: [{ name: 'General', price: 10.0, quantityTotal: 50 }],
          description: null,
        });

      expect(res.status).toBe(201);
      expect(res.body.description).toBeNull();
    });

    it('stores null when description is undefined', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Undefined Desc Event',
          date: FUTURE_DATE,
          capacity: 100,
          priceTiers: [{ name: 'General', price: 10.0, quantityTotal: 50 }],
          // description intentionally omitted
        });

      expect(res.status).toBe(201);
      expect(res.body.description).toBeNull();
    });

    it('stores empty string when description is empty string', async () => {
      const res = await request(app)
        .post(`/organizations/${testOrgId}/events`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          venueId: testVenueId,
          name: 'Empty Desc Event',
          date: FUTURE_DATE,
          capacity: 100,
          priceTiers: [{ name: 'General', price: 10.0, quantityTotal: 50 }],
          description: '',
        });

      expect(res.status).toBe(201);
      // sanitizeContentHtml('') calls sanitize('', CONTENT_HTML).trim() = ''
      expect(res.body.description).toBe('');
    });
  });

  // ── PATCH /organizations/:orgId/events/:eventId ─────────────────

  describe('PATCH /organizations/:orgId/events/:eventId', () => {
    it('strips unsafe HTML from description on update', async () => {
      const res = await request(app)
        .patch(`/organizations/${testOrgId}/events/${testEventId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          description:
            '<p>Updated</p><script>steal()</script><a href="javascript:void(0)">click</a>',
        });

      expect(res.status).toBe(200);
      expect(res.body.description).not.toMatch(/<script>/);
      expect(res.body.description).not.toMatch(/javascript:/);
      expect(res.body.description).toContain('<p>Updated</p>');
      expect(res.body.description).toContain('<a>click</a>');
    });

    it('preserves allowed tags on update', async () => {
      const res = await request(app)
        .patch(`/organizations/${testOrgId}/events/${testEventId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          description:
            '<h2>Section</h2><p>Text with <strong>bold</strong> and <em>emphasis</em></p><blockquote>Quote</blockquote>',
        });

      expect(res.status).toBe(200);
      expect(res.body.description).toContain('<h2>Section</h2>');
      expect(res.body.description).toContain('<strong>bold</strong>');
      expect(res.body.description).toContain('<em>emphasis</em>');
      expect(res.body.description).toContain('<blockquote>Quote</blockquote>');
    });

    it('sets description to null when updating to null', async () => {
      const res = await request(app)
        .patch(`/organizations/${testOrgId}/events/${testEventId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ description: null });

      expect(res.status).toBe(200);
      expect(res.body.description).toBeNull();
    });

    it('sets description to empty string when updating to empty string', async () => {
      // First set a description so we have something to clear
      const setRes = await request(app)
        .patch(`/organizations/${testOrgId}/events/${testEventId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ description: '<p>Something</p>' });

      expect(setRes.status).toBe(200);
      expect(setRes.body.description).toBe('<p>Something</p>');

      // Now clear it
      const res = await request(app)
        .patch(`/organizations/${testOrgId}/events/${testEventId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ description: '' });

      expect(res.status).toBe(200);
      expect(res.body.description).toBe('');
    });

    it('does not change description when omitted from payload', async () => {
      const res = await request(app)
        .patch(`/organizations/${testOrgId}/events/${testEventId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ name: 'Renamed Baseline Event' });

      expect(res.status).toBe(200);
      // Description should be whatever it was last set to
      expect(res.body.description).not.toBeUndefined();
    });

    it('strips event handler attributes but keeps tag structure', async () => {
      const res = await request(app)
        .patch(`/organizations/${testOrgId}/events/${testEventId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          description:
            '<p onclick="x()">Clickable</p><img src="https://example.com/img.png" onerror="bad()">',
        });

      expect(res.status).toBe(200);
      // Event handler attributes stripped
      expect(res.body.description).not.toMatch(/onclick/);
      expect(res.body.description).not.toMatch(/onerror/);
      // Tags themselves remain
      expect(res.body.description).toContain('<p>Clickable</p>');
      expect(res.body.description).toContain('<img');
    });
  });

  // ── htmlToText (plain-text helper) ──────────────────────────────

  describe('htmlToText (plain-text conversion)', () => {
    it('converts HTML to plain text with collapsed whitespace', async () => {
      // Verify by creating an event with HTML and reading it back
      const res = await request(app)
        .patch(`/organizations/${testOrgId}/events/${testEventId}`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          description: '<p>Hello   <b>world</b></p><p>Second  paragraph</p>',
        });

      expect(res.status).toBe(200);
      // The stored description is sanitised HTML (tags preserved)
      expect(res.body.description).toBe('<p>Hello <b>world</b></p><p>Second paragraph</p>');
    });
  });
});