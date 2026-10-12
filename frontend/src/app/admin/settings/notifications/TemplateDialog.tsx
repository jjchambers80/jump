'use client';

import { FormEvent, RefObject, useState } from 'react';
import SettingsDialog from '../SettingsDialog';
import { fieldClass, hintClass, labelClass } from '../formShared';
import type { MessageTemplate } from '@/lib/applications';

interface TemplateDialogProps {
  title: string;
  /** When the email goes out, shown under the title. */
  when: string;
  template: MessageTemplate;
  mergeFields: { key: string; description: string }[];
  canEdit: boolean;
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  onSave: (draft: { subject: string; body: string }) => Promise<boolean>;
  onReset: () => Promise<boolean>;
}

/** Edits one notification email (subject + message) in the Settings dialog shell. */
export default function TemplateDialog({ title, when, template, mergeFields, canEdit, returnFocusRef, onClose, onSave, onReset }: TemplateDialogProps) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [saving, setSaving] = useState(false);
  const dirty = subject !== template.subject || body !== template.body;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const ok = await onSave({ subject, body });
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

  return (
    <SettingsDialog
      titleId="notification-template-title"
      title={title}
      dirty={dirty}
      saving={saving}
      saveDisabled={!canEdit || !subject.trim() || !body.trim()}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <p className="text-sm text-gray-600 dark:text-slate-400">{when}</p>
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
          <code key={m.key} title={m.description} className="mr-1 rounded bg-gray-100 px-1 py-0.5 dark:bg-slate-700">
            {`{{${m.key}}}`}
          </code>
        ))}
      </p>
      {canEdit && !template.isDefault && (
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          className="mt-4 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          Reset to default
        </button>
      )}
    </SettingsDialog>
  );
}
