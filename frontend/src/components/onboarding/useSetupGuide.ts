'use client';

// One fetch of GET /admin/setup-guide per mount, keyed on the selected
// organization. The sidebar, the dashboard banner and the checklist page each
// mount it; a dismiss broadcasts a window event so every copy hides together.
// Refetches on window focus so returning from Stripe or a settings tab
// updates the checks.

import { useCallback, useEffect, useState } from 'react';
import adminService, { type SetupGuide } from '@/services/adminService';
import { useOrg } from '@/components/OrgContext';

const CHANGED = 'jump:setup-guide-changed';

export function useSetupGuide() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const [guide, setGuide] = useState<SetupGuide | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminService.getSetupGuide();
      setGuide(Array.isArray(data?.tasks) ? data : null);
    } catch {
      setGuide(null); // the guide is optional; never block a page
    }
  }, []);

  useEffect(() => {
    if (orgLoading || !selectedOrgId) return;
    load();
    window.addEventListener('focus', load);
    window.addEventListener(CHANGED, load);
    return () => {
      window.removeEventListener('focus', load);
      window.removeEventListener(CHANGED, load);
    };
  }, [orgLoading, selectedOrgId, load]);

  const dismiss = useCallback(async () => {
    await adminService.dismissSetupGuide();
    setGuide((g) => (g ? { ...g, dismissedAt: new Date().toISOString() } : g));
    window.dispatchEvent(new Event(CHANGED));
  }, []);

  const tasks = guide?.tasks.filter((t) => t.shown) ?? [];
  const done = tasks.filter((t) => t.done).length;
  return {
    guide,
    tasks,
    done,
    total: tasks.length,
    complete: tasks.length > 0 && done === tasks.length,
    dismiss,
  };
}
