'use client';

// Sticky "Unsaved changes — Discard / Save" bar shared by Content edit pages.
// Nothing on these pages autosaves; the bar appears only while dirty.

interface SaveBarProps {
  visible: boolean;
  saving: boolean;
  disabled?: boolean;
  error?: string | null;
  saveLabel?: string;
  onDiscard: () => void;
  onSave: () => void;
}

export default function SaveBar({
  visible,
  saving,
  disabled = false,
  error,
  saveLabel = 'Save',
  onDiscard,
  onSave,
}: SaveBarProps) {
  if (!visible) return null;
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
      data-testid="save-bar"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <p className="text-sm font-medium text-gray-900 dark:text-white">Unsaved changes</p>
        <div className="flex items-center gap-2">
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={disabled || saving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
