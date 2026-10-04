// The storefront logo as the organization's theme defines it (spec 038 Logo
// settings): the logo image override and the header widths. Pages rendered
// outside the theme frame (checkout, confirmation, apply, map, account) read
// it from their payloads so their header matches the themed pages exactly.
// Null when the organization is not on themes: those pages use the defaults.

import { prisma } from '@jump/db';
import { DEFAULT_PRESET_KEY, getPreset, resolveSettings } from '@jump/theme';
import storeFileService from './StoreFileService.js';

/** Master switch (contracts C10). Off: every org renders the legacy storefront. */
export function themesMasterSwitch() {
  return process.env.THEME_EDITOR_ENABLED === 'true';
}

export function themesEnabledFor(organization) {
  return themesMasterSwitch() && Boolean(organization?.themesEnabled);
}

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/**
 * @param {{ id: string, themesEnabled?: boolean } | null | undefined} organization
 * @returns {Promise<{ url: string | null, desktopWidth: number, mobileWidth: number } | null>}
 *   `url`: the theme's logo image (with `?w=&h=`), or null for the organization logo.
 */
export async function storefrontLogoFor(organization) {
  if (!organization?.id || !themesEnabledFor(organization)) return null;
  const theme = await prisma.theme.findFirst({
    where: { organizationId: organization.id, role: 'MAIN' },
    select: { presetKey: true, settings: true },
  });
  const preset = getPreset(theme?.presetKey ?? DEFAULT_PRESET_KEY)?.settings;
  const logo = resolveSettings(theme?.settings ?? {}, preset)?.logo ?? {};
  const fileId = logo.image?.fileId;
  const row = fileId
    ? await prisma.storeFile.findFirst({
        where: { id: fileId, organizationId: organization.id },
        include: { file: true, image: true },
      })
    : null;
  const url = row ? storeFileService.url(row) : null;
  return {
    url: url && row.width && row.height ? `${url}${url.includes('?') ? '&' : '?'}w=${row.width}&h=${row.height}` : url,
    desktopWidth: num(logo.desktopWidth, 120),
    mobileWidth: num(logo.mobileWidth, 90),
  };
}
