'use client';

// Photo viewer for a gallery (spec 046, WAI-ARIA APG modal dialog): wraps the
// server-rendered photos and opens on any button carrying GALLERY_OPEN_ATTR.
// Native <dialog> + showModal(): focus moves in and is trapped, the page goes
// inert, Escape closes, and focus returns to the photo that opened it.
// Previous / next are buttons (←/→, Home / End too); swipe is an extra (2.5.7).

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { resolveAssetUrl } from '@/lib/assets';
import { fillCount, resolveSrcset, type FlatGalleryItem, type GalleryLabels } from '@/lib/galleries';
import { GALLERY_OPEN_ATTR } from '@/theme/sections/islandClasses';

interface GalleryLightboxProps {
  items: FlatGalleryItem[];
  title: string;
  labels: GalleryLabels;
  children: ReactNode;
}

const control =
  'inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-900 shadow-md hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black aria-disabled:opacity-40';

export default function GalleryLightbox({ items, title, labels, children }: GalleryLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const touchX = useRef<number | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const titleId = useId();
  const last = items.length - 1;

  const close = useCallback(() => {
    dialogRef.current?.close();
    document.documentElement.style.removeProperty('overflow');
    setIndex(null);
    openerRef.current?.focus();
  }, []);

  // aria-disabled, not disabled, at the ends: a disabled button drops focus.
  const go = (to: number) => setIndex(Math.min(last, Math.max(0, to)));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (index === null || !dialog || dialog.open) return;
    dialog.showModal();
    document.documentElement.style.overflow = 'hidden';
  }, [index]);

  // Neighbours load before the visitor gets there.
  useEffect(() => {
    if (index === null) return;
    for (const i of [index - 1, index + 1]) {
      const item = items[i];
      if (!item) continue;
      const img = new Image();
      img.sizes = '100vw';
      const srcset = resolveSrcset(item.srcset);
      if (srcset) img.srcset = srcset;
      img.src = resolveAssetUrl(item.src) || '';
    }
  }, [index, items]);

  useEffect(() => () => void document.documentElement.style.removeProperty('overflow'), []);

  const item = index === null ? null : items[index];

  return (
    <>
      <div
        onClick={(event) => {
          const button = (event.target as HTMLElement).closest<HTMLElement>(`[${GALLERY_OPEN_ATTR}]`);
          if (!button || !event.currentTarget.contains(button)) return;
          openerRef.current = button;
          setIndex(Number(button.getAttribute(GALLERY_OPEN_ATTR)) || 0);
        }}
      >
        {children}
      </div>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          if (index === null) return;
          const keys: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: last };
          if (event.key in keys) {
            event.preventDefault();
            go(keys[event.key]);
          }
        }}
        onClick={(event) => {
          if ((event.target as HTMLElement).dataset.backdrop) close();
        }}
        className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/80"
      >
        {item && index !== null && (
          <div className="relative flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <h2 id={titleId} className="min-w-0 truncate text-sm font-semibold">
                {title}
              </h2>
              <button type="button" onClick={close} aria-label={labels.close} className={control}>
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <figure
              data-backdrop="1"
              className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-4 md:px-20"
              onTouchStart={(event) => {
                touchX.current = event.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(event) => {
                const start = touchX.current;
                const end = event.changedTouches[0]?.clientX;
                touchX.current = null;
                if (start === null || end === undefined || Math.abs(end - start) < 50) return;
                go(index + (end < start ? 1 : -1));
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={item.id}
                src={resolveAssetUrl(item.src) || undefined}
                srcSet={resolveSrcset(item.srcset)}
                sizes="100vw"
                width={item.width ?? undefined}
                height={item.height ?? undefined}
                alt={item.alt ?? fillCount(labels.photo, index + 1, items.length)}
                className="max-h-full min-h-0 w-auto max-w-full flex-shrink object-contain motion-safe:animate-[gallery-fade_150ms_ease-out]"
              />
              {item.caption && (
                <figcaption className="mt-3 max-w-prose text-center text-sm text-gray-200">{item.caption}</figcaption>
              )}
            </figure>

            <div className="flex items-center justify-between gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:justify-center">
              <button
                type="button"
                onClick={() => go(index - 1)}
                aria-disabled={index === 0}
                aria-label={labels.previous}
                className={`${control} md:absolute md:left-4 md:top-1/2 md:-translate-y-1/2`}
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <p aria-live="polite" aria-atomic="true" className="text-sm text-gray-200">
                {fillCount(labels.counter, index + 1, items.length)}
                {item.sectionTitle ? ` · ${item.sectionTitle}` : ''}
              </p>
              <button
                type="button"
                onClick={() => go(index + 1)}
                aria-disabled={index === last}
                aria-label={labels.next}
                className={`${control} md:absolute md:right-4 md:top-1/2 md:-translate-y-1/2`}
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
