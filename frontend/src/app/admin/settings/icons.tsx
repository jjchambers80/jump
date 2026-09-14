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

export function GlobeIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="10" cy="10" r="7" />
      <path d="M3 10h14M10 3c2.2 2.3 2.2 11.7 0 14M10 3c-2.2 2.3-2.2 11.7 0 14" />
    </svg>
  );
}

export function DomainIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4.5" width="14" height="11" rx="1.5" />
      <path d="M3 8h14M6 6.3h.01M8.2 6.3h.01" />
      <path d="m11 11.2 2.2 5 0.8-2.2 2.2-0.8Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ExternalLinkIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5" />
    </svg>
  );
}

export function CheckCircleIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="10" cy="10" r="7" />
      <path d="m6.8 10.2 2.1 2.1 4.3-4.6" />
    </svg>
  );
}

export function CircleDashedIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2.4 2.4" className={className}>
      <circle cx="10" cy="10" r="7" />
    </svg>
  );
}

export function ArrowRightIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  );
}

export function TrashIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6M8.5 9v4M11.5 9v4" />
    </svg>
  );
}

export function ChevronDownIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m5 7.5 5 5 5-5" />
    </svg>
  );
}

export function UsersIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="7.5" cy="6.5" r="2.75" />
      <path d="M2.5 16.5v-1a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v1" />
      <path d="M13 4.3a2.75 2.75 0 0 1 0 4.4M14.5 11.6a4 4 0 0 1 3 3.9v1" />
    </svg>
  );
}

/** Receipt with a percent sign — Settings › Tax. */
export function TaxIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 2.5h10v15l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5v-15z" />
      <path d="M7.5 12.5l5-5" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  );
}

/** Lightning bolt — automatic (Stripe Tax) source. */
export function BoltIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M11 2.5 4.5 11H10l-1 6.5L15.5 9H10l1-6.5z" />
    </svg>
  );
}

/** Triangle warning glyph. */
export function WarningIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 3 2.5 16h15L10 3z" />
      <path d="M10 8v4M10 14.2v.3" />
    </svg>
  );
}
