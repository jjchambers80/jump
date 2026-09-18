'use client';

// /signup/[orgId]/survey — the onboarding survey (spec 022 §5.2).
// One URL, step index in state (?step=n for refresh/back). Continue saves
// that step's key; ← goes back without saving; Skip records the decision
// for the whole survey and moves to done.

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import SignupShell from '../../SignupShell';
import signupService from '@/services/signupService';
import { SURVEY_STEPS, visibleSteps, type SurveyAnswers, type SurveyStep } from '@/lib/onboarding';

function Pill({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
        selected ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
      }`}
    >
      <span aria-hidden="true" className="text-xs">
        {selected ? '✓' : '+'}
      </span>
      {label}
    </button>
  );
}

function SurveyStepView({
  step,
  answers,
  onChange,
}: {
  step: SurveyStep;
  answers: SurveyAnswers;
  onChange: (patch: SurveyAnswers) => void;
}) {
  const value = answers[step.key];
  const selected = new Set<string>(Array.isArray(value) ? value : value ? [value] : []);

  const toggle = (id: string) => {
    if (step.multi) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange({ [step.key]: [...next] } as SurveyAnswers);
    } else {
      onChange({ [step.key]: selected.has(id) ? null : id } as SurveyAnswers);
    }
  };

  return (
    <div className="flex flex-wrap gap-2" role={step.multi ? 'group' : 'radiogroup'} aria-label={step.title}>
      {step.options.map((option) => (
        <Pill key={option.id} label={option.label} selected={selected.has(option.id)} onClick={() => toggle(option.id)} />
      ))}
    </div>
  );
}

function Survey() {
  const router = useRouter();
  const params = useSearchParams();
  const { orgId } = useParams<{ orgId: string }>();
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [index, setIndex] = useState(() => Math.max(0, Number(params.get('step') || 0)));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = useCallback(() => router.replace(`/signup/${orgId}/done`), [orgId, router]);

  useEffect(() => {
    let cancelled = false;
    signupService
      .get(orgId)
      .then((organization) => {
        if (cancelled) return;
        if (organization.step === 'done') {
          done();
          return;
        }
        const saved = organization.onboarding || {};
        setAnswers({
          goals: saved.goals ?? [],
          eventTypes: saved.eventTypes ?? [],
          eventsPerYear: saved.eventsPerYear ?? null,
          attendance: saved.attendance ?? null,
          movingFrom: saved.movingFrom ?? null,
        });
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.status === 404) {
          // Finished, discarded, or someone else's: start over (resumes if pending)
          router.replace('/signup');
          return;
        }
        setError(err.message || 'Could not load your signup');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, router, done]);

  const steps = visibleSteps(answers);
  const current = steps[Math.min(index, steps.length - 1)] ?? SURVEY_STEPS[0];
  const isLast = index >= steps.length - 1;

  const go = (next: number) => {
    setIndex(next);
    router.replace(`/signup/${orgId}/survey?step=${next}`);
  };

  const handleContinue = async () => {
    try {
      setBusy(true);
      setError(null);
      await signupService.saveSurvey(orgId, { [current.key]: answers[current.key] ?? (current.multi ? [] : null) } as SurveyAnswers);
      if (isLast) done();
      else go(index + 1);
    } catch (err: any) {
      setError(err.message || 'Could not save your answer');
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = async () => {
    try {
      setBusy(true);
      setError(null);
      await signupService.skipSurvey(orgId);
      done();
    } catch (err: any) {
      setError(err.message || 'Could not skip');
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SignupShell title=" ">
        <div className="py-6 flex justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
        </div>
      </SignupShell>
    );
  }

  return (
    <SignupShell
      title={current.title}
      subtitle={current.subtitle}
      onBack={index > 0 ? () => go(index - 1) : undefined}
      onSkip={handleSkip}
      busy={busy}
    >
      <div data-testid={`survey-step-${current.key}`}>
        <SurveyStepView step={current} answers={answers} onChange={(patch) => setAnswers((a) => ({ ...a, ...patch }))} />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={handleContinue}
          disabled={busy}
          className="mt-5 w-full rounded-full bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-black transition disabled:opacity-50"
        >
          {busy ? 'Saving…' : isLast ? 'Finish' : 'Continue'}
        </button>
        <p className="mt-3 text-center text-xs text-gray-400">
          Step {Math.min(index, steps.length - 1) + 1} of {steps.length}
        </p>
      </div>
    </SignupShell>
  );
}

export default function SurveyPage() {
  return (
    <Suspense fallback={null}>
      <Survey />
    </Suspense>
  );
}
