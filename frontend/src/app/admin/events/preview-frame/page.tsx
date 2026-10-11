'use client';

// Chrome-less event page for the wizard's preview iframe (spec 050 §8.3).
// Under /admin so the edge middleware guards it like the wizard itself.

import { notFound } from 'next/navigation';
import PreviewFrame from '@/components/event-setup/PreviewFrame';
import { EVENT_WIZARD_ENABLED } from '@/lib/eventWizard';

export default function EventPreviewFramePage() {
  if (!EVENT_WIZARD_ENABLED) notFound();
  return <PreviewFrame />;
}
