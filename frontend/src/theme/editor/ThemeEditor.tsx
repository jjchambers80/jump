'use client';

// Theme editor (spec 038 §11, card 038D): Header / Home or Events / Footer as
// one Puck tree, saved atomically through PUT /admin/themes/:id/save.
// Loaded with ssr: false from the editor page; the only Puck user.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { getPreset } from '@jump/theme';
import ActionsMenu from '@/components/ActionsMenu';
import { useMenusApi } from '@/app/admin/content/menus/useMenusApi';
import type { StoreFile } from '@/lib/content';
import { themesApi, type ThemeDetail, type ThemeDocumentData } from '@/lib/themes';
import type { SectionContext } from '../sections/context';
import type { ResolvedData } from '../types';
import { Puck, blocksPlugin, usePuck, type Data, type Plugin } from './puck';
import { buildEditorConfig } from './config';
import { fromEditorData, sameDocument, toEditorData, TEMPLATE_KEYS, TEMPLATE_LABELS, type TemplateKey } from './data';
import { EditorServicesContext } from './EditorServices';
import RevisionsDialog from './RevisionsDialog';
import SectionsOutline from './SectionsOutline';

type DocKey = 'header' | 'footer' | TemplateKey;
const DOC_KEYS: DocKey[] = ['header', 'footer', 'home', 'events'];
type Docs = Record<DocKey, ThemeDocumentData>;

const DOC_LABELS: Record<DocKey, string> = { header: 'Header', footer: 'Footer', home: 'Home page', events: 'Events page' };
const LIVE_NOTE_KEY = 'jump.theme-editor.live-note.';
const BACKUP_KEY = 'jump.theme-editor.backup.';

const headerButton =
  'whitespace-nowrap rounded-md border border-gray-300 bg-white px-2 py-1 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

interface Loaded {
  theme: ThemeDetail;
  docs: Docs;
  versions: Record<DocKey, number>;
  content: Record<string, string>;
  organization: SectionContext['organization'];
  resolved: ResolvedData;
}

async function loadEditor(themeId: string): Promise<Loaded> {
  const [theme, content, preview, ...documents] = await Promise.all([
    themesApi.get(themeId),
    themesApi.content(themeId),
    themesApi.previewData(themeId, 'events'),
    ...DOC_KEYS.map((key) => themesApi.document(themeId, key)),
  ]);
  const docs = {} as Docs;
  const versions = {} as Record<DocKey, number>;
  DOC_KEYS.forEach((key, i) => {
    docs[key] = documents[i].data;
    versions[key] = documents[i].version;
  });
  return { theme, docs, versions, content: content.resolved, organization: preview.organization, resolved: preview.resolved };
}

function InspectorToggle() {
  const { appState, dispatch } = usePuck();
  const inspecting = appState.ui.previewMode === 'edit';
  return (
    <button
      type="button"
      aria-pressed={inspecting}
      title="When on, clicking the preview selects sections; when off, links and menus work"
      onClick={() => dispatch({ type: 'setUi', ui: { previewMode: inspecting ? 'interactive' : 'edit' } })}
      className={headerButton}
    >
      Inspector {inspecting ? 'on' : 'off'}
    </button>
  );
}

// Puck's plugin rail is mouse-only in 0.23 (contracts C12); these buttons
// reach the same panels from the keyboard.
function PanelButtons() {
  const { appState, dispatch } = usePuck();
  const current = appState.ui.plugin?.current;
  const open = (plugin: string) => dispatch({ type: 'setUi', ui: { leftSideBarVisible: true, plugin: { current: plugin } } as any });
  return (
    <div role="group" aria-label="Left panel" className="flex gap-1">
      <button type="button" aria-pressed={current === 'outline'} onClick={() => open('outline')} className={headerButton}>
        Sections
      </button>
      <button type="button" aria-pressed={current === 'blocks'} onClick={() => open('blocks')} className={headerButton}>
        Add
      </button>
    </div>
  );
}

const sectionsPlugin: Plugin = {
  name: 'outline', // replaces Puck's own outline (plugins are keyed by name)
  label: 'Sections',
  render: () => <SectionsOutline />,
};

