// Tiptap node for Content › Galleries embeds (spec 046D), inserted from the
// Insert gallery dialog. Serialises to the empty <figure data-jump-gallery>
// the backend sanitiser keeps (backend/src/utils/sanitizeHtml.js); the
// storefront renders the gallery in its place. Registered on every full
// editor so an embed survives editing even where the button is not offered.

import { Node } from '@tiptap/react';
import { resolveAssetUrl } from '@/lib/assets';

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

export interface GalleryCardInfo {
  title: string;
  thumbUrls: string[];
}

interface GalleryEmbedOptions {
  /** null until the gallery list has loaded; then a missing id is a deleted gallery. */
  galleries: () => Record<string, GalleryCardInfo> | null;
  /** The card's Edit button: the editor opens Edit gallery for this embed. */
  onEdit: (attrs: GalleryAttrs) => void;
}

const GalleryEmbed = Node.create<GalleryEmbedOptions, { repaint: Set<() => void> }>({
  name: 'galleryEmbed',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return { galleries: () => null, onEdit: () => {} };
  },

  // Cards register a repaint, so titles that load after the editor do reach them.
  addStorage() {
    return { repaint: new Set<() => void>() };
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

  // A cover tile in the editor (first four photos, title, layout) with Edit
  // and Remove buttons; a click elsewhere on it selects it to move or delete.
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const attrs = node.attrs as GalleryAttrs;
      const dom = document.createElement('div');
      dom.className = 'jump-gallery-embed';
      dom.contentEditable = 'false';
      dom.setAttribute('data-testid', 'editor-gallery');
      const thumbs = document.createElement('div');
      thumbs.className = 'jump-gallery-embed__thumbs';
      thumbs.setAttribute('aria-hidden', 'true');
      const text = document.createElement('div');
      text.className = 'jump-gallery-embed__text';
      const name = document.createElement('strong');
      const meta = document.createElement('span');
      meta.textContent = LAYOUT_LABEL[attrs.layout] ?? 'Masonry grid';
      text.append(name, meta);
      const actions = document.createElement('div');
      actions.className = 'jump-gallery-embed__actions';
      const button = (label: string, onClick: () => void) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.textContent = label;
        el.addEventListener('click', (event) => {
          event.preventDefault();
          onClick();
        });
        actions.append(el);
        return el;
      };
      const pos = () => (typeof getPos === 'function' ? getPos() : undefined);
      const edit = button('Edit', () => {
        const at = pos();
        if (at !== undefined) editor.commands.setNodeSelection(at);
        this.options.onEdit(attrs);
      });
      const remove = button('Remove', () => {
        const at = pos();
        if (at !== undefined) editor.chain().focus().deleteRange({ from: at, to: at + node.nodeSize }).run();
      });

      const paint = () => {
        const galleries = this.options.galleries();
        const info = galleries?.[attrs.id];
        name.textContent = info ? `Gallery: ${info.title}` : galleries ? 'Gallery not found' : 'Photo gallery';
        edit.setAttribute('aria-label', `Edit ${info ? `gallery ${info.title}` : 'gallery'}`);
        remove.setAttribute('aria-label', `Remove ${info ? `gallery ${info.title}` : 'gallery'}`);
        thumbs.replaceChildren(
          ...(info?.thumbUrls ?? []).map((url) => {
            const img = document.createElement('img');
            img.src = resolveAssetUrl(url) || '';
            img.alt = '';
            img.loading = 'lazy';
            return img;
          })
        );
        thumbs.hidden = !info?.thumbUrls.length;
      };
      paint();
      this.storage.repaint.add(paint);
      dom.append(thumbs, text, actions);
      return {
        dom,
        // The buttons work as buttons, not as ProseMirror clicks.
        stopEvent: (event: Event) => event.target instanceof Element && Boolean(event.target.closest('button')),
        ignoreMutation: () => true,
        destroy: () => this.storage.repaint.delete(paint),
      };
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
