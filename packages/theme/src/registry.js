// Section registry (spec 038 §6.2, §7). Settings only: the React
// components live in frontend/src/theme/sections and are looked up by type.
// Cards 038B/C/S ship these; later cards add more definitions here.

import {
  colorScheme,
  datetime,
  httpsUrl,
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
  video,
} from './fields.js';

/**
 * Groups a section can be placed in (Shopify `enabled_on.groups`). `page`
 * sections exist only in a Content page's own document (`page:<id>`).
 */
export const GROUPS = ['header', 'footer', 'template', 'page'];

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
      size: select('Size', ['medium', 'large']),
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
  Feature: {
    label: 'Feature',
    settings: {
      image: image('Image'),
      title: text('Title', { max: 80, default: 'Feature' }),
      text: textarea('Text', { max: 300, default: '' }),
    },
  },
  Stat: {
    label: 'Stat',
    settings: {
      value: text('Number', { max: 24, default: '100+' }),
      label: text('Label', { max: 100, default: 'Happy guests' }),
    },
  },
  ChecklistItem: {
    label: 'List item',
    settings: {
      text: text('Text', { max: 200, default: 'List item' }),
    },
  },
  Step: {
    label: 'Step',
    settings: {
      title: text('Title', { max: 80, default: 'Step' }),
      text: richtext('Text', { max: 2000 }),
    },
  },
  Tier: {
    label: 'Tier',
    settings: {
      name: text('Name', { max: 80, default: 'Tier' }),
      tagline: text('Tagline', { max: 120, default: '' }),
      // One benefit per line; each line is a list item.
      benefits: textarea('Benefits (one per line)', { max: 3000, default: '' }),
      featured: toggle('Highlight this tier', false),
      badge: text('Highlight label', { max: 30, default: 'Most popular' }),
    },
  },
};

const buttons = { types: ['Button'], max: 2 };
const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'vimeo.com'];

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
      // Behind the text (full-bleed layout); the image is its poster and the
      // still shown under reduced motion. Loops muted, with a pause button.
      video: video('Background video (MP4 or WebM)'),
      videoWebm: video('Background video, WebM version (optional)'),
      layout: select('Layout', ['full-bleed', 'split-left', 'split-right']),
      overlay: range('Overlay opacity', 0, 80, { step: 10, unit: '%', default: 40 }),
      alignment: radio('Text alignment', ['center', 'left']),
      // h1 when this hero opens a full-width page that has no Page content.
      headingLevel: radio('Heading level', ['h2', 'h1']),
      // retro = monospace uppercase heading, larger subheading, both with a drop shadow.
      textStyle: select('Text style', ['default', 'retro']),
      // screen = the window's height minus whatever sits above the hero (header).
      height: select('Height', [...HEIGHTS, 'screen'], 'medium'),
      // Phones only, full-bleed only: button-bottom centers the text and pins
      // the buttons full width to the bottom of the hero.
      mobileLayout: select('Layout on mobile', ['stacked', 'button-bottom']),
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
  // Spec 046: a Content › Galleries record, placed by reference. Display
  // options live here, so one gallery can be a carousel on one page and
  // masonry on another.
  Gallery: {
    label: 'Photo gallery',
    category: 'Media',
    groups: ['template'],
    settings: {
      gallery: reference('Gallery', 'gallery'),
      heading: text('Heading', { max: 120, default: '' }),
      layout: select('Layout', ['masonry', 'carousel'], 'masonry'),
      columnsDesktop: range('Columns on desktop', 2, 5, { default: 3 }),
      columnsMobile: range('Columns on phones', 1, 2, { default: 2 }),
      showCaptions: toggle('Show captions', false),
      showSectionTitles: toggle('Show section titles', true),
      autoplay: select('Autoplay (carousel)', ['off', '5s', '8s'], 'off'),
    },
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
  // Landing-page sections: an image beside text and buttons, and a grid of
  // short benefit cards.
  ImageWithText: {
    label: 'Image with text',
    category: 'Text',
    groups: ['template'],
    settings: {
      image: image('Image'),
      // A YouTube or Vimeo player in the image's place (the image is then unused).
      videoUrl: httpsUrl('Video link (YouTube or Vimeo)', VIDEO_HOSTS),
      videoTitle: text('Video title (read by screen readers)', { max: 120, default: 'Video' }),
      imagePosition: radio('Media position', ['left', 'right']),
      heading: text('Heading', { max: 120, default: 'Tell your story' }),
      // h1 when this section opens a full-width page that has no Page content.
      headingLevel: radio('Heading level', ['h2', 'h1']),
      body: richtext('Text'),
    },
    blocks: buttons,
  },
  FeatureGrid: {
    label: 'Feature grid',
    category: 'Text',
    groups: ['template'],
    settings: {
      heading: text('Heading', { max: 120, default: 'Why come' }),
      intro: textarea('Intro', { max: 300, default: '' }),
      columns: select('Columns', ['2', '3', '4'], '3'),
      alignment: radio('Text alignment', ['center', 'left']),
    },
    blocks: { types: ['Feature'], max: 12 },
  },
  // Big numbers with a label each (attendance, years running, vendors).
  Stats: {
    label: 'Stats',
    category: 'Text',
    groups: ['template'],
    settings: {
      heading: text('Heading', { max: 120, default: '' }),
      intro: textarea('Intro', { max: 300, default: '' }),
    },
    blocks: { types: ['Stat'], max: 6 },
  },
  // A list of short lines with a check (who we want) or a cross (who we don't).
  Checklist: {
    label: 'Checklist',
    category: 'Text',
    groups: ['template'],
    settings: {
      heading: text('Heading', { max: 120, default: 'What to bring' }),
      intro: textarea('Intro', { max: 300, default: '' }),
      marker: radio('Marker', ['check', 'cross']),
      columns: select('Columns', ['1', '2', '3'], '2'),
    },
    blocks: { types: ['ChecklistItem'], max: 30 },
  },
  // Numbered steps (how to apply, how the day runs).
  Steps: {
    label: 'Steps',
    category: 'Text',
    groups: ['template'],
    settings: {
      heading: text('Heading', { max: 120, default: 'How it works' }),
      intro: textarea('Intro', { max: 300, default: '' }),
    },
    blocks: { types: ['Step'], max: 6 },
  },
  // Packages side by side (sponsorship levels, booth sizes), each with its
  // benefits; one can be highlighted.
  Tiers: {
    label: 'Tiers',
    category: 'Text',
    groups: ['template'],
    settings: {
      heading: text('Heading', { max: 120, default: 'Packages' }),
      intro: textarea('Intro', { max: 300, default: '' }),
    },
    blocks: { types: ['Tier'], max: 6 },
  },
  // The Content page's own title, text, template sections and Apply button
  // (StorefrontPageBody), placed among the theme sections of a full-width page.
  PageContent: {
    label: 'Page content',
    category: 'Text',
    groups: ['page'],
    limit: 1,
    settings: {},
  },
};

/** Section types allowed in a group, for Puck slot `allow` lists. */
export function sectionsForGroup(group) {
  return Object.entries(SECTIONS)
    .filter(([, def]) => def.groups.includes(group))
    .map(([type]) => type);
}
