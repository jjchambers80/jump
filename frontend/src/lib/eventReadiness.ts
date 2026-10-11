// Event readiness (spec 050 §7.2): the shape GET …/readiness returns and the
// blockers a 422 EVENT_NOT_READY publish carries in `details`.

export interface ReadinessItem {
  code: string;
  step: string;
  message: string;
  formId?: string;
}

export interface EventReadiness {
  ready: boolean;
  blockers: ReadinessItem[];
  warnings: ReadinessItem[];
}

/** The blockers of a refused publish, or null when the error is something else. */
export function publishBlockers(err: unknown): ReadinessItem[] | null {
  const e = err as { status?: number; code?: string; details?: { blockers?: ReadinessItem[] } } | null;
  if (e?.status !== 422 || e.code !== 'EVENT_NOT_READY' || !Array.isArray(e.details?.blockers)) return null;
  return e.details.blockers;
}

/** Org settings an item is fixed in, with the permission catalog action (backend/src/permissions/catalog.js) that may change them. */
const SETTINGS_FIX: Record<string, { href: string; permission: string; who: string }> = {
  PAYMENTS_UNAVAILABLE: { href: '/admin/settings/payments', permission: 'settings.payments', who: 'An admin needs to finish payments setup.' },
  TAX_RATE_UNRESOLVED: { href: '/admin/settings/tax', permission: 'settings.tax', who: 'An admin needs to finish tax setup.' },
};

/** The catalog permission needed to follow an item's link, and what to say without it; null when anyone can. */
export function readinessSettingsFix(item: ReadinessItem): { permission: string; who: string } | null {
  return SETTINGS_FIX[item.code] ?? null;
}

/**
 * Where an item is fixed. Until the wizard's edit mode (050-O) these are the
 * existing editors; then this becomes `/admin/events/<id>/setup?step=<step>`.
 */
export function readinessHref(item: ReadinessItem, eventId: string, orgId: string | null): string {
  const q = orgId ? `?orgId=${encodeURIComponent(orgId)}` : '';
  const base = `/admin/events/${eventId}`;
  if (SETTINGS_FIX[item.code]) return SETTINGS_FIX[item.code].href;
  if (item.code === 'CAPACITY_MISSING') return `${base}/edit/sales${q}#event-admission`;
  switch (item.step) {
    case 'name':
      return `${base}/edit/details${q}#event-details`;
    case 'venue':
    case 'date':
      return `${base}/edit/details${q}#event-when-where`;
    case 'description':
      return `${base}/edit/details${q}#event-details`;
    case 'image':
      return `${base}/edit/details${q}#event-media`;
    case 'tickets':
      return `${base}/edit/sales${q}#event-price-tiers`;
    case 'floor-map':
      return `${base}/map${q}`;
    case 'vendors':
    case 'special-guests':
    case 'volunteers':
    case 'other-applications':
      return `${base}/applications/forms${q}`;
    default:
      return `${base}${q}`;
  }
}
