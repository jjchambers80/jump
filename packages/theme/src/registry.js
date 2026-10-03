// Section registry (spec 038 §6.2, §7). Settings only: the React
// components live in frontend/src/theme/sections and are looked up by type.
// Cards 038B/C/S ship these; later cards add more definitions here.

import {
  colorScheme,
  datetime,
  image,
  link,
  radio,
  range,
  reference,
  richtext,
  select,
  text,
  textarea,
  toggle,
} from './fields.js';

/** Groups a section can be placed in (Shopify `enabled_on.groups`). */
export const GROUPS = ['header', 'footer', 'template'];

/** Every section and block may be hidden (D9) and has these (sections only). */
export const COMMON_SECTION_FIELDS = {
  colorScheme: colorScheme(),
  paddingTop: range('Top padding', 0, 80, { step: 4, unit: 'px', default: 32 }),
  paddingBottom: range('Bottom padding', 0, 80, { step: 4, unit: 'px', default: 32 }),
  // page = the page width; narrow 768 px, wide 1600 px, full = edge to edge.
  sectionWidth: select('Section width', ['page', 'narrow', 'wide', 'full'], 'page'),
};

const HEIGHTS = ['small', 'medium', 'large'];

export const BLOCKS = {
  Button: {
    label: 'Button',
    settings: {
      label: text('Label', { max: 40, default: 'Get tickets' }),
      link: link('Link', { type: 'EVENTS' }),
      style: select('Style', ['primary', 'secondary']),
    },
  },
  Announcement: {
    label: 'Announcement',
    settings: {
      text: text('Text', { max: 140, default: 'Tickets on sale now' }),
      link: link('Link'),
      startsAt: datetime('Show from'),
      endsAt: datetime('Show until'),
    },
  },
  MenuColumn: {
    label: 'Menu',
    settings: {
      heading: text('Heading', { max: 60, default: 'Quick links' }),
      menu: reference('Menu', 'menu'),
    },
  },
  Text: {
    label: 'Text',
    settings: {
      heading: text('Heading', { max: 60, default: '' }),
      body: richtext('Text', { max: 2000 }),
    },
  },
  BrandInfo: { label: 'Brand information', settings: {} },
  Slide: {
    label: 'Slide',
    settings: {
      image: image('Image'),
      heading: text('Heading', { max: 120, default: '' }),
      subheading: textarea('Subheading', { max: 300, default: '' }),
      buttonLabel: text('Button label', { max: 40, default: '' }),
      link: link('Button link'),
      alignment: radio('Text alignment', ['center', 'left']),
    },
  },
  FaqItem: {
    label: 'Question',
    settings: {
      question: text('Question', { max: 200, default: 'Question' }),
      answer: richtext('Answer', { max: 4000 }),
    },
  },
  SocialLinks: { label: 'Social media', settings: {} },
};

const buttons = { types: ['Button'], max: 2 };

