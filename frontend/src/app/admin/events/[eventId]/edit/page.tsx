'use client';

// /admin/events/:id/edit predates the section editors (spec 037 phase 3).
// Old links carry a section hash; send each to the editor that owns it,
// keeping the query (orgId, imageUpload) and the hash.

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

const SALES_SECTIONS = new Set(['event-admission', 'event-price-tiers', 'event-add-ons']);

export default function EditEventRedirect() {
  const router = useRouter();
  const params = useParams();
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const target = SALES_SECTIONS.has(hash) ? 'sales' : 'details';
    router.replace(`/admin/events/${params.eventId}/edit/${target}${window.location.search}${window.location.hash}`);
  }, [router, params.eventId]);
  return null;
}
