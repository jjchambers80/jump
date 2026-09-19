// Content › Files (spec 025) limits. Mirrored in frontend/src/lib/content.ts.

export const MAX_FILE_MB = 20;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 10;
export const FILE_NAME_MAX = 200;
export const FILE_ALT_MAX = 500;

// Sniffed MIME type → stored extension. Images go through ImageService
// (variants + focal point); documents are stored as-is.
export const IMAGE_MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const DOCUMENT_MIME_TO_EXT = {
  'application/pdf': 'pdf',
};

export const ALLOWED_MIME_TO_EXT = { ...IMAGE_MIME_TO_EXT, ...DOCUMENT_MIME_TO_EXT };

export function isImageMime(mimeType) {
  return Object.prototype.hasOwnProperty.call(IMAGE_MIME_TO_EXT, mimeType);
}
