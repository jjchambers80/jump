// Special guest lineup on the event page (spec 050 §7.6, card 050-Q), anchor
// #guests. Visible rows only, in the organizer's order; nothing renders when
// there are none, except a placeholder in preview. Bios are plain text (never
// HTML, gotcha 20); links get an accessible name ("Mara Voss on Instagram").

import { UserRound } from 'lucide-react';
import SocialIcon, { SOCIAL_LABELS } from '@/components/storefront/SocialIcon';
import { resolveAssetUrl } from '@/lib/assets';
import { GUEST_LINK_KEYS, type EventGuest } from '@/lib/eventGuests';
import Placeholder from './Placeholder';

function GuestLinks({ guest }: { guest: EventGuest }) {
  const links = GUEST_LINK_KEYS.filter((key) => guest.links?.[key]);
  if (links.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1" aria-label={`${guest.name} links`}>
      {links.map((key) => (
        <li key={key}>
          <a
            href={guest.links![key]}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={key === 'website' ? `${guest.name}'s website` : `${guest.name} on ${SOCIAL_LABELS[key] ?? key}`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-600 transition-colors hover:text-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link dark:text-slate-300"
          >
            <SocialIcon network={key} className="size-5" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function GuestCard({ guest }: { guest: EventGuest }) {
  const src = resolveAssetUrl(guest.imageUrl);
  return (
    <li className="flex gap-4 rounded-lg border border-gray-200 p-4 dark:border-slate-700">
      <div className="relative size-20 shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-slate-700">
        {src ? (
          <img src={src} alt={guest.name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <UserRound className="absolute inset-0 m-auto size-8 text-gray-400 dark:text-slate-500" aria-hidden />
        )}
      </div>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">{guest.name}</h3>
        {guest.role && <p className="text-sm font-medium text-brand-link">{guest.role}</p>}
        {guest.bio && <p className="mt-1 whitespace-pre-line text-sm text-gray-700 dark:text-slate-300">{guest.bio}</p>}
        <GuestLinks guest={guest} />
      </div>
    </li>
  );
}

export default function EventGuests({ guests, preview = false, className = '' }: { guests?: EventGuest[]; preview?: boolean; className?: string }) {
  const list = guests ?? [];
  if (list.length === 0 && !preview) return null;
  return (
    <section id="guests" aria-labelledby="guests-heading" className={`scroll-mt-6 ${className}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400">Lineup</p>
      <h2 id="guests-heading" className="mt-0.5 mb-5 text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100">
        Special guests
      </h2>
      {list.length === 0 ? (
        <Placeholder>Guests you add to the lineup show here</Placeholder>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {list.map((g) => (
            <GuestCard key={g.id} guest={g} />
          ))}
        </ul>
      )}
    </section>
  );
}
