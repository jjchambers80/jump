// Small inline icons for the Settings summary rows. Decorative only — every
// row carries its own accessible name.

interface IconProps {
  className?: string;
}

export function StoreIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 8.5 4.2 4.5h11.6L17 8.5" />
      <path d="M3 8.5a2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.7 0 2.3 2.3 0 0 0 4.7 0" />
      <path d="M4.2 10.5v5h11.6v-5" />
      <path d="M8 15.5v-3.5h4v3.5" />
    </svg>
  );
}

export function MapPinIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 17s-5.5-4.6-5.5-8.8a5.5 5.5 0 0 1 11 0C15.5 12.4 10 17 10 17Z" />
      <circle cx="10" cy="8.2" r="2" />
    </svg>
  );
}

export function ChevronRightIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m7.5 5 5 5-5 5" />
    </svg>
  );
}

export function EllipsisIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <circle cx="5" cy="10" r="1.4" />
      <circle cx="10" cy="10" r="1.4" />
      <circle cx="15" cy="10" r="1.4" />
    </svg>
  );
}
