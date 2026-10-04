// Applications for this organization (spec 011 / 037 phase 5) and the
// applicant's business profile, as their own account section (spec 040).
'use client';

import { ClipboardList } from 'lucide-react';
import { useAccount } from '@/components/account/AccountContext';
import ApplicationsSection from './ApplicationsSection';
import ApplicantProfileSection from './ApplicantProfileSection';

export default function AccountApplicationsPage() {
  const { applications } = useAccount();
  return (
    <div className="space-y-10">
      {applications !== null && applications.length === 0 && (
        <p className="flex items-center gap-3 rounded-2xl border border-dashed border-gray-300 p-6 text-gray-600 dark:border-slate-600 dark:text-slate-400">
          <ClipboardList aria-hidden className="h-5 w-5 shrink-0 text-gray-400 dark:text-slate-500" />
          No applications yet.
        </p>
      )}
      <ApplicationsSection />
      <ApplicantProfileSection />
    </div>
  );
}
