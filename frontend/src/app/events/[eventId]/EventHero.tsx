// Event hero: blurred poster behind the title block, date tile, venue, the
// hero actions (Event Information, floor map, Get involved) and the poster.
// Presentational (spec 050 §8.2). In `preview` the unset fields render as
// placeholders and nothing opens a dialog.

import Link from 'next/link';
import { ImagePlus, Info } from 'lucide-react';
import { resolveAssetUrl } from '@/lib/assets';
import FloorMapButton from './FloorMapButton';
import GetInvolved from './GetInvolved';
import EventHeroImage from './EventHeroImage';
import EventHeroMeta from './EventHeroMeta';
import Placeholder from './Placeholder';
import type { EventPageEvent, EventPageOrg } from './eventPage';

interface EventHeroProps {
  event: EventPageEvent;
  org: EventPageOrg;
  preview?: boolean;
  onShowDescription?: () => void;
  onShowImage?: () => void;
}

const PILL =
  'inline-flex h-9 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/25 backdrop-blur-sm';

export default function EventHero({ event, org, preview = false, onShowDescription, onShowImage }: EventHeroProps) {
  const isRsvp = event.admissionMode === 'RSVP';

  return (
    <div id="event-hero" className="relative">
      {/* Background layers - clipped */}
      <div className="absolute inset-0 overflow-hidden bg-slate-900 sm:rounded-t-2xl">
        {event.logoUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-70"
            style={{
              backgroundImage: `url(${resolveAssetUrl(event.logoUrl)})`,
              filter: 'blur(28px) saturate(1.2)',
              transform: 'scale(1.15)',
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/70 to-black/40" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/40 to-transparent" />
      </div>

      <div className="relative flex items-center justify-between gap-8 p-6 sm:p-10">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            {event.category && (
              <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm">
                {event.category}
              </span>
            )}
            {org.name && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-300">
                {org.id ? (
                  <Link href={`/organizations/${org.id}`} className="transition-colors hover:text-white hover:underline">
                    {org.name}
                  </Link>
                ) : (
                  org.name
                )}
              </p>
            )}
          </div>
          <h1 className="text-balance text-3xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-[2.75rem]">
            {event.name || (preview ? <Placeholder tone="hero">Add an event name</Placeholder> : null)}
          </h1>

          <EventHeroMeta event={event} preview={preview} />

          {/* Actions row. The phone poster hangs over the hero's bottom-right corner: keep clear of it */}
          <div className={`mt-6 flex flex-wrap items-center gap-2 empty:hidden ${event.logoUrl ? 'max-sm:pr-36' : ''}`}>
            {/* RSVP pages show the description inline under "About"; so does preview mode */}
            {event.description && !isRsvp && onShowDescription && (
              <button
                type="button"
                onClick={onShowDescription}
                className={`${PILL} transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white`}
              >
                <Info className="h-4 w-4" aria-hidden />
                <span>Event Information</span>
              </button>
            )}
            {preview && !event.logoUrl && (
              <span id="event-hero-image" className={`${PILL} border border-dashed border-white/40 ring-0`}>
                <ImagePlus className="h-4 w-4 text-gray-200" aria-hidden />
                <Placeholder tone="hero">Add an image</Placeholder>
              </span>
            )}
            {/* Floor map (spec 014): opens full screen; renders only once a map is published */}
            <FloorMapButton eventId={event.id} eventName={event.name} preview={preview} />
            {/* Applications (spec 011): vendors, sponsors, press, panels — above the fold */}
            <GetInvolved eventId={event.id} preview={preview} />
          </div>
        </div>

        {event.logoUrl && <EventHeroImage logoUrl={event.logoUrl} name={event.name} variant="desktop" onOpen={onShowImage} />}
      </div>

      {event.logoUrl && <EventHeroImage logoUrl={event.logoUrl} name={event.name} variant="mobile" onOpen={onShowImage} />}
    </div>
  );
}
