'use client';

import { FormEvent, RefObject, useState } from 'react';
import SettingsDialog from '../SettingsDialog';
import { fieldClass, hintClass, labelClass } from '../formShared';

type Draft = { subject: string; body: string; enabled?: boolean };

interface TemplateDialogProps {
  title: string;
  /** When the email goes out, shown under the title. */
  when: string;
  /** `enabled` set = the email is optional and gets an on/off switch. */
  template: Draft & { isDefault: boolean };
  mergeFields: { key: string; description: string }[];
  /** System parts added below the message (spec 053), listed so nobody retypes them. */
  blocks?: string[];
  canEdit: boolean;
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  onSave: (draft: Draft) => Promise<boolean>;
  onReset: () => Promise<boolean>;
  /** Renders the draft against sample data; omit to hide the Preview tab. */
  preview?: (draft: Draft) => Promise<{ subject: string; html: string }>;
  /** Sends the draft to the signed-in staff member; resolves to the address. */
  sendTest?: (draft: Draft) => Promise<string>;
}

const tabClass = (on: boolean) =>
  `rounded-md px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-accent-500 ${
    on ? 'bg-gray-100 text-gray-900 dark:bg-slate-800 dark:text-white' : 'text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white'
  }`;
const secondary =
  'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

/** Edits one notification email (subject + message) in the Settings dialog shell. */
export default function TemplateDialog({
  title,
  when,
  template,
  mergeFields,
  blocks = [],
  canEdit,
  returnFocusRef,
  onClose,
  onSave,
  onReset,
  preview,
  sendTest,
}: TemplateDialogProps) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [enabled, setEnabled] = useState(template.enabled);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [rendered, setRendered] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [testState, setTestState] = useState<{ busy: boolean; message: string | null; failed: boolean }>({ busy: false, message: null, failed: false });
  const dirty = subject !== template.subject || body !== template.body || enabled !== template.enabled;
  const draft = (): Draft => ({ subject, body, ...(enabled !== undefined && { enabled }) });
  const draftValid = subject.trim() !== '' && body.trim() !== '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const ok = await onSave(draft());
    setSaving(false);
    if (ok) onClose();
  };

  const reset = async () => {
    if (!window.confirm(`Reset the ${title} email to the default?`)) return;
    setSaving(true);
    const ok = await onReset();
    setSaving(false);
    if (ok) onClose();
  };

  const showPreview = async () => {
    setTab('preview');
    if (!preview) return;
    setRendered(null);
    setPreviewError(null);
    try {
      setRendered(await preview({ subject, body }));
    } catch (err) {
      setPreviewError((err as { message?: string })?.message || 'Could not render the preview');
    }
  };

  const test = async () => {
    if (!sendTest) return;
    setTestState({ busy: true, message: null, failed: false });
    try {
      const to = await sendTest({ subject, body });
      setTestState({ busy: false, message: `Test sent to ${to}.`, failed: false });
    } catch (err) {
      setTestState({ busy: false, message: (err as { message?: string })?.message || 'Could not send the test', failed: true });
    }
  };

  return (
    <SettingsDialog
      titleId="notification-template-title"
      title={title}
      dirty={dirty}
      saving={saving}
      saveDisabled={!canEdit || !draftValid}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <p className="text-sm text-gray-600 dark:text-slate-400">{when}</p>
      {enabled !== undefined && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3 dark:border-slate-700">
          <span>
            <span id="notification-enabled-label" className="block text-sm font-medium text-gray-900 dark:text-white">Send this email</span>
            <span id="notification-enabled-hint" className="block text-sm text-gray-600 dark:text-slate-400">{enabled ? 'On' : 'Off: nobody receives it until you turn it back on.'}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-labelledby="notification-enabled-label"
            aria-describedby="notification-enabled-hint"
            disabled={!canEdit}
            onClick={() => setEnabled(!enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 disabled:opacity-50 motion-reduce:transition-none ${
              enabled ? 'bg-accent-500' : 'bg-gray-300 dark:bg-slate-600'
            }`}
          >
            <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      )}
      {preview && (
        <div role="tablist" aria-label="Email view" className="mt-4 flex gap-1">
          <button type="button" role="tab" aria-selected={tab === 'edit'} aria-controls="notification-edit-panel" className={tabClass(tab === 'edit')} onClick={() => setTab('edit')}>
            Edit
          </button>
          <button type="button" role="tab" aria-selected={tab === 'preview'} aria-controls="notification-preview-panel" className={tabClass(tab === 'preview')} disabled={!draftValid} onClick={showPreview}>
            Preview
          </button>
        </div>
      )}

      <div id="notification-edit-panel" role={preview ? 'tabpanel' : undefined} hidden={tab !== 'edit'}>
        <label htmlFor="notification-subject" className={`${labelClass} mt-4`}>
          Subject
        </label>
        <input id="notification-subject" value={subject} disabled={!canEdit} onChange={(e) => setSubject(e.target.value)} className={fieldClass} />
        <label htmlFor="notification-body" className={`${labelClass} mt-4`}>
          Message
        </label>
        <textarea
          id="notification-body"
          rows={10}
          value={body}
          disabled={!canEdit}
          aria-describedby="notification-merge-fields"
          onChange={(e) => setBody(e.target.value)}
          className={`${fieldClass} font-mono text-xs`}
        />
        <p id="notification-merge-fields" className={hintClass}>
          Merge fields:{' '}
          {mergeFields.map((m) => (
            <code key={m.key} title={m.description} className="mr-1 rounded bg-gray-100 px-1 py-0.5 text-gray-700 dark:bg-slate-700 dark:text-slate-200">
              {`{{${m.key}}}`}
            </code>
          ))}
        </p>
        {blocks.length > 0 && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
            <p className="text-sm font-medium text-gray-900 dark:text-white">Added automatically below your message</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-600 dark:text-slate-400">
              {blocks.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {preview && (
        <div id="notification-preview-panel" role="tabpanel" hidden={tab !== 'preview'} className="mt-4">
          {previewError ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {previewError}
            </p>
          ) : !rendered ? (
            <div className="h-96 animate-pulse rounded-lg bg-gray-100 dark:bg-slate-800" aria-busy="true" aria-label="Loading preview" />
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Subject: <span className="font-medium text-gray-900 dark:text-white" data-testid="notification-preview-subject">{rendered.subject}</span>
              </p>
              <p className={hintClass}>Shown with sample details.</p>
              {/* Sandboxed: no scripts, no same-origin access. */}
              <iframe title={`${title} preview`} sandbox="" srcDoc={rendered.html} className="mt-2 h-96 w-full rounded-lg border border-gray-200 bg-white dark:border-slate-700" />
            </>
          )}
        </div>
      )}

      {canEdit && (sendTest || !template.isDefault) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {sendTest && (
            <button type="button" onClick={test} disabled={testState.busy || saving || !draftValid} className={secondary}>
              {testState.busy ? 'Sending…' : 'Send me a test'}
            </button>
          )}
          {!template.isDefault && (
            <button type="button" onClick={reset} disabled={saving} className={secondary}>
              Reset to default
            </button>
          )}
          {testState.message && (
            <p role={testState.failed ? 'alert' : 'status'} className={`text-sm ${testState.failed ? 'text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-slate-400'}`}>
              {testState.message}
            </p>
          )}
        </div>
      )}
    </SettingsDialog>
  );
}
