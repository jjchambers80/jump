// Canned storefront data for server-rendered themed pages (spec 038 §16,
// contracts C9). Built from the real preset in @jump/theme so fixtures move
// with it. One fixture set per organization id: tests pick one by URL.

import { getPreset, resolveContent, resolveSettings } from '@jump/theme';

const preset = getPreset('eventimus-default');
const future = (days) => new Date(Date.UTC(2031, 5, 1 + days, 23, 0)).toISOString();

function org(id, extra = {}) {
  return {
    id,
    slug: id,
    name: extra.name ?? 'Riverside Presents',
    logoUrl: null,
    coverUrl: null,
    brandColor: '#0f766e',
    themeMode: 'LIGHT',
    buyerSignInLinks: false,
    ...extra,
  };
}

function events(orgId) {
  const venue = { id: `${orgId}-venue`, slug: 'riverside-hall', name: 'Riverside Hall', address: '1 River Rd', timezone: 'America/New_York' };
  return [0, 3, 40].map((d, i) => ({
    id: `${orgId}-event-${i}`,
    slug: `${orgId}-show-${i}`,
    name: `Summer Show ${i + 1}`,
    date: future(d),
    venue,
    category: 'Music',
    status: 'PUBLISHED',
    admissionMode: 'TICKETED',
    rsvpLimit: null,
    rsvpMaxPartySize: 1,
    priceRange: { min: 20, max: 45 },
    availableTickets: 40,
  }));
}

const menus = (orgId) => ({
  main: [
    { id: 'm-home', label: 'Home', href: `/organizations/${orgId}`, newTab: false, children: [] },
    { id: 'm-about', label: 'About', href: `/organizations/${orgId}/pages/about`, newTab: false, children: [] },
  ],
  footer: [{ id: 'f-contact', label: 'Contact us', href: `/organizations/${orgId}/pages/contact`, newTab: false, children: [] }],
});

function render(orgId, { organization = {}, header, footer } = {}) {
  const documents = {
    header: header ?? { root: { props: {} }, content: [{ type: 'Header', props: { id: 'Header-default' } }] },
    template: preset.documents.events,
    footer: footer ?? preset.documents.footer,
  };
  return {
    renderer: 'theme',
    page: 'events',
    fallback: true,
    theme: { id: `${orgId}-theme`, name: 'Eventimus Default' },
    organization: org(orgId, organization),
    settings: resolveSettings({}, preset.settings),
    content: resolveContent({}),
    documents,
    resolved: { events: events(orgId), menus: menus(orgId), links: { 'EVENTS:': `/organizations/${orgId}#events` }, files: {} },
  };
}

const announcementHeader = {
  root: { props: {} },
  content: [
    {
      type: 'AnnouncementBar',
      props: {
        id: 'AB',
        rotate: '5s',
        dismissible: true,
        blocks: [
          { type: 'Announcement', props: { id: 'A1', text: 'Early-bird pricing ends Friday', link: { type: 'EVENTS' } } },
          { type: 'Announcement', props: { id: 'A2', text: 'Free parking every show' } },
        ],
      },
    },
    { type: 'Header', props: { id: 'Header-default', sticky: 'always' } },
  ],
};

const contentRoutes = (orgId) => ({
  '/public/pages/about': {
    organization: org(orgId),
    page: { id: 'p1', title: 'About the series', slug: 'about', content: '<p>Since 2009 by the river.</p>' },
  },
  '/public/blogs/news': {
    organization: org(orgId),
    blog: { id: 'b1', title: 'News', handle: 'news' },
    posts: [
      {
        id: 'post1',
        title: 'Lineup announced',
        handle: 'lineup',
        blog: { id: 'b1', title: 'News', handle: 'news' },
        authorName: 'Sam',
        tags: ['lineup'],
        publishedAt: '2031-05-01T12:00:00.000Z',
        excerpt: '<p>Twelve nights of music.</p>',
        featuredImage: null,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 12,
  },
  '/public/blogs/news/lineup': {
    organization: org(orgId),
    post: {
      id: 'post1',
      title: 'Lineup announced',
      handle: 'lineup',
      blog: { id: 'b1', title: 'News', handle: 'news' },
      authorName: 'Sam',
      tags: ['lineup'],
      publishedAt: '2031-05-01T12:00:00.000Z',
      excerpt: '<p>Twelve nights of music.</p>',
      featuredImage: null,
      content: '<p>Twelve nights of music by the river.</p>',
    },
  },
});

/** orgId → { render, routes, gate? } */
export const FIXTURES = {
  'theme-light': { render: render('theme-light', { header: announcementHeader }), routes: contentRoutes('theme-light') },
  'theme-dark': { render: render('theme-dark', { organization: { themeMode: 'DARK', brandColor: '#be185d' } }), routes: {} },
  'theme-system': { render: render('theme-system', { organization: { themeMode: 'SYSTEM' } }), routes: {} },
  'theme-private': {
    render: render('theme-private'),
    routes: contentRoutes('theme-private'),
    gate: { password: 'letmein', token: 'e2e-access-token', message: 'Members only until launch' },
  },
  'theme-legacy': { render: { renderer: 'legacy' }, routes: {} },
};
