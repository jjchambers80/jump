import * as eventimusDefault from './eventimus-default.js';
import { pageIdOfKey } from '../documents.js';

export const DEFAULT_PRESET_KEY = 'eventimus-default';

const PRESETS = { [DEFAULT_PRESET_KEY]: eventimusDefault };

/** A preset by key, or null. Presets are code: never stored, always current. */
export function getPreset(key) {
  return Object.prototype.hasOwnProperty.call(PRESETS, key) ? PRESETS[key] : null;
}

// A full-width page starts as its own content, so choosing the template
// changes nothing until the organizer adds sections around it.
const PAGE_STARTER = { root: { props: {} }, content: [{ type: 'PageContent', props: { id: 'PageContent-1' } }] };

/** Deep copy of a preset's default document, or null when it has none. */
export function presetDocument(key, documentKey) {
  const doc = getPreset(key)?.documents?.[documentKey] ?? (pageIdOfKey(documentKey) ? PAGE_STARTER : null);
  return doc ? structuredClone(doc) : null;
}

export function listPresets() {
  return Object.values(PRESETS).map((p) => p.preset);
}
