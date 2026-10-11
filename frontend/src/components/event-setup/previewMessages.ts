// Wizard ↔ preview frame messages (spec 050 §8.3). Same origin only, checked
// both ways: the frame answers only its parent, the wizard only its iframe.
// The wizard sends the overlay of unsaved values; the frame loads the saved
// event itself (GET …/preview-payload) and lays the overlay on top.

import type { EventPageEvent, EventVenue } from '@/app/events/[eventId]/eventPage';

export const PREVIEW_MESSAGE = 'jump:event-preview';
export const PREVIEW_READY = 'jump:event-preview-ready';

/** Unsaved form values the preview shows before they reach the server. */
export interface PreviewOverlay {
  name?: string;
  date?: string | null;
  endDate?: string | null;
  venue?: EventVenue | null;
}

export interface PreviewMessage {
  type: typeof PREVIEW_MESSAGE;
  orgId: string;
  /** Null before step 3 creates the row: the frame builds the event from the overlay. */
  eventId: string | null;
  overlay: PreviewOverlay;
  /** Bumped after each save: the frame reloads the saved event. */
  revision: number;
  /** Element id to scroll to; the frame falls back to #event-hero. */
  anchor: string;
}

export function isPreviewMessage(data: unknown): data is PreviewMessage {
  return !!data && typeof data === 'object' && (data as { type?: unknown }).type === PREVIEW_MESSAGE;
}

/** Only messages from this origin and the expected window count. */
export const trustedMessage = (event: MessageEvent, source: MessageEventSource | null | undefined) =>
  event.origin === window.location.origin && !!source && event.source === source;

/** The event before the row exists: blank, so the view shows its placeholders. */
export function blankPreviewEvent(): EventPageEvent {
  return {
    id: 'preview',
    name: '',
    description: null,
    logoUrl: null,
    date: null,
    endDate: null,
    capacity: null,
    status: 'DRAFT',
    admissionMode: 'TICKETED',
    taxRate: 0,
    venue: null,
    priceTiers: [],
  };
}

/** Saved event + overlay; keys the overlay leaves out keep the saved value. */
export function applyOverlay(base: EventPageEvent, overlay: PreviewOverlay): EventPageEvent {
  const defined = Object.fromEntries(Object.entries(overlay).filter(([, value]) => value !== undefined));
  return { ...base, ...defined };
}
