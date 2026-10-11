'use client';

// One event add-on in the Add-ons list: what it costs, what sold, which tiers
// it rides on, and (with addOns.manage) reorder, edit, activate and delete.
// Presentation only; AddOnsSection owns the calls.

import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { formatPrice } from '@/lib/fees';
import { addOnAllInPrice, type AdminAddOn } from '@/lib/addOns';
import type { TierOption } from './addOnDraft';

const SCOPE_LABEL: Record<AdminAddOn['scope'], string> = { TICKET: 'Tickets', APPLICATION: 'Applications', BOTH: 'Tickets & applications' };
// 44 px targets below sm (WCAG 2.5.5), compact on desktop.
const action = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-30 sm:min-h-8 sm:min-w-8';

interface Props {
  addOn: AdminAddOn;
  priceTiers: TierOption[];
  taxRate: number;
  taxInclusive: boolean;
  canEdit: boolean;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onRemove: () => void;
}

export default function AddOnRow({ addOn: a, priceTiers, taxRate, taxInclusive, canEdit, first, last, busy, onMove, onEdit, onToggleActive, onRemove }: Props) {
  const remaining = a.quantityTotal == null ? null : a.quantityTotal - a.quantitySold - a.quantityReserved;
  const allIn = addOnAllInPrice(a, taxRate, taxInclusive);
  const tiers = a.allTiers
    ? 'all tiers'
    : a.priceTierIds.length > 0
      ? `tiers: ${a.priceTierIds.map((id) => priceTiers.find((t) => t.id === id)?.name ?? '?').join(', ')}`
      : 'no ticket tiers attached';

  return (
    <li
      data-testid={`admin-add-on-${a.id}`}
      // Inactive: a quieter surface and the "Inactive" label, never opacity (text keeps 4.5:1).
      className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between ${a.isActive ? 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800' : 'border-dashed border-gray-300 bg-gray-50 dark:border-slate-600 dark:bg-slate-900'}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`font-medium ${a.isActive ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-slate-300'}`}>{a.name}</p>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-slate-700 dark:text-slate-300">{SCOPE_LABEL[a.scope]}</span>
          {!a.isActive && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-300">Inactive</span>}
          {!a.taxable && <span className="text-xs text-gray-600 dark:text-slate-400">untaxed</span>}
        </div>
        <p className="mt-0.5 text-sm text-gray-700 dark:text-slate-300">
          {formatPrice(a.price)}
          {a.scope !== 'APPLICATION' && <span className="text-gray-600 dark:text-slate-400"> · buyer pays {formatPrice(allIn.total)} with tickets</span>}
          {a.maxPerOrder && <span className="text-gray-600 dark:text-slate-400"> · max {a.maxPerOrder} per order</span>}
        </p>
        <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">
          Sold {a.quantitySold}
          {a.quantityReserved > 0 && <> · reserved {a.quantityReserved}</>}
          {remaining !== null ? <> · {remaining} left of {a.quantityTotal}</> : <> · unlimited</>}
          {' · '}
          {tiers}
        </p>
      </div>
      {canEdit && (
        <div className="-ml-2 flex shrink-0 flex-wrap items-center gap-1 sm:ml-0">
          <button type="button" onClick={() => onMove(-1)} disabled={first || busy} className={`${action} text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700`} aria-label={`Move ${a.name} up`}>
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={last || busy} className={`${action} text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700`} aria-label={`Move ${a.name} down`}>
            <ArrowDown className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={onEdit} className={`${action} text-accent-700 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-900/20`}>Edit</button>
          <button type="button" onClick={onToggleActive} disabled={busy} className={`${action} text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700`}>
            {a.isActive ? 'Deactivate' : 'Activate'}
          </button>
          {a.orderLineCount === 0 && (
            <button type="button" onClick={onRemove} disabled={busy} className={`${action} text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20`}>Delete</button>
          )}
        </div>
      )}
    </li>
  );
}
