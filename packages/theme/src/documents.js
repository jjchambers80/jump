// Theme documents (spec 038 §5, §6.1): Puck `Data` per document key.
// validateDocument is the server check on every save and import.

import { BLOCKS, COMMON_SECTION_FIELDS, SECTIONS } from './registry.js';
import { checkFields, isPlainObject, text, textarea } from './fields.js';
import { DOCUMENT_MAX_BYTES, SECTIONS_PER_DOCUMENT, jsonBytes } from './limits.js';

const pageRoot = {
  title: text('Title', { max: 70 }),
  seoTitle: text('SEO title', { max: 70 }),
  seoDescription: textarea('SEO description', { max: 320 }),
};

/**
 * Document keys available so far. Cards 038G/H add `page:<id>`, `blog`,
 * `blog_post` and `event`.
 */
export const DOCUMENTS = {
  header: { kind: 'HEADER_GROUP', group: 'header', required: ['Header'], root: {} },
  footer: { kind: 'FOOTER_GROUP', group: 'footer', required: ['Footer'], root: {} },
  home: { kind: 'PAGE', group: 'template', required: [], root: pageRoot },
  events: { kind: 'TEMPLATE', group: 'template', required: ['EventList'], root: pageRoot },
};

/** Template keys a storefront page can render (header/footer frame them). */
export const PAGE_KEYS = ['home', 'events'];

export function documentDef(key) {
  return Object.prototype.hasOwnProperty.call(DOCUMENTS, key) ? DOCUMENTS[key] : null;
}

const ITEM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function checkItem(item, allowed, specsFor, ids, ctx, at, errors) {
  if (!isPlainObject(item) || typeof item.type !== 'string' || !isPlainObject(item.props)) {
    errors[at] = 'must be { type, props }';
    return null;
  }
  const extraKeys = Object.keys(item).filter((k) => k !== 'type' && k !== 'props');
  if (extraKeys.length) errors[at] = `has unknown keys: ${extraKeys.join(', ')}`;
  if (!allowed.includes(item.type)) {
    errors[`${at}.type`] = `${item.type} is not allowed here`;
    return null;
  }
  const { id, hidden, blocks, ...settings } = item.props;
  if (typeof id !== 'string' || !ITEM_ID_RE.test(id)) errors[`${at}.props.id`] = 'must be a short id';
  else if (ids.has(id)) errors[`${at}.props.id`] = `duplicates ${id}`;
  else ids.add(id);
  if (hidden !== undefined && typeof hidden !== 'boolean') errors[`${at}.props.hidden`] = 'must be true or false';

  const specs = specsFor(item.type);
  const checked = checkFields(specs, settings, ctx, `${at}.props`);
  Object.assign(errors, checked.errors);
  const props = { id, ...(hidden !== undefined && { hidden }), ...checked.value };
  return { type: item.type, props, blocks };
}

function checkBlocks(section, def, ids, ctx, at, errors) {
  const { blocks } = section;
  if (!def.blocks) {
    if (blocks !== undefined) errors[`${at}.props.blocks`] = `${section.type} has no blocks`;
    return undefined;
  }
  if (blocks === undefined) return [];
  if (!Array.isArray(blocks)) {
    errors[`${at}.props.blocks`] = 'must be a list';
    return [];
  }
  if (blocks.length > def.blocks.max) errors[`${at}.props.blocks`] = `at most ${def.blocks.max} blocks`;
  const counts = {};
  const out = [];
  blocks.forEach((block, i) => {
    const bAt = `${at}.props.blocks[${i}]`;
    const checked = checkItem(block, def.blocks.types, (type) => BLOCKS[type].settings, ids, ctx, bAt, errors);
    if (!checked) return;
    // Depth ≤ 2: blocks never carry slots of their own.
    if (checked.blocks !== undefined) errors[`${bAt}.props.blocks`] = 'blocks cannot contain blocks';
    counts[checked.type] = (counts[checked.type] || 0) + 1;
    const limit = def.blocks.limits?.[checked.type];
    if (limit && counts[checked.type] > limit) errors[bAt] = `at most ${limit} ${BLOCKS[checked.type].label} block`;
    out.push({ type: checked.type, props: checked.props });
  });
  return out;
}

/**
 * Validate (and normalise) one document. Returns `{ value, errors }`;
 * `errors` maps a path to a message and is empty when the document is valid.
 *
 * ctx: { sanitizeHtml?(html), schemeIds?: Set<string> }
 */
export function validateDocument(key, data, ctx = {}) {
  const errors = {};
  const def = documentDef(key);
  if (!def) return { value: null, errors: { key: `${key} is not a theme document` } };
  if (!isPlainObject(data)) return { value: null, errors: { '.': 'must be an object' } };
  if (jsonBytes(data) > DOCUMENT_MAX_BYTES) return { value: null, errors: { '.': 'is larger than 256 KB' } };

  const extra = Object.keys(data).filter((k) => !['root', 'content', 'zones'].includes(k));
  if (extra.length) errors['.'] = `has unknown keys: ${extra.join(', ')}`;
  if (data.zones !== undefined && !(isPlainObject(data.zones) && Object.keys(data.zones).length === 0))
    errors.zones = 'drop zones are not supported';

  const root = data.root === undefined ? {} : data.root;
  let rootProps = {};
  if (!isPlainObject(root) || (root.props !== undefined && !isPlainObject(root.props))) {
    errors.root = 'must be { props }';
  } else {
    const checked = checkFields(def.root, root.props ?? {}, ctx, 'root.props');
    Object.assign(errors, checked.errors);
    rootProps = checked.value;
  }

  const content = Array.isArray(data.content) ? data.content : null;
  if (!content) {
    errors.content = 'must be a list';
    return { value: null, errors };
  }
  if (content.length > SECTIONS_PER_DOCUMENT) errors.content = `at most ${SECTIONS_PER_DOCUMENT} sections`;

  const allowed = Object.keys(SECTIONS).filter((type) => SECTIONS[type].groups.includes(def.group));
  const ids = new Set();
  const counts = {};
  const out = [];
  content.forEach((section, i) => {
    const at = `content[${i}]`;
    const checked = checkItem(
      section,
      allowed,
      (type) => ({ ...COMMON_SECTION_FIELDS, ...SECTIONS[type].settings }),
      ids,
      ctx,
      at,
      errors,
    );
    if (!checked) return;
    const sectionDef = SECTIONS[checked.type];
    counts[checked.type] = (counts[checked.type] || 0) + 1;
    if (sectionDef.limit && counts[checked.type] > sectionDef.limit)
      errors[at] = `at most ${sectionDef.limit} ${sectionDef.label} section`;
    const blocks = checkBlocks(checked, sectionDef, ids, ctx, at, errors);
    out.push({ type: checked.type, props: { ...checked.props, ...(blocks !== undefined && { blocks }) } });
  });
  for (const type of def.required) {
    if (!counts[type]) errors.content = `must contain the ${SECTIONS[type].label} section`;
  }

  return { value: { root: { props: rootProps }, content: out }, errors };
}

/** Color schemes a document uses, for "delete only when unused". */
export function schemesUsed(data) {
  const used = new Set();
  const visit = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      const scheme = item?.props?.colorScheme;
      if (typeof scheme === 'string') used.add(scheme);
      visit(item?.props?.blocks);
    }
  };
  visit(data?.content);
  return used;
}

