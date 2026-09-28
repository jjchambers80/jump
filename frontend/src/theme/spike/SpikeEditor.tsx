'use client';

// Spike 038-0: Puck 0.23 editor with three root slots (header / template /
// footer), a Theme settings plugin in the left rail, desktop/mobile
// viewports and the interactive (inspector off) preview mode.

import { useMemo, useState } from 'react';
import { Puck, blocksPlugin, usePuck, type Data, type Plugin } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import { Layers, Settings } from 'lucide-react';
import SectionsOutline from './SectionsOutline';
import { editorConfig } from './config.editor';
import { DEFAULT_SETTINGS, settingsCssVars, type SpikeThemeSettings } from './ThemeScope';
import { brandCssVars } from '@/lib/color';
import type { SpikeResolved } from './sections';

// Theme settings live in root.props.themeSettings while editing so Puck's own
// history (undo/redo) covers them; Save splits them back out to Theme.settings.
function ThemeSettingsPanel() {
  const { appState, dispatch } = usePuck();
  const settings: SpikeThemeSettings = {
    ...DEFAULT_SETTINGS,
    ...((appState.data.root.props as any)?.themeSettings ?? {}),
  };
  const set = (patch: Partial<SpikeThemeSettings>) =>
    dispatch({
      type: 'setData',
      recordHistory: true,
      data: (prev: Data) => ({
        ...prev,
        root: { ...prev.root, props: { ...(prev.root.props as any), themeSettings: { ...settings, ...patch } } },
      }),
    } as any);
  const range = (key: keyof SpikeThemeSettings, label: string, min: number, max: number) => (
    <label className="block text-sm" key={key}>
      <span className="flex justify-between">
        {label} <output>{settings[key]}px</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={settings[key] as number}
        onChange={(e) => set({ [key]: Number(e.target.value) } as any)}
        className="w-full"
        aria-label={label}
      />
    </label>
  );
  return (
    <div className="p-4 space-y-4" data-testid="theme-settings">
      <details open>
        <summary className="font-semibold">Layout</summary>
        <div className="mt-2 space-y-3">
          {range('pageWidth', 'Page width', 1000, 1600)}
          {range('sectionGap', 'Space between sections', 0, 100)}
        </div>
      </details>
      <details open>
        <summary className="font-semibold">Buttons</summary>
        <div className="mt-2 space-y-3">{range('buttonRadius', 'Button radius', 0, 40)}</div>
      </details>
      <details>
        <summary className="font-semibold">Containers</summary>
        <div className="mt-2 space-y-3">{range('radius', 'Corner radius', 0, 40)}</div>
      </details>
    </div>
  );
}

// `ui` on <Puck> is initial state only; toggling later must go through setUi.
function InspectorToggle() {
  const { appState, dispatch } = usePuck();
  const inspecting = appState.ui.previewMode === 'edit';
  return (
    <button
      type="button"
      aria-pressed={inspecting}
      onClick={() => dispatch({ type: 'setUi', ui: { previewMode: inspecting ? 'interactive' : 'edit' } })}
      className="rounded border px-2 py-1 text-sm"
    >
      Inspector {inspecting ? 'on' : 'off'}
    </button>
  );
}

const sectionsPlugin: Plugin = {
  name: 'outline', // replaces Puck's default outline (plugins are keyed by name)
  label: 'Sections',
  icon: <Layers size={16} />,
  render: () => <SectionsOutline />,
};

const themeSettingsPlugin: Plugin = {
  name: 'theme-settings',
  label: 'Theme settings',
  icon: <Settings size={16} />,
  render: () => <ThemeSettingsPanel />,
};

export default function SpikeEditor({
  initialData,
  resolved,
  brandColor,
}: {
  initialData: Data;
  resolved: SpikeResolved;
  brandColor: string;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const metadata = useMemo(() => ({ resolved }), [resolved]);

  // Root render in the editor: apply brand + theme settings as CSS variables
  // on the canvas so a settings change restyles every section live.
  const config = useMemo(
    () => ({
      ...editorConfig,
      root: {
        ...editorConfig.root,
        render: (props: any) => {
          const vars = {
            ...(brandCssVars(brandColor) ?? {}),
            ...settingsCssVars({ ...DEFAULT_SETTINGS, ...(props.themeSettings ?? {}) }),
          };
          const Inner = editorConfig.root!.render as any;
          return (
            <div className="brand-scope" style={vars as any} data-testid="canvas-scope">
              <Inner {...props} />
            </div>
          );
        },
      },
    }),
    [brandColor],
  );

  return (
    <Puck
      config={config as any}
      data={initialData}
      metadata={metadata}
      plugins={[sectionsPlugin, blocksPlugin({ label: 'Add' }), themeSettingsPlugin]}
      iframe={{ enabled: true, waitForStyles: true }}
      viewports={[
        { width: '100%', label: 'Desktop', icon: 'Monitor' as any },
        { width: 390, height: 'auto', label: 'Mobile', icon: 'Smartphone' as any },
      ]}
      headerTitle="Summer refresh · Active"
      renderHeaderActions={({ state }) => (
        <>
          <InspectorToggle />
          <button
            type="button"
            className="rounded bg-black px-3 py-1 text-sm text-white"
            onClick={() => setSaved(JSON.stringify(splitForSave(state.data)))}
          >
            Save
          </button>
          {saved && <output data-testid="saved" className="hidden">{saved}</output>}
        </>
      )}
    />
  );
}

/** Save splits the one editor tree into three documents plus theme settings. */
export function splitForSave(data: Data) {
  const { header, template, footer, themeSettings, ...rootProps } = (data.root.props ?? {}) as any;
  return {
    settings: themeSettings ?? null,
    documents: {
      header: { data: { root: { props: {} }, content: header ?? [] } },
      home: { data: { root: { props: rootProps }, content: template ?? [] } },
      footer: { data: { root: { props: {} }, content: footer ?? [] } },
    },
  };
}
