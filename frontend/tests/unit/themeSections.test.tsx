// Render tests for the theme sections (spec 038 §16: one per section).
// Presentational components, so static markup is enough.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Render } from '@puckeditor/core';
import { getPreset } from '@jump/theme';
import ButtonBlock from '@/theme/sections/ButtonBlock';
import CallToActionSection from '@/theme/sections/CallToActionSection';
import HeroSection from '@/theme/sections/HeroSection';
import HeroCarouselSection from '@/theme/sections/HeroCarouselSection';
import SlideBlock from '@/theme/sections/SlideBlock';
import FaqSection from '@/theme/sections/FaqSection';
import FaqItemBlock from '@/theme/sections/FaqItemBlock';
import RichTextSection from '@/theme/sections/RichTextSection';
import UpcomingEventsSection from '@/theme/sections/UpcomingEventsSection';
import EventsHeroSection from '@/theme/sections/EventsHeroSection';
import EventListSection from '@/theme/sections/EventListSection';
import type { SectionContext } from '@/theme/sections/context';
import { renderConfig, renderable } from '@/theme/render/config';

const venue = { id: 'v1', name: 'Riverside Hall', address: '1 River Rd', timezone: 'America/New_York' };
const event = (i: number, days: number, category = 'Music') => ({
  id: `e${i}`,
  slug: `show-${i}`,
  name: `Show ${i}`,
  date: new Date(Date.now() + days * 86_400_000).toISOString(),
  venue,
  category,
  status: 'PUBLISHED',
  admissionMode: 'TICKETED' as const,
  priceRange: { min: 20, max: 30 },
  availableTickets: 50,
});

function ctx(overrides: Partial<SectionContext> = {}): SectionContext {
  return {
    organization: { id: 'org_1', slug: 'riverside', name: 'Riverside Presents', logoUrl: null, coverUrl: '/uploads/cover.jpg', brandColor: '#0f766e', themeMode: 'LIGHT', buyerSignInLinks: true },
    resolved: {
      events: [event(1, -3), event(2, 2), event(3, 5, 'Comedy'), event(4, 9)],
      menus: { main: [], footer: [] },
      links: { 'EVENTS:': '/organizations/riverside/events', 'PAGE:p1': '/organizations/riverside/pages/about' },
      files: { f1: { url: 'https://cdn.test/hero.jpg', width: 1600, height: 900, alt: 'Stage lights' } },
    },
    settings: {},
    content: { 'events.upcoming': 'Upcoming events', 'events.viewAll': 'View all events', 'events.empty': 'No upcoming events', 'event.getTickets': 'Buy now', 'event.rsvp': 'RSVP', 'event.soldOut': 'Sold out' },
    host: null,
    nameIsHeading: false,
    path: '/organizations/riverside',
    query: {},
    ...overrides,
  };
}

const buttons = (html: string) => () => <div dangerouslySetInnerHTML={{ __html: html }} />;
const noButtons = () => null;

describe('ButtonBlock', () => {
  it('renders a resolved link and drops one whose target is gone (D8)', () => {
    expect(renderToStaticMarkup(<ButtonBlock label="About" link={{ type: 'PAGE', targetId: 'p1' }} ctx={ctx()} />)).toContain(
      'href="/organizations/riverside/pages/about"',
    );
    expect(renderToStaticMarkup(<ButtonBlock label="Gone" link={{ type: 'PAGE', targetId: 'deleted' }} ctx={ctx()} />)).toBe('');
    const external = renderToStaticMarkup(<ButtonBlock label="Map" link={{ type: 'EXTERNAL', url: 'https://maps.test/x' }} ctx={ctx()} />);
    expect(external).toContain('href="https://maps.test/x"');
    expect(external).toContain('rel="noopener"');
  });

  it('shortens platform paths on a custom domain', () => {
    const html = renderToStaticMarkup(<ButtonBlock label="Events" link={{ type: 'EVENTS' }} ctx={ctx({ host: 'tickets.riverside.test' })} />);
    expect(html).toContain('href="/events"');
  });
});

