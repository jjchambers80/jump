'use client';

// Dashboard setup guide (spec 022 §5.6): the card grid a new organization
// sees until it has an event, a design, payments, business details and a
// domain (reference: docs/research/shopify-onboarding-setup-guide.png).
// Which tasks are done comes from GET /admin/setup-guide; copy lives here.

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import adminService, { type SetupGuide as SetupGuideData, type SetupTask, type SetupTaskId } from '@/services/adminService';
import { useOrg } from '@/components/OrgContext';

interface CardCopy {
  title: string;
  body: string;
  cta: string;
  doneTitle?: string;
  art: React.ReactNode;
}

const stroke = 'currentColor';

const ART: Record<SetupTaskId, React.ReactNode> = {
  event: (
    <svg viewBox="0 0 160 80" className="w-full h-full text-gray-300 dark:text-slate-600" aria-hidden="true">
      <g fill="none" stroke={stroke} strokeWidth="2">
        <rect x="8" y="22" width="44" height="36" rx="6" transform="rotate(-8 30 40)" />
        <rect x="58" y="16" width="44" height="46" rx="8" strokeDasharray="4 4" />
        <rect x="108" y="22" width="44" height="36" rx="6" transform="rotate(8 130 40)" />
        <path d="M80 30v18M71 39h18" strokeLinecap="round" />
      </g>
    </svg>
  ),
  design: (
    <svg viewBox="0 0 160 80" className="w-full h-full text-gray-300 dark:text-slate-600" aria-hidden="true">
      <g fill="none" stroke={stroke} strokeWidth="2">
        <rect x="14" y="16" width="56" height="52" rx="6" transform="rotate(-6 42 42)" />
        <rect x="90" y="16" width="56" height="52" rx="6" transform="rotate(6 118 42)" />
        <rect x="50" y="8" width="60" height="64" rx="8" className="fill-white dark:fill-slate-800" />
        <path d="M60 24h12M60 32h12M60 40h12" strokeLinecap="round" />
      </g>
      <text x="92" y="46" fontSize="18" fontWeight="700" fill={stroke} textAnchor="middle">Aa</text>
    </svg>
  ),
  payments: (
    <svg viewBox="0 0 160 80" className="w-full h-full text-gray-300 dark:text-slate-600" aria-hidden="true">
      <g fill="none" stroke={stroke} strokeWidth="2">
        <rect x="22" y="22" width="60" height="38" rx="6" transform="rotate(-10 52 41)" />
        <rect x="70" y="18" width="60" height="38" rx="6" transform="rotate(8 100 37)" />
        <path d="M76 34h44" strokeWidth="6" strokeLinecap="round" opacity="0.6" />
        <circle cx="46" cy="44" r="6" />
        <circle cx="56" cy="44" r="6" />
      </g>
    </svg>
  ),
  business: (
    <svg viewBox="0 0 160 80" className="w-full h-full text-gray-300 dark:text-slate-600" aria-hidden="true">
      <g fill="none" stroke={stroke} strokeWidth="2">
        <rect x="30" y="14" width="100" height="56" rx="8" transform="rotate(-4 80 42)" />
        <path d="M44 30h72" strokeWidth="8" strokeLinecap="round" opacity="0.5" />
        <path d="M46 50h50M46 58h30" strokeLinecap="round" />
      </g>
    </svg>
  ),
  domain: (
    <svg viewBox="0 0 160 80" className="w-full h-full text-gray-300 dark:text-slate-600" aria-hidden="true">
      <g fill="none" stroke={stroke} strokeWidth="2">
        <rect x="14" y="14" width="132" height="54" rx="8" />
        <rect x="24" y="22" width="112" height="14" rx="7" />
        <path d="M100 52l14 14 4-8 8-4z" fill={stroke} />
      </g>
      <text x="80" y="33" fontSize="10" fill={stroke} textAnchor="middle">.com</text>
    </svg>
  ),
  applications: (
    <svg viewBox="0 0 160 80" className="w-full h-full text-gray-300 dark:text-slate-600" aria-hidden="true">
      <g fill="none" stroke={stroke} strokeWidth="2">
        <rect x="20" y="12" width="60" height="58" rx="6" />
        <path d="M30 26h40M30 36h40M30 46h24" strokeLinecap="round" />
        <rect x="92" y="28" width="48" height="36" rx="4" />
        <path d="M92 40h48M116 28v36" />
      </g>
    </svg>
  ),
};

