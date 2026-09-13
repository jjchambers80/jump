import { STATUS_LABEL, STATUS_STYLE, type DomainStatus } from './types';

/** Shopify-style status pill shared by the Domains list and the setup page. */
export default function StatusPill({ status, className = '' }: { status: DomainStatus; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]} ${className}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
