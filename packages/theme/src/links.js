// Theme links (spec 038 §6.1) resolve at read time like menu items (D8):
// the render endpoint returns `resolved.links[linkKey(link)] = href`, and a
// link whose target is gone or hidden is simply absent (the section drops it).

import { LINK_TYPES } from './fields.js';

export function linkKey(link) {
  if (!link || typeof link !== 'object') return null;
  return `${link.type}:${link.targetId ?? link.url ?? ''}`;
}

function isLink(node) {
  return (
    node &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    LINK_TYPES.includes(node.type) &&
    Object.keys(node).every((k) => k === 'type' || k === 'targetId' || k === 'url')
  );
}

/** Every link object inside a theme value, de-duplicated by key. */
export function linksInThemeJson(value) {
  const out = new Map();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (isLink(node)) out.set(linkKey(node), node);
    else Object.values(node).forEach(visit);
  };
  visit(value);
  return [...out.values()];
}
