'use client';

// Save as template (spec 019 phase 2): a form's settings, options and
// questions saved under a new name or over an existing template. ADMIN-only;
// the page hides the button. Templates are picked from the event's New form
// panel (spec 037 D2).

import { FormEvent, RefObject, useMemo, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { type AdminForm, type FormTemplate, type FormTemplateSummary } from '@/lib/applications';
import { describeError } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';

// ─── Save as template ────────────────────────────────────────────────────────

export function SaveAsTemplateDialog({
  form,
  templates,
  onSave,
  onSaved,
  returnFocusRef,
  onClose,
}: {
  form: Pick<AdminForm, 'id' | 'name' | 'kind' | 'createdFromTemplateId'>;
  templates: FormTemplateSummary[];
  onSave: (body: { name?: string; replaceTemplateId?: string }) => Promise<FormTemplate>;
  onSaved: (template: FormTemplate, replaced: boolean) => void;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const sameKind = useMemo(() => templates.filter((t) => t.kind === form.kind), [templates, form.kind]);
  const [mode, setMode] = useState<'new' | 'replace'>('new');
  const [name, setName] = useState(form.name);
  const [replaceId, setReplaceId] = useState(sameKind.some((t) => t.id === form.createdFromTemplateId) ? form.createdFromTemplateId! : sameKind[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const valid = mode === 'new' ? name.trim().length >= 2 : Boolean(replaceId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    try {
      const t = await onSave(mode === 'new' ? { name: name.trim() } : { replaceTemplateId: replaceId });
      onSaved(t, mode === 'replace');
    } catch (err) {
      setError(describeError(err, 'Could not save the template'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="save-as-template-title"
      title="Save as template"
      dirty={name !== form.name || mode === 'replace'}
      saving={saving}
      saveDisabled={!valid}
      submitWhenClean
      submitLabel={mode === 'new' ? 'Save template' : 'Replace template'}
      savingLabel="Saving…"
      initialFocusRef={nameRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="space-y-4">
        {error && (
          <div role="alert" className={formAlertClass}>
            {error}
          </div>
        )}
        <p className="text-sm text-gray-700 dark:text-slate-300">
          Snapshot the settings, options and questions of <strong>{form.name}</strong> so the next event starts from them. Add-ons, status and dates stay with this event.
        </p>
        <fieldset className="space-y-2">
          <legend className="sr-only">Save as</legend>
          <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
            <input type="radio" name="save-as-mode" checked={mode === 'new'} onChange={() => setMode('new')} /> New template
          </label>
          {mode === 'new' && (
            <div className="pl-6">
              <label htmlFor="sat-name" className={labelClass}>
                Template name
              </label>
              <input id="sat-name" ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} minLength={2} />
            </div>
          )}
          <label className={`flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200 ${sameKind.length === 0 ? 'opacity-60' : ''}`}>
            <input type="radio" name="save-as-mode" checked={mode === 'replace'} disabled={sameKind.length === 0} onChange={() => setMode('replace')} /> Replace an existing template
          </label>
          {mode === 'replace' && (
            <div className="pl-6">
              <label htmlFor="sat-replace" className={labelClass}>
                Template
              </label>
              <select id="sat-replace" value={replaceId} onChange={(e) => setReplaceId(e.target.value)} className={fieldClass}>
                {sameKind.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className={hintClass}>Its settings, options and questions are overwritten. Forms already created from it are not changed.</p>
            </div>
          )}
        </fieldset>
      </div>
    </SettingsDialog>
  );
}
