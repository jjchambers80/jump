// Mocked API for the theme editor specs (spec 038D). Documents start from the
// real preset; saves are recorded and answered like the backend (versions,
// optional 409 / 400).

import type { Page } from '@playwright/test';
// @ts-ignore plain ESM JS package
import { getPreset } from '@jump/theme';

export const API = 'http://localhost:3002';
const preset = getPreset('eventimus-default');

export const editorOrg = {
  id: 'org-editor',
  name: 'Riverside Presents',
  slug: 'riverside-presents',
  status: 'ACTIVE',
  logoUrl: null,
  coverUrl: null,
  brandColor: '#0f766e',
  themeMode: 'LIGHT',
  createdAt: '2027-01-01T00:00:00.000Z',
  updatedAt: '2027-01-01T00:00:00.000Z',
  _count: { venues: 1, users: 2 },
};

const venue = { id: 'v1', slug: 'hall', name: 'Riverside Hall', address: '1 River Rd', timezone: 'America/New_York' };
const events = [1, 2, 3].map((i) => ({
  id: `e${i}`,
  slug: `show-${i}`,
  name: `Summer Show ${i}`,
  date: new Date(Date.UTC(2031, 5, i * 4, 23)).toISOString(),
  venue,
  category: 'Music',
  status: 'PUBLISHED',
  admissionMode: 'TICKETED',
  priceRange: { min: 20, max: 40 },
  availableTickets: 30,
}));

/** A full-width Content page the editor can open (`?page=page:<id>`). */
export const fullWidthPage = { id: 'cmpagefullwidth000000001', title: 'Vendors', slug: 'vendors' };
export const fullWidthPageKey = `page:${fullWidthPage.id}`;

export interface EditorMockOptions {
  conflictOnSave?: boolean;
  invalidOnSave?: boolean;
  role?: 'MAIN' | 'UNPUBLISHED';
}

