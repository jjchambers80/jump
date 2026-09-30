// Tiptap node for YouTube / Vimeo players inserted from the Insert video
// dialog. Serialises to the same <iframe class="jump-video"> the backend
// sanitiser keeps (backend/src/utils/sanitizeHtml.js); src is re-validated on
// load so a stored iframe from anywhere else never reaches the editor.

import { Node, mergeAttributes } from '@tiptap/react';
import { VIDEO_EMBED_ALLOW, videoEmbedSrc } from '@/lib/videoEmbed';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    videoEmbed: {
      setVideoEmbed: (options: { src: string; title: string }) => ReturnType;
    };
  }
}

const VideoEmbed = Node.create({
  name: 'videoEmbed',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: 'Embedded video' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'iframe[src]',
        getAttrs: (element) => {
          const src = videoEmbedSrc(element.getAttribute('src') ?? '');
          if (!src) return false;
          return { src, title: element.getAttribute('title') || 'Embedded video' };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'iframe',
      mergeAttributes(HTMLAttributes, {
        class: 'jump-video',
        loading: 'lazy',
        allow: VIDEO_EMBED_ALLOW,
        allowfullscreen: 'true',
        referrerpolicy: 'strict-origin-when-cross-origin',
      }),
    ];
  },

  // In the editor the player sits in a wrapper that swallows clicks, so a
  // click selects the video (to delete or drag it) instead of playing it.
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'jump-video-frame';
      dom.setAttribute('data-testid', 'editor-video');
      const iframe = document.createElement('iframe');
      iframe.className = 'jump-video';
      iframe.src = node.attrs.src;
      iframe.title = node.attrs.title;
      iframe.loading = 'lazy';
      iframe.tabIndex = -1;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      dom.append(iframe);
      return { dom };
    };
  },

  addCommands() {
    return {
      setVideoEmbed:
        (options) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: options }),
    };
  },
});

export default VideoEmbed;
