'use client';

// Chrome-less event page for the wizard's preview iframe (spec 050 §8.3).
// Under /admin so the edge middleware guards it like the wizard itself.

import PreviewFrame from '@/components/event-setup/PreviewFrame';

export default function EventPreviewFramePage() {
  return <PreviewFrame />;
}
