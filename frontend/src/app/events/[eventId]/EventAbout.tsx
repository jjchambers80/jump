// "About this event": the organizer's description, rendered only through
// ContentHtml (sanitised on write, gotcha 20). Inline on RSVP pages; ticketed
// pages open it in a dialog instead, except in preview mode, which has no
// dialogs and shows it here (spec 050 §8.2).

import ContentHtml from '@/components/storefront/ContentHtml';
import Placeholder from './Placeholder';

export default function EventAbout({ description, className = '' }: { description?: string | null; className?: string }) {
  return (
    <section id="about" aria-labelledby="about-heading" className={`min-w-0 scroll-mt-6 ${className}`}>
      <h2 id="about-heading" className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400">
        About this event
      </h2>
      {description ? (
        <ContentHtml html={description} className="text-base" />
      ) : (
        <p className="text-base">
          <Placeholder>Add a description</Placeholder>
        </p>
      )}
    </section>
  );
}
