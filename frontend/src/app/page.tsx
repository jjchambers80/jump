import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ClipboardCheck,
  CreditCard,
  FileText,
  LayoutDashboard,
  MapPin,
  RotateCcw,
  ScanLine,
  Store,
  Ticket,
  Users,
} from 'lucide-react';
import EventimusLogo from '@/components/EventimusLogo';
import { LEGAL_PAGES_ENABLED, LEGAL_PATHS } from '@/lib/legal';

// The Eventimus product homepage. Platform hosts only: on a tenant host
// (custom domain or <slug>.<root> store subdomain) middleware rewrites `/` to
// the store's own homepage before this page is reached. Screenshots in
// public/home are of a real store (Raleigh Retro Gamers) in production.

export const metadata: Metadata = {
  title: 'Eventimus - Tickets and registration for conferences, conventions and events',
  description:
    'Eventimus gives conferences, conventions, expos, markets and festivals a branded store, checkout, exhibitor and speaker applications and door check-in.',
};

// Every claim below must be a shipped feature (docs/wiki/features/eventimus-homepage.md).
const EVENT_TYPES = ['Conferences', 'Conventions', 'Expos', 'Markets', 'Festivals', 'Meetups'];

const EXHIBITOR_STEPS = [
  { icon: FileText, text: 'Vendors, sponsors and speakers apply' },
  { icon: ClipboardCheck, text: 'You review and approve' },
  { icon: MapPin, text: 'Vendors choose a spot on the floor map' },
  { icon: CreditCard, text: 'They pay at checkout' },
];

const BOOTHS: ('taken' | 'open' | 'chosen')[] = [
  'taken', 'taken', 'open', 'taken', 'open', 'taken',
  'open', 'taken', 'taken', 'chosen', 'taken', 'open',
  'taken', 'open', 'taken', 'taken', 'open', 'taken',
];

const EVENT_SIZES = [
  {
    title: 'A first meetup',
    body: 'A free evening for your community. Publish a page on your own store, collect RSVPs and check people in at the door.',
    uses: ['Branded store', 'Free RSVPs', 'Door check-in'],
  },
  {
    title: 'A weekend market or expo',
    body: 'Sell admission, take vendor applications and let approved vendors pick their booth on your floor map.',
    uses: ['Ticket tiers', 'Vendor applications', 'Floor map'],
  },
  {
    title: 'A multi-day convention',
    body: 'Several ticket tiers and add-ons, speaker, sponsor and press applications, a special guests lineup and a team with roles.',
    uses: ['Add-ons', 'Registration forms', 'Special guests', 'Staff roles'],
  },
];

const CHECKOUT_POINTS = [
  { title: 'All-in prices', body: 'Buyers see fees and tax before they pay. No surprises at the last step.' },
  { title: 'Stripe checkout', body: 'Buyers pay through Stripe checkout, and every payment is confirmed by Stripe before an order counts.' },
  { title: 'Never oversold', body: 'Every ticket tier holds its own capacity, so two buyers can never get the last seat.' },
];

