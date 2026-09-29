// Spec 038 limits. The server enforces every one of them on save and import.

export const THEME_NAME_MAX = 50;
export const THEMES_PER_ORG = 20;
export const REVISIONS_KEPT = 50;
export const DOCUMENT_MAX_BYTES = 256 * 1024;
export const SETTINGS_MAX_BYTES = 64 * 1024;
export const CONTENT_MAX_BYTES = 64 * 1024;
export const SECTIONS_PER_DOCUMENT = 40;
export const COLOR_SCHEMES_MAX = 8;
export const SCHEMA_VERSION = 1;

/** UTF-8 size of a JSON value, as stored. */
export function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
}
