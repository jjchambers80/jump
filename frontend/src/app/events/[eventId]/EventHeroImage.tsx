// Foreground event image: inline on desktop, a floating square that hangs off
// the hero on phones. Without `onOpen` (preview mode, spec 050 §8.2) the image
// shows but opens no dialog.

import { resolveAssetUrl } from '@/lib/assets';

interface EventHeroImageProps {
  logoUrl: string;
  name: string;
  variant: 'desktop' | 'mobile';
  onOpen?: () => void;
}

const FRAME = {
  desktop:
    'flex h-40 w-40 rotate-2 items-center justify-center overflow-hidden rounded-xl bg-black/40 shadow-2xl shadow-black/50 ring-1 ring-white/15 transition-transform duration-300 ease-out group-hover:rotate-0 group-hover:scale-[1.02] motion-reduce:transition-none lg:h-44 lg:w-44',
  mobile: 'flex h-32 w-32 items-center justify-center overflow-hidden rounded-xl border-2 border-white bg-black/40 shadow-lg dark:border-slate-800',
};

const WRAPPER = {
  desktop: 'group hidden shrink-0 sm:block',
  mobile: 'absolute bottom-0 right-4 z-10 translate-y-1/2 cursor-pointer sm:hidden',
};

export default function EventHeroImage({ logoUrl, name, variant, onOpen }: EventHeroImageProps) {
  const frame = (
    <div className={FRAME[variant]}>
      <img src={resolveAssetUrl(logoUrl) || undefined} alt={name} className="max-h-full max-w-full object-contain" />
    </div>
  );
  // The desktop copy carries the anchor; on phones it is hidden and the hero
  // top (#event-hero) is the same scroll position.
  const id = variant === 'desktop' ? 'event-hero-image' : undefined;

  if (!onOpen) {
    return (
      <div id={id} className={WRAPPER[variant].replace(' cursor-pointer', '')}>
        {frame}
      </div>
    );
  }
  return (
    <button id={id} type="button" onClick={onOpen} aria-label={`View ${name} image`} className={WRAPPER[variant]}>
      {frame}
    </button>
  );
}
