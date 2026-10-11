'use client';

// Spec 052: edit one written policy. Opens with the saved text, or starter
// text when none is set; Save publishes it, Remove policy unsets it.

import { FormEvent, RefObject, useEffect, useState } from 'react';
import RichTextEditorField from '@/components/editor/RichTextEditorField';
import { policiesApi, type PolicyDetail, type PolicyType } from '@/services/api';
import SettingsDialog from '../SettingsDialog';

const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white';

interface PolicyDialogProps {
  type: PolicyType;
  canEdit: boolean;
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  onChanged: () => void;
}

function errorMessage(err: any, fallback: string) {
  const detail = Array.isArray(err?.details) ? err.details[0]?.message : null;
  return detail || err?.message || fallback;
}

/** The editor emits `<p></p>` for an empty document. */
const isBlank = (html: string) => !html.replace(/<[^>]*>/g, '').trim();

export default function PolicyDialog({ type, canEdit, returnFocusRef, onClose, onChanged }: PolicyDialogProps) {
  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    policiesApi
      .get(type)
      .then((p) => {
        if (cancelled) return;
        setPolicy(p);
        setTitle(p.title);
        setContent(p.content);
      })
      .catch((err) => !cancelled && setError(errorMessage(err, 'Could not load the policy')));
    return () => {
      cancelled = true;
    };
  }, [type]);

  // Starter text is unsaved: Save publishes it as is.
  const dirty = !!policy && (policy.starter || title !== policy.title || content !== policy.content);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await policiesApi.save(type, { title: title.trim(), content });
      onChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the policy'));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Remove this policy? It will no longer appear on your online store.')) return;
    setSaving(true);
    setError(null);
    try {
      await policiesApi.remove(type);
      onChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not remove the policy'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="policy-dialog-title"
      title={policy?.title ?? 'Policy'}
      dirty={canEdit && dirty && !policy?.starter}
      saving={saving}
      submitWhenClean={!!policy?.starter}
      saveDisabled={!canEdit || !policy || !title.trim() || isBlank(content)}
      submitLabel={policy?.starter ? 'Publish' : 'Save'}
      savingLabel="Saving…"
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      {error && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}
      {!policy ? (
        !error && <div className="h-80 animate-pulse rounded-lg bg-gray-100 dark:bg-slate-800" aria-busy="true" />
      ) : (
        <div className="space-y-4">
          {policy.starter && (
            <p data-testid="policy-starter-note" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              This is starter text, not legal advice. Review it and make sure it fits your business before you publish.
            </p>
          )}
          <div>
            <label htmlFor="policy-title" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
              Title
            </label>
            <input
              id="policy-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              disabled={!canEdit || saving}
              className={field}
            />
          </div>
          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-slate-300">Policy</span>
            <div className="mt-1">
              <RichTextEditorField value={content} onChange={setContent} aria-label="Policy text" placeholder="Write your policy…" />
            </div>
            {policy.slug && (
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Shown on your online store at /pages/{policy.slug}</p>
            )}
          </div>
          {!canEdit && <p className="text-sm text-gray-500 dark:text-slate-400">Only admins can change policies.</p>}
          {canEdit && !policy.starter && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={saving}
              className="text-sm font-medium text-red-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 dark:text-red-400"
            >
              Remove policy
            </button>
          )}
        </div>
      )}
    </SettingsDialog>
  );
}
