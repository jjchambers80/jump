// Validator paths → sentences an organizer can act on (spec 038D).
// "documents.home.content[0].props.image" + "needs alt text…" becomes
// "Home page › Hero › Image: needs alt text…".

import { BLOCKS, COMMON_SECTION_FIELDS, SECTIONS } from '@jump/theme';
import type { ThemeDocumentData } from '@/lib/themes';

const DOC_LABELS: Record<string, string> = { header: 'Header', footer: 'Footer', home: 'Home page', events: 'Events page' };
const ROOT_LABELS: Record<string, string> = { title: 'Page title', seoTitle: 'SEO title', seoDescription: 'SEO description' };

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

/** Server errors are keyed "documents.<key>.<path>"; anything else is shown as sent. */
export function describeSaveError(fullPath: string, message: string, docs: Record<string, ThemeDocumentData | null | undefined>) {
  const m = fullPath.match(/^documents\.([a-z_:]+[A-Za-z0-9_-]*?)\.(content\[.*|root\..*)$/);
  if (m) return describeDocumentError(m[1], m[2], message, docs[m[1]]);
  const whole = fullPath.match(/^documents\.([^.]+)$/);
  if (whole) return `${DOC_LABELS[whole[1]] ?? whole[1]}: ${message}`;
  return `${fullPath}: ${message}`;
}
