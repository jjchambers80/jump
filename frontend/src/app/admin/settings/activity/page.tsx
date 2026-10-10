// Settings › Activity log (spec 048) — who changed what in the active
// organization, from staff, the CLI, agents, sweeps and Stripe. Needs
// settings.activity (System › Roles; ADMIN by default) in *this* organization —
// SettingsNav hides the link otherwise and the backend enforces it. Rows are kept AUDIT_RETENTION_DAYS.

'use client';

import { useCan } from '@/components/OrgContext';
import { SettingsShell } from '../users/shared';
import ActivityLog from './ActivityLog';

export default function ActivityLogPage() {
  if (!useCan('settings.activity')) {
    return (
      <SettingsShell>
        <section className="min-w-0 flex-1 px-4 py-16 text-center">
          <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">Access denied</h2>
          <p className="text-gray-600 dark:text-slate-400">Your role in this organization cannot view the activity log.</p>
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

