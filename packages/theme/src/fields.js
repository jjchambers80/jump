// Declarative setting fields (spec 038 §6.2). One spec drives both the
// server validator here and the editor's Puck field config (frontend), so
// the two can never disagree. Every value is an enum, a range, bounded
// text, sanitised rich text or a reference: nothing free-form reaches CSS.

/** Link targets: the menu-item union (spec 027). */
export const LINK_TYPES = ['HOME', 'EVENTS', 'EVENT', 'VENUE', 'PAGE', 'BLOG', 'BLOG_POST', 'ACCOUNT', 'EXTERNAL'];
const TARGETED_LINKS = new Set(['EVENT', 'VENUE', 'PAGE', 'BLOG', 'BLOG_POST']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const URL_MAX = 2048;
const ALT_MAX = 200;

export const text = (label, { max = 200, default: def = '' } = {}) => ({ kind: 'text', label, max, default: def });
export const textarea = (label, { max = 1000, default: def = '' } = {}) => ({ kind: 'textarea', label, max, default: def });
export const richtext = (label, { max = 20000, default: def = '' } = {}) => ({ kind: 'richtext', label, max, default: def });
export const select = (label, options, def = options[0]) => ({ kind: 'select', label, options, default: def });
export const radio = (label, options, def = options[0]) => ({ kind: 'radio', label, options, default: def });
export const range = (label, min, max, { step = 1, unit = '', default: def = min } = {}) => ({
  kind: 'range',
  label,
  min,
  max,
  step,
  unit,
  default: def,
});
export const toggle = (label, def = false) => ({ kind: 'toggle', label, default: def });
export const colorScheme = (label = 'Color scheme', def = 'scheme-1') => ({ kind: 'colorScheme', label, default: def });
export const image = (label) => ({ kind: 'image', label, default: null });
/** An MP4 or WebM from Content › Files: `{ fileId }`. Always decorative (muted, no captions needed). */
export const video = (label) => ({ kind: 'video', label, default: null });
export const link = (label, def = null) => ({ kind: 'link', label, default: def });
export const reference = (label, target) => ({ kind: 'reference', label, target, default: null });
export const datetime = (label) => ({ kind: 'datetime', label, default: null });
export const hex = (label, def) => ({ kind: 'hex', label, default: def });
export const httpsUrl = (label, hosts = null) => ({ kind: 'httpsUrl', label, hosts, default: '' });

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkHttps(value, hosts) {
  if (typeof value !== 'string' || value.length > URL_MAX) return 'must be a URL of at most 2048 characters';
  let url;
  try {
    url = new URL(value);
  } catch {
    return 'must be a valid URL';
  }
  if (url.protocol !== 'https:') return 'must start with https://';
  if (url.username || url.password) return 'must not contain credentials';
  if (hosts) {
    const host = url.hostname.toLowerCase();
    if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) return `must be a link on ${hosts[0]}`;
  }
  return null;
}

/**
 * Validate one field value. Returns `{ value }` (possibly normalised, e.g.
 * sanitised rich text) or `{ error }`. `undefined` is always accepted: the
 * default applies at render time.
 *
 * ctx: { sanitizeHtml?(html) → html, schemeIds?: Set<string> }
 */
