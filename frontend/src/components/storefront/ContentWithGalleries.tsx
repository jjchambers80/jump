// Stored content HTML with its gallery embeds (spec 046D) rendered in place:
// the HTML between embeds goes through ContentHtml, each embed becomes a
// GalleryBlock outside the prose styles. Server-safe, so both the client
// views and the themed server routes use it. An unknown or empty gallery
// renders nothing.

import GalleryBlock from '@/components/storefront/gallery/GalleryBlock';
import { splitGalleryEmbeds, type PublicGallery } from '@/lib/galleries';
import ContentHtml from './ContentHtml';

interface ContentWithGalleriesProps {
  html: string;
  galleries?: Record<string, PublicGallery>;
  className?: string;
}

export default function ContentWithGalleries({ html, galleries = {}, className = '' }: ContentWithGalleriesProps) {
  const parts = splitGalleryEmbeds(html);
  if (parts.length === 1 && 'html' in parts[0]) return <ContentHtml html={html} className={className} />;
  return (
    <div className={className}>
      {parts.map((part, index) => {
        if ('html' in part) return <ContentHtml key={index} html={part.html} className={index ? 'mt-6' : ''} />;
        const gallery = galleries[part.galleryId];
        if (!gallery) return null;
        return (
          <div key={index} className={index ? 'mt-8' : ''}>
            <GalleryBlock gallery={gallery} placementId={`embed-${index}-${part.galleryId}`} layout={part.layout} priority={index === 0} />
          </div>
        );
      })}
    </div>
  );
}
