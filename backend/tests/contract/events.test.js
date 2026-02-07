// Contract tests for Events API endpoints
// Tests API spec compliance for GET /events and GET /events/:eventId

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../../src/api/server.js';

const prisma = new PrismaClient();

describe('Events API Contract Tests', () => {
  let testEvent;
  let draftEvent;

  beforeAll(async () => {
    // Clean up existing test data
    await prisma.ticket.deleteMany();
    await prisma.event.deleteMany();
    await prisma.admin.deleteMany();

    // Create test admin
    const admin = await prisma.admin.create({
      data: {
        email: 'test-admin@test.com',
        name: 'Test Admin',
        organization: 'Test Org',
        passwordHash: 'hashed',
      },
    });

    // Create a published event
    testEvent = await prisma.event.create({
      data: {
        organizerId: admin.id,
        name: 'Published Test Event',
        date: new Date('2026-12-31'),
        venue: 'Test Venue',
        capacity: 100,
        ticketPrice: 5000, // $50.00
        status: 'PUBLISHED',
      },
    });

    // Create a draft event (should not appear in public listings)
    draftEvent = await prisma.event.create({
      data: {
        organizerId: admin.id,
        name: 'Draft Test Event',
        date: new Date('2026-12-31'),
        venue: 'Test Venue',
        capacity: 50,
        ticketPrice: 2500,
        status: 'DRAFT',
      },
    });
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany();
    await prisma.event.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.$disconnect();
  });

  describe('GET /events', () => {
    it('should return 200 with published events only', async () => {
      const response = await request(app).get('/events').expect(200);

      expect(response.body).toHaveProperty('events');
      expect(Array.isArray(response.body.events)).toBe(true);
      expect(response.body.events.length).toBeGreaterThan(0);

      // Verify only published events are returned
      const allPublished = response.body.events.every((event) => event.status === 'PUBLISHED');
      expect(allPublished).toBe(true);

      // Verify draft event is not included
      const draftIncluded = response.body.events.some((event) => event.id === draftEvent.id);
      expect(draftIncluded).toBe(false);
    });

    it('should return events with correct structure', async () => {
      const response = await request(app).get('/events').expect(200);

      const event = response.body.events[0];
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('name');
      expect(event).toHaveProperty('date');
      expect(event).toHaveProperty('venue');
      expect(event).toHaveProperty('capacity');
      expect(event).toHaveProperty('ticketPrice');
      expect(event).toHaveProperty('status');
    });

    it('should support pagination with limit parameter', async () => {
      const response = await request(app).get('/events?limit=1').expect(200);

      expect(response.body.events.length).toBeLessThanOrEqual(1);
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('limit');
    });

    it('should support pagination with page parameter', async () => {
      const response = await request(app).get('/events?page=1&limit=10').expect(200);

      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(10);
    });
  });

  describe('GET /events/:eventId', () => {
    it('should return 200 with event details for valid ID', async () => {
      const response = await request(app).get(`/events/${testEvent.id}`).expect(200);

      expect(response.body).toHaveProperty('event');
      expect(response.body.event.id).toBe(testEvent.id);
      expect(response.body.event.name).toBe(testEvent.name);
      expect(response.body.event.capacity).toBe(testEvent.capacity);
      expect(response.body.event.ticketPrice).toBe(testEvent.ticketPrice);
    });

    it('should return 404 for non-existent event ID', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(`/events/${fakeId}`).expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.message).toContain('not found');
    });

    it('should return 400 for invalid UUID format', async () => {
      const response = await request(app).get('/events/invalid-uuid').expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should not return draft events even with valid ID', async () => {
      const response = await request(app).get(`/events/${draftEvent.id}`).expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });
});
