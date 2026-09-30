'use client';

// Insert video: paste a YouTube / Vimeo embed snippet (or a plain link).
// Escape, backdrop and ✕ cancel; focus returns to the toolbar button.
// Portalled to <body> so the editor's .jump-prose type styles don't reach it.

import { X } from 'lucide-react';
import { RefObject, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseVideoEmbed } from '@/lib/videoEmbed';

interface InsertVideoDialogProps {
  returnFocusRef?: RefObject<HTMLElement>;
  onClose: () => void;
  onInsert: (video: { src: string; title: string }) => void;
}

export default function InsertVideoDialog({
  returnFocusRef,
  onClose,
  onInsert,
}: InsertVideoDialogProps) {
  const id = useId();
  const [snippet, setSnippet] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const returnTo = returnFocusRef?.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo?.focus();
    };
    // Mount-only focus management.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insert = () => {
    const video = parseVideoEmbed(snippet);
    if (!video) {
      setError('Paste a YouTube or Vimeo embed snippet or link');
      return;
    }
    onInsert(video);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="w-full max-w-xl rounded-xl bg-white shadow-2xl dark:bg-slate-900"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 id={`${id}-title`} className="text-base font-semibold text-gray-900 dark:text-white">
            Insert video
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="px-5 pb-5">
          <label
            htmlFor={`${id}-snippet`}
            className="block text-sm font-medium text-gray-800 dark:text-slate-200"
          >
            Insert a video by pasting the embed snippet in the box below.
          </label>
          <textarea
            ref={textareaRef}
            id={`${id}-snippet`}
            rows={5}
            value={snippet}
            onChange={(event) => {
              setSnippet(event.target.value);
              setError(null);
            }}
            aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
            aria-invalid={error ? true : undefined}
            spellCheck={false}
            className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
          />
          <p id={`${id}-help`} className="mt-1.5 text-xs text-gray-600 dark:text-slate-400">
            The embed snippet usually starts with &quot;&lt;iframe ...&quot;. YouTube and Vimeo
            are supported.
          </p>
          {error && (
            <p
              id={`${id}-error`}
              role="alert"
              className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400"
            >
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={insert}
              disabled={!snippet.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-slate-900"
            >
              Insert video
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
