'use client';

// The expanded form on an application step (spec 050 §5.2 Edit): the shared
// FormEditorCards, unchanged, each saving on its own. A vendor form's "How
// vendors choose their space" lives in SettingsCard (PAID); choosing MAP adds
// the Floor map step as soon as it is saved. Other applications also pick the
// form's purpose here, fixed once it has applications (PATCH answers 409).
// "Save as template" and "View public form" came from the old form editor
// page (050-O parity: that page now redirects here).

import { useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { AdminForm, FormPurpose, FormTemplateSummary } from '@/lib/applications';
import { QuestionsCard, SettingsCard, TiersCard } from '@/components/applications/FormEditorCards';
import { SaveAsTemplateDialog } from '@/components/applications/TemplateDialogs';
import { useParticipantsApi } from '@/components/applications/useParticipantsApi';
import type { useApplicationsApi } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import { PURPOSE_LABEL, wizardLink } from '../applicationSteps';
import ShiftsCard from './ShiftsCard';
import { hintClass, inputClass, labelClass, secondaryButton } from '../ui';

interface Props {
  form: AdminForm;
  api: ReturnType<typeof useApplicationsApi>;
  canEdit: boolean;
  /** Other applications: the purposes this form may switch between. */
  purposes: FormPurpose[] | null;
  /** After any save: reload the forms and refresh the preview. */
  onSaved: () => void;
  /** Event start / end (ISO): volunteer shifts outside them get a soft warning (050-S). */
  eventStart?: string | null;
  eventEnd?: string | null;
}

export default function InlineFormEditor({ form, api, canEdit, purposes, onSaved, eventStart, eventEnd }: Props) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const participants = useParticipantsApi();
  const [templates, setTemplates] = useState<FormTemplateSummary[] | null>(null);
  const saveAsRef = useRef<HTMLButtonElement>(null);
  const openSaveAs = () =>
    participants
      .templates()
      .then((r) => setTemplates(r.data))
      // Without the list the dialog still saves a new template.
      .catch(() => setTemplates([]));

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setNotice('');
    try {
      await fn();
      onSaved();
      setNotice(label);
    } catch (err) {
      setError((err as Error)?.message || "Couldn't save");
    }
  };
  const purposeLocked = !!form.purposeLocked;

  return (
    <div className="space-y-4">
      {purposes && (
        <div>
          <label htmlFor="setup-form-purpose" className={labelClass}>What is this form for?</label>
          <select
            id="setup-form-purpose"
            value={form.purpose ?? 'OTHER'}
            disabled={!canEdit || purposeLocked}
            aria-describedby={purposeLocked ? 'setup-form-purpose-lock' : undefined}
            onChange={(e) => void run('Purpose saved.', () => api.updateForm(form.id, { purpose: e.target.value }))}
            className={inputClass}
          >
            {purposes.map((p) => (
              <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>
            ))}
          </select>
          {purposeLocked && (
            <p id="setup-form-purpose-lock" className={hintClass}>
              Fixed: this form already has applications.
            </p>
          )}
        </div>
      )}
      {(canEdit || form.status !== 'DRAFT') && (
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <button ref={saveAsRef} type="button" onClick={openSaveAs} className={secondaryButton}>
              Save as template
            </button>
          )}
          {form.status !== 'DRAFT' && (
            <a href={`/events/${form.eventId}/apply/${form.slug}`} target="_blank" rel="noreferrer" className={secondaryButton}>
              View public form
              <ExternalLink className="h-4 w-4" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>
      )}
      <p role="status" className="sr-only">{notice}</p>
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
      <SettingsCard form={form} canEdit={canEdit} linkTo={wizardLink} onSave={(body) => run('Form settings saved.', () => api.updateForm(form.id, body))} />
      {form.kind === 'PAID' && (
        <TiersCard
          form={form}
          canEdit={canEdit}
          linkTo={wizardLink}
          onAdd={(body) => run('Tier added.', () => api.addTier(form.id, body))}
          onUpdate={(tierId, body) => run('Tier saved.', () => api.updateTier(form.id, tierId, body))}
          onDelete={(tierId) => run('Tier deleted.', () => api.deleteTier(form.id, tierId))}
          onSetAddOns={(tierId, addOnIds) => run('Add-ons saved.', () => api.setTierAddOns(form.id, tierId, addOnIds))}
        />
      )}
      {form.purpose === 'VOLUNTEER' && <ShiftsCard form={form} api={api} canEdit={canEdit} eventStart={eventStart} eventEnd={eventEnd} onSaved={onSaved} />}
      <QuestionsCard
        form={form}
        canEdit={canEdit}
        onAdd={(body) => run('Question added.', () => api.addQuestion(form.id, body))}
        onUpdate={(id, body) => run('Question saved.', () => api.updateQuestion(form.id, id, body))}
        onRemove={(id) => run('Question removed.', () => api.removeQuestion(form.id, id))}
        onReorder={(ids) => run('Order saved.', () => api.reorderQuestions(form.id, ids))}
      />
      {templates && (
        <SaveAsTemplateDialog
          form={form}
          templates={templates}
          onSave={(body) => api.saveAsTemplate(form.id, body)}
          onSaved={(t, replaced) => {
            setTemplates(null);
            setNotice(replaced ? `Template "${t.name}" replaced.` : `Saved as the "${t.name}" template.`);
          }}
          returnFocusRef={saveAsRef}
          onClose={() => setTemplates(null)}
        />
      )}
    </div>
  );
}
