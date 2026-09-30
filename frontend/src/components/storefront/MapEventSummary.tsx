import Link from 'next/link';
import { resolveAssetUrl } from '@/lib/assets';

// Subheader of the map bar (OrganizationHeader layout="bar"): which event this
// map belongs to, Ticketmaster-style. The event name is the page's h1; the
// venue links back to the event page. Colours stay on brand tokens.

interface MapEventSummaryProps {
  name: string;
  /** Pre-formatted in the venue's zone (formatEventDateTime). */
  when?: string | null;
  venueName?: string | null;
  eventHref: string;
  /** The event image, shown whole (never a cropped variant) from `sm`. */
  imageUrl?: string | null;
}

export default function MapEventSummary({ name, when, venueName, eventHref, imageUrl }: MapEventSummaryProps) {
  const image = imageUrl ? resolveAssetUrl(imageUrl) : null;
  return (
    <div className="flex items-center gap-3 sm:gap-4" data-testid="map-event-summary">
      {image && (
        // Whole image at its own aspect ratio (a poster stays a poster): no crop, no letterbox bands.
        // eslint-disable-next-line @next/next/no-img-element -- decorative, sized by height
        <img
          src={image}
          alt=""
          className="hidden h-16 w-auto max-w-[7rem] shrink-0 rounded-md object-contain shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:block"
        />
      )}
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-600 dark:text-slate-400">Floor map</p>
        <h1 className="text-balance text-lg font-bold leading-snug tracking-tight text-gray-900 dark:text-slate-50 sm:text-xl">
          {name}
        </h1>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-gray-700 dark:text-slate-300">
          {when && <span>{when}</span>}
          {when && <span aria-hidden className="text-gray-400 dark:text-slate-500">·</span>}
          <Link
            href={eventHref}
            className="inline-flex min-h-6 items-center rounded font-medium text-gray-900 underline underline-offset-2 hover:text-brand-link focus:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-slate-100"
          >
            {venueName || 'Event details'}
            <span className="sr-only"> — back to {name}</span>
          </Link>
        </p>
      </div>
    </div>
  );
}