export default function ThemeEditor({ themeId }: { themeId: string }) {
  const menusApi = useMenusApi();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [docs, setDocs] = useState<Docs | null>(null);
  const [saved, setSaved] = useState<Docs | null>(null);
  const [versions, setVersions] = useState<Record<DocKey, number> | null>(null);
  const [themeVersion, setThemeVersion] = useState(1);
  const [page, setPage] = useState<TemplateKey>('home');
  const [mountKey, setMountKey] = useState(0);
  const [menus, setMenus] = useState<{ id: string; title: string }[]>([]);
  const [files, setFiles] = useState<Record<string, { url: string; width: number | null; height: number | null; alt: string | null }>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; details?: string[] } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [liveNote, setLiveNote] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [backup, setBackup] = useState<Docs | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const resetKeys = useRef(new Set<DocKey>());

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await loadEditor(themeId);
      setLoaded(next);
      setDocs(next.docs);
      setSaved(next.docs);
      setVersions(next.versions);
      setThemeVersion(next.theme.version);
      setFiles(next.resolved.files ?? {});
      resetKeys.current.clear();
      setMountKey((k) => k + 1);
    } catch (err: any) {
      setLoadError(err?.message || 'Could not open the theme');
    }
  }, [themeId]);

  useEffect(() => {
    void reload();
    menusApi
      .list()
      .then((r) => setMenus(r.menus.map((m) => ({ id: m.id, title: m.title }))))
      .catch(() => setMenus([]));
    try {
      const raw = window.sessionStorage.getItem(BACKUP_KEY + themeId);
      if (raw) setBackup(JSON.parse(raw));
    } catch {
      /* no backup */
    }
  }, [themeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirtyKeys = useMemo(
    () => (docs && saved ? DOC_KEYS.filter((key) => resetKeys.current.has(key) || !sameDocument(docs[key], saved[key])) : []),
    [docs, saved],
  );
  const dirty = dirtyKeys.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const schemes = useMemo(
    () => ((loaded?.theme.resolvedSettings?.colors?.schemes as { id: string; name: string }[] | undefined) ??
      (getPreset(loaded?.theme.presetKey ?? 'eventimus-default')?.settings.colors.schemes ?? [])).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })),
    [loaded],
  );
  const config = useMemo(() => buildEditorConfig({ schemes, menus }), [schemes, menus]);

  const metadata = useMemo(() => {
    if (!loaded) return {};
    const ctx: SectionContext = {
      organization: loaded.organization,
      resolved: { ...loaded.resolved, files },
      settings: { ...loaded.theme.resolvedSettings, colors: { schemes: loaded.theme.resolvedSettings?.colors?.schemes ?? getPreset(loaded.theme.presetKey)?.settings.colors.schemes } },
      content: loaded.content,
      host: null,
      nameIsHeading: true,
      path: '#',
      query: {},
      editing: true,
    };
    return { ctx };
  }, [loaded, files]);

  const services = useMemo(
    () => ({
      registerFile: (file: StoreFile) =>
        setFiles((prev) => ({ ...prev, [file.id]: { url: file.url, width: file.width, height: file.height, alt: file.altText } })),
      fileUrl: (fileId: string) => files[fileId]?.url ?? null,
    }),
    [files],
  );

  const onChange = useCallback(
    (data: Data) => {
      const split = fromEditorData(data as any);
      setDocs((prev) => (prev ? { ...prev, header: split.header, footer: split.footer, [page]: split.template } : prev));
    },
    [page],
  );

  const switchPage = (next: TemplateKey) => {
    if (next === page) return;
    setPage(next);
    setMountKey((k) => k + 1);
  };

  const resetPage = () => {
    const preset = getPreset(loaded?.theme.presetKey ?? 'eventimus-default');
    if (!preset || !window.confirm(`Reset the ${TEMPLATE_LABELS[page].toLowerCase()} to the theme default? Save to keep the change.`)) return;
    resetKeys.current.add(page);
    setDocs((prev) => (prev ? { ...prev, [page]: structuredClone(preset.documents[page]) } : prev));
    setMountKey((k) => k + 1);
  };

  const save = async () => {
    if (!docs || !versions || !loaded || !dirty) return;
    setSaving(true);
    setSaveError(null);
    setStatus(null);
    const presetDocs = getPreset(loaded.theme.presetKey)?.documents ?? {};
    const documents = Object.fromEntries(
      dirtyKeys.map((key) => {
        // "Reset to theme default" left untouched deletes the stored row (contracts C5).
        const untouchedReset = resetKeys.current.has(key) && sameDocument(docs[key], (presetDocs as Record<string, ThemeDocumentData>)[key]);
        return [key, { data: untouchedReset ? null : docs[key], version: versions[key] }];
      }),
    );
    try {
      const result = await themesApi.save(themeId, { themeVersion, documents });
      setSaved(docs);
      setVersions((prev) => ({ ...(prev as Record<DocKey, number>), ...(result.documents as Record<DocKey, number>) }));
      setThemeVersion(result.theme.version);
      resetKeys.current.clear();
      setStatus('Saved');
      window.sessionStorage.removeItem(BACKUP_KEY + themeId);
      if (loaded.theme.role === 'MAIN' && !window.sessionStorage.getItem(LIVE_NOTE_KEY + themeId)) {
        window.sessionStorage.setItem(LIVE_NOTE_KEY + themeId, '1');
        setLiveNote(true);
      }
    } catch (err: any) {
      if (err?.status === 409) {
        try {
          window.sessionStorage.setItem(BACKUP_KEY + themeId, JSON.stringify(docs));
        } catch {
          /* storage full: the dialog still explains */
        }
        setConflict(true);
      } else {
        const errors = err?.details?.errors as Record<string, string> | undefined;
        setSaveError({
          message: err?.message || 'Could not save',
          details: errors ? Object.entries(errors).map(([path, message]) => `${path}: ${message}`) : undefined,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const applyBackup = () => {
    if (!backup) return;
    setDocs(backup);
    setBackup(null);
    window.sessionStorage.removeItem(BACKUP_KEY + themeId);
    setMountKey((k) => k + 1);
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
  if (!loaded || !docs) {
    return <div className="min-h-screen animate-pulse bg-gray-100" aria-busy="true" aria-label="Loading the theme editor" />;
  }

  const data = toEditorData({ header: docs.header, footer: docs.footer, template: docs[page] });
  const badge = loaded.theme.role === 'MAIN' ? 'Active' : 'Draft';

  return (
    <EditorServicesContext.Provider value={services}>
      <div className="flex h-screen flex-col">
        {(liveNote || backup || saveError || status) && (
          <div className="space-y-1 border-b border-gray-200 bg-white px-4 py-2 text-sm">
            {liveNote && (
              <p role="status" className="flex items-center justify-between gap-3 text-amber-900">
                <span>You&apos;re editing your live store: saved changes are visible to visitors right away. Revision history lets you go back.</span>
                <button type="button" className="text-xs font-medium underline" onClick={() => setLiveNote(false)}>
                  Dismiss
                </button>
              </p>
            )}
            {backup && (
              <p className="flex items-center justify-between gap-3 text-gray-800">
                <span>Your unsaved edits from before the reload are kept for this session.</span>
                <button type="button" className="text-xs font-medium text-indigo-700 underline" onClick={applyBackup}>
                  Apply them again
                </button>
              </p>
            )}
            {saveError && (
              <div role="alert" className="text-red-800">
                <p>{saveError.message}</p>
                {saveError.details && (
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {saveError.details.slice(0, 8).map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {status && !saveError && (
              <p role="status" className="text-green-800">
                {status}
              </p>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <Puck
            key={`${page}-${mountKey}`}
            config={config}
            data={data as Data}
            metadata={metadata}
            onChange={onChange}
            plugins={[sectionsPlugin, blocksPlugin({ label: 'Add' })]}
            iframe={{ enabled: true, waitForStyles: true }}
            viewports={[
              { width: '100%', label: 'Desktop', icon: 'Monitor' as any },
              { width: 390, height: 'auto', label: 'Mobile', icon: 'Smartphone' as any },
            ]}
            headerTitle={`${loaded.theme.name} · ${badge}`}
            renderHeaderActions={() => (
              <div className="flex flex-wrap items-center justify-end gap-1.5" data-testid="editor-actions">
                <Link
                  href="/admin/online-store"
                  onClick={(e) => {
                    if (dirty && !window.confirm('Leave the editor? Unsaved changes will be lost.')) e.preventDefault();
                  }}
                  className={`${headerButton} inline-flex items-center gap-1`}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden /> Exit
                </Link>
                <label className="sr-only" htmlFor="editor-page">
                  Page being edited
                </label>
                <select
                  id="editor-page"
                  value={page}
                  onChange={(e) => switchPage(e.target.value as TemplateKey)}
                  className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm"
                >
                  {TEMPLATE_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {TEMPLATE_LABELS[key]}
                      {dirtyKeys.includes(key) ? ' •' : ''}
                    </option>
                  ))}
                </select>
                <PanelButtons />
                <InspectorToggle />
                <ActionsMenu
                  label="More editor actions"
                  items={[
                    ...(loaded.theme.role === 'MAIN' ? [{ label: 'Revision history', onSelect: () => setHistoryOpen(true) }] : []),
                    { label: `Reset ${TEMPLATE_LABELS[page].toLowerCase()} to theme default`, onSelect: resetPage },
                    { label: 'View store', href: `/organizations/${loaded.organization.slug}`, external: true },
                  ]}
                />
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={!dirty || saving}
                  aria-describedby={dirty ? 'unsaved-summary' : undefined}
                  className="whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {dirty && (
                  <span id="unsaved-summary" className="sr-only">
                    Unsaved changes: {dirtyKeys.map((k) => DOC_LABELS[k]).join(', ')}
                  </span>
                )}
              </div>
            )}
          />
        </div>
      </div>

      {historyOpen && (
        <RevisionsDialog
          themeId={themeId}
          themeVersion={themeVersion}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => {
            setHistoryOpen(false);
            setStatus('Restored');
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
              Someone saved this theme after you opened it. Reload to see their changes. Your unsaved edits are kept for this session and you can apply them again after reloading.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={headerButton} onClick={() => setConflict(false)}>
                Keep editing
              </button>
              <button
                type="button"
                autoFocus
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
                onClick={() => {
                  setConflict(false);
                  try {
                    const raw = window.sessionStorage.getItem(BACKUP_KEY + themeId);
                    if (raw) setBackup(JSON.parse(raw));
                  } catch {
                    /* ignore */
                  }
                  void reload();
                }}
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      )}
    </EditorServicesContext.Provider>
  );
}
