import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { CalendarCheck, LayoutGrid, ScanLine, Ticket } from 'lucide-react';
import EventimusLogo from '@/components/EventimusLogo';
import { LEGAL_PAGES_ENABLED, LEGAL_PATHS } from '@/lib/legal';

// The Eventimus product homepage. Platform hosts only: on a tenant host
// (custom domain or <slug>.<root> store subdomain) middleware rewrites `/` to
// the store's own homepage before this page is reached. Screenshots in
// public/home are of a real store (Raleigh Retro Gamers) in production.

export const metadata: Metadata = {
  title: 'Eventimus - Tickets, vendors and your own event store',
  description:
    'Eventimus gives markets, conventions and community events a branded store, checkout, vendor applications and door check-in.',
};

const primaryCta =
  'inline-flex items-center justify-center rounded-full bg-accent-400 px-6 py-3 text-sm font-semibold text-gray-900 transition hover:bg-accent-hover active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950';
const secondaryCta =
  'inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 transition hover:bg-gray-100 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 dark:text-white dark:ring-white/20 dark:hover:bg-white/10';

export default function Home() {
  return (
    <div className="min-h-[100dvh] bg-white text-gray-900 dark:bg-zinc-950 dark:text-white">
      <header className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Eventimus home" className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-600">
          <EventimusLogo className="h-4 min-[360px]:h-5 sm:h-6" />
        </Link>
        <nav aria-label="Account" className="flex items-center gap-1 sm:gap-4">
          <Link href="/auth/signin" className="whitespace-nowrap rounded px-2 py-1 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-zinc-300 dark:hover:text-white">
            Sign in
          </Link>
          <Link href="/signup" className={`${primaryCta} whitespace-nowrap !px-4 !py-2`}>
            Start selling
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[5fr_7fr] lg:pb-24 lg:pt-16">
          <div>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Sell tickets and run your vendor floor.
            </h1>
            <p className="mt-6 max-w-[48ch] text-lg leading-relaxed text-gray-600 dark:text-zinc-400">
              A branded store, checkout, vendor applications and door check-in for markets, conventions and community events.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className={primaryCta}>
                Start selling
              </Link>
              <Link href="/events" className={secondaryCta}>
                Browse events
              </Link>
            </div>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-xl bg-zinc-900 shadow-2xl shadow-zinc-900/20 ring-1 ring-gray-900/10 dark:shadow-black/40 dark:ring-white/10">
              <div className="flex h-8 items-center gap-1.5 border-b border-white/10 px-3" aria-hidden="true">
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
              </div>
              <Image
                src="/home/storefront-event.jpg"
                alt="An event page on an Eventimus store: the Raleigh Retro Gamers Halloween Market with its date, venue and an RSVP form."
                width={1600}
                height={1000}
                priority
                sizes="(min-width: 1024px) 58vw, 100vw"
                className="h-auto w-full"
              />
            </div>
          </div>
        </section>

        <section aria-labelledby="features-heading" className="bg-gray-50 py-16 dark:bg-zinc-900/60 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <h2 id="features-heading" className="max-w-[22ch] text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything your event sells, under your name.
            </h2>

            <div className="mt-10 grid gap-4 lg:grid-cols-[3fr_2fr] lg:grid-rows-3">
              <article className="relative overflow-hidden rounded-xl bg-zinc-900 p-6 text-white sm:p-8 lg:row-span-3">
                <div className="grid h-full gap-8 sm:grid-cols-[1fr_auto]">
                  <div className="flex flex-col">
                    <LayoutGrid className="h-6 w-6 text-accent-400" strokeWidth={1.75} aria-hidden="true" />
                    <h3 className="mt-4 text-xl font-semibold">A store that looks like your event</h3>
                    <p className="mt-2 max-w-[40ch] leading-relaxed text-zinc-300">
                      Your logo, colors, pages and menus at yourname.eventimus.net, or on a domain you already own.
                    </p>
                  </div>
                  <Image
                    src="/home/storefront-mobile.jpg"
                    alt="The Raleigh Retro Gamers store homepage on a phone, with event and vendor buttons."
                    width={780}
                    height={1688}
                    sizes="(min-width: 640px) 240px, 70vw"
                    className="mx-auto h-auto w-[70%] max-w-[240px] rounded-[1.75rem] ring-4 ring-zinc-800 sm:w-[240px] sm:self-end"
                  />
                </div>
              </article>

              <Feature
                icon={Ticket}
                title="Tickets and RSVPs"
                body="Paid tiers, free RSVPs and add-ons. Buyers see fees and tax before they pay."
                className="bg-accent-300 text-gray-900"
                muted="text-gray-800"
              />
              <Feature
                icon={CalendarCheck}
                title="Vendor and sponsor applications"
                body="Review applications, approve them, and let vendors choose a spot on your floor map and pay."
                className="bg-white ring-1 ring-gray-200 dark:bg-zinc-900 dark:ring-white/10"
                muted="text-gray-600 dark:text-zinc-400"
              />
              <Feature
                icon={ScanLine}
                title="Door check-in"
                body="Scan tickets from a phone at the door. Buyers get tickets by email and in their account."
                className="bg-white ring-1 ring-gray-200 dark:bg-zinc-900 dark:ring-white/10"
                muted="text-gray-600 dark:text-zinc-400"
              />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="flex flex-col items-start justify-between gap-6 border-t border-gray-200 pt-12 dark:border-white/10 md:flex-row md:items-center">
            <h2 className="max-w-[24ch] text-2xl font-semibold tracking-tight sm:text-3xl">
              Set up your store and publish your first event today.
            </h2>
            <Link href="/signup" className={primaryCta}>
              Start selling
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-200 dark:border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-gray-600 dark:text-zinc-400 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} Eventimus</p>
          {LEGAL_PAGES_ENABLED && (
            <nav aria-label="Legal" className="flex gap-6">
              <Link href={LEGAL_PATHS.terms} className="hover:text-gray-900 dark:hover:text-white">
                Terms
              </Link>
              <Link href={LEGAL_PATHS.privacy} className="hover:text-gray-900 dark:hover:text-white">
                Privacy
              </Link>
            </nav>
          )}
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
  className,
  muted,
}: {
  icon: typeof Ticket;
  title: string;
  body: string;
  className: string;
  muted: string;
}) {
  return (
    <article className={`rounded-xl p-6 ${className}`}>
      <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className={`mt-1 leading-relaxed ${muted}`}>{body}</p>
    </article>
  );
}
