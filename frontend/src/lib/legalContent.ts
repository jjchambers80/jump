// Server-only loader for the public legal pages (spec 023 LR-01/LR-02).
// Reads `frontend/content/legal/<slug>.md`, parses the front matter and
// renders the Markdown body. Dark until NEXT_PUBLIC_LEGAL_PAGES_ENABLED.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';

export const LEGAL_SLUGS = [
  'terms',
  'privacy',
  'organizer-terms',
  'copyright',
  'accessibility',
  'acceptable-use',
] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export interface LegalDocumentMeta {
  title: string;
  version: string;
  effectiveDate: string;
  audience: string;
}

export interface LegalDocumentContent extends LegalDocumentMeta {
  slug: LegalSlug;
  html: string;
}

export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(value);
}

/** Split `---` front matter from the body; keys are plain `key: value` lines. */
export function parseFrontMatter(source: string): { meta: Record<string, string>; body: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: source };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    meta[line.slice(0, idx).trim()] = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return { meta, body: match[2] };
}

const REQUIRED: (keyof LegalDocumentMeta)[] = ['title', 'version', 'effectiveDate', 'audience'];

/** The rendered document, or null when the file is absent or incomplete. */
export async function loadLegalDocument(slug: LegalSlug): Promise<LegalDocumentContent | null> {
  let source: string;
  try {
    source = await readFile(path.join(process.cwd(), 'content', 'legal', `${slug}.md`), 'utf8');
  } catch {
    return null;
  }
  const { meta, body } = parseFrontMatter(source);
  if (REQUIRED.some((key) => !meta[key])) return null;
  const html = await marked.parse(body, { gfm: true });
  return {
    slug,
    title: meta.title,
    version: meta.version,
    effectiveDate: meta.effectiveDate,
    audience: meta.audience,
    html,
  };
}
