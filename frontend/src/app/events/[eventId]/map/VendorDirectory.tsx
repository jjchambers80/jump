'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, MapPin, Search, Store } from 'lucide-react';
import { resolveAssetUrl } from '@/lib/assets';
import type { PublicMapVendor } from '@/services/api';

interface VendorDirectoryProps {
  vendors: PublicMapVendor[];
  onSelectBooth: (boothId: string) => void;
  boothHref: (boothId: string) => string;
}

function websiteLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'Visit website';
  }
}

export default function VendorDirectory({ vendors, onSelectBooth, boothHref }: VendorDirectoryProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');

  const categories = useMemo(
    () => [...new Set(vendors.map((vendor) => vendor.category))].sort((a, b) => a.localeCompare(b)),
    [vendors]
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return [...vendors]
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .filter((vendor) => !category || vendor.category === category)
      .filter((vendor) => {
        if (!needle) return true;
        return [vendor.name, vendor.description, vendor.category, vendor.tier?.name, vendor.booth?.label]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(needle));
      });
  }, [category, query, vendors]);

  return (
    <section className="mt-12 scroll-mt-4" aria-labelledby="vendor-directory-heading" data-testid="vendor-directory">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="vendor-directory-heading" className="text-2xl font-bold text-gray-900 dark:text-slate-100">Vendor directory</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Find an exhibitor and locate their booth on the map.</p>
        </div>
        <span className="text-sm text-gray-600 dark:text-slate-400">{vendors.length} {vendors.length === 1 ? 'vendor' : 'vendors'}</span>
      </div>

      {vendors.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-800">
          <Store className="mx-auto h-8 w-8 text-gray-400 dark:text-slate-500" aria-hidden />
          <p className="mt-3 font-medium text-gray-900 dark:text-slate-100">Vendor directory coming soon</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Approved vendors will appear here when their profiles are published.</p>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <label className="relative block">
              <span className="sr-only">Search vendors</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500 dark:text-slate-400" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search vendors, categories or booths"
                className="h-11 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3 text-base text-gray-900 placeholder:text-gray-500 dark:placeholder:text-slate-400 sm:text-sm focus:border-brand-link focus:outline-none focus:ring-2 focus:ring-brand-link dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>
            <label>
              <span className="sr-only">Filter by category</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-base text-gray-900 sm:text-sm focus:border-brand-link focus:outline-none focus:ring-2 focus:ring-brand-link dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="">All categories</option>
                {categories.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>

          {visible.length === 0 ? (
            <p className="mt-4 rounded-xl border border-gray-200 bg-white px-6 py-8 text-center text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400" role="status">
              No vendors match your search.
            </p>
          ) : (
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((vendor) => (
                <li key={vendor.id} className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex min-h-32 items-center justify-center bg-gray-100 dark:bg-slate-700">
                    {vendor.imageUrl ? (
                      <img src={resolveAssetUrl(vendor.imageUrl) ?? undefined} alt="" className="h-32 w-full object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-2xl font-bold text-brand-fg" aria-hidden>
                        {vendor.name.slice(0, 1).toLocaleUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-link">{vendor.category}</p>
                    <h3 className="mt-1 break-words text-lg font-semibold text-gray-900 dark:text-slate-100">{vendor.name}</h3>
                    {vendor.description && <p className="mt-2 line-clamp-3 text-sm text-gray-600 dark:text-slate-400">{vendor.description}</p>}
                    {Object.keys(vendor.socials).length > 0 && (
                      <p className="mt-2 break-words text-xs text-gray-600 dark:text-slate-400">
                        {Object.entries(vendor.socials).map(([network, value]) => `${network}: ${value}`).join(' · ')}
                      </p>
                    )}
                    <div className="mt-auto flex flex-wrap items-center gap-x-4 pt-3 text-sm">
                      {vendor.booth ? (
                        <a
                          href={boothHref(vendor.booth.id)}
                          onClick={(event) => {
                            event.preventDefault();
                            onSelectBooth(vendor.booth!.id);
                          }}
                          className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded font-semibold text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link"
                        >
                          <MapPin className="h-4 w-4" aria-hidden /> View booth {vendor.booth.label}
                        </a>
                      ) : (
                        <span className="inline-flex min-h-[2.75rem] items-center text-gray-600 dark:text-slate-400">Booth to be announced</span>
                      )}
                      {vendor.website && (
                        <a href={vendor.website} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[2.75rem] items-center gap-1 rounded font-semibold text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link">
                          {websiteLabel(vendor.website)} <ExternalLink className="h-3.5 w-3.5" aria-hidden /><span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
