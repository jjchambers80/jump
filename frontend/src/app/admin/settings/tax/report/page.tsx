// Settings › Tax › Collected tax report (spec 009 phase 3)
// Tax collected per region for orders placed in a date range, for remittance.
// Refunded tax is an estimate (refund ÷ order total × order tax): refunds do
// not store a tax split.
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import { formatPrice } from '@/lib/fees';
import SettingsNav from '../../SettingsNav';
import { TaxIcon } from '../../icons';
import { describeError, useTaxApi } from '../useTaxApi';
import { reportToCsv, type TaxReport } from '../types';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const inputClass =
  'rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white';
const secondaryBtn =
  'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
const primaryBtn =
  'rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50';
const num = 'px-4 py-3 text-right text-sm tabular-nums';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function TaxReportPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const taxApi = useTaxApi();
  const today = new Date();
  const [from, setFrom] = useState(`${today.getUTCFullYear()}-01-01`);
  const [to, setTo] = useState(isoDate(today));
  const [report, setReport] = useState<TaxReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (f: string, t: string) => {
      setLoading(true);
      setError(null);
      try {
        setReport(await taxApi.report(f, t));
      } catch (err) {
        setReport(null);
        setError(describeError(err, 'Could not load the tax report'));
      } finally {
        setLoading(false);
      }
    },
    [taxApi]
  );

  const loadedForOrg = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (orgLoading && !selectedOrgId) return;
    if (loadedForOrg.current === selectedOrgId) return;
    loadedForOrg.current = selectedOrgId;
    load(from, to);
    // Initial load per org; the form drives later loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgLoading, selectedOrgId, load]);

  const download = () => {
    if (!report) return;
    const blob = new Blob([reportToCsv(report)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tax-collected-${report.from.slice(0, 10)}_${report.to.slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const rangeInvalid = from > to;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="tax-report-heading" className="min-w-0 flex-1 space-y-6">
          <nav aria-label="Breadcrumb" className="text-sm text-gray-600 dark:text-slate-400">
            <Link href="/admin/settings/tax" className="font-medium text-indigo-600 hover:underline dark:text-indigo-300">
              Tax
            </Link>
            <span aria-hidden="true"> › </span>
            <span>Collected tax report</span>
          </nav>
          <h2 id="tax-report-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <TaxIcon className="h-5 w-5 text-gray-500 dark:text-slate-400" />
            Collected tax report
          </h2>

          <div className={cardClass}>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!rangeInvalid) load(from, to);
              }}
            >
              <label className="text-sm">
                <span className="block font-medium text-gray-900 dark:text-white">From</span>
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={`mt-1 ${inputClass}`} />
              </label>
              <label className="text-sm">
                <span className="block font-medium text-gray-900 dark:text-white">To</span>
                <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={`mt-1 ${inputClass}`} />
              </label>
              <button type="submit" className={primaryBtn} disabled={loading || rangeInvalid}>
                {loading ? 'Loading…' : 'Run report'}
              </button>
              <button type="button" className={secondaryBtn} onClick={download} disabled={!report || loading}>
                Download CSV
              </button>
            </form>
            {rangeInvalid && (
              <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
                From must be on or before To.
              </p>
            )}
            {error && (
              <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {error}
              </p>
            )}

            <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="w-full min-w-[40rem] text-left" data-testid="tax-report-table">
                <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Region</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Orders</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Taxable sales</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Tax collected</th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      Tax refunded <span className="font-normal normal-case">(est.)</span>
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">Tax net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {report && report.rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">
                        No completed orders in this range.
                      </td>
                    </tr>
                  )}
                  {report?.rows.map((r) => (
                    <tr key={r.region ?? 'none'} data-testid={`tax-report-${r.region ?? 'none'}`}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{r.name}</td>
                      <td className={`${num} text-gray-900 dark:text-white`}>{r.orders}</td>
                      <td className={`${num} text-gray-900 dark:text-white`}>{formatPrice(r.taxableSales)}</td>
                      <td className={`${num} text-gray-900 dark:text-white`}>{formatPrice(r.taxCollected)}</td>
                      <td className={`${num} text-gray-600 dark:text-slate-400`}>{formatPrice(r.taxRefunded)}</td>
                      <td className={`${num} font-medium text-gray-900 dark:text-white`}>{formatPrice(r.taxNet)}</td>
                    </tr>
                  ))}
                </tbody>
                {report && report.rows.length > 0 && (
                  <tfoot className="bg-gray-50 dark:bg-slate-800/60">
                    <tr data-testid="tax-report-totals">
                      <th scope="row" className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">Total</th>
                      <td className={`${num} font-semibold text-gray-900 dark:text-white`}>{report.totals.orders}</td>
                      <td className={`${num} font-semibold text-gray-900 dark:text-white`}>{formatPrice(report.totals.taxableSales)}</td>
                      <td className={`${num} font-semibold text-gray-900 dark:text-white`}>{formatPrice(report.totals.taxCollected)}</td>
                      <td className={`${num} font-semibold text-gray-600 dark:text-slate-400`}>{formatPrice(report.totals.taxRefunded)}</td>
                      <td className={`${num} font-semibold text-gray-900 dark:text-white`}>{formatPrice(report.totals.taxNet)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="mt-3 text-xs text-gray-600 dark:text-slate-400">
              Orders are counted by the date they were placed. Refunded tax is estimated in proportion to the refunded amount because refunds
              are not itemised by tax. Taxable sales is the ticket base price before fees and tax.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
