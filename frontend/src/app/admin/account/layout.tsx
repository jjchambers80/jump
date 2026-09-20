// Personal account settings (spec 030). Account-scoped: the org switcher
// changes nothing here. Not under /admin/settings (organization settings).

import AccountNav from './AccountNav';

export const metadata = {
  title: 'Account | Jump',
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Account</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Your personal profile and preferences. These settings belong to you, not to an organization.
      </p>
      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <AccountNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
