// Saved list views (spec 011 phase 3, shared by spec 019): named filter sets
// kept in this browser under a key per list. The URL stays the shareable
// form; a view is a shortcut to one.

export interface SavedView<Q extends object> {
  name: string;
  query: Q;
}

export function readSavedViews<Q extends object>(key: string): SavedView<Q>[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => v && typeof v.name === 'string' && v.query && typeof v.query === 'object') : [];
  } catch {
    return [];
  }
}

export function writeSavedViews<Q extends object>(key: string, views: SavedView<Q>[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(views));
  } catch {
    // Private mode or quota: views are a convenience, the URL still works.
  }
}

/** Stable identity of a filter set: the listed keys, empty when unset, in a fixed order. */
export function viewKey<Q extends object>(query: Q, keys: (keyof Q)[]): string {
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, (query[k] as unknown as string | undefined) || ''])));
}
