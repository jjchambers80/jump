// Validator paths → sentences an organizer can act on (spec 038D).
// "documents.home.content[0].props.image" + "needs alt text…" becomes
// "Home page › Hero › Image: needs alt text…".

import { BLOCKS, COMMON_SECTION_FIELDS, SECTIONS, SETTINGS_GROUPS } from '@jump/theme';
import type { ThemeDocumentData } from '@/lib/themes';

const DOC_LABELS: Record<string, string> = { header: 'Header', footer: 'Footer', home: 'Home page', events: 'Events page' };
const ROOT_LABELS: Record<string, string> = { title: 'Page title', seoTitle: 'SEO title', seoDescription: 'SEO description', pageWidth: 'Page width' };

type Item = { type: string; props: Record<string, any> };

function labelOf(type: string | undefined) {
  return (type && ((SECTIONS as any)[type]?.label ?? (BLOCKS as any)[type]?.label)) || 'Section';
}

function fieldLabel(type: string | undefined, key: string) {
  const def = type ? ((SECTIONS as any)[type] ?? (BLOCKS as any)[type]) : null;
  const spec = def?.settings?.[key] ?? (COMMON_SECTION_FIELDS as any)[key];
  if (spec?.label) return spec.label as string;
  if (key === 'blocks') return 'Buttons';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * @param key   document key (header, footer, home, events)
 * @param path  validator path inside the document, e.g. "content[0].props.blocks[1].props.link"
 * @param doc   the document that was validated, to name the sections
 */
export function describeDocumentError(key: string, path: string, message: string, doc?: ThemeDocumentData | null) {
  const parts = [DOC_LABELS[key] ?? key];
  const m = path.match(/^content\[(\d+)\](?:\.props\.blocks\[(\d+)\])?(?:\.props\.([A-Za-z]+))?/);
  if (m) {
    const section = doc?.content?.[Number(m[1])] as Item | undefined;
    parts.push(labelOf(section?.type));
    let owner = section;
    if (m[2] !== undefined) {
      owner = (section?.props?.blocks as Item[] | undefined)?.[Number(m[2])];
      parts.push(`${labelOf(owner?.type)} ${Number(m[2]) + 1}`);
    }
    if (m[3] && m[3] !== 'id') parts.push(fieldLabel(owner?.type, m[3]));
  } else if (path.startsWith('root.props.')) {
    parts.push(ROOT_LABELS[path.slice('root.props.'.length)] ?? 'Page settings');
  }
  return `${parts.join(' › ')}: ${message}`;
}

const SLOT_LABELS: Record<string, string> = { foreground: 'Text', accentForeground: 'Text on accent', secondaryButtonLabel: 'Secondary button label', muted: 'Muted text' };

/**
 * Settings validator paths: "colors.schemes[1].accent" → "Theme settings ›
 * Colors › Inverse › Accent", "typography.headingFont" → "… › Typography › Heading font".
 */
export function describeSettingsError(path: string, message: string, settings?: Record<string, any> | null) {
  const parts = ['Theme settings'];
  const scheme = path.match(/^colors\.schemes\[(\d+)\](?:\.(\w+))?/);
  const field = path.match(/^(\w+)(?:\.(\w+))?$/);
  if (scheme) {
    parts.push('Colors', settings?.colors?.schemes?.[Number(scheme[1])]?.name || `Scheme ${Number(scheme[1]) + 1}`);
    const slot = scheme[2];
    if (slot) parts.push(SLOT_LABELS[slot] ?? slot.charAt(0).toUpperCase() + slot.slice(1));
  } else if (field && (SETTINGS_GROUPS as any)[field[1]]) {
    const group = (SETTINGS_GROUPS as any)[field[1]];
    parts.push(group.label);
    if (field[2]) parts.push(group.fields?.[field[2]]?.label ?? field[2]);
  } else parts.push(path);
  return `${parts.join(' › ')}: ${message}`;
}

/** Server errors are keyed "documents.<key>.<path>" or a settings path; anything else is shown as sent. */
export function describeSaveError(
  fullPath: string,
  message: string,
  docs: Record<string, ThemeDocumentData | null | undefined>,
  settings?: Record<string, any> | null,
) {
  const m = fullPath.match(/^documents\.([a-z_:]+[A-Za-z0-9_-]*?)\.(content\[.*|root\..*)$/);
  if (m) return describeDocumentError(m[1], m[2], message, docs[m[1]]);
  const whole = fullPath.match(/^documents\.([^.]+)$/);
  if (whole) return `${DOC_LABELS[whole[1]] ?? whole[1]}: ${message}`;
  if ((SETTINGS_GROUPS as any)[fullPath.split(/[.[]/)[0]])
    return describeSettingsError(fullPath, message, settings);
  return `${fullPath}: ${message}`;
}
