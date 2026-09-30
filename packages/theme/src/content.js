// Default theme content (spec 038 D15, §6.5): storefront wording an
// organizer can override per theme. Legal, consent, refund, fee, tax and
// checkout wording is deliberately NOT here and can never be overridden.

import { CONTENT_MAX_BYTES, jsonBytes } from './limits.js';
import { isPlainObject } from './fields.js';

const entry = (group, value, maxLength = 60, description = '') => ({ group, default: value, maxLength, description });

export const CONTENT_GROUPS = [
  'Header & navigation',
  'Events list',
  'Event page',
  'Announcement bar',
  'Hero carousel',
  'Blog',
  'Store password page',
  'General',
];

export const CATALOG = {
  'nav.menu': entry('Header & navigation', 'Menu'),
  'nav.account': entry('Header & navigation', 'Account'),
  'nav.signIn': entry('Header & navigation', 'Sign in'),
  'events.upcoming': entry('Events list', 'Upcoming events'),
  'events.empty': entry('Events list', 'No upcoming events', 140),
  'events.dateTba': entry('Events list', 'Date TBA'),
  'events.viewAll': entry('Events list', 'View all events'),
  'event.getTickets': entry('Event page', 'Get tickets', 40),
  'event.rsvp': entry('Event page', 'RSVP', 40),
  'event.soldOut': entry('Event page', 'Sold out', 40),
  'event.salesEnded': entry('Event page', 'Sales ended', 40),
  'event.onSaleAt': entry('Event page', 'Tickets on sale {date}', 80, 'Shown before sales open'),
  'event.doorsOpen': entry('Event page', 'Doors open', 40),
  'announcement.pause': entry('Announcement bar', 'Pause announcements', 40),
  'announcement.close': entry('Announcement bar', 'Close', 40),
  'carousel.previous': entry('Hero carousel', 'Previous slide', 40),
  'carousel.next': entry('Hero carousel', 'Next slide', 40),
  'carousel.pause': entry('Hero carousel', 'Pause slides', 40),
  'carousel.slide': entry('Hero carousel', 'Slide {n} of {total}', 40),
  'carousel.label': entry('Hero carousel', 'Featured', 40, 'Name of the carousel for screen readers'),
  'blog.readMore': entry('Blog', 'Read more', 40),
  'blog.postedOn': entry('Blog', 'Posted {date}', 60),
  'password.title': entry('Store password page', 'This store is private', 80),
  'password.enter': entry('Store password page', 'Enter password', 40),
  'general.back': entry('General', 'Back', 30),
  'general.search': entry('General', 'Search', 30),
  'general.share': entry('General', 'Share', 30),
};

const VAR_RE = /\{([a-z][a-zA-Z0-9]*)\}/g;

/** Variables a catalog string needs, e.g. ["date"]. */
export function contentVariables(key) {
  const def = CATALOG[key];
  return def ? [...def.default.matchAll(VAR_RE)].map((m) => m[1]) : [];
}

/** Validate overrides. Returns `{ value, errors }`. */
export function validateContent(content) {
  if (!isPlainObject(content)) return { value: null, errors: { content: 'must be an object' } };
  if (jsonBytes(content) > CONTENT_MAX_BYTES) return { value: null, errors: { content: 'is larger than 64 KB' } };
  const errors = {};
  const out = {};
  for (const [key, value] of Object.entries(content)) {
    const def = CATALOG[key];
    if (!def) {
      errors[`content.${key}`] = 'is not a theme content key';
      continue;
    }
    if (typeof value !== 'string' || !value.trim()) {
      errors[`content.${key}`] = 'must be text';
      continue;
    }
    if (value.length > def.maxLength) {
      errors[`content.${key}`] = `must be at most ${def.maxLength} characters`;
      continue;
    }
    const missing = contentVariables(key).filter((v) => !value.includes(`{${v}}`));
    if (missing.length) {
      errors[`content.${key}`] = `must keep ${missing.map((v) => `{${v}}`).join(', ')}`;
      continue;
    }
    const unknown = [...value.matchAll(VAR_RE)].map((m) => m[1]).filter((v) => !contentVariables(key).includes(v));
    if (unknown.length) {
      errors[`content.${key}`] = `has unknown ${unknown.map((v) => `{${v}}`).join(', ')}`;
      continue;
    }
    if (value !== def.default) out[key] = value;
  }
  return { value: out, errors };
}

/** Catalog defaults merged with a theme's overrides. */
export function resolveContent(overrides) {
  const out = {};
  for (const [key, def] of Object.entries(CATALOG)) {
    out[key] = typeof overrides?.[key] === 'string' ? overrides[key] : def.default;
  }
  return out;
}

/** `t('event.onSaleAt', { date })` against resolved content. */
export function translate(content, key, vars = {}) {
  const template = content?.[key] ?? CATALOG[key]?.default ?? key;
  return template.replace(VAR_RE, (whole, name) => (vars[name] !== undefined ? String(vars[name]) : whole));
}
