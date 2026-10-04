import Link from 'next/link';
import type { StorefrontLogo } from '@/components/OrganizationHeader';
import { ArrowLeft } from 'lucide-react';
import OrganizationHeader from '@/components/OrganizationHeader';
import { resolveAssetUrl } from '@/lib/assets';
import { dateTile } from '@/lib/dateTile';
import { formatEventDate, formatEventTime } from '@/lib/eventTime';

// Header of the pages built around a floor map (public map, spot chooser),
// Ticketmaster-style: one dark band. Top row: menu button, logo flush left,
// account link flush right (OrganizationHeader layout="bar"). Under it, on
// the same background: back button, date tile, the page title (h1), the
// event, its date and venue. Background = the event poster, blurred, under a
// dark scrim, with a brand rule where the band meets the map.

export interface EventMapHeaderEvent {
  id: string;
  name: string;
  date: string;
  logoUrl?: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
  organizationLogoUrl?: string | null;
  organizationStorefrontLogo?: StorefrontLogo | null;
  organizationSignInLinks?: boolean;
  venue?: { name?: string | null; timezone?: string | null } | null;
}

interface EventMapHeaderProps {
  event: EventMapHeaderEvent;
  /** The page's h1 ("Your application", "Floor map"). */
  title: string;
  /** Where the back button goes (the event page). */
  backHref: string;
  testId?: string;
}

export default function EventMapHeader({ event, title, backHref, testId = 'event-map-header' }: EventMapHeaderProps) {
  const zone = event.venue?.timezone;
  const tile = dateTile(event.date, zone);
  const poster = event.logoUrl ? resolveAssetUrl(event.logoUrl) : null;
  const when = `${formatEventDate(event.date, zone)} · ${formatEventTime(event.date, zone)}`;
  const venue = event.venue?.name;

  const summary = (
    <div className="flex items-center gap-3 sm:gap-4" data-testid="map-event-summary">
      <Link
        href={backHref}
        aria-label={`Back to ${event.name}`}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white ring-1 ring-inset ring-white/20 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </Link>
      {tile && (
        <div
          aria-hidden
          className="hidden w-11 shrink-0 flex-col items-center rounded-lg bg-white/10 py-1 text-white ring-1 ring-inset ring-white/20 min-[380px]:flex"
        >
          <span className="text-[9px] font-bold uppercase tracking-[0.16em] opacity-80">{tile.month}</span>
          <span className="text-base font-extrabold leading-none tabular-nums">{tile.day}</span>
        </div>
      )}
      <div className="min-w-0 flex-1 leading-snug">
        <h1 className="text-base font-extrabold tracking-tight text-white sm:text-lg">
          {title}
          <span className="sr-only"> for {event.name}</span>
        </h1>
        <p aria-hidden className="line-clamp-1 text-[13px] font-semibold text-gray-200" title={event.name}>
          {event.name}
        </p>
        {/* Date and venue share a line from sm; on a phone each gets its own. */}
        <p className="text-xs text-gray-300 sm:truncate" title={venue ? `${when} · ${venue}` : when}>
          <span className="block truncate sm:inline">{when}</span>
          {venue && (
            <>
              <span aria-hidden className="hidden sm:inline"> · </span>
              <span className="sr-only">, at </span>
              <span className="block truncate sm:inline">{venue}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );

  return (
    <div className="dark relative overflow-hidden bg-slate-900" data-testid={testId} data-variant="compact">
      {poster && (
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center opacity-50"
          style={{ backgroundImage: `url(${poster})`, filter: 'blur(32px) saturate(1.2)', transform: 'scale(1.2)' }}
        />
      )}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/75 to-black/55" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-brand" />
      <div className="relative">
        {event.organizationName ? (
          <OrganizationHeader
            organization={{ id: event.organizationId, name: event.organizationName, logoUrl: event.organizationLogoUrl, storefrontLogo: event.organizationStorefrontLogo }}
            nav
            signIn={event.organizationSignInLinks !== false}
            layout="bar"
            subheader={summary}
          />
        ) : (
          <div className="px-3 py-3 sm:px-4">{summary}</div>
        )}
      </div>
    </div>
  );
}
