import * as eventimusDefault from './eventimus-default.js';

export const DEFAULT_PRESET_KEY = 'eventimus-default';

const PRESETS = { [DEFAULT_PRESET_KEY]: eventimusDefault };

/** A preset by key, or null. Presets are code: never stored, always current. */
export function getPreset(key) {
  return Object.prototype.hasOwnProperty.call(PRESETS, key) ? PRESETS[key] : null;
}

/** Deep copy of a preset's default document, or null when it has none. */
export function presetDocument(key, documentKey) {
  const doc = getPreset(key)?.documents?.[documentKey];
  return doc ? structuredClone(doc) : null;
}

export function listPresets() {
  return Object.values(PRESETS).map((p) => p.preset);
}
