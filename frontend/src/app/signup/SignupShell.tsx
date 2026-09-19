'use client';

// Full-bleed stage (light/dark via .signup-stage) for the signup steps (reference:
// docs/research/shopify-onboarding-survey.png): Skip pill top-right, a
// back circle beside the card, headline + subline above a white card.

import React from 'react';

interface SignupShellProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  busy?: boolean;
  children: React.ReactNode;
}

export default function SignupShell({ title, subtitle, onBack, onSkip, skipLabel = 'Skip', busy, children }: SignupShellProps) {
  return (
    <div
      className="min-h-screen signup-stage text-gray-900 dark:text-white px-4 py-10 sm:py-16"
      data-testid="signup-shell"
    >
      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="fixed top-4 right-4 rounded-full bg-gray-900/10 hover:bg-gray-900/20 dark:bg-white/10 dark:hover:bg-white/20 px-4 py-2 text-sm font-medium transition disabled:opacity-50"
        >
          {skipLabel}
        </button>
      )}

      <div className="max-w-xl mx-auto mt-6 sm:mt-10">
        <h1 className="text-2xl sm:text-3xl font-semibold text-center">{title}</h1>
        {subtitle && <p className="mt-2 text-center text-sm sm:text-base text-gray-600 dark:text-white/60">{subtitle}</p>}

        <div className="relative mt-8">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              disabled={busy}
              aria-label="Back"
              className="absolute -left-14 top-2 hidden sm:flex items-center justify-center w-11 h-11 rounded-full bg-gray-900/10 hover:bg-gray-900/20 dark:bg-white/10 dark:hover:bg-white/20 transition disabled:opacity-50"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="rounded-2xl bg-white text-gray-900 dark:bg-slate-800 dark:text-white p-5 sm:p-6 shadow-2xl">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                disabled={busy}
                className="sm:hidden mb-3 text-sm text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white"
              >
                ← Back
              </button>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
