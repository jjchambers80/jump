// URL handle preview: "Raleigh Retro Gamers" -> "raleigh-retro-gamers".
// Mirrors backend/src/utils/slug.js; the server's uniqueSlug() wins when it
// has to append -2, -3, … for a clash.

export const SLUG_MAX_LENGTH = 60;

export function slugify(name: string): string {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}
