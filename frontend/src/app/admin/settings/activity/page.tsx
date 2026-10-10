// Settings › Activity log (spec 048) — who changed what in the active
// organization, from staff, the CLI, agents, sweeps and Stripe. ADMIN /
// SYSTEM_ADMIN only (SettingsNav hides the link for other roles; the backend
// checks the role in *this* organization). Rows are kept AUDIT_RETENTION_DAYS.

'use client';

import { useSession } from 'next-auth/react';
import { SettingsShell } from '../users/shared';
import ActivityLog from './ActivityLog';

export default function ActivityLogPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role;
  if (status === 'authenticated' && !['ADMIN', 'SYSTEM_ADMIN'].includes(role)) {
    return (
      <SettingsShell>
        <section className="min-w-0 flex-1 px-4 py-16 text-center">
          <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">Access denied</h2>
          <p className="text-gray-600 dark:text-slate-400">Admin role required to view the activity log.</p>
        </section>
      </SettingsShell>
    );
  }
  return (
    <SettingsShell>
      <ActivityLog />
    </SettingsShell>
  );
}

