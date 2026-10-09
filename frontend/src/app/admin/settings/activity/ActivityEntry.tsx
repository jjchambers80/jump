'use client';

// One row of Settings › Activity log (spec 048): a sentence ("Jane updated
// event Summer Fest"), when / where / how, and an expandable field diff.

import { useId, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import type { AuditLogEntry, AuditOperation } from '@/services/api';

const VERBS: Record<AuditOperation, string> = {
  CREATE: 'created',
  UPDATE: 'updated',
  DELETE: 'deleted',
  BULK_CREATE: 'created several',
  BULK_UPDATE: 'updated several',
  BULK_DELETE: 'deleted several',
  EXPORT: 'downloaded',
  OTHER: 'changed',
};

const badge = 'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium';
const BADGES: Record<string, { label: string; className: string }> = {
  DEVELOPER_TOKEN: { label: 'CLI', className: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  AGENT: { label: 'Agent', className: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  SYSTEM: { label: 'System', className: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300' },
};

/** "PriceTier" → "price tier"; "storefrontPasswordHash" → "Storefront password hash". */
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
const fieldLabel = (name: string) => {
  const text = words(name);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === '') return <span className="text-gray-400 dark:text-slate-500">—</span>;
  if (value === '[changed]') return <span className="italic text-gray-500 dark:text-slate-400">hidden</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return <code className="break-all text-xs">{JSON.stringify(value)}</code>;
  return <span className="break-words">{String(value)}</span>;
}

function sentence(entry: AuditLogEntry) {
  const count = typeof entry.meta?.count === 'number' ? ` (${entry.meta.count})` : '';
  const noun = entry.operation === 'EXPORT' ? 'a file' : words(entry.entityType);
  return { verb: `${VERBS[entry.operation]} ${noun}${count}`, target: entry.entityLabel };
}

export default function ActivityEntry({ entry, when }: { entry: AuditLogEntry; when: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const changes = entry.changes ? Object.entries(entry.changes) : [];
  const { verb, target } = sentence(entry);
  const typeBadge = BADGES[entry.actor.type];
  const details = [entry.feature, when, entry.location, entry.device].filter(Boolean);

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-900 dark:text-white">
            <span className="font-semibold">{entry.actor.label}</span>
            {typeBadge && <span className={`${badge} ${typeBadge.className} ml-1.5`}>{typeBadge.label}</span>}
            {entry.actor.viaPlatformAdmin && (
              <span className={`${badge} ml-1.5 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300`}>Eventimus staff</span>
            )}{' '}
            {verb}
            {target && <> <span className="font-semibold">{target}</span></>}
          </p>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-slate-400">{details.join(' · ')}</p>
        </div>
        {changes.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-accent-700 hover:bg-accent-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-accent-300 dark:hover:bg-accent-900/30"
          >
            {changes.length} {changes.length === 1 ? 'change' : 'changes'}
            <ChevronDownIcon aria-hidden className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {open && (
        <div id={panelId} className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Changed fields</caption>
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-slate-400">
                <th scope="col" className="w-1/4 pb-1 pr-3 font-medium">Field</th>
                <th scope="col" className="pb-1 pr-3 font-medium">Before</th>
                <th scope="col" className="pb-1 font-medium">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 align-top dark:divide-slate-700">
              {changes.map(([field, [before, after]]) => (
                <tr key={field}>
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium text-gray-700 dark:text-slate-300">{fieldLabel(field)}</th>
                  <td className="py-1.5 pr-3 text-gray-600 dark:text-slate-400">{formatValue(before)}</td>
                  <td className="py-1.5 text-gray-900 dark:text-white">{formatValue(after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}
