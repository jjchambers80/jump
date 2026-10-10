// The storefront logo as the organization's theme defines it (spec 038 Logo
// settings): the logo image override and the header widths. Pages rendered
// outside the theme frame (checkout, confirmation, apply, map, account) read
// it from their payloads so their header matches the themed pages exactly.
// It also carries the theme's button corner radius so their buttons match.
// Null when the organization is not on themes: those pages use the defaults.

import { prisma } from '@jump/db';
import { DEFAULT_PRESET_KEY, getPreset, mobileLogoWidth, resolveSettings } from '@jump/theme';
import storeFileService from './StoreFileService.js';

/** Master switch (contracts C10). Off: every org renders the legacy storefront. */
export function themesMasterSwitch() {
  return process.env.THEME_EDITOR_ENABLED === 'true';
}

export function themesEnabledFor(organization) {
  return themesMasterSwitch() && Boolean(organization?.themesEnabled);
}

async function mainThemeSettings(organizationId) {
  const theme = await prisma.theme.findFirst({
    where: { organizationId, role: 'MAIN' },
    select: { presetKey: true, settings: true },
  });
  const preset = getPreset(theme?.presetKey ?? DEFAULT_PRESET_KEY)?.settings;
  return resolveSettings(theme?.settings ?? {}, preset) ?? {};
}

function storeFileRow(organizationId, fileId) {
  return fileId
    ? prisma.storeFile.findFirst({ where: { id: fileId, organizationId }, include: { file: true, image: true } })
    : null;
}

/**
 * Spec 049 favicon: the organization's square logo (Settings › Brand), else
 * null (the platform default). Themes do not override it.
 *
 * @param {{ squareLogoUrl?: string | null }} organization
 */
export function faviconUrlFor(organization) {
  return organization?.squareLogoUrl ?? null;
}

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/**
 * @param {{ id: string, themesEnabled?: boolean } | null | undefined} organization
 * @returns {Promise<{ url: string | null, desktopWidth: number, mobileWidth: number, buttonRadius: number } | null>}
 *   `url`: the theme's logo image (with `?w=&h=`), or null for the organization logo.
 */
export async function storefrontLogoFor(organization) {
  if (!organization?.id || !themesEnabledFor(organization)) return null;
  const settings = await mainThemeSettings(organization.id);
  const logo = settings.logo ?? {};
  const buttons = settings.buttons ?? {};
  const row = await storeFileRow(organization.id, logo.image?.fileId);
  const url = row ? storeFileService.url(row) : null;
  return {
    url: url && row.width && row.height ? `${url}${url.includes('?') ? '&' : '?'}w=${row.width}&h=${row.height}` : url,
    desktopWidth: num(logo.width, 120),
    mobileWidth: mobileLogoWidth(logo.width),
    // Same rule as the theme frame's --theme-button-radius (frontend theme/settingsCss.ts).
    buttonRadius: buttons.shape === 'pill' ? 9999 : buttons.shape === 'square' ? 0 : num(buttons.radius, 8),
  };
}
