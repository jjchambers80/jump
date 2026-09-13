'use client';

// Three-step setup checklist for one domain (spec 008), after Shopify's
// domain page: configure DNS records (with Current value → Update to),
// DNS propagation, TLS certificate. State is derived from the serialized
// domain; nothing here calls the API.

import { ReactNode, useState } from 'react';
import { ArrowRightIcon, CheckCircleIcon, CircleDashedIcon, ExternalLinkIcon } from '../icons';
import { relativeName, type DnsRecord, type StorefrontDomain } from './types';

type StepState = 'todo' | 'active' | 'done' | 'failed' | 'info';

export function deriveSteps(domain: StorefrontDomain): { dns: StepState; propagation: StepState; tls: StepState } {
  const recordsValid = domain.dnsRecords.every((r) => r.status === 'valid');
  const dnsProven = domain.status === 'VERIFIED' || domain.status === 'ACTIVE';

  if (domain.status === 'FAILED') return { dns: 'failed', propagation: 'todo', tls: 'todo' };

  if (!dnsProven) {
    // PENDING: records still wrong or never checked; propagation is "active" only
    // once every record answers correctly but the last check predates that.
    return { dns: recordsValid ? 'done' : 'active', propagation: recordsValid ? 'active' : 'todo', tls: 'todo' };
  }

  // VERIFIED / ACTIVE. Without Railway the operator attaches TLS by hand, so
  // the step is informational rather than a spinner that never completes.
  let tls: StepState = 'info';
  if (domain.tlsManagedByRailway) {
    if (domain.status === 'ACTIVE' || domain.certificateStatus === 'ISSUED') tls = 'done';
    else if (domain.certificateStatus === 'FAILED') tls = 'failed';
    else tls = 'active';
  }
  return { dns: 'done', propagation: 'done', tls };
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CheckCircleIcon className="h-5 w-5 text-green-600 dark:text-green-400" />;
  if (state === 'failed') return <CircleDashedIcon className="h-5 w-5 text-red-500" />;
  if (state === 'active') return <CircleDashedIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />;
  return <CircleDashedIcon className="h-5 w-5 text-gray-300 dark:text-slate-600" />;
}

function Step({ state, title, children }: { state: StepState; title: string; children?: ReactNode }) {
  const muted = state === 'todo';
  return (
    <li className="flex gap-3" data-step-state={state}>
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        <StepIcon state={state} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className={`text-sm font-semibold ${muted ? 'text-gray-400 dark:text-slate-500' : 'text-gray-900 dark:text-white'}`}>
          {title}
          <span className="sr-only">
            {state === 'done' ? ' — complete' : state === 'active' ? ' — in progress' : state === 'failed' ? ' — failed' : ''}
          </span>
        </h3>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </li>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
      aria-label={`Copy ${label}`}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function RecordTable({ records, zone, caption }: { records: DnsRecord[]; zone: string; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-gray-50 text-xs font-medium text-gray-500 dark:bg-slate-900/40 dark:text-slate-400">
          <tr>
            <th scope="col" className="px-3 py-2">Type</th>
            <th scope="col" className="px-3 py-2">Name</th>
            <th scope="col" className="px-3 py-2">Current value</th>
            <th scope="col" className="px-3 py-2" aria-hidden="true" />
            <th scope="col" className="px-3 py-2">Update to</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-900 dark:divide-slate-700 dark:text-slate-100">
          {records.map((r) => {
            const rel = relativeName(r.name, zone);
            const ok = r.status === 'valid';
            return (
              <tr key={r.key} data-record={r.key} data-record-status={r.status}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.type}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex max-w-full items-center gap-1">
                    <code className="truncate" title={r.name}>{rel}</code>
                    <CopyButton value={rel} label={`${r.type} record name ${rel}`} />
                  </span>
                </td>
                <td className="px-3 py-2">
                  {r.currentValue ? (
                    <code className={`break-all ${ok ? 'text-green-700 dark:text-green-300' : ''}`}>{r.currentValue}</code>
                  ) : (
                    <span className="text-gray-400 dark:text-slate-500">{r.status === 'pending' ? '(not checked yet)' : '(empty)'}</span>
                  )}
                </td>
                <td className="px-2 py-2 text-gray-400 dark:text-slate-500" aria-hidden="true">
                  {ok ? <CheckCircleIcon className="h-4 w-4 text-green-600 dark:text-green-400" /> : <ArrowRightIcon />}
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex max-w-full items-center gap-1">
                    <code className="break-all font-semibold">{r.value}</code>
                    <CopyButton value={r.value} label={`${r.type} record value`} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface SetupChecklistProps {
  domain: StorefrontDomain;
  checking: boolean;
  onCheck: () => void;
}

export default function SetupChecklist({ domain, checking, onCheck }: SetupChecklistProps) {
  const steps = deriveSteps(domain);
  const provider = domain.dnsProvider;
  const providerName = provider?.name ?? 'your DNS provider';
  const txt = domain.dnsRecords.filter((r) => r.type === 'TXT');
  const cname = domain.dnsRecords.filter((r) => r.type === 'CNAME');

  return (
    <ol className="space-y-6" aria-label="Domain setup steps">
      <Step state={steps.dns} title={`Configure DNS records on ${providerName}`}>
        {steps.dns !== 'todo' && (
          <div className="space-y-5 text-sm text-gray-700 dark:text-slate-300">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                1. Log in to {providerName} and open DNS management for <code>{domain.zone}</code>
              </p>
              {provider && (
                <a
                  href={provider.dnsConsoleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  {provider.name}
                  <ExternalLinkIcon />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
            </div>

            <div className="space-y-2">
              <p className="font-medium text-gray-900 dark:text-white">2. Add this record to verify domain ownership</p>
              <RecordTable records={txt} zone={domain.zone} caption="Ownership verification record" />
            </div>

            <div className="space-y-2">
              <p className="font-medium text-gray-900 dark:text-white">3. Point your domain at Jump</p>
              <RecordTable records={cname} zone={domain.zone} caption="Storefront CNAME record" />
              <p className="text-xs text-gray-500 dark:text-slate-400">
                If your provider proxies traffic (for example Cloudflare&apos;s orange cloud), turn the proxy off for this record so the
                certificate can be issued.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onCheck}
                disabled={checking}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 dark:bg-white dark:text-gray-900 dark:hover:bg-slate-200"
              >
                {checking ? 'Checking…' : 'I updated DNS records'}
              </button>
            </div>
          </div>
        )}
      </Step>

      <Step state={steps.propagation} title="DNS propagation">
        {steps.propagation === 'active' && (
          <p className="text-sm text-gray-600 dark:text-slate-400">
            Your records look right. DNS changes usually take effect within an hour but can take up to 48 hours. We re-check
            automatically.
          </p>
        )}
      </Step>

      <Step state={steps.tls} title="TLS certificate provisioning">
        {steps.tls === 'active' && (
          <p className="text-sm text-gray-600 dark:text-slate-400">
            DNS is verified. The certificate is being issued; this usually completes within an hour.
          </p>
        )}
        {steps.tls === 'failed' && (
          <p className="text-sm text-red-700 dark:text-red-300">
            The certificate could not be issued. Make sure the hostname is not proxied by your DNS provider, then check again.
          </p>
        )}
        {steps.tls === 'info' && (
          <p className="text-sm text-gray-600 dark:text-slate-400">
            {domain.status === 'ACTIVE'
              ? 'DNS is verified. Jump attaches the certificate for this domain; if the site shows a certificate warning, contact support.'
              : 'Jump attaches the certificate once DNS is verified.'}
          </p>
        )}
      </Step>
    </ol>
  );
}
