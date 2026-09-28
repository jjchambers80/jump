// Spike 038-0: presentational sections. No 'use client', no fetching: they
// read resolved data from props (metadata) and render the same on the
// server (Render from @puckeditor/core/rsc) and inside the editor iframe.
// OrganizationHeader stays a client island (drawer, buyer session).

import type { ReactNode } from 'react';
import EventStub from '@/components/storefront/EventStub';
import OrganizationHeader from '@/components/OrganizationHeader';
import type { EventSummary } from '@/components/EventCard';
import type { PublicMenus } from '@/lib/menus';

export interface SpikeResolved {
  organization: { id: string; slug: string; name: string; logoUrl: string | null };
  events: EventSummary[];
  menus: PublicMenus;
}

const pad = (top = 32, bottom = 32) => ({ paddingTop: top, paddingBottom: bottom });

export function HeaderSection({ resolved, sticky }: { resolved: SpikeResolved; sticky: string }) {
  return (
    <div data-section="Header" data-sticky={sticky}>
      <OrganizationHeader
        organization={resolved.organization}
        organizationSlug={resolved.organization.slug}
        as="link"
        nav
        menus={resolved.menus}
      />
    </div>
  );
}

export function AnnouncementBarSection({ text }: { text: string }) {
  return (
    <div role="region" aria-label="Announcement" className="bg-brand text-brand-fg text-center text-sm py-2 px-4">
      {text}
    </div>
  );
}

export function HeroSection({
  heading,
  subheading,
  paddingTop,
  paddingBottom,
  Blocks,
}: {
  heading: string;
  subheading: string;
  paddingTop: number;
  paddingBottom: number;
  Blocks: (props?: { className?: string }) => ReactNode;
}) {
  return (
    <section aria-labelledby="hero-heading" style={pad(paddingTop, paddingBottom)} className="px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[var(--theme-page-width,1200px)] rounded-[var(--theme-radius,16px)] bg-white/60 dark:bg-slate-800/60 p-10 text-center">
        <h2 id="hero-heading" className="text-4xl font-bold tracking-tight text-gray-900 dark:text-slate-100" style={{ fontFamily: 'var(--theme-heading-font, inherit)' }}>
          {heading}
        </h2>
        {subheading && <p className="mt-3 text-lg text-gray-600 dark:text-slate-300">{subheading}</p>}
        {/* The slot renders its own wrapper; layout classes go on it. */}
        <Blocks className="mt-6 flex flex-wrap justify-center gap-3" />
      </div>
    </section>
  );
}

export function ButtonBlock({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center rounded-[var(--theme-button-radius,9999px)] bg-brand px-5 py-2.5 text-sm font-semibold text-brand-fg hover:bg-brand-hover"
    >
      {label}
    </a>
  );
}

export function RichTextSection({ heading, body }: { heading: string; body: string }) {
  return (
    <section style={pad()} className="px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{heading}</h2>
        <p className="mt-2 text-gray-700 dark:text-slate-300">{body}</p>
      </div>
    </section>
  );
}

export function EventListSection({ resolved, limit }: { resolved: SpikeResolved; limit: number }) {
  const events = resolved.events.slice(0, limit);
  return (
    <section aria-labelledby="events-heading" style={pad()} className="px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[var(--theme-page-width,1200px)]">
        <h2 id="events-heading" className="text-2xl font-bold text-gray-900 dark:text-slate-100">
          Upcoming events
        </h2>
        {events.length === 0 ? (
          <p className="mt-4 text-gray-600 dark:text-slate-400">No upcoming events</p>
        ) : (
          <ul className="mt-6 space-y-4">
            {events.map((event) => (
              <li key={event.id}>
                <EventStub event={event} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function FooterSection({ resolved, copyright }: { resolved: SpikeResolved; copyright: string }) {
  return (
    <footer className="border-t border-gray-200 dark:border-slate-700 px-4 py-8 text-sm text-gray-600 dark:text-slate-400">
      <nav aria-label="Footer">
        <ul className="flex gap-4">
          {resolved.menus.footer.map((item) => (
            <li key={item.id}>
              <a href={item.href ?? '#'}>{item.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="mt-4">{copyright || `© ${resolved.organization.name}`}</p>
    </footer>
  );
}
