// Theme Feature block: one card of a FeatureGrid (image, title, text). The
// grid's alignment reaches it through the inherited text-align.

import type { SectionContext } from './context';

export interface FeatureProps {
  id: string;
  image?: { fileId: string; alt?: string; decorative?: boolean } | null;
  title?: string;
  text?: string;
  ctx: SectionContext;
}

export default function FeatureBlock({ image, title = '', text = '', ctx }: FeatureProps) {
  const file = image?.fileId ? ctx.resolved.files[image.fileId] : null;
  const alt = image?.decorative ? '' : (image?.alt ?? file?.alt ?? '');
  return (
    <div data-feature>
      {file && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.url}
          alt={alt}
          loading="lazy"
          decoding="async"
          width={file.width ?? undefined}
          height={file.height ?? undefined}
          className="mb-5 aspect-[3/2] w-full rounded-[var(--theme-media-radius,1rem)] object-cover"
        />
      )}
      {title && <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{title}</h3>}
      {text && <p className="mt-2 text-pretty text-gray-600 dark:text-slate-300">{text}</p>}
    </div>
  );
}