export function checkField(spec, value, ctx = {}) {
  if (value === undefined) return { value };
  switch (spec.kind) {
    case 'text':
    case 'textarea':
      if (typeof value !== 'string') return { error: 'must be text' };
      if (value.length > spec.max) return { error: `must be at most ${spec.max} characters` };
      return { value };
    case 'richtext': {
      if (typeof value !== 'string') return { error: 'must be text' };
      if (value.length > spec.max) return { error: `must be at most ${spec.max} characters` };
      return { value: ctx.sanitizeHtml ? ctx.sanitizeHtml(value) : value };
    }
    case 'select':
    case 'radio':
      return spec.options.includes(value) ? { value } : { error: `must be one of ${spec.options.join(', ')}` };
    case 'range':
      if (typeof value !== 'number' || !Number.isFinite(value)) return { error: 'must be a number' };
      if (value < spec.min || value > spec.max) return { error: `must be between ${spec.min} and ${spec.max}` };
      if (Math.abs((value - spec.min) / spec.step - Math.round((value - spec.min) / spec.step)) > 1e-9)
        return { error: `must be a multiple of ${spec.step}` };
      return { value };
    case 'toggle':
      return typeof value === 'boolean' ? { value } : { error: 'must be true or false' };
    case 'colorScheme':
      if (typeof value !== 'string' || !/^scheme-[1-8]$/.test(value)) return { error: 'must be a color scheme' };
      if (ctx.schemeIds && !ctx.schemeIds.has(value)) return { error: `uses ${value}, which does not exist` };
      return { value };
    case 'image': {
      if (value === null) return { value };
      if (!isPlainObject(value)) return { error: 'must be an image' };
      const extra = Object.keys(value).filter((k) => !['fileId', 'alt', 'decorative'].includes(k));
      if (extra.length) return { error: `has unknown keys: ${extra.join(', ')}` };
      if (typeof value.fileId !== 'string' || !ID_RE.test(value.fileId)) return { error: 'must reference a file' };
      if (value.decorative !== undefined && typeof value.decorative !== 'boolean') return { error: 'decorative must be true or false' };
      if (value.alt !== undefined && (typeof value.alt !== 'string' || value.alt.length > ALT_MAX))
        return { error: `alt text must be at most ${ALT_MAX} characters` };
      if (!value.decorative && !String(value.alt ?? '').trim()) return { error: 'needs alt text, or mark it decorative' };
      return { value };
    }
    case 'video': {
      if (value === null) return { value };
      if (!isPlainObject(value)) return { error: 'must be a video' };
      const extra = Object.keys(value).filter((k) => k !== 'fileId');
      if (extra.length) return { error: `has unknown keys: ${extra.join(', ')}` };
      if (typeof value.fileId !== 'string' || !ID_RE.test(value.fileId)) return { error: 'must reference a file' };
      return { value };
    }
    case 'link': {
      if (value === null) return { value };
      if (!isPlainObject(value)) return { error: 'must be a link' };
      const extra = Object.keys(value).filter((k) => !['type', 'targetId', 'url'].includes(k));
      if (extra.length) return { error: `has unknown keys: ${extra.join(', ')}` };
      if (!LINK_TYPES.includes(value.type)) return { error: 'has an unknown link type' };
      if (TARGETED_LINKS.has(value.type)) {
        if (typeof value.targetId !== 'string' || !ID_RE.test(value.targetId)) return { error: 'needs a target' };
      } else if (value.targetId !== undefined) return { error: 'must not have a target' };
      if (value.type === 'EXTERNAL') {
        const error = checkHttps(value.url, null);
        if (error) return { error: `url ${error}` };
      } else if (value.url !== undefined) return { error: 'must not have a url' };
      return { value };
    }
    case 'reference':
      if (value === null) return { value };
      return typeof value === 'string' && ID_RE.test(value) ? { value } : { error: `must reference a ${spec.target}` };
    case 'datetime':
      if (value === null) return { value };
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value)
        ? { value }
        : { error: 'must be an ISO date and time' };
    case 'hex':
      return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? { value: value.toLowerCase() } : { error: 'must be a #rrggbb color' };
    case 'httpsUrl': {
      if (value === '') return { value };
      const error = checkHttps(value, spec.hosts);
      return error ? { error } : { value };
    }
    default:
      return { error: 'has an unknown field type' };
  }
}

/**
 * Validate an object of values against `{ key: spec }`. Unknown keys are
 * errors (they would never render and would bloat stored JSON).
 * Returns `{ value, errors }` where errors is `{ path: message }`.
 */
export function checkFields(specs, values, ctx = {}, path = '') {
  const errors = {};
  const out = {};
  if (!isPlainObject(values)) {
    errors[path || '.'] = 'must be an object';
    return { value: values, errors };
  }
  for (const [key, value] of Object.entries(values)) {
    const at = path ? `${path}.${key}` : key;
    const spec = specs[key];
    if (!spec) {
      errors[at] = 'is not a known setting';
      continue;
    }
    const result = checkField(spec, value, ctx);
    if (result.error) errors[at] = result.error;
    else if (result.value !== undefined) out[key] = result.value;
  }
  return { value: out, errors };
}

/** Defaults of a field map, for presets and rendering. */
export function fieldDefaults(specs) {
  return Object.fromEntries(Object.entries(specs).map(([key, spec]) => [key, spec.default]));
}

export { isPlainObject };