describe('HeroSection', () => {
  it('labels the section by its heading and renders the buttons slot', () => {
    const html = renderToStaticMarkup(<HeroSection id="h1" heading="Summer Series" subheading="By the river" Buttons={buttons('<a>Tickets</a>')} ctx={ctx()} />);
    expect(html).toMatch(/<section aria-labelledby="hero-h1"/);
    expect(html).toContain('<h2 id="hero-h1"');
    expect(html).toContain('By the river');
    expect(html).toContain('Tickets');
  });

  it('full-bleed image uses its alt text; a decorative image has an empty alt', () => {
    const withAlt = renderToStaticMarkup(<HeroSection id="h" heading="x" image={{ fileId: 'f1', alt: 'Crowd' }} Buttons={noButtons} ctx={ctx()} />);
    expect(withAlt).toContain('alt="Crowd"');
    expect(withAlt).toContain('opacity:0.4');
    const decorative = renderToStaticMarkup(<HeroSection id="h" heading="x" image={{ fileId: 'f1', decorative: true }} Buttons={noButtons} ctx={ctx()} />);
    expect(decorative).toContain('alt=""');
  });

  it('full-bleed image sits in the content container with 32px corners, fitted whole over a blurred copy', () => {
    const html = renderToStaticMarkup(<HeroSection id="h" heading="x" image={{ fileId: 'f1', alt: 'Crowd' }} Buttons={noButtons} ctx={ctx()} />);
    expect(html).toContain('max-w-7xl');
    expect(html).toContain('rounded-[32px]');
    expect(html).toMatch(/alt="Crowd" class="[^"]*object-contain/);
    expect(html).toMatch(/data-testid="hero-backdrop" class="[^"]*blur-2xl/);
  });

  it('an image of another organization (unresolved) is left out', () => {
    const html = renderToStaticMarkup(<HeroSection id="h" heading="x" image={{ fileId: 'foreign', alt: 'x' }} Buttons={noButtons} ctx={ctx()} />);
    expect(html).not.toContain('<img');
  });
});