export async function mockThemeEditorApi(page: Page, options: EditorMockOptions = {}) {
  const saves: any[] = [];
  const restores: any[] = [];
  const docs: Record<string, any> = {
    header: preset.documents.header,
    footer: preset.documents.footer,
    home: preset.documents.home,
    events: preset.documents.events,
    [fullWidthPageKey]: { root: { props: {} }, content: [{ type: 'PageContent', props: { id: 'PageContent-1' } }] },
  };
  const versions: Record<string, number> = { header: 0, footer: 0, home: 0, events: 0, [fullWidthPageKey]: 0 };
  let themeVersion = 1;
  const revisions = [
    { id: 'rev-2', changedKeys: ['home'], savedBy: { id: 'u1', name: 'Sam Organizer' }, createdAt: '2027-03-02T15:00:00.000Z' },
    { id: 'rev-1', changedKeys: ['settings'], savedBy: { id: 'u1', name: 'Sam Organizer' }, createdAt: '2027-03-01T15:00:00.000Z' },
  ];

  await page.route(`${API}/**`, (route) => route.fulfill({ json: [] }));
  await page.route(`${API}/organizations`, (route) => route.fulfill({ json: [editorOrg] }));
  await page.route(`${API}/admin/menus`, (route) => route.fulfill({ json: { menus: [{ id: 'menu-main', title: 'Main menu', handle: 'main-menu', isDefault: true, itemLabels: [], updatedAt: '' }] } }));
  await page.route(`${API}/admin/menus/link-targets**`, (route) =>
    route.fulfill({ json: { events: [], venues: [], pages: [{ id: 'page-about', title: 'About us', slug: 'about' }], blogs: [], blogPosts: [] } }),
  );
  await page.route(`${API}/admin/themes/theme-main`, (route) =>
    route.fulfill({
      json: {
        id: 'theme-main',
        name: 'Eventimus Default',
        role: options.role ?? 'MAIN',
        presetKey: 'eventimus-default',
        presetVersion: '1.0',
        version: themeVersion,
        lastSavedAt: '2027-03-02T15:00:00.000Z',
        lastSavedBy: null,
        publishedAt: null,
        createdAt: '2027-01-01T00:00:00.000Z',
        settings: {},
        resolvedSettings: { ...preset.settings, layout: { pageWidth: 1200, sectionSpacing: 0 } },
        content: {},
        documents: Object.keys(docs).map((key) => ({ key, kind: 'TEMPLATE', version: versions[key], updatedAt: null, isDefault: versions[key] === 0 })),
      },
    }),
  );
  await page.route(`${API}/admin/themes/theme-main/content`, (route) =>
    route.fulfill({ json: { overrides: {}, resolved: { 'events.upcoming': 'Upcoming events', 'events.viewAll': 'View all events', 'events.empty': 'No upcoming events', 'event.getTickets': 'Get tickets', 'event.rsvp': 'RSVP', 'event.soldOut': 'Sold out', 'announcement.pause': 'Pause announcements', 'announcement.close': 'Close', 'carousel.label': 'Featured', 'carousel.previous': 'Previous slide', 'carousel.next': 'Next slide', 'carousel.pause': 'Pause slides', 'carousel.slide': 'Slide {n} of {total}' } } }),
  );
  await page.route(`${API}/admin/pages`, (route) =>
    route.fulfill({ json: { pages: [{ ...fullWidthPage, content: '', isVisible: true, template: 'full-width' }, { id: 'page-about', title: 'About us', slug: 'about', content: '', isVisible: true, template: null }] } }),
  );
  await page.route(`${API}/admin/themes/theme-main/preview-data**`, (route) => {
    const isPage = new URL(route.request().url()).searchParams.get('page') === fullWidthPageKey;
    return route.fulfill({
      json: {
        organization: { ...editorOrg, buyerSignInLinks: false },
        resolved: {
          events,
          menus: { main: [], footer: [] },
          links: { 'EVENTS:': '/organizations/riverside-presents/events' },
          files: {},
          ...(isPage && { page: { ...fullWidthPage, content: '<p>Tables from $40.</p>', template: { name: 'full-width', sections: [{ type: 'page_content' }] } } }),
        },
      },
    });
  });
  await page.route(`${API}/admin/themes/theme-main/documents/*`, (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
    return route.fulfill({ json: { key, kind: 'TEMPLATE', data: docs[key], version: versions[key], isDefault: versions[key] === 0 } });
  });
  await page.route(`${API}/admin/themes/theme-main/save`, async (route) => {
    const body = route.request().postDataJSON();
    saves.push(body);
    if (options.conflictOnSave) {
      return route.fulfill({ status: 409, json: { error: 'ConflictError', code: 'THEME_CONFLICT', message: 'This theme changed since you opened it', details: { theme: 2, documents: {} } } });
    }
    if (options.invalidOnSave) {
      return route.fulfill({ status: 400, json: { error: 'ValidationError', code: 'THEME_INVALID', message: 'The theme has errors', details: { errors: { 'documents.home.content[0].props.heading': 'must be at most 120 characters' } } } });
    }
    const out: Record<string, number> = {};
    for (const [key, entry] of Object.entries<any>(body.documents ?? {})) {
      docs[key] = entry.data ?? (preset.documents as Record<string, any>)[key];
      versions[key] = entry.data === null ? 0 : versions[key] + 1;
      out[key] = versions[key];
    }
    return route.fulfill({ json: { theme: { id: 'theme-main', version: themeVersion, lastSavedAt: new Date().toISOString() }, documents: out, changedKeys: Object.keys(out) } });
  });
  await page.route(`${API}/admin/themes/theme-main/revisions`, (route) => route.fulfill({ json: { revisions } }));
  await page.route(`${API}/admin/themes/theme-main/revisions/*/restore`, async (route) => {
    restores.push({ url: route.request().url(), body: route.request().postDataJSON() });
    themeVersion += 1;
    return route.fulfill({ json: { theme: { id: 'theme-main', version: themeVersion, lastSavedAt: '' }, documents: {}, changedKeys: ['restore:rev-1'] } });
  });
  return { saves, restores, docs };
}
