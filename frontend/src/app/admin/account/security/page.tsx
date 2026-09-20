'use client';

// Account › Security (spec 030). Devices (feature D) is live; sign-in
// methods (B) and two-step authentication (C) replace the placeholder
// cards when they land.

import DevicesCard from './DevicesCard';

const placeholderClass =
  'rounded-xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 sm:p-5';

export default function AccountSecurityPage() {
  return (
    <section aria-labelledby="account-security-heading">
      <h2 id="account-security-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
        Security
      </h2>
      <div className="mt-4 space-y-4">
        <div className={placeholderClass}>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Sign-in methods</h3>
          <p className="mt-1">Passkeys, password, connected accounts and a secondary email are coming soon.</p>
        </div>
        <div className={placeholderClass}>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Two-step authentication</h3>
          <p className="mt-1">Coming soon.</p>
        </div>
        <DevicesCard />
      </div>
    </section>
  );
}
