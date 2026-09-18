'use client';

// Edit the organizer tags on one application (spec 019 phase 3): chip input
// with autocomplete from the tags already used in scope. Saves through the
// per-event PATCH; the caller patches its row from the response.

import { FormEvent, KeyboardEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import type { AdminApplication } from '@/lib/applications';
import { describeError, patchApplicationMeta } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

interface EditTagsDialogProps {
  eventId: string;
  applicationId: string;
  businessName: string;
  tags: string[];
  /** Tags already used in scope, for the suggestions. */
  suggestions: string[];
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onSaved: (next: AdminApplication) => void;
}

/** Mirrors the backend: trim, collapse spaces, dedupe case-insensitively keeping the first spelling. */
export function addTag(list: string[], raw: string): string[] {
  const tag = raw.trim().replace(/\s+/g, ' ');
  if (!tag) return list;
  if (list.some((t) => t.toLowerCase() === tag.toLowerCase())) return list;
  return [...list, tag];
}

export default function EditTagsDialog({ eventId, applicationId, businessName, tags: initial, suggestions, returnFocusRef, onClose, onSaved }: EditTagsDialogProps) {
  const [tags, setTags] = useState<string[]>(initial);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(tags) !== JSON.stringify(initial) || draft.trim() !== '';
  const listId = `tags-suggestions-${applicationId}`;
  const unused = suggestions.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()));

  const commitDraft = () => {
    const next = addTag(tags, draft);
    if (next.length > MAX_TAGS) {
      setError(`At most ${MAX_TAGS} tags.`);
      return false;
    }
    if (draft.trim().length > MAX_TAG_LENGTH) {
      setError(`Tags are ${MAX_TAG_LENGTH} characters or fewer.`);
      return false;
    }
    setTags(next);
    setDraft('');
    setError(null);
    return true;
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && draft === '' && tags.length) {
      setTags(tags.slice(0, -1));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    let next = tags;
    if (draft.trim()) {
      if (!commitDraft()) return;
      next = addTag(tags, draft);
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await patchApplicationMeta(eventId, applicationId, { tags: next }));
    } catch (err) {
      setError(describeError(err, 'Could not save tags'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="edit-tags-title"
      title="Edit tags"
      dirty={dirty}
      saving={saving}
      submitLabel="Save tags"
      savingLabel="Saving…"
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="space-y-3">
        {error && (
          <div role="alert" className={formAlertClass}>
            {error}
          </div>
        )}
        <p className="text-sm text-gray-700 dark:text-slate-300">
          Tags on <strong>{businessName}</strong>. Free-form, visible only to your team; use them to group participants across events.
        </p>
        <div>
          <label htmlFor="tag-input" className={labelClass}>
            Tags
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800" data-testid="tag-chips">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                {t}
                <button type="button" aria-label={`Remove tag ${t}`} className="rounded-full px-1 leading-none hover:bg-amber-200 dark:hover:bg-amber-800" onClick={() => setTags(tags.filter((x) => x !== t))}>
                  ×
                </button>
              </span>
            ))}
            <input
              id="tag-input"
              ref={inputRef}
              list={listId}
              value={draft}
              maxLength={MAX_TAG_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onBlur={() => draft.trim() && commitDraft()}
              className={`${fieldClass} mt-0 min-w-[8rem] flex-1 border-0 px-1 py-0.5 shadow-none focus:ring-0`}
              placeholder={tags.length ? '' : 'Type a tag and press Enter'}
            />
            <datalist id={listId}>
              {unused.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <p className={hintClass}>Enter or comma adds a tag; Backspace removes the last one. Up to {MAX_TAGS} tags.</p>
        </div>
        {unused.length > 0 && (
          <div>
            <p className={labelClass}>Used elsewhere</p>
            <div className="mt-1 flex flex-wrap gap-1" data-testid="tag-suggestions">
              {unused.slice(0, 12).map((s) => (
                <button key={s} type="button" className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700" onClick={() => setTags(addTag(tags, s))}>
                  + {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </SettingsDialog>
  );
}
