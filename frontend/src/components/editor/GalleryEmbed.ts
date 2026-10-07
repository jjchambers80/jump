// Tiptap node for Content › Galleries embeds (spec 046D), inserted from the
// Insert gallery dialog. Serialises to the empty <figure data-jump-gallery>
// the backend sanitiser keeps (backend/src/utils/sanitizeHtml.js); the
// storefront renders the gallery in its place. Registered on every full
// editor so an embed survives editing even where the button is not offered.

import { Node } from '@tiptap/react';

export type GalleryLayout = 'masonry' | 'carousel';
export interface GalleryAttrs {
  id: string;
  layout: GalleryLayout;
}

const ID_RE = /^[a-z0-9]{1,64}$/;
const LAYOUT_LABEL: Record<GalleryLayout, string> = { masonry: 'Masonry grid', carousel: 'Carousel' };

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    galleryEmbed: {
      setGalleryEmbed: (options: GalleryAttrs) => ReturnType;
    };
  }
}

const GalleryEmbed = Node.create<{ titles: () => Record<string, string> }>({
  name: 'galleryEmbed',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return { titles: () => ({}) };
  },

  addAttributes() {
    return {
      id: { default: null },
      layout: { default: 'masonry' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-jump-gallery]',
        getAttrs: (element) => {
          const id = element.getAttribute('data-jump-gallery') ?? '';
          const layout = element.getAttribute('data-layout');
          if (!ID_RE.test(id)) return false;
          return { id, layout: layout === 'carousel' ? 'carousel' : 'masonry' };
        },
      },
    ];
  },

  renderHTML({ node }) {
    return ['figure', { 'data-jump-gallery': node.attrs.id, 'data-layout': node.attrs.layout }];
  },

  // A card in the editor; a click selects it (to move, delete or edit).
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'jump-gallery-embed';
      dom.setAttribute('data-testid', 'editor-gallery');
      const title = this.options.titles()[node.attrs.id];
      const name = document.createElement('strong');
      name.textContent = title ? `Gallery: ${title}` : 'Photo gallery';
      const meta = document.createElement('span');
      meta.textContent = `${LAYOUT_LABEL[node.attrs.layout as GalleryLayout] ?? 'Masonry grid'} · double-click to change`;
      dom.append(name, meta);
      return { dom };
    };
  },

  addCommands() {
    return {
      setGalleryEmbed:
        (options) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: options }),
    };
  },
});

export default GalleryEmbed;
