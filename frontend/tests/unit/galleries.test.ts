import { describe, expect, it } from 'vitest';
import {
  effectiveAlt,
  missingAlt,
  moveBy,
  moveToSection,
  removeSection,
  splitGalleryEmbeds,
  toInput,
  type DraftItem,
  type DraftSection,
} from '@/lib/galleries';

const file = (altText: string | null) => ({
  name: 'photo',
  altText,
  width: 100,
  height: 100,
  thumbUrl: null,
  previewUrl: null,
});
const item = (key: string, over: Partial<DraftItem> = {}): DraftItem => ({
  key,
  fileId: `f-${key}`,
  altText: null,
  decorative: false,
  caption: null,
  file: file(null),
  ...over,
});
const sections = (): DraftSection[] => [
  { key: 's1', title: 'Main floor', items: [item('a', { altText: 'Crowd' }), item('b')] },
  { key: 's2', title: '', items: [item('c', { file: file('From file') })] },
];

describe('gallery draft helpers', () => {
  it('reads alt text from the photo, then the file, never for decorative photos', () => {
    expect(effectiveAlt(item('x', { altText: ' Own ', file: file('File') }))).toBe('Own');
    expect(effectiveAlt(item('x', { file: file('File') }))).toBe('File');
    expect(effectiveAlt(item('x', { altText: 'Own', decorative: true }))).toBe('');
  });

  it('lists photos missing alt text with a readable label', () => {
    expect(missingAlt(sections())).toEqual([{ sectionKey: 's1', itemKey: 'b', label: 'Main floor, photo 2 (photo)' }]);
    const fixed = sections();
    fixed[0].items[1].decorative = true;
    expect(missingAlt(fixed)).toEqual([]);
  });

  it('moves within bounds only', () => {
    expect(moveBy(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveBy(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveBy(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });

  it('moves a photo to the end of another section', () => {
    const next = moveToSection(sections(), 'a', 's2');
    expect(next[0].items.map((i) => i.key)).toEqual(['b']);
    expect(next[1].items.map((i) => i.key)).toEqual(['c', 'a']);
  });

  it('removes a section, keeping or dropping its photos', () => {
    expect(removeSection(sections(), 's1', 's2')[0].items.map((i) => i.key)).toEqual(['c', 'a', 'b']);
    expect(removeSection(sections(), 's1', null)).toHaveLength(1);
  });

  it('serialises the draft: trims, nulls blanks, clears alt on decorative photos', () => {
    const draft = sections();
    draft[0].items[1] = item('b', { decorative: true, altText: 'ignored', caption: '  ' });
    expect(toInput(' Expo ', '', draft)).toEqual({
      title: 'Expo',
      description: null,
      sections: [
        {
          title: 'Main floor',
          items: [
            { fileId: 'f-a', altText: 'Crowd', decorative: false, caption: null },
            { fileId: 'f-b', altText: null, decorative: true, caption: null },
          ],
        },
        { title: null, items: [{ fileId: 'f-c', altText: null, decorative: false, caption: null }] },
      ],
    });
  });
});

describe('splitGalleryEmbeds', () => {
  const embed = (id: string, layout = 'masonry') => `<figure data-jump-gallery="${id}" data-layout="${layout}"></figure>`;

  it('splits content at each embed, dropping empty text between', () => {
    expect(splitGalleryEmbeds(`<p>a</p>${embed('g1', 'carousel')}${embed('g2')}<p>b</p>`)).toEqual([
      { html: '<p>a</p>' },
      { galleryId: 'g1', layout: 'carousel' },
      { galleryId: 'g2', layout: 'masonry' },
      { html: '<p>b</p>' },
    ]);
  });

  it('leaves content without embeds whole, and ignores anything not in the sanitised shape', () => {
    expect(splitGalleryEmbeds('<p>x</p>')).toEqual([{ html: '<p>x</p>' }]);
    const odd = '<figure data-jump-gallery="g1" data-layout="grid"></figure><figure data-layout="masonry" data-jump-gallery="g1"></figure>';
    expect(splitGalleryEmbeds(odd)).toEqual([{ html: odd }]);
  });
});
