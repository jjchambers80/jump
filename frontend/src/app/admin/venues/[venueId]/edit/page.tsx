'use client';

// Admin › Venues › :venue › Edit — the only place a venue is changed.
import { useParams } from 'next/navigation';
import VenueEditor from '../../VenueEditor';

export default function EditVenuePage() {
  const { venueId } = useParams<{ venueId: string }>();
  return <VenueEditor venueId={venueId} />;
}