describe('section width', () => {
  it('sets --theme-section-width on the section wrapper', () => {
    const html = renderToStaticMarkup(<UpcomingEventsSection id="U" heading="Upcoming" count={3} sectionWidth="full" ctx={ctx()} />);
    expect(html).toMatch(/data-section="UpcomingEvents"[^>]*style="--theme-section-width:none/);
    expect(html).toContain('max-w-7xl');
  });
});

describe('RichTextSection and CallToActionSection', () => {
  it('render their text and headings', () => {
    const rich = renderToStaticMarkup(<RichTextSection id="r" heading="About" body="<p>Since 2009</p>" alignment="center" Buttons={noButtons} ctx={ctx()} />);
    expect(rich).toContain('<p>Since 2009</p>');
    expect(rich).toContain('text-center');
    const cta = renderToStaticMarkup(<CallToActionSection id="c" heading="Join us" text="Tickets go fast" Buttons={buttons('<a>Go</a>')} ctx={ctx()} />);
    expect(cta).toContain('Join us');
    expect(cta).toContain('Tickets go fast');
    expect(cta).toContain('aria-labelledby="cta-c"');
  });
});

describe('UpcomingEventsSection', () => {
  it('lists upcoming events only, up to the count, with a View all link', () => {
    const html = renderToStaticMarkup(<UpcomingEventsSection id="u" count={2} ctx={ctx()} />);
    expect(html).not.toContain('Show 1');
    expect(html).toContain('Show 2');
    expect(html).toContain('Show 3');
    expect(html).not.toContain('Show 4');
    expect(html).toContain('href="/organizations/riverside/events"');
    expect(html).toContain('View all events');
  });

  it('filters by category and says so when nothing is left', () => {
    expect(renderToStaticMarkup(<UpcomingEventsSection id="u" category="comedy" ctx={ctx()} />)).toContain('Show 3');
    expect(renderToStaticMarkup(<UpcomingEventsSection id="u" category="Theatre" ctx={ctx()} />)).toContain('No upcoming events');
  });
});

describe('EventsHero and EventList', () => {
  it('default the Events page to today\'s cover and grouped list', () => {
    const hero = renderToStaticMarkup(<EventsHeroSection ctx={ctx()} />);
    expect(hero).toContain('Riverside Presents cover');
    expect(hero).toContain('Buy now');
    const list = renderToStaticMarkup(<EventListSection ctx={ctx()} />);
    expect(list).toContain('id="events"');
    expect(list).toContain('4 events');
  });

  it('filters by category through the query', () => {
    const list = renderToStaticMarkup(<EventListSection categoryFilter ctx={ctx({ query: { category: 'Comedy' } })} />);
    expect(list).toContain('1 event');
    expect(list).toContain('aria-label="Filter events"');
  });
});

describe('HeroCarouselSection and SlideBlock', () => {
  const carouselCtx = () => ctx({ content: { 'carousel.label': 'Featured', 'carousel.previous': 'Previous slide', 'carousel.next': 'Next slide', 'carousel.pause': 'Pause slides', 'carousel.slide': 'Slide {n} of {total}' } });

  it('is a labelled carousel whose slot is a scroll-snap track carrying the overlay', () => {
    const html = renderToStaticMarkup(<HeroCarouselSection id="c" overlay={60} Slides={(p) => <div className={p?.className} style={p?.style} />} ctx={carouselCtx()} />);
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="Featured"');
    expect(html).toMatch(/class="hero-carousel-track [^"]*snap-x snap-mandatory/);
    expect(html).toContain('--carousel-overlay:0.6');
    expect(html).toContain('rounded-[32px]');
  });

  it('a slide draws its image like the hero, with alt text, and a button when it has a label and a live link', () => {
    const html = renderToStaticMarkup(
      <SlideBlock id="s" heading="Summer Series" subheading="By the river" image={{ fileId: 'f1', alt: 'Crowd' }} buttonLabel="Tickets" link={{ type: 'EVENTS' }} ctx={ctx()} />,
    );
    expect(html).toContain('<h2');
    expect(html).toContain('By the river');
    expect(html).toMatch(/alt="Crowd" loading="lazy" class="[^"]*object-contain/);
    expect(html).toContain('opacity:var(--carousel-overlay, 0.4)');
    expect(html).toContain('href="/organizations/riverside/events"');
    const noLink = renderToStaticMarkup(<SlideBlock id="s" heading="x" buttonLabel="Tickets" link={{ type: 'PAGE', targetId: 'gone' }} ctx={ctx()} />);
    expect(noLink).not.toContain('Tickets</a>');
  });

  it('renders every slide through the Puck slot', () => {
    const data = {
      root: { props: {} },
      content: [{ type: 'HeroCarousel', props: { id: 'C', blocks: [{ type: 'Slide', props: { id: 'S1', heading: 'One' } }, { type: 'Slide', props: { id: 'S2', heading: 'Two' } }] } }],
      zones: {},
    };
    const html = renderToStaticMarkup(<Render config={renderConfig} data={data as any} metadata={{ ctx: carouselCtx() }} />);
    expect(html).toContain('data-section="HeroCarousel"');
    expect(html).toContain('One');
    expect(html).toContain('Two');
    expect(html.match(/data-slide="/g)).toHaveLength(2);
  });
});

describe('FaqSection and FaqItemBlock', () => {
  it('each question is a native disclosure with its sanitised answer', () => {
    const html = renderToStaticMarkup(<FaqItemBlock id="q" question="When do doors open?" answer="<p>At 7</p>" ctx={ctx()} />);
    expect(html).toMatch(/^<details/);
    expect(html).toContain('<summary');
    expect(html).toContain('When do doors open?');
    expect(html).toContain('<p>At 7</p>');
    expect(html).toContain('jump-prose');
  });

  it('labels the section by its heading and renders the questions slot', () => {
    const html = renderToStaticMarkup(<FaqSection id="f" heading="FAQ" intro="Good to know" Items={buttons('<details><summary>Q</summary></details>')} ctx={ctx()} />);
    expect(html).toContain('aria-labelledby="faq-f"');
    expect(html).toContain('Good to know');
    expect(html).toContain('<summary>Q</summary>');
  });

  it('renders every question through the Puck slot', () => {
    const data = {
      root: { props: {} },
      content: [{ type: 'Faq', props: { id: 'F', heading: 'FAQ', blocks: [{ type: 'FaqItem', props: { id: 'Q1', question: 'Parking?' } }, { type: 'FaqItem', props: { id: 'Q2', question: 'Pets?' } }] } }],
      zones: {},
    };
    const html = renderToStaticMarkup(<Render config={renderConfig} data={data as any} metadata={{ ctx: ctx() }} />);
    expect(html).toMatch(/class="faq-list /);
    expect(html.match(/<details/g)).toHaveLength(2);
  });
});

describe('Puck render config', () => {
  it('renders the preset homepage with its buttons through the slot', () => {
    const home = getPreset('eventimus-default').documents.home;
    const html = renderToStaticMarkup(
      <Render config={renderConfig} data={{ ...renderable(home), zones: {} } as any} metadata={{ ctx: ctx() }} />,
    );
    expect(html).toContain('data-section="Hero"');
    expect(html).toContain('See all events');
    expect(html).toContain('href="/organizations/riverside/events"');
    expect(html).toContain('data-section="UpcomingEvents"');
    expect(html).toContain('data-section="CallToAction"');
  });

  it('drops section types it has no component for', () => {
    const doc = { root: { props: {} }, content: [{ type: 'Gallery', props: { id: 'g' } }, { type: 'Hero', props: { id: 'h', heading: 'Hi' } }] };
    expect(renderable(doc).content.map((s) => s.type)).toEqual(['Hero']);
  });
});
