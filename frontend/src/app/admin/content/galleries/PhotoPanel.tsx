'use client';

// Photo settings: a bottom sheet on phones, a side panel from md up. Native
// <dialog> + showModal() gives the focus trap, Escape and an inert page.
// Edits apply to the editor draft as you type; Save on the page persists.

import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { resolveAssetUrl } from '@/lib/assets';
import { needsAlt, resolveSrcset, type DraftItem, type DraftSection } from '@/lib/galleries';

interface PhotoPanelProps {
  item: DraftItem;
  position: number;
  section: DraftSection;
  sections: DraftSection[];
  onChange: (item: DraftItem) => void;
  onMove: (offset: number) => void;
  onMoveToSection: (sectionKey: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800';
const secondary =
  'inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';

export default function PhotoPanel({
  item,
  position,
  section,
  sections,
  onChange,
  onMove,
  onMoveToSection,
  onRemove,
  onClose,
}: PhotoPanelProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const others = sections.filter((entry) => entry.key !== section.key);
  const [target, setTarget] = useState(others[0]?.key ?? '');
  const missing = needsAlt(item);
  const fileAlt = item.file.altText?.trim();
  const sectionName = (entry: DraftSection) => entry.title.trim() || `Section ${sections.indexOf(entry) + 1}`;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="photo-panel-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-full overflow-y-auto rounded-t-2xl bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-black/50 dark:bg-slate-900 dark:text-white md:inset-y-0 md:left-auto md:right-0 md:h-full md:max-h-full md:w-[28rem] md:rounded-none"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
        <h2 id="photo-panel-title" className="min-w-0 truncate text-base font-semibold">
          Photo {position + 1} of {section.items.length} · {sectionName(section)}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-md hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-800"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="space-y-5 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolveAssetUrl(item.file.src ?? item.file.previewUrl ?? item.file.thumbUrl) || undefined}
          srcSet={resolveSrcset(item.file.srcset)}
          sizes="(min-width: 768px) 448px, 100vw"
          width={item.file.width ?? undefined}
          height={item.file.height ?? undefined}
          alt=""
          className="mx-auto max-h-64 w-auto rounded-md bg-gray-100 object-contain dark:bg-slate-800"
        />
        <p className="truncate text-sm text-gray-500 dark:text-slate-400">{item.file.name}</p>

        <div>
          <label htmlFor="photo-alt" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
            Alt text
          </label>
          <textarea
            id="photo-alt"
            rows={2}
            maxLength={500}
            value={item.decorative ? '' : (item.altText ?? '')}
            placeholder={fileAlt || 'Describe what the photo shows'}
            disabled={item.decorative}
            aria-describedby="photo-alt-hint"
            onChange={(event) => onChange({ ...item, altText: event.target.value })}
            className={field}
          />
          <p id="photo-alt-hint" className={`mt-1 text-sm ${missing ? 'font-medium text-amber-800 dark:text-amber-300' : 'text-gray-500 dark:text-slate-400'}`}>
            {item.decorative
              ? 'Screen readers skip decorative photos.'
              : missing
                ? 'No alt text yet: screen readers will hear only its position. Describe what it shows, or mark it decorative.'
                : !item.altText?.trim() && fileAlt
                  ? 'Using the alt text from Files. Type to change it for this gallery only.'
                  : 'Used in this gallery only; the file in Files keeps its own.'}
          </p>
          <label className="mt-2 flex min-h-10 items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={item.decorative}
              onChange={(event) => onChange({ ...item, decorative: event.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-accent-600 focus:ring-accent-500"
            />
            Decorative (adds no information)
          </label>
        </div>

        <div>
          <label htmlFor="photo-caption" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
            Caption <span className="font-normal text-gray-500 dark:text-slate-400">(optional)</span>
          </label>
          <input
            id="photo-caption"
            maxLength={300}
            value={item.caption ?? ''}
            onChange={(event) => onChange({ ...item, caption: event.target.value })}
            className={field}
          />
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-gray-700 dark:text-slate-300">Position</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" className={secondary} disabled={position === 0} onClick={() => onMove(-1)}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Move earlier
            </button>
            <button type="button" className={secondary} disabled={position === section.items.length - 1} onClick={() => onMove(1)}>
              Move later
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {others.length > 0 && (
            <div className="mt-3 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor="photo-section" className="block text-sm text-gray-600 dark:text-slate-400">
                  Move to section
                </label>
                <select id="photo-section" value={target} onChange={(event) => setTarget(event.target.value)} className={field}>
                  {others.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {sectionName(entry)}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className={secondary} disabled={!target} onClick={() => onMoveToSection(target)}>
                Move
              </button>
            </div>
          )}
        </fieldset>

        <div className="flex items-center justify-between gap-2 border-t border-gray-200 pt-4 dark:border-slate-700">
          <button
            type="button"
            onClick={onRemove}
            className="min-h-10 rounded-md px-2 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-300 dark:hover:bg-red-900/20"
          >
            Remove from gallery
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-gray-950 hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
