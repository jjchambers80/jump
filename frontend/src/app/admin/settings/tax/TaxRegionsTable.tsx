'use client';

// Region | Collecting | Tax service — one row per state the organization has a
// venue in. Each row is a button that opens the edit dialog; focus returns to
// the row on close. Venues without a state cannot be placed in a region and
// are listed separately with links to fix them.

import Link from 'next/link';
import { RefObject } from 'react';
import { BoltIcon, ChevronRightIcon, WarningIcon } from '../icons';
import { formatRate, type TaxRegionRow, type TaxServiceStatus } from './types';

interface TaxRegionsTableProps {
  regions: TaxRegionRow[];
  needsAddress: Array<{ id: string; name: string }>;
  service: TaxServiceStatus;
  rowRefs: Map<string, RefObject<HTMLButtonElement>>;
  onEdit: (region: TaxRegionRow) => void;
}

const cell = 'px-4 py-3 text-sm';

function CollectingCell({ region }: { region: TaxRegionRow }) {
  if (!region.configured) {
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
        <WarningIcon className="h-4 w-4" />
        Not set
      </span>
    );
  }
  if (!region.collecting) return <span className="text-gray-600 dark:text-slate-400">Not collecting</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-green-800 dark:text-green-300">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-500" />
      Collecting
    </span>
  );
}

function ServiceCell({ region, service }: { region: TaxRegionRow; service: TaxServiceStatus }) {
  if (!region.configured || !region.collecting) return <span className="text-gray-400 dark:text-slate-500">—</span>;
  if (region.source === 'MANUAL') {
    return (
      <span className="text-gray-900 dark:text-white">
        Manual · {formatRate(region.manualRate)}
      </span>
    );
  }
  const warn = service.status !== 'active' || !region.registrationFound || Boolean(region.lastError);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="inline-flex items-center gap-1 text-gray-900 dark:text-white">
        <BoltIcon className="h-4 w-4 text-indigo-500" />
        Stripe Tax
      </span>
      {region.lastRate != null && !region.lastError && (
        <span className="text-gray-600 dark:text-slate-400">{formatRate(region.lastRate)}</span>
      )}
      {warn && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <WarningIcon className="h-3.5 w-3.5" />
          {service.status !== 'active' ? 'Stripe Tax inactive' : region.lastError ? 'Lookup failed' : 'No registration'}
        </span>
      )}
    </span>
  );
}

export default function TaxRegionsTable({ regions, needsAddress, service, rowRefs, onEdit }: TaxRegionsTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
      <table className="w-full min-w-[32rem] text-left">
        <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-slate-800/60 dark:text-slate-400">
          <tr>
            <th scope="col" className="px-4 py-2.5">Region</th>
            <th scope="col" className="px-4 py-2.5">Collecting</th>
            <th scope="col" className="px-4 py-2.5">Tax service</th>
            <th scope="col" className="w-10 px-2 py-2.5"><span className="sr-only">Edit</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {regions.length === 0 && needsAddress.length === 0 && (
            <tr>
              <td colSpan={4} className={`${cell} text-gray-600 dark:text-slate-400`}>
                No regions yet. Add a venue with a US state to create one.
              </td>
            </tr>
          )}
          {regions.map((region) => {
            const key = `${region.country}/${region.region}`;
            return (
              <tr key={key} data-testid={`tax-region-${region.region}`} className="group">
                <td className="p-0" colSpan={4}>
                  <button
                    ref={rowRefs.get(key)}
                    type="button"
                    aria-label={`Edit tax region ${region.name}`}
                    onClick={() => onEdit(region)}
                    className="grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_2.5rem] items-center text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/40"
                  >
                    <span className={cell}>
                      <span className="block font-medium text-gray-900 dark:text-white">{region.name}</span>
                      <span className="block text-xs text-gray-600 dark:text-slate-400">
                        {region.venueCount === 1 ? '1 venue' : `${region.venueCount} venues`}
                      </span>
                    </span>
                    <span className={cell}><CollectingCell region={region} /></span>
                    <span className={cell}><ServiceCell region={region} service={service} /></span>
                    <span className="flex justify-center px-2 text-gray-400 dark:text-slate-500"><ChevronRightIcon /></span>
                  </button>
                </td>
              </tr>
            );
          })}
          {needsAddress.length > 0 && (
            <tr data-testid="tax-region-needs-address">
              <td className={cell}>
                <span className="block font-medium text-gray-900 dark:text-white">Needs address</span>
                <span className="block text-xs text-gray-600 dark:text-slate-400">
                  {needsAddress.length === 1 ? '1 venue has' : `${needsAddress.length} venues have`} no state
                </span>
              </td>
              <td className={`${cell} text-gray-600 dark:text-slate-400`} colSpan={3}>
                <span className="block">
                  {needsAddress.map((v) => v.name).join(', ')} collect no tax until a US state is set.{' '}
                  <Link href="/admin/venues" className="font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                    Edit venues
                  </Link>
                </span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
