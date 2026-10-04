'use client';

// Online Store › Edit code: the theme as the files `jump theme pull` writes
// (settings.json, content.json, documents/<key>.json, read-only
// .jump/schema.json), edited in Monaco with the server's own checks and saved
// through PUT /admin/themes/:id/save like `jump theme push`. JSON only: a
// theme has no CSS, HTML or script to edit (spec 043).

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { ArrowLeft, ChevronDown, ChevronRight, CircleX, FileJson, Files, Lock, X } from 'lucide-react';
import ActionsMenu from '@/components/ActionsMenu';
import { useOrg } from '@/components/OrgContext';
import { useThemeMode } from '@/components/ThemeProvider';
import { editorHref, themesApi, type ThemeDetail } from '@/lib/themes';
import RevisionsDialog from '../editor/RevisionsDialog';
import { DOC_KEYS, SCHEMA_PATH, checkTexts, docPath, filesToTexts, parseTexts, rangeFor, saveBody, type Problem, type ThemeFiles } from './files';

// Same-origin copy of monaco-editor/min (app/api/monaco), never a CDN.
loader.config({ paths: { vs: '/api/monaco/vs' } });

const BACKUP_KEY = 'jump.theme-code.backup.';
const LIVE_NOTE_KEY = 'jump.theme-editor.live-note.';
const MARKER_OWNER = 'jump-theme';

interface Loaded {
  theme: ThemeDetail;
  files: ThemeFiles;
  versions: Record<string, number>;
}

async function loadTheme(themeId: string): Promise<Loaded> {
  const [theme, content, ...documents] = await Promise.all([
    themesApi.get(themeId),
    themesApi.content(themeId),
    ...DOC_KEYS.map((key) => themesApi.document(themeId, key)),
  ]);
  return {
    theme,
    files: {
      settings: theme.settings ?? {},
      content: content.overrides ?? {},
      documents: Object.fromEntries(DOC_KEYS.map((key, i) => [key, documents[i].data])),
    },
    versions: Object.fromEntries(DOC_KEYS.map((key, i) => [key, documents[i].version])),
  };
}

const fileName = (path: string) => path.split('/').pop() as string;
const button =
  'inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

