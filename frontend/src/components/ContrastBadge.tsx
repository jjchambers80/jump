'use client';

import React from 'react';
import InfoTooltip from '@/components/InfoTooltip';
import { formatRatio, WCAG_AA_NORMAL, type BrandEvaluation, type ContrastCheck } from '@/lib/color';

interface ContrastBadgeProps {
  evaluation: BrandEvaluation;
}

const CHECKS: { key: keyof Pick<BrandEvaluation, 'buttonText' | 'linkLight' | 'linkDark'>; label: string }[] = [
  { key: 'buttonText', label: 'Button text on brand color' },
  { key: 'linkLight', label: 'Links on light background' },
  { key: 'linkDark', label: 'Links on dark background' },
];

function CheckRow({ label, check }: { label: string; check: ContrastCheck }) {
  return (
    <li className="flex items-center justify-between gap-3 text-xs" data-testid="contrast-check-row">
      <span className="text-gray-700 dark:text-slate-300">{label}</span>
      <span className="flex items-center gap-2 font-mono tabular-nums">
        <span className={check.passes ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
          {formatRatio(check.ratio)}
        </span>
        <span aria-label={check.passes ? 'Passes' : 'Fails'} className={check.passes ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
          {check.passes ? '✓' : '✗'}
        </span>
      </span>
    </li>
  );
}

/**
 * Shows the overall WCAG AA verdict for a brand color plus the three individual checks
 * and a live preview of a button and link on light and dark tiles.
 */
export default function ContrastBadge({ evaluation }: ContrastBadgeProps) {
  const { hex, passesAA, buttonText, linkLight, linkDark } = evaluation;

  return (
    <div className="mt-3 rounded-md border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-3" data-testid="contrast-badge">
      <div className="flex items-center gap-2">
        <span
          role="status"
          data-testid="contrast-verdict"
          data-passes={passesAA ? 'true' : 'false'}
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            passesAA
              ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
          }`}
        >
          {passesAA ? 'Passes WCAG AA' : 'Fails WCAG AA'}
        </span>
        <span className="text-xs text-gray-500 dark:text-slate-400">
          minimum {WCAG_AA_NORMAL}:1 for normal text
        </span>
        <InfoTooltip label="Why contrast matters">
          Web Content Accessibility Guidelines (WCAG) 2.1 AA — the standard courts and the DOJ apply
          under the ADA — requires at least a 4.5:1 contrast ratio between text and its background.
          Roughly 1 in 12 men have a color-vision deficiency and low-vision users rely on contrast to
          read buttons and links. Colors that fail can make &ldquo;Buy Tickets&rdquo; unreadable and expose
          your organization to accessibility complaints.
        </InfoTooltip>
      </div>

      <ul className="mt-3 space-y-1.5">
        {CHECKS.map(({ key, label }) => (
          <CheckRow key={key} label={label} check={evaluation[key]} />
        ))}
      </ul>

      <div className="mt-3 grid grid-cols-2 gap-2" aria-hidden="true">
        <div className="rounded border border-gray-200 p-2" style={{ backgroundColor: linkLight.bg }}>
          <span
            className="inline-block rounded px-2 py-1 text-xs font-bold"
            style={{ backgroundColor: hex, color: buttonText.fg }}
          >
            Buy Tickets
          </span>
          <div className="mt-1.5 text-xs font-semibold underline" style={{ color: linkLight.fg }}>
            $25.00 · Event link
          </div>
        </div>
        <div className="rounded border border-slate-700 p-2" style={{ backgroundColor: linkDark.bg }}>
          <span
            className="inline-block rounded px-2 py-1 text-xs font-bold"
            style={{ backgroundColor: hex, color: buttonText.fg }}
          >
            Buy Tickets
          </span>
          <div className="mt-1.5 text-xs font-semibold underline" style={{ color: linkDark.fg }}>
            $25.00 · Event link
          </div>
        </div>
      </div>
    </div>
  );
}
