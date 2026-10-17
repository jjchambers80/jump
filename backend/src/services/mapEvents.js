// Spec 057: a floor map (and the special guest lineup) belongs to a LIVE event,
// and the registration events linked to it sell its spaces and fill its lineup.
// These two lookups are the only place that knows; map, booth and lineup code
// goes through them instead of comparing eventIds.

import { prisma } from '@jump/db';

/** The event whose map an event's forms and applications use: the linked live event of a registration event, else itself. */
export async function mapEventIdFor(eventId, tx = prisma) {
  if (!eventId) return eventId;
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { type: true, linkedEventId: true } });
  return event?.type === 'REGISTRATION' && event.linkedEventId ? event.linkedEventId : eventId;
}

/** Every event whose forms and applications use the map of `mapEventId`: itself and the registration events linked to it. */
export async function eventIdsForMap(mapEventId, tx = prisma) {
  const linked = await tx.event.findMany({ where: { linkedEventId: mapEventId, type: 'REGISTRATION' }, select: { id: true } });
  return [mapEventId, ...linked.map((e) => e.id)];
}