export default function CodeEditor({ themeId }: { themeId: string }) {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const { setForced } = useThemeMode();
  useEffect(() => {
    setForced('light');
    return () => setForced(null);
  }, [setForced]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [themeVersion, setThemeVersion] = useState(1);
  const [tabs, setTabs] = useState<string[]>([docPath('home')]);
  const [active, setActive] = useState(docPath('home'));
  const [docsOpen, setDocsOpen] = useState(true);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'status' | 'live'; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [backup, setBackup] = useState<Record<string, string> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const saveRef = useRef<() => void>(() => {});

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await loadTheme(themeId);
      const nextTexts = filesToTexts(next.files);
      setLoaded(next);
      setSaved(nextTexts);
      setTexts(nextTexts);
      setThemeVersion(next.theme.version);
      // Models outlive the component's state: put the fresh text into any open one.
      monacoRef.current?.editor.getModels().forEach((model: editor.ITextModel) => {
        const text = nextTexts[model.uri.path.replace(/^\//, '')];
        if (text !== undefined && model.getValue() !== text) model.setValue(text);
      });
    } catch (err: any) {
      setLoadError(err?.message || 'Could not open the theme');
    }
  }, [themeId]);

  useEffect(() => {
    if (orgLoading || !selectedOrgId) return;
    void reload();
    try {
      const raw = window.sessionStorage.getItem(BACKUP_KEY + themeId);
      if (raw) setBackup(JSON.parse(raw));
    } catch {
      /* no backup */
    }
  }, [themeId, selectedOrgId, orgLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirtyPaths = useMemo(() => Object.keys(texts).filter((path) => texts[path] !== saved[path]), [texts, saved]);
  const dirty = dirtyPaths.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // The server's checks, a beat after typing stops.
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => setProblems(checkTexts(texts, loaded.theme.presetKey)), 250);
    return () => window.clearTimeout(timer);
  }, [texts, loaded]);

  // Validator problems as squiggles; Monaco's JSON mode marks syntax errors itself.
  const paintMarkers = useCallback(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    for (const model of monaco.editor.getModels()) {
      const path = model.uri.path.replace(/^\//, '');
      const text = model.getValue();
      const markers = problems
        .filter((p) => p.path === path && p.offset === undefined)
        .map((p) => {
          const range = rangeFor(text, p);
          const start = model.getPositionAt(range.offset);
          const end = model.getPositionAt(range.offset + range.length);
          return {
            severity: monaco.MarkerSeverity.Error,
            message: p.message,
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          };
        });
      monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
    }
  }, [problems]);
  useEffect(paintMarkers, [paintMarkers, active]);

  const open = (path: string) => {
    setTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActive(path);
  };
  const close = (path: string) => {
    const next = tabs.filter((t) => t !== path);
    setTabs(next);
    if (active === path && next.length) setActive(next[next.length - 1]);
  };

  const reveal = (problem: Problem) => {
    open(problem.path);
    // The model for a newly opened tab exists after the next render.
    window.setTimeout(() => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model) return;
      const range = rangeFor(model.getValue(), problem);
      const at = model.getPositionAt(range.offset);
      editor.revealLineInCenter(at.lineNumber);
      editor.setPosition(at);
      editor.focus();
    }, 50);
  };

  const save = async () => {
    if (!loaded || !dirty || saving) return;
    setMessage(null);
    if (problems.length) {
      setProblemsOpen(true);
      setMessage({ kind: 'error', text: `Fix ${problems.length === 1 ? 'the problem' : `${problems.length} problems`} before saving.` });
      return;
    }
    const body = saveBody(parseTexts(saved).files, parseTexts(texts).files, loaded.versions, themeVersion);
    if (!body) {
      // Formatting only: nothing for the server to store.
      setSaved(texts);
      return;
    }
    setSaving(true);
    try {
      const result = await themesApi.save(themeId, body);
      setSaved(texts);
      setThemeVersion(result.theme.version);
      setLoaded((prev) => (prev ? { ...prev, versions: { ...prev.versions, ...result.documents } } : prev));
      window.sessionStorage.removeItem(BACKUP_KEY + themeId);
      if (loaded.theme.role === 'MAIN' && !window.sessionStorage.getItem(LIVE_NOTE_KEY + themeId)) {
        window.sessionStorage.setItem(LIVE_NOTE_KEY + themeId, '1');
        setMessage({ kind: 'live', text: "You're editing your live store: saved changes are visible to visitors right away." });
      } else {
        setMessage({ kind: 'status', text: 'Saved' });
      }
    } catch (err: any) {
      if (err?.status === 409) {
        try {
          window.sessionStorage.setItem(BACKUP_KEY + themeId, JSON.stringify(texts));
        } catch {
          /* storage full: the dialog still explains */
        }
        setConflict(true);
      } else {
        const errors = err?.details?.errors as Record<string, string> | undefined;
        const details = errors ? Object.entries(errors).map(([path, msg]) => `${path}: ${msg}`).join('; ') : '';
        setMessage({ kind: 'error', text: `${err?.message || 'Could not save'}${details ? ` (${details})` : ''}` });
      }
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = () => void save();

  const applyBackup = () => {
    if (!backup) return;
    monacoRef.current?.editor.getModels().forEach((model: editor.ITextModel) => {
      const text = backup[model.uri.path.replace(/^\//, '')];
      if (text !== undefined) model.setValue(text);
    });
    setTexts(backup);
    setBackup(null);
    window.sessionStorage.removeItem(BACKUP_KEY + themeId);
  };

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
    editor.onDidChangeCursorPosition((e) => setCursor({ line: e.position.lineNumber, column: e.position.column }));
    paintMarkers();
  };

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="text-center">
          <p role="alert" className="text-gray-800">
            {loadError}
          </p>
          <Link href="/admin/online-store" className="mt-4 inline-block text-sm font-medium text-indigo-700 hover:underline">
            Back to Online Store
          </Link>
        </div>
      </div>
    );
  }
  if (!loaded) {
    return <div className="min-h-screen animate-pulse bg-gray-100" aria-busy="true" aria-label="Loading the code editor" />;
  }

  const readOnly = active === SCHEMA_PATH;
  const problemCount = (path: string) => problems.filter((p) => p.path === path).length;
  const fileButton = (path: string, label: string, indent: boolean) => {
    const count = problemCount(path);
    return (
      <li key={path}>
        <button
          type="button"
          onClick={() => open(path)}
          aria-current={active === path ? 'true' : undefined}
          className={`flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-[13px] hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
            indent ? 'pl-7' : 'pl-3'
          } ${active === path ? 'bg-indigo-100 text-indigo-900' : 'text-gray-800'}`}
        >
          {path === SCHEMA_PATH ? <Lock className="h-3.5 w-3.5 text-gray-500" aria-hidden /> : <FileJson className="h-3.5 w-3.5 text-amber-600" aria-hidden />}
          <span className={`flex-1 truncate ${count ? 'text-red-700' : ''}`}>{label}</span>
          {count > 0 && <span className="text-[11px] text-red-700">{count}</span>}
          {dirtyPaths.includes(path) && (
            <span className="h-2 w-2 rounded-full bg-gray-500" aria-label="Unsaved changes" />
          )}
        </button>
      </li>
    );
  };
  const badge = loaded.theme.role === 'MAIN' ? 'Active' : 'Draft';

  return (
    <div className="flex h-screen flex-col bg-white text-gray-900">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-50 px-2">
        <Link
          href="/admin/online-store"
          onClick={(e) => {
            if (dirty && !window.confirm('Leave the code editor? Unsaved changes will be lost.')) e.preventDefault();
          }}
          className={button}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Exit
        </Link>
        <Link
          href={editorHref(themeId)}
          onClick={(e) => {
            if (dirty && !window.confirm('Open the visual editor? Unsaved changes will be lost.')) e.preventDefault();
          }}
          className={button}
        >
          Customize
        </Link>
        <div className="mx-auto flex min-w-0 max-w-md flex-1 items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700">
          <h1 className="truncate font-medium">{loaded.theme.name}</h1>
          <span className={`rounded px-1.5 text-[11px] font-semibold ${badge === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>{badge}</span>
        </div>
        {loaded.theme.role === 'MAIN' && (
          <ActionsMenu label="More code editor actions" items={[{ label: 'Revision history', onSelect: () => setHistoryOpen(true) }]} />
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {(message || backup) && (
        <div className="space-y-1 border-b border-gray-200 px-4 py-1.5 text-sm">
          {backup && (
            <p className="flex items-center justify-between gap-3 text-gray-800">
              <span>Your unsaved edits from before the reload are kept for this session.</span>
              <button type="button" className="text-xs font-medium text-indigo-700 underline" onClick={applyBackup}>
                Apply them again
              </button>
            </p>
          )}
          {message && (
            <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-red-800' : message.kind === 'live' ? 'text-amber-900' : 'text-green-800'}>
              {message.text}
            </p>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Activity" className="flex w-12 shrink-0 flex-col items-center border-r border-gray-200 bg-gray-100 py-2">
          <span className="rounded p-2 text-gray-900" title="Explorer">
            <Files className="h-5 w-5" aria-hidden />
          </span>
        </nav>

        <aside aria-label="Explorer" className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-gray-50">
          <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">Explorer</p>
          <p className="truncate px-3 py-1 text-[11px] font-bold uppercase text-gray-700">{loaded.theme.name}</p>
          <ul>
            {fileButton('settings.json', 'settings.json', false)}
            {fileButton('content.json', 'content.json', false)}
            <li>
              <button
                type="button"
                aria-expanded={docsOpen}
                onClick={() => setDocsOpen((v) => !v)}
                className="flex w-full items-center gap-1 py-0.5 pl-2 text-left text-[13px] text-gray-800 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
              >
                {docsOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                documents
              </button>
              {docsOpen && <ul>{DOC_KEYS.map((key) => fileButton(docPath(key), `${key}.json`, true))}</ul>}
            </li>
            {fileButton(SCHEMA_PATH, SCHEMA_PATH, false)}
          </ul>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div role="tablist" aria-label="Open files" className="flex h-9 shrink-0 overflow-x-auto border-b border-gray-200 bg-gray-50">
            {tabs.map((path) => (
              <div
                key={path}
                className={`flex items-center border-r border-gray-200 text-[13px] ${active === path ? 'bg-white text-gray-900' : 'text-gray-600'}`}
              >
                <button type="button" role="tab" aria-selected={active === path} onClick={() => setActive(path)} className="flex items-center gap-1.5 py-1.5 pl-3 pr-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
                  <FileJson className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                  {fileName(path)}
                  {dirtyPaths.includes(path) && <span className="h-2 w-2 rounded-full bg-gray-500" aria-label="Unsaved changes" />}
                </button>
                {tabs.length > 1 && (
                  <button type="button" onClick={() => close(path)} aria-label={`Close ${fileName(path)}`} className="mr-1 rounded p-0.5 hover:bg-gray-200">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="shrink-0 px-4 py-0.5 text-xs text-gray-500" data-testid="breadcrumb">
            {active.split('/').join(' › ')}
            {readOnly && ' (read only)'}
          </p>
          <div className="min-h-0 flex-1" data-testid="code-editor">
            <Editor
              path={active}
              defaultLanguage="json"
              defaultValue={texts[active]}
              onChange={(value) => setTexts((prev) => (prev[active] === value ? prev : { ...prev, [active]: value ?? '' }))}
              onMount={onMount}
              theme="vs"
              loading={<div className="h-full animate-pulse bg-gray-50" aria-label="Loading the editor" />}
              options={{
                readOnly,
                tabSize: 2,
                insertSpaces: true,
                fontSize: 13,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                renderWhitespace: 'none',
              }}
            />
          </div>
          {problemsOpen && (
            <section aria-label="Problems" className="max-h-48 shrink-0 overflow-y-auto border-t border-gray-200 bg-white text-[13px]">
              <div className="flex items-center justify-between px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Problems
                <button type="button" onClick={() => setProblemsOpen(false)} aria-label="Close problems" className="rounded p-0.5 hover:bg-gray-200">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              {problems.length === 0 ? (
                <p className="px-3 pb-2 text-gray-600">No problems.</p>
              ) : (
                <ul>
                  {problems.map((p, i) => (
                    <li key={`${p.path}-${i}`}>
                      <button type="button" onClick={() => reveal(p)} className="flex w-full items-center gap-2 px-3 py-0.5 text-left hover:bg-gray-100">
                        <CircleX className="h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden />
                        <span className="text-gray-900">
                          {p.at?.length ? `${p.at.join('.')}: ` : ''}
                          {p.message}
                        </span>
                        <span className="text-gray-500">{p.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </main>
      </div>

      <footer className="flex h-6 shrink-0 items-center gap-4 bg-indigo-700 px-3 text-[11px] text-white">
        <button type="button" onClick={() => setProblemsOpen((v) => !v)} className="inline-flex items-center gap-1 hover:underline" aria-expanded={problemsOpen}>
          <CircleX className="h-3 w-3" aria-hidden />
          <span data-testid="problem-count">{problems.length}</span>
          <span className="sr-only">problems</span>
        </button>
        <span className="ml-auto">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span>Spaces: 2</span>
        <span>UTF-8</span>
        <span>LF</span>
        <span>{'{ }'} JSON</span>
      </footer>

      {historyOpen && (
        <RevisionsDialog
          themeId={themeId}
          themeVersion={themeVersion}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => {
            setHistoryOpen(false);
            setMessage({ kind: 'status', text: 'Restored' });
            void reload();
          }}
        />
      )}

      {conflict && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 id="conflict-title" className="text-lg font-semibold text-gray-900">
              This theme changed elsewhere
            </h2>
            <p className="mt-2 text-sm text-gray-700">
              Someone saved this theme after you opened it (in the editor or with the Jump CLI). Reload to see their changes. Your unsaved edits are kept for this session and you can apply them again after reloading.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm" onClick={() => setConflict(false)}>
                Keep editing
              </button>
              <button
                type="button"
                autoFocus
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
                onClick={() => {
                  setConflict(false);
                  setBackup(texts);
                  void reload();
                }}
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
