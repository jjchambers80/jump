// Spec 046D: gallery embeds survive the content sanitiser only in their exact
// shape (an empty figure naming a gallery id and a layout).

import { describe, expect, it } from '@jest/globals';
import { sanitizeContentHtml } from '../../src/utils/sanitizeHtml.js';
import { galleryIdsInHtml } from '../../src/services/GalleryService.js';

const embed = (id, layout) => `<figure data-jump-gallery="${id}" data-layout="${layout}"></figure>`;

describe('gallery embed sanitising', () => {
  it('keeps a well-formed embed and empties it', () => {
    const html = sanitizeContentHtml(
      `<p>a</p><figure data-jump-gallery="cmgal1" data-layout="carousel" onclick="steal()" class="x"><img src="https://x.test/a.png" alt="a"><p>inside</p></figure><p>b</p>`
    );
    expect(html).toBe(`<p>a</p>${embed('cmgal1', 'carousel')}<p>b</p>`);
    expect(galleryIdsInHtml(html)).toEqual(['cmgal1']);
  });

  it('strips gallery attributes from a malformed embed, keeping an ordinary figure', () => {
    expect(sanitizeContentHtml('<figure data-jump-gallery="BAD ID" data-layout="masonry"><figcaption>c</figcaption></figure>')).toBe(
      '<figure><figcaption>c</figcaption></figure>'
    );
    expect(sanitizeContentHtml('<figure data-jump-gallery="ok1" data-layout="grid">x</figure>')).toBe('<figure>x</figure>');
    expect(sanitizeContentHtml('<figure data-jump-gallery="ok1" data-layout="masonry" data-x="1"></figure>')).toBe(embed('ok1', 'masonry'));
  });

  it('stays balanced when the embed held nested markup', () => {
    const html = sanitizeContentHtml(`<figure data-jump-gallery="g1" data-layout="masonry"><figure>in</figure>tail</figure><p>after</p>`);
    expect(html.startsWith(embed('g1', 'masonry'))).toBe(true);
    expect((html.match(/<figure/g) || []).length).toBe((html.match(/<\/figure>/g) || []).length);
    expect(html).toContain('<p>after</p>');
  });

  it('leaves ordinary figures alone', () => {
    const figure = '<figure><img src="https://x.test/a.png" alt="a" /><figcaption>c</figcaption></figure>';
    expect(sanitizeContentHtml(figure)).toBe(figure);
  });
});
