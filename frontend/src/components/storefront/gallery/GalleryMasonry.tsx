// Masonry: CSS multi-column, so photos keep their own shape and DOM order is
// reading and focus order (down each column). Never reorder with JS or
// `order` (WCAG 1.3.2 / 2.4.3). Each photo is a button the lightbox opens.

import type { CSSProperties } from 'react';
import { resolveAssetUrl } from '@/lib/assets';
import { fillCount, resolveSrcset, type GalleryLabels, type PublicGallery } from '@/lib/galleries';
import { GALLERY_OPEN_ATTR } from '@/theme/sections/islandClasses';
import GalleryImage from './GalleryImage';

interface GalleryMasonryProps {
  gallery: PublicGallery;
  placementId: string;
  columnsDesktop: number;
  columnsMobile: number;
  showCaptions: boolean;
  showSectionTitles: boolean;
  sectionLevel: 2 | 3;
  labels: GalleryLabels;
  /** The gallery opens the page: its first photo loads first (LCP). */
  priority: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

export default function GalleryMasonry({
  gallery,
  placementId,
  columnsDesktop,
  columnsMobile,
  showCaptions,
  showSectionTitles,
  sectionLevel,
  labels,
  priority,
}: GalleryMasonryProps) {
  const desktop = clamp(columnsDesktop, 2, 5);
  const mobile = clamp(columnsMobile, 1, 2);
  const tablet = Math.min(3, desktop);
  const style = { '--cols': mobile, '--cols-md': tablet, '--cols-lg': desktop } as CSSProperties;
  const sizes = `(min-width: 1024px) ${Math.ceil(100 / desktop)}vw, (min-width: 768px) ${Math.ceil(100 / tablet)}vw, ${Math.ceil(100 / mobile)}vw`;
  const total = gallery.sections.reduce((sum, section) => sum + section.items.length, 0);
  const titled = showSectionTitles && gallery.sections.length > 1;
  // The link bar names sections, so it lists only titled ones.
  const linked = titled ? gallery.sections.filter((section) => section.title) : [];
  const SectionHeading = sectionLevel === 3 ? 'h3' : 'h2';
  const anchor = (sectionId: string) => `gallery-${placementId}-${sectionId}`;
  let offset = 0;

  return (
    <div style={style}>
      {linked.length > 3 && (
        <nav aria-label={labels.sections} className="-mx-4 mb-6 overflow-x-auto px-4">
          <ul className="flex gap-2">
            {linked.map((section) => (
              <li key={section.id} className="shrink-0">
                <a
                  href={`#${anchor(section.id)}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-gray-300 px-4 text-sm font-medium text-gray-800 hover:border-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:border-slate-600 dark:text-slate-200"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {gallery.sections.map((section) => {
        const start = offset;
        offset += section.items.length;
        return (
          <div key={section.id} className="mb-8 last:mb-0">
            {titled && section.title && (
              <SectionHeading
                id={anchor(section.id)}
                className="mb-3 scroll-mt-24 text-lg font-semibold text-gray-900 dark:text-slate-100 sm:text-xl"
              >
                {section.title}
              </SectionHeading>
            )}
            <ul
              role="list"
              className="gap-x-2 [column-count:var(--cols)] md:gap-x-3 md:[column-count:var(--cols-md)] lg:[column-count:var(--cols-lg)]"
            >
              {section.items.map((item, i) => {
                const n = start + i + 1;
                return (
                  <li key={item.id} className="mb-2 break-inside-avoid md:mb-3">
                    <button
                      type="button"
                      {...{ [GALLERY_OPEN_ATTR]: n - 1 }}
                      aria-label={`${fillCount(labels.open, n, total)}${item.alt ? `: ${item.alt}` : ''}`}
                      className="group block w-full scroll-mt-24 overflow-hidden rounded-lg bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:bg-slate-800 dark:focus-visible:ring-offset-slate-950"
                    >
                      <GalleryImage
                        fallbackText={item.alt || 'Photo unavailable'}
                        src={resolveAssetUrl(item.src) || undefined}
                        srcSet={resolveSrcset(item.srcset)}
                        sizes={sizes}
                        width={item.width ?? undefined}
                        height={item.height ?? undefined}
                        alt=""
                        loading={priority && n === 1 ? 'eager' : 'lazy'}
                        fetchPriority={priority && n === 1 ? 'high' : undefined}
                        decoding="async"
                        className="block h-auto w-full motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:scale-[1.02]"
                      />
                    </button>
                    {showCaptions && item.caption && (
                      <p className="mt-1.5 text-sm text-gray-600 dark:text-slate-400">{item.caption}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
