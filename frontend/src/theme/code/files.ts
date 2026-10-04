// Theme as files for the browser code editor: the same layout `jump theme
// pull` writes (spec 043), the same checks as `jump theme check`, and the
// same PUT /save body the CLI pushes (only what changed, with versions).

import { findNodeAtLocation, parseTree, type ParseError, parse } from 'jsonc-parser';
import { DOCUMENTS, checkTheme, themeSchema } from '@jump/theme';
import type { ThemeDocumentData, ThemeSaveBody } from '@/lib/themes';

export const SCHEMA_PATH = '.jump/schema.json';
export const DOC_KEYS = Object.keys(DOCUMENTS);
export const docPath = (key: string) => `documents/${key}.json`;

export interface ThemeFiles {
  settings: Record<string, any>;
  content: Record<string, string>;
  documents: Record<string, ThemeDocumentData>;
}

export interface Problem {
  path: string;
  /** Location inside the file, for markers: a validator path or a parse offset. */
  at: (string | number)[] | null;
  offset?: number;
  message: string;
}

export const toText = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** path → text, in explorer order. The schema is read-only. */
export function filesToTexts(files: ThemeFiles): Record<string, string> {
  return {
    'settings.json': toText(files.settings),
    'content.json': toText(files.content),
    ...Object.fromEntries(DOC_KEYS.map((key) => [docPath(key), toText(files.documents[key])])),
    [SCHEMA_PATH]: toText(themeSchema()),
  };
}

/** Texts back to values; files that do not parse are reported and left out. */
export function parseTexts(texts: Record<string, string>): { files: ThemeFiles; problems: Problem[] } {
  const problems: Problem[] = [];
  const read = (path: string) => {
    const errors: ParseError[] = [];
    const value = parse(texts[path] ?? '', errors, { allowTrailingComma: false, disallowComments: true });
    if (errors.length) {
      problems.push({ path, at: null, offset: errors[0].offset, message: 'is not valid JSON' });
      return undefined;
    }
    return value;
  };
  const documents: Record<string, ThemeDocumentData> = {};
  for (const key of DOC_KEYS) {
    const value = read(docPath(key));
    if (value !== undefined) documents[key] = value;
  }
  return { files: { settings: read('settings.json') ?? {}, content: read('content.json') ?? {}, documents }, problems };
}

/** `content[0].props.blocks[1]` → ['content', 0, 'props', 'blocks', 1]. */
export function splitPath(path: string): (string | number)[] {
  if (path === '.' || path === '') return [];
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/** Server-side checks, run here, as problems per file. */
export function checkTexts(texts: Record<string, string>, presetKey: string): Problem[] {
  const { files, problems } = parseTexts(texts);
  const broken = new Set(problems.map((p) => p.path));
  for (const [key, message] of Object.entries(checkTheme(files, presetKey) as Record<string, string>)) {
    let path: string;
    let at: (string | number)[];
    if (key.startsWith('settings.')) {
      path = 'settings.json';
      at = splitPath(key.slice('settings.'.length));
    } else if (key.startsWith('content.')) {
      // validateContent names keys "content.<key>" (or "content" for the whole
      // file), and content keys hold dots themselves ("events.upcoming").
      path = 'content.json';
      const inner = key.slice('content.'.length);
      at = inner === 'content' ? [] : [inner.replace(/^content\./, '')];
    } else {
      const m = key.match(/^documents\.([^.]+)\.(.*)$/);
      if (!m) continue;
      path = docPath(m[1]);
      at = m[2] === 'key' ? [] : splitPath(m[2]);
    }
    if (!broken.has(path)) problems.push({ path, at, message });
  }
  return problems;
}

/** Text range of a problem: the node at its path, else its nearest parent. */
export function rangeFor(text: string, problem: Problem): { offset: number; length: number } {
  if (problem.offset !== undefined) return { offset: problem.offset, length: 1 };
  const tree = parseTree(text);
  if (!tree) return { offset: 0, length: 1 };
  for (let n = problem.at?.length ?? 0; n >= 0; n--) {
    const node = findNodeAtLocation(tree, (problem.at ?? []).slice(0, n));
    if (node) {
      // A property's key reads better than its whole value.
      const key = node.parent?.type === 'property' ? node.parent.children?.[0] : undefined;
      return key ? { offset: key.offset, length: key.length } : { offset: node.offset, length: Math.min(node.length, 1) };
    }
  }
  return { offset: 0, length: 1 };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The PUT /save body for what changed, or null when nothing did. */
export function saveBody(
  original: ThemeFiles,
  edited: ThemeFiles,
  versions: Record<string, number>,
  themeVersion: number,
): ThemeSaveBody | null {
  const body: ThemeSaveBody = { themeVersion };
  if (!same(original.settings, edited.settings)) body.settings = edited.settings;
  if (!same(original.content, edited.content)) body.content = edited.content;
  const documents: NonNullable<ThemeSaveBody['documents']> = {};
  for (const key of DOC_KEYS) {
    if (key in edited.documents && !same(original.documents[key], edited.documents[key])) {
      documents[key] = { data: edited.documents[key], version: versions[key] ?? 0 };
    }
  }
  if (Object.keys(documents).length) body.documents = documents;
  return Object.keys(body).length > 1 ? body : null;
}
