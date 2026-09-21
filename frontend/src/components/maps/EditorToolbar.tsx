'use client';

import React from 'react';
import type { EditorTool } from './useMapEditor';
import { MARKER_LABELS } from './mapTheme';
import {
  MousePointer2,
  Grid3x3,
  Square,
  Rows,
  Type,
  PanelRight,
  Undo2,
  Redo2,
  Copy,
  Trash2,
  Save,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  Map,
} from 'lucide-react';

interface EditorToolbarProps {
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onSave: () => void;
  onPublish?: () => void;
  onUnpublish?: () => void;
  saving: boolean;
  dirty: boolean;
  status: 'DRAFT' | 'PUBLISHED';
  zoom: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

const TOOLS: { tool: EditorTool; icon: React.ReactNode; label: string }[] = [
  { tool: 'select', icon: <MousePointer2 className="w-4 h-4" />, label: 'Select' },
  { tool: 'booth', icon: <Square className="w-4 h-4" />, label: 'Booth' },
  { tool: 'table', icon: <Grid3x3 className="w-4 h-4" />, label: 'Table' },
  { tool: 'row', icon: <Rows className="w-4 h-4" />, label: 'Row' },
];

const MARKERS: { tool: EditorTool }[] = [
  { tool: 'stage' },
  { tool: 'entrance' },
  { tool: 'restroom' },
  { tool: 'food' },
  { tool: 'info' },
  { tool: 'firstAid' },
  { tool: 'programming' },
];

export default function EditorToolbar({
  activeTool,
  onToolChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onDuplicate,
  onDelete,
  onSave,
  onPublish,
  onUnpublish,
  saving,
  dirty,
  status,
  zoom,
  onZoomIn,
  onZoomOut,
}: EditorToolbarProps) {
  const btnClass = (tool: string) =>
    `p-1.5 rounded transition-colors ${
      activeTool === tool
        ? 'bg-indigo-100 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-300'
        : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700'
    }`;

  const actionBtnClass = (disabled = false) =>
    `p-1.5 rounded transition-colors ${
      disabled
        ? 'text-gray-300 dark:text-slate-600 cursor-not-allowed'
        : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700'
    }`;

  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
      {/* Drawing tools */}
      <div className="flex items-center gap-0.5 mr-2">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            type="button"
            onClick={() => onToolChange(t.tool)}
            className={btnClass(t.tool)}
            title={t.label}
            aria-label={t.label}
            aria-pressed={activeTool === t.tool}
          >
            {t.icon}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-gray-200 dark:bg-slate-600" />

      {/* Markers dropdown */}
      <div className="relative group">
        <button
          type="button"
          className={btnClass('marker')}
          title="Markers"
          aria-label="Markers"
        >
          <Map className="w-4 h-4" />
        </button>
        <div className="absolute top-full left-0 mt-1 hidden group-hover:block group-focus-within:block bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded shadow-lg z-50 min-w-[140px]">
          {MARKERS.map((m) => (
            <button
              key={m.tool}
              type="button"
              onClick={() => onToolChange(m.tool)}
              className={`w-full text-left px-3 py-1.5 text-sm ${btnClass(m.tool)}`}
            >
              {MARKER_LABELS[m.tool] || m.tool}
            </button>
          ))}
        </div>
      </div>

      {/* Label & Wall */}
      <button
        type="button"
        onClick={() => onToolChange('label')}
        className={btnClass('label')}
        title="Text label"
        aria-label="Text label"
        aria-pressed={activeTool === 'label'}
      >
        <Type className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => onToolChange('wall')}
        className={btnClass('wall')}
        title="Wall"
        aria-label="Wall"
        aria-pressed={activeTool === 'wall'}
      >
        <PanelRight className="w-4 h-4 rotate-90" />
      </button>

      <div className="w-px h-5 bg-gray-200 dark:bg-slate-600" />

      {/* Actions */}
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className={actionBtnClass(!canUndo)}
        title="Undo"
        aria-label="Undo"
      >
        <Undo2 className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className={actionBtnClass(!canRedo)}
        title="Redo"
        aria-label="Redo"
      >
        <Redo2 className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onDuplicate}
        className={actionBtnClass(false)}
        title="Duplicate (Ctrl+D)"
        aria-label="Duplicate"
      >
        <Copy className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className={actionBtnClass(false)}
        title="Delete (Delete)"
        aria-label="Delete"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <div className="flex-1" />

      {/* Zoom */}
      <div className="flex items-center gap-1 mr-3">
        <button
          type="button"
          onClick={onZoomOut}
          className={actionBtnClass()}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-xs text-gray-500 dark:text-slate-400 w-10 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={onZoomIn}
          className={actionBtnClass()}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
      </div>

      {/* Save state */}
      <span
        className={`text-xs ${
          saving
            ? 'text-yellow-500'
            : dirty
            ? 'text-orange-500'
            : 'text-green-500'
        }`}
      >
        {saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}
      </span>

      {/* Save button */}
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !dirty}
        className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
          saving || !dirty
            ? 'bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-slate-500 cursor-not-allowed'
            : 'bg-indigo-600 text-white hover:bg-indigo-700'
        }`}
      >
        <Save className="w-4 h-4 inline mr-1" />
        Save
      </button>

      {/* Publish / Unpublish */}
      {status === 'DRAFT' ? (
        <button
          type="button"
          onClick={onPublish}
          className="px-3 py-1.5 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
        >
          <Eye className="w-4 h-4 inline mr-1" />
          Publish
        </button>
      ) : (
        <button
          type="button"
          onClick={onUnpublish}
          className="px-3 py-1.5 rounded text-sm font-medium bg-yellow-500 text-white hover:bg-yellow-600 transition-colors"
        >
          <EyeOff className="w-4 h-4 inline mr-1" />
          Unpublish
        </button>
      )}
    </div>
  );
}