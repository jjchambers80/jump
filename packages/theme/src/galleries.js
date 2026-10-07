// Gallery references inside theme JSON (spec 046): the `gallery` setting of
// every Gallery section, at any depth (template and page documents).

export function galleryIdsInThemeJson(value) {
  const ids = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object') {
      if (node.type === 'Gallery' && typeof node.props?.gallery === 'string') ids.add(node.props.gallery);
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return [...ids];
}
