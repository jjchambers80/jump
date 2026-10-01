// Spec 042: page template manifests. A developer uploads one JSON file per
// template; it is declarative only — an ordered list of whitelisted sections
// with typed settings. Nothing in it runs as code, and the only HTML it can
// carry (rich_text) is sanitized like every other organizer HTML (gotcha 20).

import { sanitizeContentHtml } from './sanitizeHtml.js';

export const MANIFEST_SCHEMA_VERSION = 1;
export const MANIFEST_MAX_BYTES = 64 * 1024;
export const MAX_SECTIONS = 20;
export const TEMPLATE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RICH_TEXT_MAX = 20 * 1024;

export const CONTACT_FORM_DEFAULTS = Object.freeze({
  heading: 'Get in touch',
  intro: '',
  submitLabel: 'Send message',
  successMessage: "Thanks for your message. We'll get back to you soon.",
  showPhone: false,
  showSubject: true,
});

/** Settings each section type accepts: string fields carry a max length. */
const SECTION_TYPES = {
  page_content: { settings: {} },
  rich_text: { settings: { html: { type: 'html', max: RICH_TEXT_MAX } } },
  contact_form: {
    settings: {
      heading: { type: 'string', max: 100 },
      intro: { type: 'string', max: 500 },
      submitLabel: { type: 'string', max: 40, required: true },
      successMessage: { type: 'string', max: 300, required: true },
      showPhone: { type: 'boolean' },
      showSubject: { type: 'boolean' },
    },
    defaults: CONTACT_FORM_DEFAULTS,
  },
};

export const SECTION_TYPE_NAMES = Object.keys(SECTION_TYPES);

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function unknownKeys(object, allowed, path, errors) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) errors.push({ field: `${path}${key}`, message: `unknown key "${key}"` });
  }
}

function text(value, { field, max, required }, errors) {
  if (value === undefined || value === null) {
    if (required) errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push({ field, message: `${field} must be a string` });
    return undefined;
  }
  const trimmed = value.trim();
  if (required && !trimmed) errors.push({ field, message: `${field} is required` });
  if (trimmed.length > max) errors.push({ field, message: `${field} must be ${max} characters or less` });
  return trimmed;
}

function normalizeSection(section, index, errors) {
  const path = `sections[${index}]`;
  if (!isPlainObject(section)) {
    errors.push({ field: path, message: `${path} must be an object` });
    return null;
  }
  unknownKeys(section, ['type', 'settings'], `${path}.`, errors);
  const spec = SECTION_TYPES[section.type];
  if (!spec) {
    errors.push({
      field: `${path}.type`,
      message: `${path}.type must be one of ${SECTION_TYPE_NAMES.join(', ')}`,
    });
    return null;
  }
  const raw = section.settings ?? {};
  if (!isPlainObject(raw)) {
    errors.push({ field: `${path}.settings`, message: `${path}.settings must be an object` });
    return null;
  }
  unknownKeys(raw, Object.keys(spec.settings), `${path}.settings.`, errors);

  const settings = { ...(spec.defaults || {}) };
  for (const [key, rule] of Object.entries(spec.settings)) {
    const field = `${path}.settings.${key}`;
    const value = raw[key];
    if (rule.type === 'boolean') {
      if (value === undefined) continue;
      if (typeof value !== 'boolean') errors.push({ field, message: `${field} must be a boolean` });
      else settings[key] = value;
    } else if (rule.type === 'html') {
      if (typeof value !== 'string') {
        errors.push({ field, message: `${field} must be an HTML string` });
        continue;
      }
      if (value.length > rule.max) {
        errors.push({ field, message: `${field} must be ${rule.max} characters or less` });
        continue;
      }
      settings[key] = sanitizeContentHtml(value);
    } else {
      const fallback = spec.defaults?.[key];
      const normalized = text(value, { field, max: rule.max, required: rule.required && fallback === undefined }, errors);
      if (normalized !== undefined && (normalized || !rule.required)) settings[key] = normalized;
    }
  }
  return Object.keys(spec.settings).length ? { type: section.type, settings } : { type: section.type };
}

/**
 * Validate and normalize an uploaded manifest.
 * @returns {{ manifest: object|null, errors: {field: string, message: string}[] }}
 */
export function parsePageTemplateManifest(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { manifest: null, errors: [{ field: 'manifest', message: 'The template must be a JSON object' }] };
  }
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MANIFEST_MAX_BYTES) {
    return {
      manifest: null,
      errors: [{ field: 'manifest', message: `The template must be ${MANIFEST_MAX_BYTES / 1024} KB or less` }],
    };
  }
  unknownKeys(input, ['schemaVersion', 'name', 'label', 'description', 'sections'], '', errors);

  if (input.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    errors.push({ field: 'schemaVersion', message: `schemaVersion must be ${MANIFEST_SCHEMA_VERSION}` });
  }
  if (typeof input.name !== 'string' || !TEMPLATE_NAME_RE.test(input.name)) {
    errors.push({
      field: 'name',
      message: 'name must be 1-40 lowercase letters, digits or hyphens, starting with a letter or digit',
    });
  }
  const label = text(input.label, { field: 'label', max: 60, required: true }, errors);
  const description = text(input.description, { field: 'description', max: 200 }, errors);

  const sections = [];
  if (!Array.isArray(input.sections) || input.sections.length === 0) {
    errors.push({ field: 'sections', message: 'sections must be a non-empty array' });
  } else if (input.sections.length > MAX_SECTIONS) {
    errors.push({ field: 'sections', message: `sections can hold at most ${MAX_SECTIONS} entries` });
  } else {
    input.sections.forEach((section, index) => {
      const normalized = normalizeSection(section, index, errors);
      if (normalized) sections.push(normalized);
    });
    const count = (type) => sections.filter((s) => s.type === type).length;
    // The page's own content must render exactly once, so picking a template
    // never hides what the organizer wrote.
    if (count('page_content') !== 1) {
      errors.push({ field: 'sections', message: 'sections must include exactly one page_content section' });
    }
    if (count('contact_form') > 1) {
      errors.push({ field: 'sections', message: 'sections can include at most one contact_form section' });
    }
  }

  if (errors.length) return { manifest: null, errors };
  return {
    manifest: {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      name: input.name,
      label,
      ...(description ? { description } : {}),
      sections,
    },
    errors: [],
  };
}

/** The contact_form section of a stored definition, or null. */
export function contactFormSection(definition) {
  const sections = Array.isArray(definition?.sections) ? definition.sections : [];
  return sections.find((section) => section?.type === 'contact_form') || null;
}
