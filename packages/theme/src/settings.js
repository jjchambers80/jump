// Theme settings (spec 038 §6.3): the editor's gear panel. Grouped like
// Shopify's settings_schema; every value is an enum, a range, bounded text
// or a reference. Stored settings may omit any group or key: defaults apply.

import { colorScheme, checkFields, httpsUrl, image, isPlainObject, range, select, text, textarea, toggle } from './fields.js';
import { COLOR_SCHEMES_MAX, SETTINGS_MAX_BYTES, jsonBytes } from './limits.js';

export const FONTS = [
  'system',
  'inter',
  'poppins',
  'montserrat',
  'playfair-display',
  'dm-serif-display',
  'lora',
  'work-sans',
  'space-grotesk',
  'oswald',
  'archivo',
  'libre-baskerville',
];

const shadow = (label = 'Shadow') => select(label, ['none', 'subtle', 'strong']);
const radius = (def = 8) => range('Corner radius', 0, 40, { unit: 'px', default: def });
const border = (def = 0) => range('Border thickness', 0, 4, { unit: 'px', default: def });
const box = (r = 8, b = 0) => ({ radius: radius(r), borderThickness: border(b), shadow: shadow() });
const cards = {
  style: select('Style', ['standard', 'card']),
  imageRatio: select('Image ratio', ['16:9', 'none', '4:3', '1:1']),
  ...box(12, 0),
  textAlignment: select('Text alignment', ['left', 'center']),
};

export const SETTINGS_GROUPS = {
  logo: {
    label: 'Logo',
    fields: {
      // One size; phones get three quarters of it (mobileLogoWidth). The
      // favicon is always the square logo from Settings › Brand.
      image: image('Logo (defaults to the organization logo)'),
      width: range('Logo size', 50, 300, { unit: 'px', default: 120 }),
    },
  },
  colors: { label: 'Colors', fields: {} }, // schemes: validated by checkSchemes
  // Two fonts, each for the whole theme: headings (h1–h6) and everything
  // else. No sizes, case or spacing (owner rule: theme settings stay simple).
  typography: {
    label: 'Typography',
    fields: {
      headingFont: select('Heading font', FONTS, 'inter'),
      bodyFont: select('Body font', FONTS, 'inter'),
    },
  },
  layout: {
    label: 'Layout',
    fields: {
      pageWidth: range('Page width', 1000, 1600, { step: 10, unit: 'px', default: 1280 }),
      sectionSpacing: range('Space between template sections', 0, 100, { step: 4, unit: 'px', default: 0 }),
      gridHorizontal: range('Grid horizontal space', 4, 40, { step: 4, unit: 'px', default: 16 }),
      gridVertical: range('Grid vertical space', 4, 40, { step: 4, unit: 'px', default: 16 }),
    },
  },
  background: {
    label: 'Background',
    fields: {
      style: select('Page background', ['none', 'retro-grid']),
    },
  },
  animations: {
    label: 'Animations',
    fields: {
      reveal: select('Reveal sections on scroll', ['off', 'fade', 'slide-up']),
      hover: select('Hover effect', ['none', 'lift', 'zoom']),
    },
  },
  buttons: {
    label: 'Buttons',
    fields: {
      shape: select('Shape', ['rounded', 'square', 'pill']),
      ...box(8, 0),
      labelCase: select('Label case', ['as-typed', 'uppercase']),
    },
  },
  inputs: { label: 'Inputs', fields: box(8, 1) },
  eventCards: {
    label: 'Event cards',
    fields: { ...cards, dateBadge: select('Date badge', ['tile', 'text']) },
  },
  blogCards: { label: 'Blog cards', fields: { ...cards, showExcerpt: toggle('Show excerpt', true) } },
  contentContainers: { label: 'Content containers', fields: box(12, 0) },
  media: { label: 'Media', fields: box(12, 0) },
  popups: { label: 'Dropdowns and pop-ups', fields: box(8, 1) },
  drawers: { label: 'Drawers', fields: { borderThickness: border(0), shadow: shadow() } },
  badges: {
    label: 'Badges',
    fields: {
      position: select('Position on event cards', ['top-left', 'top-right', 'bottom-left']),
      shape: select('Shape', ['rounded', 'pill']),
      soldOutScheme: colorScheme('Sold out color scheme', 'scheme-2'),
      fewLeftScheme: colorScheme('Few left color scheme', 'scheme-1'),
    },
  },
  brand: {
    label: 'Brand information',
    fields: {
      headline: text('Headline', { max: 120, default: '' }),
      description: textarea('Short description', { max: 300, default: '' }),
      showLogoInFooter: toggle('Show logo in the footer', false),
    },
  },
  social: {
    label: 'Social media',
    fields: {
      instagram: httpsUrl('Instagram', ['instagram.com']),
      tiktok: httpsUrl('TikTok', ['tiktok.com']),
      facebook: httpsUrl('Facebook', ['facebook.com', 'fb.com']),
      x: httpsUrl('X', ['x.com', 'twitter.com']),
      youtube: httpsUrl('YouTube', ['youtube.com', 'youtu.be']),
      linkedin: httpsUrl('LinkedIn', ['linkedin.com']),
      threads: httpsUrl('Threads', ['threads.net', 'threads.com']),
      reddit: httpsUrl('Reddit', ['reddit.com']),
      twitch: httpsUrl('Twitch', ['twitch.tv']),
      website: httpsUrl('Website'),
    },
  },
};

