'use client';

// Review's readiness checklist (spec 050 §5.1, §7.2): exactly what
// GET …/readiness returns. Blockers first, then warnings; each says its kind in
// text next to its icon (never colour alone) and links to the wizard step that
// fixes it, or names who can when the fix is an org setting the viewer can't change.

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronRight, XCircle } from 'lucide-react';
import { hasPermission, useOrg } from '@/components/OrgContext';
import { readinessSettingsFix, readinessHref, type EventReadiness, type ReadinessItem } from '@/lib/eventReadiness';

const KIND = {
  blocker: { Icon: XCircle, label: 'Must fix', iconClass: 'text-red-700 dark:text-red-400' },
  warning: { Icon: AlertTriangle, label: 'Check', iconClass: 'text-amber-700 dark:text-amber-400' },
} as const;

function Item({ item, kind, eventId }: { item: ReadinessItem; kind: keyof typeof KIND; eventId: string }) {
  const { permissions } = useOrg();
  const { Icon, label, iconClass } = KIND[kind];
  const settings = readinessSettingsFix(item);
  const blocked = settings && !hasPermission(permissions, settings.permission);
  const text = (
    <span className="flex items-start gap-2">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} aria-hidden />
      <span>
        <span className="font-semibold">{label}: </span>
        {item.message}
        {blocked && <span className="block font-semibold">{settings.who}</span>}
      </span>
    </span>
  );
  return (
    <li>
      {blocked ? (
        <div className="flex min-h-11 items-center py-2 text-sm">{text}</div>
      ) : (
        <Link
          href={readinessHref(item, eventId)}
          className="flex min-h-11 items-center justify-between gap-3 rounded py-2 text-sm text-gray-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-slate-200"
        >
          {text}
          <span className="inline-flex shrink-0 items-center font-semibold">
            {kind === 'blocker' ? 'Fix' : 'Review'}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </span>
        </Link>
      )}
    </li>
  );
}

export default function ReadinessChecklist({ readiness, eventId }: { readiness: EventReadiness; eventId: string }) {
  const { blockers, warnings } = readiness;
  const items = [
    ...blockers.map((item) => ({ item, kind: 'blocker' as const })),
    ...warnings.map((item) => ({ item, kind: 'warning' as const })),
  ];
  let summary = 'Ready to publish';
  if (blockers.length) summary = blockers.length === 1 ? '1 thing to fix before publishing' : `${blockers.length} things to fix before publishing`;
  else if (warnings.length) summary = `Ready to publish, with ${warnings.length === 1 ? '1 thing' : `${warnings.length} things`} to check`;
  const SummaryIcon = blockers.length ? XCircle : CheckCircle2;

  return (
    <section aria-labelledby="review-readiness" className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:p-6">
      <h2 id="review-readiness" className="text-base font-semibold text-gray-900 dark:text-white">
        Checklist
      </h2>
      <p className="mt-1 flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300" data-testid="readiness-summary">
        <SummaryIcon className={`h-4 w-4 shrink-0 ${blockers.length ? KIND.blocker.iconClass : 'text-green-700 dark:text-green-400'}`} aria-hidden />
        {summary}
      </p>
      {items.length > 0 && (
        <ul className="mt-2 divide-y divide-gray-200 dark:divide-slate-700">
          {items.map(({ item, kind }) => (
            <Item key={`${kind}-${item.code}-${item.formId ?? ''}`} item={item} kind={kind} eventId={eventId} />
          ))}
        </ul>
      )}
    </section>
  );
}
