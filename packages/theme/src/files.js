// File references inside theme JSON (spec 038 §5 Files): every `{ fileId }`
// at any depth, plus files embedded in rich-text HTML (`/files/<id>/<hash>/`,
// the same pattern StoreFileService.fileIdsInHtml reads).

const FILE_URL_RE = /\/files\/([a-z0-9]+)\/[a-f0-9]{64}\//gi;

export function fileIdsInHtml(html) {
  const ids = new Set();
  if (typeof html === 'string') for (const match of html.matchAll(FILE_URL_RE)) ids.add(match[1]);
  return [...ids];
}

/** Every file id a theme value (settings, content or a document) uses. */
export function fileIdsInThemeJson(value) {
  const ids = new Set();
  const visit = (node) => {
    if (typeof node === 'string') {
      if (node.includes('/files/')) for (const id of fileIdsInHtml(node)) ids.add(id);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object') {
      if (typeof node.fileId === 'string') ids.add(node.fileId);
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return [...ids];
}