const LEGACY_TYPOGRAPHY = ['font', 'headingScale', 'bodyScale', 'headingCase', 'letterSpacing'];

/**
 * Typography stored under older rules: the one-font `font` fills whichever
 * of heading/body font is missing; sizes, case and spacing are dropped.
 * Keeps old revisions, settings.json uploads and CLI pushes valid.
 */
export function normalizeTypography(values) {
  if (!isPlainObject(values) || !LEGACY_TYPOGRAPHY.some((k) => k in values)) return values;
  const out = Object.fromEntries(Object.entries(values).filter(([k]) => !LEGACY_TYPOGRAPHY.includes(k)));
  if (values.font !== undefined) {
    out.headingFont ??= values.font;
    out.bodyFont ??= values.font;
  }
  return out;
}

/** Logo stored before the one-size rule: `width` ← desktop width; mobile width and favicon dropped. */
export function normalizeLogo(values) {
  if (!isPlainObject(values) || !['desktopWidth', 'mobileWidth', 'favicon'].some((k) => k in values)) return values;
  const { desktopWidth, mobileWidth: _m, favicon: _f, ...out } = values;
  if (out.width === undefined && desktopWidth !== undefined) out.width = desktopWidth;
  return out;
}

/** Phone logo width from the one logo size (120 → 90, the old defaults), within 30–150px. */
export function mobileLogoWidth(width) {
  const w = typeof width === 'number' && Number.isFinite(width) ? width : 120;
  return Math.min(150, Math.max(30, Math.round(w * 0.75)));
}

const NORMALIZERS = { typography: normalizeTypography, logo: normalizeLogo };
const normalizeGroup = (group, values) => (NORMALIZERS[group] ? NORMALIZERS[group](values) : values);

/**
 * Scheme color slots: `auto` follows the page's light/dark tokens, `brand` /
 * `brand-secondary` (accent only) the org brand colors. Three on purpose
 * (owner rule: theme settings stay simple); text on the accent is derived.
 * Slots stored before that rule are dropped.
 */
export const SCHEME_COLORS = ['background', 'foreground', 'accent'];
const LEGACY_SCHEME_COLORS = ['accentForeground', 'secondaryButtonLabel', 'border', 'muted', 'shadow'];
const HEX_RE = /^#[0-9a-f]{6}$/i;

