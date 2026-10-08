// Theme Gallery section (spec 046): a Content › Galleries record placed by
// reference. The gallery and its photos come resolved (ThemeService), filtered
// to the organization; a missing or empty one renders nothing.

import GalleryBlock from '@/components/storefront/gallery/GalleryBlock';
import type { GalleryLabels } from '@/lib/galleries';
import SectionShell from './SectionShell';
import { t, type SectionContext } from './context';

export interface GallerySectionProps {
  id: string;
  gallery?: string | null;
  heading?: string;
  layout?: 'masonry' | 'carousel';
  columnsDesktop?: number;
  columnsMobile?: number;
  showCaptions?: boolean;
  showSectionTitles?: boolean;
  autoplay?: 'off' | '5s' | '8s';
  colorScheme?: string;
  paddingTop?: number;
  paddingBottom?: number;
  sectionWidth?: string;
  ctx: SectionContext;
}

export default function GallerySection({
  gallery: galleryId,
  heading = '',
  layout = 'masonry',
  columnsDesktop = 3,
  columnsMobile = 2,
  showCaptions = false,
  showSectionTitles = true,
  autoplay = 'off',
  ctx,
  id,
  ...common
}: GallerySectionProps) {
  const gallery = galleryId ? ctx.resolved.galleries?.[galleryId] : undefined;
  if (!gallery) {
    if (!ctx.editing) return null;
    return (
      <SectionShell type="Gallery" props={common}>
        <p className="mx-auto max-w-7xl rounded-lg border-2 border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-600 dark:border-slate-600 dark:text-slate-400">
          {galleryId ? 'This gallery is empty or was deleted.' : 'Choose a gallery in the section settings.'}
        </p>
      </SectionShell>
    );
  }
  const labels: GalleryLabels = {
    open: t(ctx, 'gallery.open'),
    counter: t(ctx, 'gallery.counter'),
    previous: t(ctx, 'gallery.previous'),
    next: t(ctx, 'gallery.next'),
    close: t(ctx, 'gallery.close'),
    photo: t(ctx, 'gallery.photo'),
    pause: t(ctx, 'gallery.pause'),
    sections: t(ctx, 'gallery.sections'),
  };

  return (
    <SectionShell type="Gallery" props={common}>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <GalleryBlock
          gallery={gallery}
          placementId={id}
          layout={layout}
          heading={heading}
          columnsDesktop={columnsDesktop}
          columnsMobile={columnsMobile}
          showCaptions={showCaptions}
          showSectionTitles={showSectionTitles}
          autoplayMs={ctx.editing ? 0 : autoplay === '5s' ? 5000 : autoplay === '8s' ? 8000 : 0}
          labels={labels}
        />
      </div>
    </SectionShell>
  );
}
