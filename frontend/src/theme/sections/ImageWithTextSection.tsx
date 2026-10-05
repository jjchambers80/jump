// Theme ImageWithText section: an image or a YouTube / Vimeo player beside a
// heading, rich text and up to two buttons; side by side from `lg`, media
// first on phones. The body is organizer HTML sanitised on write and rendered
// only through ContentHtml. The player src is rebuilt by videoEmbedSrc, so
// only canonical YouTube (no-cookie) and Vimeo player URLs ever reach it.

import type { ReactNode } from 'react';
import ContentHtml from '@/components/storefront/ContentHtml';
import { VIDEO_EMBED_ALLOW, videoEmbedSrc } from '@/lib/videoEmbed';
import SectionShell from './SectionShell';
import type { SectionContext } from './context';

export interface ImageWithTextProps {
  id: string;
  image?: { fileId: string; alt?: string; decorative?: boolean } | null;
  videoUrl?: string;
  videoTitle?: string;
  imagePosition?: 'left' | 'right';
  heading?: string;
  headingLevel?: 'h2' | 'h1';
  body?: string;
  colorScheme?: string;
  paddingTop?: number;
  sectionWidth?: string;
  paddingBottom?: number;
  Buttons: (props?: { className?: string }) => ReactNode;
  ctx: SectionContext;
}

export default function ImageWithTextSection({ id, image, videoUrl = '', videoTitle = 'Video', imagePosition = 'left', heading = '', headingLevel = 'h2', body = '', Buttons, ctx, ...common }: ImageWithTextProps) {
  const videoSrc = videoUrl ? videoEmbedSrc(videoUrl) : null;
  const file = !videoSrc && image?.fileId ? ctx.resolved.files[image.fileId] : null;
  const media = Boolean(videoSrc || file);
  const order = imagePosition === 'right' ? 'lg:order-2' : '';
  const alt = image?.decorative ? '' : (image?.alt ?? file?.alt ?? '');
  const headingId = `image-text-${id}`;
  const Heading = headingLevel === 'h1' ? 'h1' : 'h2';
  return (
    <SectionShell type="ImageWithText" props={common}>
      <section aria-labelledby={heading ? headingId : undefined} className="px-4 py-12 sm:px-6 lg:px-8">
        <div className={`mx-auto grid max-w-7xl items-center gap-8 lg:gap-16 ${media ? 'lg:grid-cols-2' : ''}`}>
          {videoSrc && (
            <div className={`aspect-video w-full overflow-hidden rounded-[var(--theme-media-radius,1rem)] bg-black ${order}`}>
              <iframe
                src={videoSrc}
                title={videoTitle || 'Video'}
                loading="lazy"
                allow={VIDEO_EMBED_ALLOW}
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                className="h-full w-full border-0"
              />
            </div>
          )}
          {file && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={file.url}
              alt={alt}
              loading="lazy"
              width={file.width ?? undefined}
              height={file.height ?? undefined}
              className={`aspect-[4/3] w-full rounded-[var(--theme-media-radius,1rem)] object-cover ${order}`}
            />
          )}
          <div className={media ? '' : 'mx-auto max-w-3xl'}>
            {heading && (
              <Heading id={headingId} className={`text-balance font-bold tracking-tight text-gray-900 dark:text-slate-100 ${Heading === 'h1' ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl'}`}>
                {heading}
              </Heading>
            )}
            {body && <ContentHtml html={body} className={heading ? 'mt-4' : ''} />}
            <Buttons className="mt-8 flex flex-wrap gap-3" />
          </div>
        </div>
      </section>
    </SectionShell>
  );
}
