// Serves the Monaco editor's AMD build (monaco-editor/min) for the theme code
// editor, so the admin never loads editor code from a CDN and tests run
// offline. Read-only, files under min/ only.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Located on disk, not through require.resolve: webpack would try to bundle
// it, and monaco-editor's exports map hides package.json. The workspace
// install hoists it to the repo root; a frontend-only install keeps it local.
const ROOT =
  [path.join(process.cwd(), 'node_modules/monaco-editor/min'), path.join(process.cwd(), '../node_modules/monaco-editor/min')].find((dir) =>
    existsSync(dir),
  ) ?? '';
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
};

export async function GET(_req: Request, { params }: { params: { path: string[] } }) {
  const file = path.join(ROOT, ...params.path);
  const type = TYPES[path.extname(file)];
  if (!ROOT || !type || !file.startsWith(ROOT + path.sep)) return new Response('Not found', { status: 404 });
  try {
    const body = await readFile(file);
    // monaco-editor is pinned (root package.json overrides), so a day is safe.
    return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
