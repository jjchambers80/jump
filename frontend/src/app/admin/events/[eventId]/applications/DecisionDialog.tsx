'use client';

// Approve / reject / waitlist / withdraw one application (spec 011). Shows the
// organization's template rendered for this applicant; the organizer can
// edit the subject/body for this send only, add an internal note, or skip
// the email. Paid approvals will charge the card on file (phase 2).

import { FormEvent, RefObject, useEffect, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { errorClass, fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { DECISION_LABEL, type AdminApplication, type Decision } from '@/lib/applications';
import { describeError, useApplicationsApi } from './useApplicationsApi';

interface DecisionDialogProps {
  eventId: string;
  application: AdminApplication;
  decision: Decision;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onDecided: (next: AdminApplication) => void;
}

const TITLE: Record<Decision, string> = {
  APPROVE: 'Approve application',
  REJECT: 'Reject application',
  WAITLIST: 'Move to waitlist',
  WITHDRAW: 'Withdraw application',
};

export default function DecisionDialog({ eventId, application, decision, returnFocusRef, onClose, onDecided }: DecisionDialogProps) {
  const api = useApplicationsApi(eventId);
  const [template, setTemplate] = useState<{ subject: string; body: string } | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api
      .preview(application.id, decision)
      .then((t) => {
        setTemplate(t);
        setSubject(t.subject);
        setBody(t.body);
      })
      .catch((err) => setError(describeError(err, 'Could not load the email template')));
  }, [api, application.id, decision]);

  const edited = template !== null && (subject !== template.subject || body !== template.body);
  const dirty = edited || note.trim() !== '' || !sendEmail;
  const paidCharge = decision === 'APPROVE' && application.form.kind === 'PAID' && application.paymentStatus === 'CARD_ON_FILE';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !template) return;
    if (sendEmail && (!subject.trim() || !body.trim())) {
      setError('Subject and message are required when sending an email.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await api.decide(application.id, {
        decision,
        note: note.trim() || undefined,
        sendEmail,
        message: sendEmail && edited ? { subject: subject.trim(), body: body.trim() } : null,
      });
      onDecided(next);
    } catch (err) {
      const e = err as { message?: string; details?: { suggestion?: string } };
      setError(e.details?.suggestion === 'WAITLIST' ? `${e.message} Use Waitlist instead.` : describeError(err, 'Could not save the decision'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="decision-dialog-title"
      title={TITLE[decision]}
      dirty={dirty}
      saving={saving}
      saveDisabled={!template}
      submitLabel={DECISION_LABEL[decision]}
      savingLabel="Saving…"
      initialFocusRef={noteRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className="space-y-5">
        {error && (
          <div role="alert" className={formAlertClass}>
            {error}
          </div>
        )}
        <p className="text-sm text-gray-700 dark:text-slate-300">
          <strong>{application.profile.businessName}</strong> · {application.contact.firstName} {application.contact.lastName} · {application.form.name}
          {application.tier ? ` · ${application.tier.name}` : ''}
        </p>
        {paidCharge && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            Approving charges the card on file. You will see the payment result immediately.
          </p>
        )}

        <div>
          <label htmlFor="decision-note" className={labelClass}>
            Internal note (optional)
          </label>
          <textarea ref={noteRef} id="decision-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} />
          <p className={hintClass}>Only your team sees this.</p>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          Email the applicant
        </label>

        {sendEmail && (
          <div className="space-y-3" data-testid="decision-email">
            <div>
              <label htmlFor="decision-subject" className={labelClass}>
                Subject
              </label>
              <input id="decision-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={fieldClass} disabled={!template} />
            </div>
            <div>
              <label htmlFor="decision-body" className={labelClass}>
                Message
              </label>
              <textarea id="decision-body" rows={9} value={body} onChange={(e) => setBody(e.target.value)} className={`${fieldClass} font-mono text-xs`} disabled={!template} />
              <p className={hintClass}>
                {edited ? 'Edited for this applicant only — the template is unchanged.' : 'Rendered from your template. Edit the template on Settings › Applications.'}
              </p>
              {!template && !error && <p className={errorClass}>Loading template…</p>}
            </div>
          </div>
        )}
      </div>
    </SettingsDialog>
  );
}
