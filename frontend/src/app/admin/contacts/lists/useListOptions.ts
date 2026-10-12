'use client';

// Events and standing forms an automatic list can filter on (spec 055), for the
// filter builder and the plain-words summary on a list's page.

import { useEffect, useState } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import type { NamedOption } from '@/lib/contactLists';

export function useListOptions(enabled = true) {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const [events, setEvents] = useState<NamedOption[]>([]);
  const [forms, setForms] = useState<NamedOption[]>([]);

  useEffect(() => {
    if (!enabled || orgLoading || !selectedOrgId) return;
    let cancelled = false;
    // Either list may be hidden for this role; the builder then offers fewer filters.
    api
      .get<{ events: NamedOption[] }>('/admin/events')
      .then((result) => !cancelled && setEvents(result.events.map(({ id, name }) => ({ id, name }))))
      .catch(() => !cancelled && setEvents([]));
    api
      .get<{ data: NamedOption[] }>('/admin/standing-application-forms')
      .then((result) => !cancelled && setForms(result.data.map(({ id, name }) => ({ id, name }))))
      .catch(() => !cancelled && setForms([]));
    return () => {
      cancelled = true;
    };
  }, [enabled, orgLoading, selectedOrgId]);

  return { events, forms };
}
