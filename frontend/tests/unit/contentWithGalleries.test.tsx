// Spec 046: rich-text gallery embeds render in place; only an embed that
// opens the content loads its first photo with high priority.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ContentWithGalleries from '@/components/storefront/ContentWithGalleries';
import type { PublicGallery } from '@/lib/galleries';

const gallery: PublicGallery = {
  id: 'g1',
  title: 'Expo',
  sections: [
    {
      id: 's1',
      title: null,
      items: [
        { id: 'p1', src: '/images/1/h/w1600', srcset: '/images/1/h/w480 480w', width: 800, height: 600, alt: 'Crowd', caption: null },
        { id: 'p2', src: '/images/2/h/w1600', srcset: '/images/2/h/w480 480w', width: 800, height: 600, alt: 'Stage', caption: null },
      ],
    },
  ],
};
const embed = '<figure data-jump-gallery="g1" data-layout="masonry"></figure>';

describe('ContentWithGalleries', () => {
  it('gives the first photo high priority only when the gallery opens the content', () => {
    const first = renderToStaticMarkup(<ContentWithGalleries html={`${embed}<p>after</p>`} galleries={{ g1: gallery }} />);
    expect(first.match(/fetchPriority="high"/gi)).toHaveLength(1);
    expect(first).toContain('Open photo 1 of 2: Crowd');

    const later = renderToStaticMarkup(<ContentWithGalleries html={`<p>before</p>${embed}`} galleries={{ g1: gallery }} />);
    expect(later).not.toMatch(/fetchPriority="high"/i);
    expect(later.indexOf('before')).toBeLessThan(later.indexOf('Open photo 1'));
  });

  it('renders nothing for an unknown gallery', () => {
    const html = renderToStaticMarkup(<ContentWithGalleries html={`<p>a</p>${embed}<p>b</p>`} galleries={{}} />);
    expect(html).not.toContain('Open photo');
    expect(html).toContain('<p>a</p>');
    expect(html).toContain('<p>b</p>');
  });
});