function checkSchemes(schemes, errors) {
  if (!Array.isArray(schemes) || schemes.length < 1 || schemes.length > COLOR_SCHEMES_MAX) {
    errors['colors.schemes'] = `must have 1 to ${COLOR_SCHEMES_MAX} color schemes`;
    return schemes;
  }
  const ids = new Set();
  return schemes.map((scheme, i) => {
    const at = `colors.schemes[${i}]`;
    if (!isPlainObject(scheme)) {
      errors[at] = 'must be a color scheme';
      return scheme;
    }
    const extra = Object.keys(scheme).filter((k) => !['id', 'name', ...SCHEME_COLORS, ...LEGACY_SCHEME_COLORS].includes(k));
    if (extra.length) errors[at] = `has unknown keys: ${extra.join(', ')}`;
    if (typeof scheme.id !== 'string' || !/^scheme-[1-8]$/.test(scheme.id)) errors[`${at}.id`] = 'must be scheme-1 … scheme-8';
    else if (ids.has(scheme.id)) errors[`${at}.id`] = `duplicates ${scheme.id}`;
    else ids.add(scheme.id);
    if (typeof scheme.name !== 'string' || !scheme.name.trim() || scheme.name.length > 30)
      errors[`${at}.name`] = 'must be 1 to 30 characters';
    const out = { id: scheme.id, name: scheme.name };
    for (const slot of SCHEME_COLORS) {
      const value = scheme[slot];
      const special = slot === 'accent' ? ['brand', 'brand-secondary'] : ['auto'];
      if (special.includes(value)) out[slot] = value;
      else if (typeof value === 'string' && HEX_RE.test(value)) out[slot] = value.toLowerCase();
      else errors[`${at}.${slot}`] = `must be a #rrggbb color or ${special.map((v) => `"${v}"`).join(' or ')}`;
    }
    return out;
  });
}

/** Scheme ids defined by (possibly partial) settings. */
export function schemeIdsOf(settings) {
  const schemes = settings?.colors?.schemes;
  return new Set(Array.isArray(schemes) ? schemes.map((s) => s?.id).filter(Boolean) : ['scheme-1']);
}

/**
 * Validate settings. Returns `{ value, errors }`. ctx.schemeIds is derived
 * from these settings so badge schemes must exist.
 */
export function validateSettings(settings) {
  const errors = {};
  if (!isPlainObject(settings)) return { value: null, errors: { settings: 'must be an object' } };
  if (jsonBytes(settings) > SETTINGS_MAX_BYTES) return { value: null, errors: { settings: 'is larger than 64 KB' } };
  const out = {};
  const schemeIds = schemeIdsOf(settings);
  for (const [group, values] of Object.entries(settings)) {
    const def = SETTINGS_GROUPS[group];
    if (!def) {
      errors[group] = 'is not a settings group';
      continue;
    }
    if (group === 'colors') {
      if (!isPlainObject(values)) {
        errors.colors = 'must be an object';
        continue;
      }
      const extra = Object.keys(values).filter((k) => k !== 'schemes');
      if (extra.length) errors.colors = `has unknown keys: ${extra.join(', ')}`;
      out.colors = { schemes: checkSchemes(values.schemes, errors) };
      continue;
    }
    const checked = checkFields(def.fields, normalizeGroup(group, values), { schemeIds }, group);
    Object.assign(errors, checked.errors);
    out[group] = checked.value;
  }
  return { value: out, errors };
}

/** Full default settings (every group, every key). */
export function settingsDefaults() {
  const out = {};
  for (const [group, def] of Object.entries(SETTINGS_GROUPS)) {
    if (group === 'colors') continue;
    out[group] = Object.fromEntries(Object.entries(def.fields).map(([k, spec]) => [k, spec.default]));
  }
  return out;
}

/** Stored (partial) settings merged over the defaults, group by group. */
export function resolveSettings(stored, presetSettings) {
  const base = { ...settingsDefaults(), ...(presetSettings ?? {}) };
  const out = {};
  for (const group of new Set([...Object.keys(base), ...Object.keys(stored ?? {})])) {
    const own = normalizeGroup(group, stored?.[group]);
    out[group] = { ...(base[group] ?? {}), ...(own ?? {}) };
  }
  return out;
}

const inherit = (theme, org) => ((theme == null || theme === '') && typeof org === 'string' && org ? org : theme);

/**
 * Spec 049: resolved settings where an empty theme value inherits the
 * organization's brand identity (headline ← slogan, description ←
 * shortDescription, social.* ← socialLinks.*). A non-empty theme value wins.
 * For rendering only: stored settings stay partial overrides.
 */
export function withBrand(resolved, org) {
  if (!resolved || !org) return resolved;
  const links = isPlainObject(org.socialLinks) ? org.socialLinks : {};
  const social = { ...(resolved.social ?? {}) };
  for (const key of Object.keys(SETTINGS_GROUPS.social.fields)) {
    const value = inherit(social[key], links[key]);
    if (value !== undefined) social[key] = value;
  }
  const brand = resolved.brand ?? {};
  return {
    ...resolved,
    brand: { ...brand, headline: inherit(brand.headline, org.slogan), description: inherit(brand.description, org.shortDescription) },
    social,
  };
}
