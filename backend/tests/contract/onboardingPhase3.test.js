// Contract tests for spec 022 phase 3: tailored setup, abandoned-signup
// sweep, SYSTEM_ADMIN funnel + survey summary, check-in setup card.

import request from 'supertest';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';
import { staffToken, cleanupStaff } from '../helpers/staff.js';
import onboardingService from '../../src/services/OnboardingService.js';
import { SEED_TEMPLATES } from '../../src/config/onboarding.js';

const OWNER_EMAIL = 'owner@onboarding-p3-test.com';
const SYS_EMAIL = 'sys@onboarding-p3-test.com';
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('Onboarding phase 3 (spec 022)', () => {
  let ownerToken;
  let sysToken;
  let ownerId;
  const created = [];

  beforeAll(async () => {
    ownerToken = await staffToken({ role: 'ADMIN', email: OWNER_EMAIL });
    sysToken = await staffToken({ role: 'SYSTEM_ADMIN', email: SYS_EMAIL });
    ownerId = (await prisma.user.findUnique({ where: { email: OWNER_EMAIL } })).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: created } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { name: { startsWith: 'P3 Test' } } }).catch(() => {});
    await cleanupStaff([OWNER_EMAIL, SYS_EMAIL]);
  });

  const start = async (name, survey) => {
    const res = await request(app).post('/signup').set(auth(ownerToken)).send({ name, source: 'admin' });
    created.push(res.body.id);
    if (survey) await request(app).patch(`/signup/${res.body.id}/survey`).set(auth(ownerToken)).send(survey);
    return res.body.id;
  };

  describe('tailored setup', () => {
    it('seeds the starter application templates when the survey chose applications', async () => {
      const id = await start('P3 Test Vendor Org', { goals: ['sell_online', 'vendor_applications'], eventTypes: ['convention_expo'] });
      const res = await request(app).post(`/signup/${id}/complete`).set(auth(ownerToken));
      expect(res.status).toBe(200);

      const templates = await prisma.applicationFormTemplate.findMany({ where: { organizationId: id }, orderBy: { name: 'asc' } });
      expect(templates.map((t) => [t.name, t.kind])).toEqual([
        ['Press & media', 'FREE'],
        ['Vendor booth', 'PAID'],
      ]);
      const vendor = templates.find((t) => t.name === 'Vendor booth');
      expect(vendor.createdById).toBe(ownerId);
      expect(vendor.definition.tiers).toHaveLength(2);
      expect(vendor.definition.tiers[0]).toMatchObject({ name: 'Standard booth (10×10)', price: 275 });
      expect(vendor.definition.questions.filter((q) => q.pinned)).toHaveLength(1);

      // Templates are listed on the Participants › Applications tab
      const list = await request(app).get('/admin/application-templates').set(auth(ownerToken)).set('X-Jump-Org', id);
      expect(list.status).toBe(200);
      expect(list.body.data.map((t) => t.name).sort()).toEqual(['Press & media', 'Vendor booth']);

      // Re-seeding is a no-op (unique names)
      const again = await onboardingService.seedTemplates(id, ownerId, ['press_applications']);
      expect(again).toEqual([]);
      expect(await prisma.applicationFormTemplate.count({ where: { organizationId: id } })).toBe(2);

      // The applications card counts templates as not-yet-done (a form is the goal), but is shown
      const guide = await request(app).get('/admin/setup-guide').set(auth(ownerToken)).set('X-Jump-Org', id);
      expect(guide.body.tasks.find((t) => t.id === 'applications')).toMatchObject({ shown: true, done: false });
      expect(guide.body.tasks.find((t) => t.id === 'checkin')).toMatchObject({ shown: false, done: false });
    });

    it('seeds nothing for organizations without an application goal', async () => {
      const id = await start('P3 Test Ticket Org', { goals: ['sell_online', 'sell_at_door'] });
      await request(app).post(`/signup/${id}/complete`).set(auth(ownerToken));
      expect(await prisma.applicationFormTemplate.count({ where: { organizationId: id } })).toBe(0);

      const guide = await request(app).get('/admin/setup-guide').set(auth(ownerToken)).set('X-Jump-Org', id);
      expect(guide.body.tasks.find((t) => t.id === 'applications').shown).toBe(false);
      expect(guide.body.tasks.find((t) => t.id === 'checkin')).toMatchObject({ shown: true, done: false });
    });

    it('every seed definition passes the template validator', async () => {
      const { default: templateService } = await import('../../src/services/ApplicationFormTemplateService.js');
      for (const seed of SEED_TEMPLATES) {
        expect(() => templateService.validateDefinition(seed.kind, seed.definition)).not.toThrow();
      }
    });
  });

  describe('abandoned-signup sweep', () => {
    it('removes stale pending organizations without events or a subscription only', async () => {
      // Created directly (no membership) so the per-user pending cap does not apply
      const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const pending = async (name, createdAt) => {
        const org = await prisma.organization.create({
          data: { name, onboardingCompletedAt: null, createdAt, platformCustomer: { create: { ownerUserId: ownerId, onboarding: { version: 1, source: 'public' } } } },
        });
        created.push(org.id);
        return org.id;
      };
      const stale = await pending('P3 Test Stale', old);
      const fresh = await pending('P3 Test Fresh', new Date());
      const withEvent = await pending('P3 Test Stale With Event', old);
      const subscribed = await pending('P3 Test Stale Subscribed', old);

      const venue = await prisma.venue.create({ data: { name: 'P3 Venue', address: '1 St', timezone: 'America/New_York', organizationId: withEvent } });
      await prisma.event.create({ data: { name: 'P3 Event', date: new Date('2027-06-01T00:00:00Z'), capacity: 10, venueId: venue.id } });
      await prisma.platformCustomer.update({ where: { organizationId: subscribed }, data: { stripeSubscriptionId: `sub_p3_${Date.now()}` } });

      const removed = await onboardingService.sweepAbandoned(7 * 24 * 60 * 60 * 1000);
      expect(removed).toBeGreaterThanOrEqual(1);

      expect(await prisma.organization.findUnique({ where: { id: stale } })).toBeNull();
      expect(await prisma.organization.findUnique({ where: { id: fresh } })).not.toBeNull();
      expect(await prisma.organization.findUnique({ where: { id: withEvent } })).not.toBeNull();
      expect(await prisma.organization.findUnique({ where: { id: subscribed } })).not.toBeNull();

      // A completed organization is never touched, however old
      const done = await start('P3 Test Old Completed');
      await request(app).post(`/signup/${done}/complete`).set(auth(ownerToken));
      await prisma.organization.updateMany({ where: { id: done }, data: { createdAt: old } });
      await onboardingService.sweepAbandoned(7 * 24 * 60 * 60 * 1000);
      expect(await prisma.organization.findUnique({ where: { id: done } })).not.toBeNull();
    });
  });

  describe('SYSTEM_ADMIN funnel and survey summary', () => {
    it('reports counts per window and pending now', async () => {
      const forbidden = await request(app).get('/organizations/onboarding/funnel').set(auth(ownerToken));
      expect(forbidden.status).toBe(403);

      const res = await request(app).get('/organizations/onboarding/funnel').set(auth(sysToken));
      expect(res.status).toBe(200);
      expect(res.body.windows['7']).toEqual(expect.objectContaining({ started: expect.any(Number), completed: expect.any(Number), subscribed: expect.any(Number) }));
      expect(res.body.windows['30'].started).toBeGreaterThanOrEqual(res.body.windows['7'].started);
      expect(res.body.windows['7'].started).toBeGreaterThanOrEqual(2);
      expect(res.body.windows['7'].completed).toBeGreaterThanOrEqual(2);
      expect(res.body.pending).toBeGreaterThanOrEqual(1);
    });

    it('lists survey answers and plan for SYSTEM_ADMIN only', async () => {
      const id = await start('P3 Test Survey Org', { goals: ['move_platform'], movingFrom: 'eventeny', eventsPerYear: 'two_to_five' });
      await request(app).post(`/signup/${id}/complete`).set(auth(ownerToken));

      const sys = await request(app).get('/organizations').set(auth(sysToken));
      const row = sys.body.find((o) => o.id === id);
      expect(row.plan).toBe('FREE');
      expect(row.onboarding).toEqual({
        source: 'admin',
        goals: ['move_platform'],
        eventTypes: [],
        eventsPerYear: 'two_to_five',
        attendance: null,
        movingFrom: 'eventeny',
        surveySkipped: false,
      });

      const own = await request(app).get('/organizations').set(auth(ownerToken));
      const ownRow = own.body.find((o) => o.id === id);
      expect(ownRow).toBeDefined();
      expect(ownRow.onboarding).toBeUndefined();
      expect(ownRow.plan).toBeUndefined();
    });
  });
});
