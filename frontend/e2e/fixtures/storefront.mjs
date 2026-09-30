// Canned storefront data for server-rendered themed pages (spec 038 §16,
// contracts C9). Built from the real preset in @jump/theme so fixtures move
// with it. One fixture set per organization id: tests pick one by URL.

import { getPreset, resolveContent, resolveSettings } from '@jump/theme';

const preset = getPreset('eventimus-default');
/** The Events template every fixture serves for `page=events`. */
export const EVENTS_TEMPLATE = preset.documents.events;
/** A square logo for header-size assertions (data URL: no asset server). */
export const LOGO =
  'data:image/svg+xml,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="navy"/></svg>');
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

function render(orgId, { organization = {}, header, footer, template } = {}) {
  const documents = {
    header: header ?? { root: { props: {} }, content: [{ type: 'Header', props: { id: 'Header-default' } }] },
    template: template ?? preset.documents.events,
    footer: footer ?? preset.documents.footer,
  };
  return {
    renderer: 'theme',
    page: template ? 'home' : 'events',
    fallback: !template,
    theme: { id: `${orgId}-theme`, name: 'Eventimus Default' },
    organization: org(orgId, organization),
    settings: resolveSettings({}, preset.settings),
    content: resolveContent({}),
    documents,
    resolved: { events: events(orgId), menus: menus(orgId), links: { 'EVENTS:': `/organizations/${orgId}/events` }, files: {} },
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

// Screenshot parity (spec 038 test 10): the same organization, events and
// menus served to the themed renderer ("theme-parity") and, through browser
// mocks, to today's client page (any id without a fixture).
export const PARITY_COVER = '/uploads/parity-cover.png';
export function parityPublic(orgId, themeMode = 'LIGHT') {
  return {
    organization: { ...org(orgId, { coverUrl: PARITY_COVER, themeMode }), id: orgId },
    events: events('theme-parity'),
    locked: false,
  };
}
export const parityMenus = () => menus('theme-parity');

// A saved homepage built from the starter sections (038S).
const homeDocument = {
  root: { props: { title: 'Home' } },
  content: [
    {
      type: 'Hero',
      props: {
        id: 'Hero-home',
        heading: 'Summer Series 2031',
        subheading: 'Twelve nights of music by the river.',
        blocks: [
          { type: 'Button', props: { id: 'B-events', label: 'See all events', link: { type: 'EVENTS' } } },
          { type: 'Button', props: { id: 'B-gone', label: 'Deleted page', link: { type: 'PAGE', targetId: 'gone' } } },
        ],
      },
    },
    { type: 'UpcomingEvents', props: { id: 'Upcoming-home', heading: 'Coming up', count: 2, layout: 'list' } },
    { type: 'RichText', props: { id: 'Rich-home', heading: 'About the series', body: '<p>Since 2009 on the river bank.</p>' } },
    { type: 'CallToAction', props: { id: 'Cta-home', heading: 'Bring a friend', text: 'Two-for-one on Thursdays.', blocks: [] } },
  ],
};

// Hero carousel + FAQ (spec 041).
const blocksDocument = {
  root: { props: { title: 'Home' } },
  content: [
    {
      type: 'HeroCarousel',
      props: {
        id: 'Carousel-home',
        autoplay: '8s',
        blocks: [
          { type: 'Slide', props: { id: 'Slide-1', heading: 'Opening night', buttonLabel: 'See all events', link: { type: 'EVENTS' } } },
          { type: 'Slide', props: { id: 'Slide-2', heading: 'Late show', image: { fileId: 'cover', alt: 'The stage at night' } } },
          { type: 'Slide', props: { id: 'Slide-3', heading: 'Closing party' } },
        ],
      },
    },
    {
      type: 'Faq',
      props: {
        id: 'Faq-home',
        heading: 'Good to know',
        singleOpen: true,
        blocks: [
          { type: 'FaqItem', props: { id: 'Q-parking', question: 'Is there parking?', answer: '<p>Free parking behind the hall.</p>' } },
          { type: 'FaqItem', props: { id: 'Q-doors', question: 'When do doors open?', answer: '<p>One hour before the show.</p>' } },
        ],
      },
    },
  ],
};

/** orgId → { render, routes, gate? } */
export const FIXTURES = {
  'theme-home': { render: render('theme-home', { template: homeDocument }), routes: {} },
  'theme-blocks': (() => {
    const base = render('theme-blocks', { template: blocksDocument });
    return { render: { ...base, resolved: { ...base.resolved, files: { cover: { url: PARITY_COVER, alt: 'The stage at night' } } } }, routes: {} };
  })(),
  'theme-parity': { render: render('theme-parity', { organization: { coverUrl: PARITY_COVER } }), routes: {} },
  'theme-parity-dark': {
    render: { ...render('theme-parity', { organization: { coverUrl: PARITY_COVER, themeMode: 'DARK' } }), organization: org('theme-parity-dark', { coverUrl: PARITY_COVER, themeMode: 'DARK' }) },
    routes: {},
  },
  'theme-light': { render: render('theme-light', { header: announcementHeader }), routes: contentRoutes('theme-light') },
  'theme-dark': { render: render('theme-dark', { organization: { themeMode: 'DARK', brandColor: '#be185d' } }), routes: {} },
  'theme-system': { render: render('theme-system', { organization: { themeMode: 'SYSTEM' } }), routes: {} },
  'theme-private': {
    render: render('theme-private'),
    routes: contentRoutes('theme-private'),
    gate: { password: 'letmein', token: 'e2e-access-token', message: 'Members only until launch' },
  },
  'theme-legacy': { render: { renderer: 'legacy' }, routes: {} },
  'theme-logo': { render: render('theme-logo', { organization: { logoUrl: LOGO } }), routes: {} },
};

/**
 * Event route meta (`GET /events/:id/meta`) for event pages framed by a theme.
 * Keyed by slug and id, as the backend resolves either.
 */
export const EVENT_ROUTES = Object.fromEntries(
  ['theme-light', 'theme-logo'].flatMap((orgId) => {
    const meta = { id: `${orgId}-event-0`, slug: `${orgId}-show-0`, organizationId: orgId };
    return [[meta.id, meta], [meta.slug, meta]];
  }),
);
