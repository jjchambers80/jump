// Setup checklist tasks (spec 022 §5.6): copy and line art for each task the
// backend reports from GET /admin/setup-guide, plus the groups the onboarding
// checklist page lists them under. Which tasks are done comes from the API.

import React from 'react';
import type { SetupTask, SetupTaskId } from '@/services/adminService';

export interface TaskCopy {
  title: string;
  body: string;
  cta: string;
  doneTitle?: string;
  art: React.ReactNode;
}
const stroke = 'currentColor';

export const ART: Record<SetupTaskId, React.ReactNode> = {
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
  checkin: (
    <svg viewBox="0 0 160 80" className="w-full h-full text-gray-300 dark:text-slate-600" aria-hidden="true">
      <g fill="none" stroke={stroke} strokeWidth="2">
        <rect x="52" y="8" width="56" height="64" rx="8" />
        <rect x="64" y="20" width="32" height="32" rx="3" />
        <path d="M70 26h6v6h-6zM84 26h6v6h-6zM70 40h6v6h-6z" fill={stroke} />
        <path d="M112 36l10 10 20-20" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  ),
};

export function copyFor(task: SetupTask): TaskCopy {
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
    case 'checkin':
      return {
        title: 'Check tickets in at the door',
        body: 'Scan QR codes from any phone. Try it with a test ticket before doors open.',
        cta: 'Open scanner',
        doneTitle: 'First ticket checked in',
        art: ART.checkin,
      };
  }
}

export const GROUPS: { label: string; ids: SetupTaskId[] }[] = [
  { label: 'Set up your store', ids: ['business', 'design', 'payments', 'domain'] },
  { label: 'Start selling', ids: ['event', 'applications', 'checkin'] },
];