function copyFor(task: SetupTask): CardCopy {
  switch (task.id) {
    case 'event':
      return {
        title: 'Create your first event',
        body: 'A name, a date and a venue are enough to start selling. Add tiers and details later.',
        cta: 'Create event',
        doneTitle: 'Your first event is in',
        art: ART.event,
      };
    case 'design':
      return {
        title: 'Choose your store design',
        body: "Pick a theme mode and brand colour. You can refine it once you're selling.",
        cta: 'Choose design',
        doneTitle: 'Store design chosen',
        art: ART.design,
      };
    case 'payments':
      return task.state === 'connect'
        ? {
            title: 'Connect your Stripe account',
            body: 'Ticket revenue is paid into your own Stripe account. Connect it to start selling.',
            cta: 'Connect Stripe',
            doneTitle: 'Stripe connected',
            art: ART.payments,
          }
        : {
            title: "You're ready to accept payments",
            body: 'Review payment methods and your statement descriptor.',
            cta: 'Review payments',
            doneTitle: 'Payments reviewed',
            art: ART.payments,
          };
    case 'business':
      return {
        title: 'Add your business details',
        body: 'Your legal name and address appear on receipts and tax reports.',
        cta: 'Add details',
        doneTitle: 'Business details added',
        art: ART.business,
      };
    case 'domain':
      return {
        title: 'Claim your web address',
        body: "Give your store a branded URL that's easy to find, trust, and remember.",
        cta: 'Set up domain',
        doneTitle: 'Web address claimed',
        art: ART.domain,
      };
    case 'applications':
      return {
        title: 'Open vendor & sponsor applications',
        body: 'Start from a template: booths, sponsorships, press, panels.',
        cta: 'Set up applications',
        doneTitle: 'Applications open',
        art: ART.applications,
      };
  }
}

function SetupCard({ task }: { task: SetupTask }) {
  const copy = copyFor(task);
  return (
    <div
      className={`rounded-xl border bg-white dark:bg-slate-800 p-5 flex flex-col ${
        task.done ? 'border-green-200 dark:border-green-900/50' : 'border-gray-200 dark:border-slate-700'
      }`}
      data-testid={`setup-card-${task.id}`}
      data-done={task.done ? 'true' : 'false'}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">{task.done ? copy.doneTitle ?? copy.title : copy.title}</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{copy.body}</p>
        </div>
        {task.done && (
          <span
            className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
            aria-label="Done"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </span>
        )}
      </div>
      <div className="my-4 h-24">{copy.art}</div>
      {!task.done && (
        <Link
          href={task.href}
          className="mt-auto self-start rounded-full border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-4 py-1.5 text-sm font-medium text-gray-900 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-600 transition"
        >
          {copy.cta}
        </Link>
      )}
    </div>
  );
}

export default function SetupGuide() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const [guide, setGuide] = useState<SetupGuideData | null>(null);
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setGuide(await adminService.getSetupGuide());
    } catch {
      setGuide(null); // the guide is optional; never block the dashboard
    }
  }, []);

  useEffect(() => {
    if (orgLoading || !selectedOrgId) return;
    load();
  }, [orgLoading, selectedOrgId, load]);

  if (!guide || guide.dismissedAt) return null;

  const tasks = guide.tasks.filter((t) => t.shown);
  const remaining = tasks.filter((t) => !t.done).length;

  const handleDismiss = async () => {
    try {
      setDismissing(true);
      await adminService.dismissSetupGuide();
      setGuide({ ...guide, dismissedAt: new Date().toISOString() });
    } finally {
      setDismissing(false);
    }
  };

  return (
    <section className="mb-8" aria-labelledby="setup-guide-heading" data-testid="setup-guide">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 id="setup-guide-heading" className="text-lg font-semibold text-gray-900 dark:text-slate-100">
            {remaining === 0 ? "You're all set" : 'Set up your organization'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {remaining === 0
              ? 'Everything on this list is done. Dismiss the guide whenever you like.'
              : `${tasks.length - remaining} of ${tasks.length} done`}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={dismissing}
          className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 disabled:opacity-50"
        >
          Dismiss guide
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tasks.map((task) => (
          <SetupCard key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}
