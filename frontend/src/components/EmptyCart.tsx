import { Tickets } from 'lucide-react';

interface EmptyCartProps {
  className?: string;
}

// Placeholder shown in the Order Summary card and the mobile cart drawer
// while nothing is selected.
export default function EmptyCart({ className = '' }: EmptyCartProps) {
  return (
    <div
      className={`flex flex-col items-center text-center py-8 ${className}`}
      data-testid="cart-empty"
    >
      <Tickets aria-hidden="true" strokeWidth={1.75} className="w-16 h-16 text-gray-300 dark:text-slate-600 mb-4" />
      <p className="text-sm text-gray-500 dark:text-slate-400">Select tickets to begin your order.</p>
    </div>
  );
}
