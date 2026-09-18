/**
 * URL slugs for organization names, e.g. "Raleigh Retro Gamers" → "raleigh-retro-gamers".
 * Organizations have no stored slug; the admin org page resolves the slug back
 * to an organization by re-slugifying the names in the org switcher list.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Admin URL for an organization's settings page. */
export function organizationAdminPath(org: { id: string; name: string }): string {
  return `/admin/organization/${slugify(org.name) || org.id}`;
}
