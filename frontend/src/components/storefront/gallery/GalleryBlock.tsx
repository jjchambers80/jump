// A Content › Galleries record on a storefront page (spec 046), shared by the
// theme Gallery section and rich-text embeds. Server component: the photos
// render without JavaScript; GalleryLightbox and GalleryCarousel are islands.

import {
  DEFAULT_GALLERY_LABELS,
  flattenGallery,
  type GalleryLabels,
  type PublicGallery,
} from '@/lib/galleries';
import GalleryCarousel from './GalleryCarousel';
import GalleryLightbox from './GalleryLightbox';
import GalleryMasonry from './GalleryMasonry';

export interface GalleryBlockProps {
  gallery: PublicGallery;
  /** Unique per placement: one gallery can appear twice on a page. */
  placementId: string;
  layout?: 'masonry' | 'carousel';
  heading?: string;
  columnsDesktop?: number;
  columnsMobile?: number;
  showCaptions?: boolean;
  showSectionTitles?: boolean;
  autoplayMs?: number;
  labels?: GalleryLabels;
}

export default function GalleryBlock({
  gallery,
  placementId,
  layout = 'masonry',
  heading = '',
  columnsDesktop = 3,
  columnsMobile = 2,
  showCaptions = false,
  showSectionTitles = true,
  autoplayMs = 0,
  labels = DEFAULT_GALLERY_LABELS,
}: GalleryBlockProps) {
  const items = flattenGallery(gallery);
  if (!items.length) return null;
  const headingId = `gallery-${placementId}-heading`;
  const name = heading || gallery.title;

  return (
    <div data-gallery={gallery.id}>
      {heading && (
        <h2 id={headingId} className="mb-6 text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-3xl">
          {heading}
        </h2>
      )}
      <GalleryLightbox items={items} title={name} labels={labels}>
        {layout === 'carousel' ? (
          <GalleryCarousel items={items} title={name} labelledBy={heading ? headingId : undefined} labels={labels} autoplayMs={autoplayMs} showCaptions={showCaptions} />
        ) : (
          <GalleryMasonry
            gallery={gallery}
            placementId={placementId}
            columnsDesktop={columnsDesktop}
            columnsMobile={columnsMobile}
            showCaptions={showCaptions}
            showSectionTitles={showSectionTitles}
            sectionLevel={heading ? 3 : 2}
            labels={labels}
          />
        )}
      </GalleryLightbox>
    </div>
  );
}
