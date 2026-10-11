import Link from 'next/link';

export interface EventTax {
  rate: number;
  source: 'STRIPE' | 'MANUAL' | null;
  region: string | null;
}

export function formatTaxRate(rate: number): string {
  return `${(rate * 100).toFixed(3).replace(/\.?0+$/, '')}%`;
}

/** "Tax: 8.25% · Stripe Tax · NC" with a link to Settings › Tax. */
export default function EventTaxSummary({ tax, className = 'mt-1 text-xs' }: { tax: EventTax; className?: string }) {
  const parts = [formatTaxRate(tax.rate)];
  if (tax.source === 'STRIPE') parts.push('Stripe Tax');
  else if (tax.source === 'MANUAL') parts.push('Manual rate');
  else parts.push('Not collecting');
  if (tax.region) parts.push(tax.region);
  return (
    <p className={`${className} text-gray-600 dark:text-slate-400`} data-testid="event-tax-summary">
      Tax: {parts.join(' · ')}
      {' · '}
      <Link href="/admin/settings/tax" className="font-medium text-accent-600 hover:underline dark:text-accent-300">
        Settings › Tax
      </Link>
      {!tax.region && ' — set the venue\'s state to collect tax'}
    </p>
  );
}
