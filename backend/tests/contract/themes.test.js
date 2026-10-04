// Contract tests for online store themes (spec 038, card 038A). Covers plan
// §16 acceptance tests 5 (atomic save), 6 (nested references), 14 (render
// route gate), 15 (references kept / rolled back) and 16 (full-state restore).

import { createHash } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

process.env.THEME_EDITOR_ENABLED = 'true';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: storeFileService } = await import('../../src/services/StoreFileService.js');
const { default: themeService } = await import('../../src/services/ThemeService.js');

const TAG = 'themes-ct';
const emails = [`admin@${TAG}.test`, `other@${TAG}.test`, `system@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];
const sha = (s) => createHash('sha256').update(s).digest('hex');

const homeDoc = (heading, extra = {}) => ({
  root: { props: { title: 'Home' } },
  content: [{ type: 'Hero', props: { id: 'Hero-1', heading, ...extra } }],
});
const eventsDoc = (extra = []) => ({
  root: { props: {} },
  content: [...extra, { type: 'EventList', props: { id: 'EventList-1' } }],
});

describe('Online store themes contract', () => {
  let organization;
  let other;
  let adminToken;
  let otherToken;
  let systemToken;
  let theme;
  const files = [];

  const save = (body, themeId = theme.id, token = adminToken) =>
    request(app).put(`/admin/themes/${themeId}/save`).set(...auth(token)).send(body);
  const current = async () => (await request(app).get(`/admin/themes/${theme.id}`).set(...auth(adminToken))).body;
  const docVersion = async (key) =>
    (await request(app).get(`/admin/themes/${theme.id}/documents/${key}`).set(...auth(adminToken))).body.version;
  const refs = (field) =>
    prisma.storeFileReference.findMany({ where: { kind: 'THEME', targetId: theme.id, ...(field && { field }) } });

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    systemToken = await staffToken({ email: emails[2], role: 'SYSTEM_ADMIN' });
    organization = await prisma.organization.create({ data: { name: `${TAG} Store`, slug: `${TAG}-store` } });
    other = await prisma.organization.create({ data: { name: `${TAG} Other`, slug: `${TAG}-other`, themesEnabled: true } });
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    await joinOrgByToken(otherToken, other.id, 'ORGANIZER');
    for (const name of ['logo', 'hero', 'inline']) {
      const file = await prisma.file.upsert({
        where: { hash: sha(`${TAG}-${name}`) },
        update: {},
        create: { hash: sha(`${TAG}-${name}`), mimeType: 'image/png', sizeBytes: 10 },
      });
      files.push({
        ...(await prisma.storeFile.create({
          data: { organizationId: organization.id, fileId: file.id, name, extension: 'png' },
        })),
        hash: file.hash,
      });
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [organization.id, other.id] } } }).catch(() => {});
    await prisma.file.deleteMany({ where: { hash: { in: ['logo', 'hero', 'inline'].map((n) => sha(`${TAG}-${n}`)) } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  describe('rollout', () => {
    it('is 404 until the organization is enabled', async () => {
      const res = await request(app).get('/admin/themes').set(...auth(adminToken));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('THEMES_NOT_ENABLED');
      const status = await request(app).get('/admin/themes/status').set(...auth(adminToken));
      expect(status.body).toEqual({ masterSwitch: true, organizationEnabled: false, enabled: false });
    });

    it('only SYSTEM_ADMIN can switch an organization on', async () => {
      const denied = await request(app).put('/admin/themes/rollout').set(...auth(adminToken)).send({ enabled: true });
      expect(denied.status).toBe(403);
      const ok = await request(app)
        .put('/admin/themes/rollout')
        .set(...auth(systemToken))
        .set('X-Jump-Org', organization.id)
        .send({ enabled: true });
      expect(ok.status).toBe(200);
      expect(ok.body.enabled).toBe(true);
    });

    it('the master switch overrides the organization flag', async () => {
      process.env.THEME_EDITOR_ENABLED = '';
      try {
        expect((await request(app).get('/admin/themes').set(...auth(adminToken))).status).toBe(404);
      } finally {
        process.env.THEME_EDITOR_ENABLED = 'true';
      }
    });
  });

  describe('library', () => {
    it('creates exactly one MAIN theme under concurrent first visits', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => themeService.ensureMain(organization.id)));
      expect(new Set(results.map((t) => t.id)).size).toBe(1);
      const list = await request(app).get('/admin/themes').set(...auth(adminToken));
      expect(list.status).toBe(200);
      expect(list.body.themes).toHaveLength(1);
      expect(list.body.themes[0]).toMatchObject({ role: 'MAIN', name: 'Eventimus Default', presetKey: 'eventimus-default', presetVersion: '1.0' });
      theme = list.body.themes[0];
      expect(await prisma.theme.count({ where: { organizationId: organization.id, role: 'MAIN' } })).toBe(1);
    });

    it('serves preset documents until they are saved', async () => {
      const detail = await current();
      expect(detail.documents.find((d) => d.key === 'home')).toMatchObject({ isDefault: true, version: 0 });
      const doc = await request(app).get(`/admin/themes/${theme.id}/documents/events`).set(...auth(adminToken));
      expect(doc.body).toMatchObject({ key: 'events', kind: 'TEMPLATE', isDefault: true, version: 0 });
      expect(doc.body.data.content.map((s) => s.type)).toEqual(['EventsHero', 'EventList']);
    });

    it('serves the deployed schema and guide for the CLI, versioned by their hash', async () => {
      const res = await request(app).get('/admin/themes/schema').set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.schema.commonSectionFields.sectionWidth).toBeTruthy();
      expect(res.body.guide).toMatch(/sectionWidth/);
      expect(res.body.version).toBe(sha(JSON.stringify({ schema: res.body.schema, guide: res.body.guide })));
    });

    it('is invisible to another organization', async () => {
      const res = await request(app).get(`/admin/themes/${theme.id}`).set(...auth(otherToken));
      expect(res.status).toBe(404);
      const write = await save({ themeVersion: 1, documents: { home: { data: homeDoc('x'), version: 0 } } }, theme.id, otherToken);
      expect(write.status).toBe(404);
    });
  });

  describe('atomic save (test 5)', () => {
    it('writes settings and a document in one save and one revision', async () => {
      const res = await save({
        themeVersion: 1,
        settings: { layout: { pageWidth: 1300 } },
        documents: { home: { data: homeDoc('First'), version: 0 } },
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ theme: { version: 2 }, documents: { home: 1 }, changedKeys: ['settings', 'home'] });
      const revisions = await request(app).get(`/admin/themes/${theme.id}/revisions`).set(...auth(adminToken));
      expect(revisions.body.revisions).toHaveLength(1);
      expect(revisions.body.revisions[0]).toMatchObject({ changedKeys: ['settings', 'home'], savedBy: { name: 'Test User' } });
    });

    it('a stale document version is a 409 and nothing changes', async () => {
      const res = await save({
        themeVersion: 2,
        settings: { layout: { pageWidth: 1500 } },
        documents: { home: { data: homeDoc('Stale'), version: 0 }, events: { data: eventsDoc(), version: 0 } },
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('THEME_CONFLICT');
      expect(res.body.details).toEqual({ theme: 2, documents: { home: 1, events: 0 } });
      const detail = await current();
      expect(detail.settings).toEqual({ layout: { pageWidth: 1300 } });
      expect(detail.version).toBe(2);
      expect(detail.documents.find((d) => d.key === 'events').isDefault).toBe(true);
      expect(await prisma.themeRevision.count({ where: { themeId: theme.id } })).toBe(1);
    });

    it('a stale theme version is a 409 even for a document-only save', async () => {
      const res = await save({ themeVersion: 1, documents: { events: { data: eventsDoc(), version: 0 } } });
      expect(res.status).toBe(409);
    });

    it('one invalid document is a 400 and nothing changes', async () => {
      const res = await save({
        themeVersion: 2,
        settings: { layout: { pageWidth: 1400 } },
        documents: {
          events: { data: eventsDoc(), version: 0 },
          home: { data: homeDoc('Bad', { paddingTop: 999 }), version: 1 },
        },
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('THEME_INVALID');
      expect(Object.keys(res.body.details.errors)).toEqual(['documents.home.content[0].props.paddingTop']);
      const detail = await current();
      expect(detail.settings).toEqual({ layout: { pageWidth: 1300 } });
      expect(detail.documents.find((d) => d.key === 'events').isDefault).toBe(true);
      expect(await docVersion('home')).toBe(1);
    });

    it('sanitises rich text on write', async () => {
      const doc = {
        root: { props: {} },
        content: [{ type: 'RichText', props: { id: 'R', body: '<p>Hi</p><script>alert(1)</script><img src=x onerror=alert(1)>' } }],
      };
      const res = await save({ themeVersion: 2, documents: { home: { data: doc, version: 1 } } });
      expect(res.status).toBe(200);
      const stored = await request(app).get(`/admin/themes/${theme.id}/documents/home`).set(...auth(adminToken));
      expect(stored.body.data.content[0].props.body).not.toMatch(/script|onerror/);
      expect(stored.body.data.content[0].props.body).toContain('<p>Hi</p>');
    });

    it('refuses to remove a color scheme a stored document still uses', async () => {
      await save({
        themeVersion: 2,
        documents: { events: { data: eventsDoc([{ type: 'EventsHero', props: { id: 'EH', colorScheme: 'scheme-2' } }]), version: 0 } },
      });
      const onlyOne = {
        colors: {
          schemes: [{ id: 'scheme-1', name: 'Page', background: 'auto', foreground: 'auto', accent: 'brand', accentForeground: 'auto', secondaryButtonLabel: 'auto', border: 'auto', muted: 'auto', shadow: 'auto' }],
        },
      };
      const res = await save({ themeVersion: 2, settings: onlyOne });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.details.errors)).toEqual(['documents.events']);
    });

    it('data: null deletes a document so the preset default applies again', async () => {
      const res = await save({ themeVersion: 2, documents: { events: { data: null, version: await docVersion('events') } } });
      expect(res.status).toBe(200);
      expect(res.body.documents.events).toBe(0);
      expect((await current()).documents.find((d) => d.key === 'events').isDefault).toBe(true);
    });

    it('keeps only the last 50 revisions', async () => {
      let version = await docVersion('home');
      for (let i = 0; i < 52; i += 1) {
        const res = await save({ themeVersion: 2, documents: { home: { data: homeDoc(`Save ${i}`), version } } });
        expect(res.status).toBe(200);
        version = res.body.documents.home;
      }
      expect(await prisma.themeRevision.count({ where: { themeId: theme.id } })).toBe(50);
    });
  });

  describe('file references (tests 6 and 15)', () => {
    const inlineUrl = () => `https://api.example/files/${files[2].id}/${files[2].hash}/inline.png`;

    it('extracts ids from settings, nested block props and rich-text HTML', async () => {
      const detail = await current();
      const res = await save({
        themeVersion: detail.version,
        settings: { layout: { pageWidth: 1300 }, logo: { image: { fileId: files[0].id, alt: 'Logo' } } },
        documents: {
          home: {
            version: await docVersion('home'),
            data: {
              root: { props: {} },
              content: [
                { type: 'Hero', props: { id: 'H', heading: 'x', image: { fileId: files[1].id, alt: 'Stage' } } },
                { type: 'RichText', props: { id: 'R', body: `<p><img src="${inlineUrl()}" alt="a"></p>` } },
              ],
            },
          },
          header: {
            version: 0,
            data: {
              root: { props: {} },
              content: [
                { type: 'Header', props: { id: 'Hd' } },
                {
                  type: 'AnnouncementBar',
                  props: { id: 'AB', blocks: [{ type: 'Announcement', props: { id: 'A1', text: 'Hi', link: { type: 'EVENTS' } } }] },
                },
              ],
            },
          },
        },
      });
      expect(res.status).toBe(200);
      const rows = await refs();
      expect(rows.map((r) => `${r.field}:${r.fileId}`).sort()).toEqual(
        [`settings:${files[0].id}`, `home:${files[1].id}`, `home:${files[2].id}`].sort(),
      );
      const used = await storeFileService._resolveReferences(rows);
      expect(used[0]).toMatchObject({ kind: 'THEME', title: 'Theme Eventimus Default' });
    });

    it('saving only home keeps the settings references', async () => {
      const res = await save({
        themeVersion: (await current()).version,
        documents: { home: { data: homeDoc('No images'), version: await docVersion('home') } },
      });
      expect(res.status).toBe(200);
      expect((await refs('home')).length).toBe(0);
      expect((await refs('settings')).map((r) => r.fileId)).toEqual([files[0].id]);
    });

    it('references written inside a failed transaction roll back with it', async () => {
      const before = await refs();
      await expect(
        prisma.$transaction(async (tx) => {
          await storeFileService.syncReferences('THEME', theme.id, { settings: [], home: [files[1].id] }, organization.id, {
            tx,
            onlyFields: ['settings', 'home'],
          });
          throw new Error('later step failed');
        }),
      ).rejects.toThrow('later step failed');
      expect(await refs()).toEqual(before);
    });

    it('ignores files of another organization', async () => {
      const foreignFile = await prisma.file.findUnique({ where: { hash: files[1].hash } });
      const foreign = await prisma.storeFile.create({
        data: { organizationId: other.id, fileId: foreignFile.id, name: 'foreign', extension: 'png' },
      });
      await save({
        themeVersion: (await current()).version,
        documents: { home: { data: homeDoc('x', { image: { fileId: foreign.id, alt: 'a' } }), version: await docVersion('home') } },
      });
      expect((await refs('home')).length).toBe(0);
    });
  });

  describe('restore (test 16)', () => {
    it('puts the whole theme back, deleting documents created later', async () => {
      const v = async () => (await current()).version;
      await save({ themeVersion: await v(), documents: { home: { data: homeDoc('Old home'), version: await docVersion('home') } } });
      const colors = await save({ themeVersion: await v(), settings: { layout: { pageWidth: 1100 } } });
      expect(colors.status).toBe(200);
      const [colorRevision] = (await request(app).get(`/admin/themes/${theme.id}/revisions`).set(...auth(adminToken))).body.revisions;
      expect(colorRevision.changedKeys).toEqual(['settings']);

      await save({ themeVersion: await v(), documents: { home: { data: homeDoc('New home'), version: await docVersion('home') } } });
      await save({ themeVersion: await v(), documents: { events: { data: eventsDoc(), version: 0 } } });
      await save({ themeVersion: await v(), settings: { layout: { pageWidth: 1600 } } });

      const restored = await request(app)
        .post(`/admin/themes/${theme.id}/revisions/${colorRevision.id}/restore`)
        .set(...auth(adminToken))
        .send({ themeVersion: await v() });
      expect(restored.status).toBe(200);
      expect(restored.body.changedKeys[0]).toBe(`restore:${colorRevision.id}`);

      const detail = await current();
      expect(detail.settings).toEqual({ layout: { pageWidth: 1100 } });
      const home = await request(app).get(`/admin/themes/${theme.id}/documents/home`).set(...auth(adminToken));
      expect(home.body.data.content[0].props.heading).toBe('Old home');
      expect(detail.documents.find((d) => d.key === 'events').isDefault).toBe(true);

      const [latest] = (await request(app).get(`/admin/themes/${theme.id}/revisions`).set(...auth(adminToken))).body.revisions;
      expect(latest.changedKeys[0]).toBe(`restore:${colorRevision.id}`);
    });

    it('a restore with a stale theme version is a 409', async () => {
      const [revision] = (await request(app).get(`/admin/themes/${theme.id}/revisions`).set(...auth(adminToken))).body.revisions;
      const res = await request(app)
        .post(`/admin/themes/${theme.id}/revisions/${revision.id}/restore`)
        .set(...auth(adminToken))
        .send({ themeVersion: 1 });
      expect(res.status).toBe(409);
    });
  });

  describe('public render (test 14)', () => {
    const render = (identifier, page = 'home', headers = {}) => {
      const req = request(app).get(`/organizations/${identifier}/public/storefront/render?page=${page}`);
      for (const [k, value] of Object.entries(headers)) req.set(k, value);
      return req;
    };

    it('answers legacy for organizations outside the rollout', async () => {
      await prisma.organization.update({ where: { id: other.id }, data: { themesEnabled: false } });
      const res = await render(other.slug);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ renderer: 'legacy' });
      await prisma.organization.update({ where: { id: other.id }, data: { themesEnabled: true } });
    });

    it('renders the preset for an enabled organization with no theme row, without writing one', async () => {
      const res = await render(other.slug);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).toMatchObject({ renderer: 'theme', page: 'events', fallback: true, theme: { id: null } });
      expect(res.body.documents.template.content.map((s) => s.type)).toEqual(['EventsHero', 'EventList']);
      // The preset announcement bar is hidden, so it is not sent.
      expect(res.body.documents.header.content.map((s) => s.type)).toEqual(['Header']);
      expect(await prisma.theme.count({ where: { organizationId: other.id } })).toBe(0);
    });

    it('shows home once saved, strips hidden items and out-of-window announcements', async () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      const future = new Date(Date.now() + 86400000).toISOString();
      await save({
        themeVersion: (await current()).version,
        documents: {
          home: {
            version: await docVersion('home'),
            data: {
              root: { props: {} },
              content: [
                { type: 'Hero', props: { id: 'Shown', heading: 'Shown' } },
                { type: 'RichText', props: { id: 'Hidden', hidden: true, heading: 'Hidden' } },
                {
                  type: 'HeroCarousel',
                  props: {
                    id: 'Carousel',
                    blocks: [
                      { type: 'Slide', props: { id: 'Slide1', heading: 'One' } },
                      { type: 'Slide', props: { id: 'SlideOff', heading: 'Off', hidden: true } },
                    ],
                  },
                },
                // Nothing left to show: a carousel or FAQ without blocks does not render.
                { type: 'HeroCarousel', props: { id: 'EmptyCarousel', blocks: [{ type: 'Slide', props: { id: 'SlideGone', hidden: true } }] } },
                {
                  type: 'Faq',
                  props: { id: 'Faq', blocks: [{ type: 'FaqItem', props: { id: 'Q1', question: 'Parking?', answer: '<p>Free</p><script>x</script>' } }] },
                },
                { type: 'Faq', props: { id: 'EmptyFaq', blocks: [] } },
              ],
            },
          },
          header: {
            version: await docVersion('header'),
            data: {
              root: { props: {} },
              content: [
                {
                  type: 'AnnouncementBar',
                  props: {
                    id: 'AB',
                    blocks: [
                      { type: 'Announcement', props: { id: 'Now', text: 'Now' } },
                      { type: 'Announcement', props: { id: 'Later', text: 'Later', startsAt: future } },
                      { type: 'Announcement', props: { id: 'Over', text: 'Over', endsAt: past } },
                      { type: 'Announcement', props: { id: 'Off', text: 'Off', hidden: true } },
                    ],
                  },
                },
                { type: 'Header', props: { id: 'Hd' } },
              ],
            },
          },
        },
      });
      const res = await render(organization.slug);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 'home', fallback: false, theme: { id: theme.id } });
      expect(res.body.documents.template.content.map((s) => s.props.id)).toEqual(['Shown', 'Carousel', 'Faq']);
      expect(res.body.documents.template.content[1].props.blocks.map((b) => b.props.id)).toEqual(['Slide1']);
      expect(res.body.documents.template.content[2].props.blocks[0].props.answer).toBe('<p>Free</p>');
      expect(res.body.documents.header.content[0].props.blocks.map((b) => b.props.id)).toEqual(['Now']);
      expect(res.body.organization).toMatchObject({ id: organization.id, slug: organization.slug });
      expect(res.body.settings.layout.pageWidth).toBe(1100);
      expect(res.body.content['event.getTickets']).toBe('Get tickets');
      expect(res.body.resolved).toHaveProperty('menus.main');
      expect(Array.isArray(res.body.resolved.events)).toBe(true);
    });

    it('private store: the registered route answers the gate without a token', async () => {
      const prefs = await request(app)
        .patch('/admin/online-store/preferences')
        .set(...auth(adminToken))
        .send({ storefrontPrivate: true, password: 'themes-1985' });
      expect(prefs.status).toBe(200);

      const locked = await render(organization.slug);
      expect(locked.status).toBe(403);
      expect(locked.body.details).toMatchObject({ locked: true, organization: { id: organization.id } });
      expect(locked.headers['cache-control']).toBe('private, no-store');
      expect(JSON.stringify(locked.body)).not.toContain('Shown');

      const unlock = await request(app).post(`/organizations/${organization.id}/storefront-access`).send({ password: 'themes-1985' });
      const open = await render(organization.slug, 'events', { 'X-Storefront-Access': unlock.body.token });
      expect(open.status).toBe(200);
      expect(open.body.page).toBe('events');
    });

    it('page=frame returns header and footer only, and resolves theme links', async () => {
      const unlock = await request(app).post(`/organizations/${organization.id}/storefront-access`).send({ password: 'themes-1985' });
      const page = await prisma.page.create({ data: { organizationId: organization.id, title: 'About', slug: 'about-themes-ct', content: '<p>x</p>' } });
      const hidden = await prisma.page.create({ data: { organizationId: organization.id, title: 'Draft', slug: 'draft-themes-ct', content: '<p>x</p>', isVisible: false } });
      await save({
        themeVersion: (await current()).version,
        documents: {
          header: {
            version: await docVersion('header'),
            data: {
              root: { props: {} },
              content: [
                {
                  type: 'AnnouncementBar',
                  props: {
                    id: 'AB',
                    blocks: [
                      { type: 'Announcement', props: { id: 'L1', text: 'About', link: { type: 'PAGE', targetId: page.id } } },
                      { type: 'Announcement', props: { id: 'L2', text: 'Hidden', link: { type: 'PAGE', targetId: hidden.id } } },
                      { type: 'Announcement', props: { id: 'L3', text: 'Out', link: { type: 'EXTERNAL', url: 'https://example.com/x' } } },
                    ],
                  },
                },
                { type: 'Header', props: { id: 'Hd' } },
              ],
            },
          },
        },
      });
      const res = await render(organization.slug, 'frame', { 'X-Storefront-Access': unlock.body.token });
      expect(res.status).toBe(200);
      expect(res.body.page).toBe('frame');
      expect(res.body.documents.template).toBeNull();
      expect(res.body.resolved.events).toEqual([]);
      expect(res.body.resolved.links).toEqual({
        [`PAGE:${page.id}`]: `/organizations/${organization.slug}/pages/about-themes-ct`,
        'EXTERNAL:https://example.com/x': 'https://example.com/x',
      });
    });

    it('unknown organizations and pages are 404', async () => {
      expect((await render('no-such-org-themes-ct')).status).toBe(404);
      const unlock = await request(app).post(`/organizations/${organization.id}/storefront-access`).send({ password: 'themes-1985' });
      expect((await render(organization.id, 'checkout', { 'X-Storefront-Access': unlock.body.token })).status).toBe(404);
    });
  });

  describe('preview data', () => {
    it('resolves referenced files for the editor, scoped to the organization', async () => {
      const saved = await save({
        themeVersion: (await current()).version,
        settings: { logo: { image: { fileId: files[0].id, alt: 'Logo' } } },
      });
      expect(saved.status).toBe(200);
      const res = await request(app).get(`/admin/themes/${theme.id}/preview-data?page=home`).set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.resolved.files)).toContain(files[0].id);
      expect(res.body.resolved.files[files[0].id].url).toContain(`/files/${files[0].id}/`);
    });

    it('resolves files on every page, not only the one asked for', async () => {
      // The editor loads preview data once (page=events) and switches pages
      // locally; a Home hero slide image must still resolve after a reload.
      const { body: home } = await request(app).get(`/admin/themes/${theme.id}/documents/home`).set(...auth(adminToken));
      const slides = {
        root: { props: { title: 'Home' } },
        content: [
          {
            type: 'HeroCarousel',
            props: {
              id: 'HC-1',
              blocks: [{ type: 'Slide', props: { id: 'S-1', heading: 'x', image: { fileId: files[1].id, alt: 'Stage' } } }],
            },
          },
        ],
      };
      const saved = await save({ themeVersion: (await current()).version, documents: { home: { data: slides, version: home.version } } });
      expect(saved.status).toBe(200);
      const res = await request(app).get(`/admin/themes/${theme.id}/preview-data?page=events`).set(...auth(adminToken));
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.resolved.files)).toContain(files[1].id);
    });
  });
});