const STEPS = [
  { title: 'Create your store', body: 'Add your logo and colors and pick your store address.' },
  { title: 'Set up your event', body: 'Add the date and venue, then tickets, RSVPs or a registration form.' },
  { title: 'Publish and sell', body: 'Share the link, take payments and check people in at the door.' },
];

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

      {/* `dark` pins every band to the dark look (and the CTAs to their dark
          variants) whatever the visitor's theme; header and footer still follow it. */}
      <main className="dark bg-zinc-950 text-white">
        <section className="mx-auto max-w-7xl px-4 pb-16 pt-12 sm:px-6 lg:pb-24 lg:pt-20">
          <h1 className="max-w-[18ch] text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
            Your conference, convention or market, <span className="text-accent-300">sold out</span> from one store.
          </h1>
          <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-zinc-300">
            Tickets, registrations, exhibitor applications and door check-in for events of every size, under your own name.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={primaryCta}>
              Start selling
            </Link>
            <Link href="/events" className={secondaryCta}>
              Browse events
            </Link>
          </div>
          <div className="mt-12 overflow-hidden rounded-xl bg-zinc-900 shadow-2xl shadow-black/40 ring-1 ring-white/10 lg:mt-16">
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
              sizes="(min-width: 1280px) 1232px, 100vw"
              className="h-auto w-full"
            />
          </div>
        </section>

        <section aria-labelledby="types-heading" className="border-y border-white/10 py-12 lg:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <h2 id="types-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Sell wherever your crowd gathers.
            </h2>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-xl font-medium text-zinc-400 sm:text-3xl">
              {EVENT_TYPES.map((type) => (
                <li key={type} className="group flex items-center gap-6">
                  {type}
                  <span className="h-2 w-2 rounded-full bg-accent-300 group-last:hidden" aria-hidden="true" />
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="run-heading" className="py-16 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <h2 id="run-heading" className="max-w-[20ch] text-3xl font-semibold tracking-tight sm:text-5xl">
              One place to run it.
            </h2>
            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              <article className="rounded-xl bg-zinc-900 p-6 ring-1 ring-white/10 sm:p-8 lg:row-span-2">
                <Store className="h-6 w-6 text-accent-300" strokeWidth={1.75} aria-hidden="true" />
                <h3 className="mt-4 text-xl font-semibold">Your branded store</h3>
                <p className="mt-2 leading-relaxed text-zinc-400">
                  Your logo, colors, pages and menus at yourname.eventimus.net, or on a domain you already own.
                </p>
                <Image
                  src="/home/storefront-mobile.jpg"
                  alt="The Raleigh Retro Gamers store homepage on a phone, with event and vendor buttons."
                  width={780}
                  height={1688}
                  sizes="240px"
                  className="mx-auto mt-8 h-auto w-2/3 max-w-[240px] rounded-[1.75rem] ring-4 ring-zinc-800"
                />
              </article>
              <article className="grid gap-6 rounded-xl bg-accent-300 p-6 text-gray-900 sm:grid-cols-2 sm:p-8 lg:col-span-2">
                <div>
                  <Ticket className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
                  <h3 className="mt-3 text-lg font-semibold">Tickets, RSVPs and registrations</h3>
                  <p className="mt-1 leading-relaxed text-gray-800">
                    Paid ticket tiers, free RSVPs and add-ons, or a registration form for speakers, sponsors and press.
                  </p>
                </div>
                {/* What a buyer can pick, drawn in markup. */}
                <ul className="space-y-2 self-end" aria-hidden="true">
                  {['General admission', 'Free RSVP', 'Speaker registration'].map((label) => (
                    <li key={label} className="flex items-center justify-between rounded-lg bg-gray-900/90 px-4 py-3 text-sm font-medium text-white">
                      {label}
                      <span className="h-2 w-2 rounded-full bg-accent-300" />
                    </li>
                  ))}
                </ul>
              </article>
              <Feature
                icon={LayoutDashboard}
                title="One admin for everything"
                body="Orders, contacts and reports in one place. Import and export contact lists as CSV."
                className="bg-zinc-900 ring-1 ring-white/10 lg:col-span-2"
                muted="text-zinc-400"
              />
            </div>
          </div>
        </section>

        <section aria-labelledby="exhibitors-heading" className="bg-zinc-900 py-16 lg:py-24">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 id="exhibitors-heading" className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-5xl">
                Fill your exhibit hall.
              </h2>
              <p className="mt-6 max-w-[48ch] text-lg leading-relaxed text-zinc-300">
                Open applications for vendors, sponsors and speakers. Review and approve them, then approved vendors choose a spot on
                your floor map and pay.
              </p>
              <ol className="mt-8 space-y-4">
                {EXHIBITOR_STEPS.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-3 text-zinc-200">
                    <Icon className="h-5 w-5 shrink-0 text-accent-300" strokeWidth={1.75} aria-hidden="true" />
                    {text}
                  </li>
                ))}
              </ol>
            </div>
            {/* A floor map drawn in markup: taken booths, open booths, one being chosen. */}
            <div className="rounded-xl bg-zinc-950 p-4 ring-1 ring-white/10 sm:p-6" aria-hidden="true">
              <div className="grid grid-cols-6 gap-2">
                {BOOTHS.map((state, i) => (
                  <div
                    key={i}
                    className={`flex aspect-square items-center justify-center rounded-md ${
                      state === 'chosen'
                        ? 'bg-accent-300 text-gray-900'
                        : state === 'taken'
                          ? 'bg-zinc-700'
                          : 'ring-1 ring-inset ring-white/20'
                    }`}
                  >
                    {state === 'chosen' && <MapPin className="h-1/2 w-1/2" strokeWidth={2} />}
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-md border border-dashed border-white/20 py-3 text-center text-xs uppercase tracking-widest text-zinc-500">
                Entrance
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="sizes-heading" className="py-16 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <h2 id="sizes-heading" className="max-w-[22ch] text-3xl font-semibold tracking-tight sm:text-5xl">
              From first meetup to multi-day convention.
            </h2>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {EVENT_SIZES.map(({ title, body, uses }) => (
                <article key={title} className="flex flex-col rounded-xl bg-zinc-900 p-6 ring-1 ring-white/10 sm:p-8">
                  <h3 className="text-xl font-semibold">{title}</h3>
                  <p className="mt-2 leading-relaxed text-zinc-400">{body}</p>
                  <ul className="mt-6 flex flex-wrap gap-2">
                    {uses.map((use) => (
                      <li key={use} className="rounded-full bg-white/5 px-3 py-1 text-sm text-accent-300 ring-1 ring-inset ring-white/10">
                        {use}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="checkout-heading" className="border-t border-white/10 py-16 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <h2 id="checkout-heading" className="max-w-[20ch] text-3xl font-semibold tracking-tight sm:text-5xl">
              A checkout buyers trust.
            </h2>
            <div className="mt-10 grid gap-10 md:grid-cols-3">
              {CHECKOUT_POINTS.map(({ title, body }) => (
                <div key={title} className="border-t border-accent-300 pt-6">
                  <h3 className="text-3xl font-semibold tracking-tight text-accent-300 sm:text-4xl">{title}</h3>
                  <p className="mt-3 leading-relaxed text-zinc-300">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="back-heading" className="bg-zinc-900 py-16 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <h2 id="back-heading" className="text-3xl font-semibold tracking-tight sm:text-5xl">
              We&apos;ve got your back.
            </h2>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <Feature
                icon={ScanLine}
                title="Door check-in by phone"
                body="Scan tickets from a phone at the door. Buyers get their tickets by email and in their account."
                className="bg-zinc-950 ring-1 ring-white/10"
                muted="text-zinc-400"
              />
              <Feature
                icon={RotateCcw}
                title="Refunds handled"
                body="Refund an order in a few clicks. Cancel an event and every paid ticket and vendor order is refunded for you."
                className="bg-zinc-950 ring-1 ring-white/10"
                muted="text-zinc-400"
              />
              <Feature
                icon={Users}
                title="Staff roles"
                body="Add your team with the role they need, so each person sees only what their job calls for."
                className="bg-zinc-950 ring-1 ring-white/10"
                muted="text-zinc-400"
              />
            </div>
          </div>
        </section>

        <section aria-labelledby="steps-heading" className="py-16 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <h2 id="steps-heading" className="text-3xl font-semibold tracking-tight sm:text-5xl">
              Start selling in three steps.
            </h2>
            <ol className="mt-10 grid gap-10 md:grid-cols-3">
              {STEPS.map(({ title, body }, i) => (
                <li key={title}>
                  <span className="text-5xl font-semibold text-accent-300 sm:text-6xl" aria-hidden="true">
                    0{i + 1}
                  </span>
                  <h3 className="mt-4 text-xl font-semibold">{title}</h3>
                  <p className="mt-2 leading-relaxed text-zinc-400">{body}</p>
                </li>
              ))}
            </ol>
            <Link href="/signup" className={`${primaryCta} mt-12`}>
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