export const SECTIONS = {
  AnnouncementBar: {
    label: 'Announcement bar',
    category: 'Header',
    groups: ['header'],
    limit: 1,
    settings: {
      rotate: select('Rotate announcements', ['off', '5s', '8s']),
      dismissible: toggle('Visitors can close it', false),
    },
    blocks: { types: ['Announcement'], max: 5 },
  },
  Header: {
    label: 'Header',
    category: 'Header',
    groups: ['header'],
    limit: 1,
    locked: true,
    settings: {
      logoPosition: select('Logo position', ['left', 'center']),
      menu: reference('Menu', 'menu'),
      sticky: select('Sticky header', ['off', 'always', 'scroll-up']),
      separator: toggle('Show separator line', false),
      showAccountLink: toggle('Show account link', true),
    },
  },
  Footer: {
    label: 'Footer',
    category: 'Footer',
    groups: ['footer'],
    limit: 1,
    locked: true,
    settings: {
      showLegalLinks: toggle('Show legal links', true),
      poweredBy: toggle('Show "Powered by Eventimus"', false),
      copyright: text('Copyright text', { max: 120, default: '' }),
    },
    blocks: {
      types: ['MenuColumn', 'Text', 'BrandInfo', 'SocialLinks'],
      max: 8,
      limits: { BrandInfo: 1, SocialLinks: 1 },
    },
  },
  EventsHero: {
    label: 'Events hero',
    category: 'Events',
    groups: ['template'],
    limit: 1,
    settings: {
      image: image('Cover image (defaults to the organization cover)'),
      showNextEvent: toggle('Show the next event', true),
      height: select('Height', HEIGHTS, 'medium'),
    },
  },
  EventList: {
    label: 'Event list',
    category: 'Events',
    groups: ['template'],
    limit: 1,
    locked: true,
    settings: {
      layout: select('Layout', ['grouped', 'grid', 'list']),
      columnsDesktop: range('Columns on desktop', 2, 4, { default: 3 }),
      columnsMobile: range('Columns on mobile', 1, 2, { default: 1 }),
      imageRatio: select('Image ratio', ['none', '16:9', '4:3', '1:1']),
      showPrice: toggle('Show price', true),
      showVenue: toggle('Show venue', true),
      showDateBadge: toggle('Show date badge', true),
      categoryFilter: toggle('Category filter', false),
      venueFilter: toggle('Venue filter', false),
      sort: select('Sort', ['date-asc', 'date-desc']),
      pageSize: range('Events per page', 12, 48, { step: 12, default: 24 }),
      emptyText: text('Text when there are no events', { max: 140, default: '' }),
    },
  },
  Hero: {
    label: 'Hero',
    category: 'Banners',
    groups: ['template'],
    settings: {
      heading: text('Heading', { max: 120, default: 'Welcome' }),
      subheading: textarea('Subheading', { max: 300, default: '' }),
      image: image('Image'),
      layout: select('Layout', ['full-bleed', 'split-left', 'split-right']),
      overlay: range('Overlay opacity', 0, 80, { step: 10, unit: '%', default: 40 }),
      alignment: radio('Text alignment', ['center', 'left']),
      height: select('Height', HEIGHTS, 'medium'),
    },
    blocks: buttons,
  },
  HeroCarousel: {
    label: 'Hero carousel',
    category: 'Banners',
    groups: ['template'],
    settings: {
      autoplay: select('Autoplay', ['off', '5s', '8s'], '5s'),
      height: select('Height', HEIGHTS, 'medium'),
      overlay: range('Overlay opacity', 0, 80, { step: 10, unit: '%', default: 40 }),
      showArrows: toggle('Show arrows', true),
      showDots: toggle('Show dots', true),
    },
    blocks: { types: ['Slide'], max: 6 },
  },
  UpcomingEvents: {
    label: 'Upcoming events',
    category: 'Events',
    groups: ['template'],
    settings: {
      heading: text('Heading', { max: 120, default: 'Upcoming events' }),
      count: range('Events shown', 3, 12, { default: 6 }),
      layout: select('Layout', ['grid', 'list', 'carousel']),
      category: text('Only this category', { max: 60, default: '' }),
      showViewAll: toggle('Show "View all" link', true),
    },
  },
  RichText: {
    label: 'Rich text',
    category: 'Text',
    groups: ['template'],
    settings: {
      heading: text('Heading', { max: 120, default: 'Talk about your events' }),
      body: richtext('Text'),
      alignment: radio('Alignment', ['left', 'center']),
      width: select('Width', ['narrow', 'normal', 'wide'], 'normal'),
    },
    blocks: buttons,
  },
  CallToAction: {
    label: 'Call to action',
    category: 'Text',
    groups: ['template'],
    settings: {
      heading: text('Heading', { max: 120, default: 'Don’t miss the next show' }),
      text: textarea('Text', { max: 300, default: '' }),
    },
    blocks: buttons,
  },
  Faq: {
    label: 'FAQ',
    category: 'Text',
    groups: ['template'],
    settings: {
      heading: text('Heading', { max: 120, default: 'Frequently asked questions' }),
      intro: textarea('Intro', { max: 300, default: '' }),
      singleOpen: toggle('Open one answer at a time', true),
      openFirst: toggle('Open the first answer', false),
      width: select('Width', ['narrow', 'normal', 'wide'], 'normal'),
    },
    blocks: { types: ['FaqItem'], max: 30 },
  },
};

/** Section types allowed in a group, for Puck slot `allow` lists. */
export function sectionsForGroup(group) {
  return Object.entries(SECTIONS)
    .filter(([, def]) => def.groups.includes(group))
    .map(([type]) => type);
}
