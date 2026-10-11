// Settings › Policies (spec 052)
// Written policies: seven buyer-facing pages each store may publish. Each row
// opens PolicyDialog with the saved text, or starter text built from the
// store's details. Published policies are linked in the storefront footer and
// at checkout unless the store turns that off in the ⋯ menu.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrg, useCan } from '@/components/OrgContext';
import { policiesApi, type PolicyList, type PolicySummary, type PolicyType } from '@/services/api';
import SettingsNav from '../SettingsNav';
import { ChevronRightIcon, EllipsisIcon } from '../icons';
import PolicyDialog from './PolicyDialog';
import { Accessibility, Contact, Lock, Mail, ReceiptText, ScrollText, Truck, type LucideIcon } from 'lucide-react';

const ICONS: Record<PolicyType, LucideIcon> = {
  REFUND: ReceiptText,
  PRIVACY: Lock,
  TERMS: ScrollText,
  SHIPPING: Truck,
  CONTACT: Contact,
  LEGAL_NOTICE: Mail,
  ACCESSIBILITY: Accessibility,
};

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const PUBLISHED_PILL = 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
const NOT_SET_PILL = 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300';
const LEARN_MORE = 'https://github.com/jjchambers80/jump/blob/main/docs/wiki/features/store-policies.md';

function errorMessage(err: any, fallback: string) {
  const detail = Array.isArray(err?.details) ? err.details[0]?.message : null;
  return detail || err?.message || fallback;
}

export default function PoliciesSettingsPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const canEdit = useCan('settings.policies');
  const [data, setData] = useState<PolicyList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PolicyType | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const rowRefs = useRef<Partial<Record<PolicyType, HTMLButtonElement | null>>>({});
  const returnFocus = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await policiesApi.list());
    } catch (err) {
      setError(errorMessage(err, 'Could not load policies'));
    }
  }, []);

  useEffect(() => {
    if (orgLoading || !selectedOrgId) return;
    setData(null);
    void load();
  }, [orgLoading, selectedOrgId, load]);

  const toggleFooter = async () => {
    if (!data) return;
    setMenuOpen(false);
    try {
      setData(await policiesApi.setShowInFooter(!data.showInFooter));
    } catch (err) {
      setError(errorMessage(err, 'Could not save'));
    }
  };

  const open = (policy: PolicySummary) => {
    (returnFocus as React.MutableRefObject<HTMLButtonElement | null>).current = rowRefs.current[policy.type] ?? null;
    setEditing(policy.type);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="policies-heading" className="min-w-0 flex-1 space-y-6">
          <h2 id="policies-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <ScrollText aria-hidden="true" className="h-5 w-5 text-gray-500 dark:text-slate-400" />
            Policies
          </h2>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}

          <div className={cardClass} data-testid="written-policies-card">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Written policies</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                  {data && !data.showInFooter
                    ? 'Policies are not linked in the footer of your online store or at checkout'
                    : 'By default, policies appear in the footer of your online store and checkout'}
                </p>
              </div>
              {canEdit && data && (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    aria-label="Policy options"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((v) => !v)}
                    className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-slate-400 dark:hover:bg-slate-700"
                  >
                    <EllipsisIcon />
                  </button>
                  {menuOpen && (
                    <div role="menu" className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={data.showInFooter}
                        onClick={() => void toggleFooter()}
                        className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-slate-100 dark:hover:bg-slate-700"
                      >
                        Show policies in footer and checkout
                        <span aria-hidden="true" className="font-semibold text-accent-600">{data.showInFooter ? '✓' : ''}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {!data && !error ? (
              <div className="mt-4 h-72 animate-pulse rounded-lg bg-gray-100 dark:bg-slate-700" aria-busy="true" />
            ) : data ? (
              <ul className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700">
                {data.policies.map((policy) => {
                  const Icon = ICONS[policy.type];
                  return (
                  <li key={policy.type}>
                    <button
                      ref={(el) => {
                        rowRefs.current[policy.type] = el;
                      }}
                      type="button"
                      data-testid={`policy-row-${policy.type}`}
                      onClick={() => open(policy)}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500 dark:hover:bg-slate-700/40"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-gray-600 dark:text-slate-300">
                        <Icon aria-hidden="true" className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-white">{policy.title}</span>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${policy.status === 'PUBLISHED' ? PUBLISHED_PILL : NOT_SET_PILL}`}
                      >
                        {policy.status === 'PUBLISHED' ? 'Published' : 'No policy set'}
                      </span>
                      <span className="shrink-0 text-gray-400 dark:text-slate-500">
                        <ChevronRightIcon />
                      </span>
                    </button>
                  </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <p className="text-sm text-gray-600 dark:text-slate-400">
            Recommended policies are not legal advice. You are responsible for ensuring they are accurate and comply with
            applicable laws.{' '}
            <a href={LEARN_MORE} target="_blank" rel="noreferrer" className="underline hover:text-gray-900 dark:hover:text-white">
              Learn more
            </a>
          </p>
        </section>
      </div>

      {editing && (
        <PolicyDialog
          type={editing}
          canEdit={canEdit}
          returnFocusRef={returnFocus}
          onClose={() => setEditing(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
