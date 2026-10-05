'use client';

import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { acceptanceLine, type PublicForm } from '@/lib/applications';
import StorefrontShell, { type StorefrontOrganization } from '@/components/storefront/StorefrontShell';
import { useStorefrontContent } from '@/components/storefront/useStorefrontContent';
import { ApplySteps, useApplyForm } from '@/components/applications/ApplySteps';

type Payload = PublicForm & { organization: StorefrontOrganization };

export default function StandingApplyView({ orgId, formSlug }: { orgId: string; formSlug: string }) {
  const router = useRouter();
  const path = `/organizations/${encodeURIComponent(orgId)}/public/apply/${encodeURIComponent(formSlug)}`;
  const state = useStorefrontContent<Payload>(path);
  const apply = useApplyForm(state.data, { submitUrl: path, draftKey: `jump.apply.${orgId}.${formSlug}` });

  return (
    <StorefrontShell orgId={orgId} state={state} notFoundTitle="Form not found">
      {(form) => {
        const closedLine = acceptanceLine(form.acceptance);
        return (
          <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">{form.name}</h1>
            {closedLine ? (
              <div className="mt-8 flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800" data-testid="apply-closed">
                <Lock className="h-5 w-5 shrink-0 text-gray-500" aria-hidden />
                <p className="font-semibold text-gray-900 dark:text-slate-100">This form is {closedLine.toLowerCase()}.</p>
              </div>
            ) : (
              <form
                className="mt-8 space-y-5"
                data-testid="apply-form"
                onSubmit={async (event) => {
                  const result = await apply.submit(event);
                  if (result) {
                    const url = new URL(result.statusUrl, window.location.origin);
                    router.push(url.pathname + url.search);
                  }
                }}
              >
                <ApplySteps form={form} apply={apply} />
                {apply.error && (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                    {apply.error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={apply.submitting}
                  className="h-12 w-full rounded-xl bg-brand font-semibold text-brand-fg hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto sm:px-10"
                >
                  {apply.submitting ? 'Submitting…' : 'Submit application'}
                </button>
              </form>
            )}
          </main>
        );
      }}
    </StorefrontShell>
  );
}
