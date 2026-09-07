import Link from 'next/link';

export interface EventVenue {
  id: string;
  name: string;
  address: string;
}

export interface PriceRange {
  min: number;
  max: number;
}

export interface EventSummary {
  id: string;
  name: string;
  date: string;
  venue: EventVenue;
  category?: string | null;
  status: string;
  priceRange: PriceRange | null;
  availableTickets: number;
}

export function formatPrice(dollars: number): string {
  return `$${Number(dollars).toFixed(2)}`;
}

export default function EventCard({ event }: { event: EventSummary }) {
  const eventDate = new Date(event.date);
  const formattedDate = eventDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = eventDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const isSoldOut = event.availableTickets === 0;
  const isAlmostSoldOut = event.availableTickets > 0 && event.availableTickets <= 10;

  return (
    <Link
      href={`/events/${event.id}`}
      data-testid={`event-card-${event.id}`}
      className="block bg-white dark:bg-slate-800 rounded-lg shadow-md dark:shadow-lg dark:shadow-black/20 hover:shadow-xl dark:hover:shadow-xl dark:hover:shadow-black/30 transition-shadow duration-300 overflow-hidden"
    >
      <div className="p-6">
        <h3
          data-testid={`event-card-name-${event.id}`}
          className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2"
        >
          {event.name}
        </h3>

        {event.category && (
          <span className="inline-block bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 text-xs font-medium px-2.5 py-0.5 rounded mb-2">
            {event.category}
          </span>
        )}

        <div className="flex items-center text-gray-600 dark:text-slate-400 mb-2">
          <svg className="w-5 h-5 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-sm">{formattedDate} at {formattedTime}</span>
        </div>

        <div className="flex items-center text-gray-600 dark:text-slate-400 mb-4">
          <svg className="w-5 h-5 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm">{event.venue?.name || 'TBA'}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center">
            {event.priceRange ? (
              <>
                <span className="text-3xl font-bold text-blue-600 dark:text-indigo-400">
                  {formatPrice(event.priceRange.min)}
                </span>
                {event.priceRange.min !== event.priceRange.max && (
                  <span className="text-gray-500 dark:text-slate-400 ml-1">
                    – {formatPrice(event.priceRange.max)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-gray-500 dark:text-slate-400 text-sm">No tiers available</span>
            )}
          </div>

          <div className="text-right">
            {isSoldOut ? (
              <span className="bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 px-3 py-1 rounded-full text-sm font-semibold">Sold Out</span>
            ) : isAlmostSoldOut ? (
              <span className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 px-3 py-1 rounded-full text-sm font-semibold">Almost Sold Out</span>
            ) : (
              <span className="text-green-700 dark:text-green-400 text-sm font-semibold">
                {event.availableTickets} tickets available
              </span>
            )}
          </div>
        </div>

        {!isSoldOut && (
          <div className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-center text-white font-bold py-2 px-4 rounded transition-colors duration-200">
            View Details &amp; Purchase
          </div>
        )}
      </div>
    </Link>
  );
}
