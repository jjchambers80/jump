// Theme EventsHero section (spec 038 §7): today's cover with the "Next up"
// band. Image defaults to the organization cover.

import EventsCover from '@/components/storefront/EventsCover';
import SectionShell from './SectionShell';
import { t, type SectionContext } from './context';

export interface EventsHeroProps {
  image?: { fileId: string; alt?: string; decorative?: boolean } | null;
  showNextEvent?: boolean;
  height?: 'small' | 'medium' | 'large';
  colorScheme?: string;
  paddingTop?: number;
  sectionWidth?: string;
  paddingBottom?: number;
  ctx: SectionContext;
}

export default function EventsHeroSection({ image, showNextEvent = true, height = 'medium', ctx, ...common }: EventsHeroProps) {
  const file = image?.fileId ? ctx.resolved.files[image.fileId] : null;
  return (
    <SectionShell type="EventsHero" props={common}>
      <EventsCover
        organization={ctx.organization}
        events={ctx.resolved.events}
        imageUrl={file?.url ?? null}
        imageAlt={file ? (image?.decorative ? '' : (image?.alt ?? file.alt ?? '')) : null}
        showNextEvent={showNextEvent}
        height={height}
        labels={{ getTickets: t(ctx, 'event.getTickets'), rsvp: t(ctx, 'event.rsvp') }}
      />
    </SectionShell>
  );
}
