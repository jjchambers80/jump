// Content › Galleries (spec 046): API shapes and the pure draft helpers the
// admin editor runs on. The editor keeps one draft tree and sends it whole
// (PUT /admin/galleries/:id), like menus.

import { resolveAssetUrl } from './assets';

export const GALLERY_MAX_SECTIONS = 20;
export const GALLERY_MAX_ITEMS = 500;

export interface GalleryPlacement {
  kind: 'PAGE' | 'BLOG_POST' | 'THEME';
  targetId: string;
  title: string;
  href: string;
}

export interface GalleryFileView {
  name: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
  previewUrl: string | null;
  src?: string | null;
  srcset?: string | null;
}

export interface GalleryItem {
  id: string;
  fileId: string;
  altText: string | null;
  decorative: boolean;
  caption: string | null;
  alt: string;
  file: GalleryFileView;
}

export interface GallerySection {
  id: string;
  title: string | null;
  items: GalleryItem[];
}

export interface Gallery {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  sections: GallerySection[];
  placements: GalleryPlacement[];
  updatedAt: string;
}

export interface GallerySummary {
  id: string;
  title: string;
  handle: string;
  sectionCount: number;
  photoCount: number;
  coverThumbUrl: string | null;
  placementCount: number;
  updatedAt: string;
}

export interface GalleryInput {
  title: string;
  description: string | null;
  sections: {
    title: string | null;
    items: { fileId: string; altText: string | null; decorative: boolean; caption: string | null }[];
  }[];
}

/** Draft rows carry a stable client key (dnd-kit ids, React keys). */
export interface DraftItem {
  key: string;
  fileId: string;
  altText: string | null;
  decorative: boolean;
  caption: string | null;
  file: GalleryFileView;
}

export interface DraftSection {
  key: string;
  title: string;
  items: DraftItem[];
}

let counter = 0;
export const draftKey = (prefix: string) => `${prefix}-${(counter += 1)}`;

export function fromServer(gallery: Gallery): DraftSection[] {
  return gallery.sections.map((section) => ({
    key: section.id,
    title: section.title ?? '',
    items: section.items.map((item) => ({
      key: item.id,
      fileId: item.fileId,
      altText: item.altText,
      decorative: item.decorative,
      caption: item.caption,
      file: item.file,
    })),
  }));
}

export function toInput(title: string, description: string, sections: DraftSection[]): GalleryInput {
  const text = (value: string | null) => (value && value.trim() ? value.trim() : null);
  return {
    title: title.trim(),
    description: text(description),
    sections: sections.map((section) => ({
      title: text(section.title),
      items: section.items.map((item) => ({
        fileId: item.fileId,
        altText: item.decorative ? null : text(item.altText),
        decorative: item.decorative,
        caption: text(item.caption),
      })),
    })),
  };
}

/** What the storefront will read aloud: the photo's own alt, else the file's. */
export function effectiveAlt(item: Pick<DraftItem, 'altText' | 'decorative' | 'file'>): string {
  if (item.decorative) return '';
  return item.altText?.trim() || item.file.altText?.trim() || '';
}

export function needsAlt(item: Pick<DraftItem, 'altText' | 'decorative' | 'file'>): boolean {
  return !item.decorative && !effectiveAlt(item);
}

export interface MissingAlt {
  sectionKey: string;
  itemKey: string;
  label: string;
}

export function missingAlt(sections: DraftSection[]): MissingAlt[] {
  const out: MissingAlt[] = [];
  sections.forEach((section, s) =>
    section.items.forEach((item, i) => {
      if (needsAlt(item)) {
        out.push({
          sectionKey: section.key,
          itemKey: item.key,
          label: `${section.title.trim() || `Section ${s + 1}`}, photo ${i + 1} (${item.file.name})`,
        });
      }
    })
  );
  return out;
}

export function photoCount(sections: DraftSection[]): number {
  return sections.reduce((sum, section) => sum + section.items.length, 0);
}

/** Move one entry of a list by an offset; out-of-range moves return the list unchanged. */
export function moveBy<T>(list: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const next = [...list];
  const [entry] = next.splice(index, 1);
  next.splice(target, 0, entry);
  return next;
}

/** Move a photo to the end of another section. */
export function moveToSection(sections: DraftSection[], itemKey: string, toSectionKey: string): DraftSection[] {
  const from = sections.find((section) => section.items.some((item) => item.key === itemKey));
  if (!from || from.key === toSectionKey) return sections;
  const item = from.items.find((entry) => entry.key === itemKey)!;
  return sections.map((section) => {
    if (section.key === from.key) return { ...section, items: section.items.filter((entry) => entry.key !== itemKey) };
    if (section.key === toSectionKey) return { ...section, items: [...section.items, item] };
    return section;
  });
}

/** Delete a section; its photos either join `moveTo` (appended) or are dropped. */
export function removeSection(sections: DraftSection[], sectionKey: string, moveTo: string | null): DraftSection[] {
  const removed = sections.find((section) => section.key === sectionKey);
  if (!removed) return sections;
  return sections
    .filter((section) => section.key !== sectionKey)
    .map((section) =>
      section.key === moveTo ? { ...section, items: [...section.items, ...removed.items] } : section
    );
}

/** Backend srcsets hold API-relative URLs; make every candidate absolute. */
export function resolveSrcset(srcset: string | null | undefined): string | undefined {
  if (!srcset) return undefined;
  return srcset
    .split(',')
    .map((candidate) => {
      const [url, descriptor] = candidate.trim().split(/\s+/);
      return `${resolveAssetUrl(url)} ${descriptor ?? ''}`.trim();
    })
    .join(', ');
}
