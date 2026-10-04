'use client';

// Event › Edit details (spec 037 phase 3): name, URL, description, media,
// date & venue, listing.
import EventEditor from '../EventEditor';

export default function EditEventDetailsPage() {
  return <EventEditor scope="details" />;
}
