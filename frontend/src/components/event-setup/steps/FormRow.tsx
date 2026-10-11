'use client';

// One application form on an application step (spec 050 §5.2 List): name,
// purpose, status, kind and question count, with Edit (expands the inline
// editor below it) and Delete, or Close once it has submissions (the server
// refuses to delete those, and the reason is written out).

import { ChevronDown, ChevronUp, Trash2, XCircle } from 'lucide-react';
import type { AdminForm } from '@/lib/applications';
import { PURPOSE_LABEL } from '../applicationSteps';
import { secondaryButton, textButton } from '../ui';

const STATUS_LABEL: Record<AdminForm['status'], string> = { DRAFT: 'Draft', OPEN: 'Open', CLOSED: 'Closed' };
/** The row's heading: focus lands here after the form is created. */
export const formHeadingId = (id: string) => `setup-form-title-${id}`;
const chip = 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-slate-700 dark:text-slate-200';

interface Props {
  form: AdminForm;
  expanded: boolean;
  showPurpose: boolean;
  canEdit: boolean;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}

export default function FormRow({ form, expanded, showPurpose, canEdit, busy, onToggle, onDelete, onClose, children }: Props) {
  const questions = form.questions.length;
  const submitted = form.applicationCount > 0;
  const editorId = `setup-form-editor-${form.id}`;
  const reasonId = `setup-form-delete-reason-${form.id}`;
  return (
    <li className="rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800" data-testid={`setup-form-${form.id}`}>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0">
          <h3 id={formHeadingId(form.id)} tabIndex={-1} className="break-words text-base font-semibold text-gray-900 focus:outline-none dark:text-white">
            {form.name}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            {showPurpose && <span className={chip}>{PURPOSE_LABEL[form.purpose ?? 'OTHER']}</span>}
            <span className={chip}>{STATUS_LABEL[form.status]}</span>
            <span className={chip}>{form.kind === 'PAID' ? 'Paid' : 'Free'}</span>
            <span className="text-sm text-gray-600 dark:text-slate-400">
              {questions} question{questions === 1 ? '' : 's'}
              {submitted && ` · ${form.applicationCount} application${form.applicationCount === 1 ? '' : 's'}`}
            </span>
          </p>
          {submitted && canEdit && (
            <p id={reasonId} className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              {form.status === 'CLOSED'
                ? 'Has applications, so it can\u2019t be deleted. It is closed to new ones.'
                : 'Has applications, so it can\u2019t be deleted. Close it to stop new ones.'}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={expanded ? editorId : undefined} className={secondaryButton} aria-label={`${expanded ? 'Hide' : canEdit ? 'Edit' : 'View'} ${form.name}`}>
            {expanded ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
            {expanded ? 'Hide' : canEdit ? 'Edit' : 'View'}
          </button>
          {canEdit &&
            (submitted ? (
              form.status !== 'CLOSED' && (
                <button type="button" onClick={onClose} disabled={busy} className={textButton} aria-label={`Close ${form.name}`} aria-describedby={reasonId}>
                  <XCircle className="h-4 w-4" aria-hidden />
                  Close
                </button>
              )
            ) : (
              <button type="button" onClick={onDelete} disabled={busy} className={`${textButton} text-red-700 dark:text-red-300`} aria-label={`Delete ${form.name}`}>
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete
              </button>
            ))}
        </div>
      </div>
      {expanded && (
        <div id={editorId} className="border-t border-gray-200 p-4 dark:border-slate-700 sm:p-6">
          {children}
        </div>
      )}
    </li>
  );
}
