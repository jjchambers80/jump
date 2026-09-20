'use client';

// Placeholder until spec 030 features B (sign-in methods), C (two-step) and
// D (devices) land. The route exists so the nav is stable across those PRs.

export default function AccountSecurityPage() {
  return (
    <section aria-labelledby="account-security-heading">
      <h2 id="account-security-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
        Security
      </h2>
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        Passkeys, password, secondary email, two-step authentication and device management are coming soon.
      </div>
    </section>
  );
}
