'use client';

// Approve / reject / waitlist / withdraw one application (spec 011). Shows the
// organization's template rendered for this applicant; the organizer can
// edit the subject/body for this send only, add an internal note, or skip
// the email. Spec 037 phase 5: approving a PAID application assigns its
// category (required when the form has several) and charges nothing — the
// vendor is emailed to choose their space and pay (CHOOSE_SPACE template).
// Spec 039: on a TIERS form the organizer may instead let the vendor choose
// the tier (sent as `tierId: null`; nothing is reserved until they pay); a
// MAP form always names the category whose spots the vendor may pick.

import { FormEvent, RefObject, useEffect, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { errorClass, fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { applicantName, DECISION_LABEL, money, type AdminApplication, type Decision } from '@/lib/applications';

/** Select value for "Let the vendor choose" (spec 039 D6). */
const VENDOR_CHOOSES = '__vendor';
import { describeError, useApplicationsApi } from './useApplicationsApi';

interface DecisionDialogProps {
  eventId: string;
  /** Spec 044: decide on a standing-form submission; it is always emailed. */
  standingFormId?: string;
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

export default function DecisionDialog({ eventId, standingFormId, application, decision, returnFocusRef, onClose, onDecided }: DecisionDialogProps) {
  const api = useApplicationsApi(eventId, standingFormId);
  const [template, setTemplate] = useState<{ subject: string; body: string } | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // Spec 037 D4: the category an approval assigns. Preselected when there is
  // one active category, or the one already on the application.
  const categories = (application.categories ?? []).filter((c) => c.isActive);
  const assignsCategory = decision === 'APPROVE' && application.form.kind === 'PAID';
  const spotMode = application.form.spaceSelection === 'MAP';
  const [tierId, setTierId] = useState<string>(() => {
    if (application.tier && categories.some((c) => c.id === application.tier?.id)) return application.tier.id;
    if (!spotMode) return VENDOR_CHOOSES;
    return categories.length === 1 ? categories[0].id : '';
  });
  const vendorChooses = assignsCategory && tierId === VENDOR_CHOOSES;
  // What the API gets: an id, or null for "the vendor chooses".
  const tierIdToSend = vendorChooses ? null : tierId;
  const reserves = application.form.reserveOnApproval !== false;
  const chosen = categories.find((c) => c.id === tierId) ?? null;
  const full = assignsCategory && reserves && chosen !== null && chosen.remaining <= 0 && application.capacitySlot === 'NONE';

  useEffect(() => {
    if (assignsCategory && !tierId) return;
    api
      .preview(application.id, decision, assignsCategory ? tierIdToSend : undefined)
      .then((t) => {
        setTemplate(t);
        setSubject(t.subject);
        setBody(t.body);
      })
      .catch((err) => setError(describeError(err, 'Could not load the email template')));
    // tierIdToSend follows tierId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, application.id, decision, assignsCategory, tierId]);

  const edited = template !== null && (subject !== template.subject || body !== template.body);
  const dirty = edited || note.trim() !== '' || !sendEmail;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !template) return;
    if (assignsCategory && !tierId) {
      setError('Choose a category for this vendor.');
      return;
    }
    if (sendEmail && (!subject.trim() || !body.trim())) {
      setError('Subject and message are required when sending an email.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await api.decide(application.id, {
        decision,
        ...(assignsCategory && { tierId: tierIdToSend }),
        note: note.trim() || undefined,
        sendEmail,
        message: sendEmail && edited ? { subject: subject.trim(), body: body.trim() } : null,
      });
      onDecided(next);
    } catch (err) {
      const e = err as { code?: string; message?: string; details?: { suggestion?: string } };
      setError(
        e.details?.suggestion === 'WAITLIST'
          ? `${e.message} Use Waitlist instead.`
          : e.code === 'NO_SPOTS_IN_CATEGORY'
            ? `${e.message}. Add spots for it on the floor map, publish the map, or pick another category.`
            : describeError(err, 'Could not save the decision')
      );
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="decision-dialog-title"
      title={TITLE[decision]}
      dirty={dirty}
      saving={saving}
      saveDisabled={!template || (assignsCategory && !tierId)}
      submitWhenClean
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
          <strong>{applicantName(application)}</strong> · {application.contact.firstName} {application.contact.lastName} · {application.form.name}
          {application.tier ? ` · ${application.tier.name}` : ''}
        </p>
        {assignsCategory && (
          <div data-testid="decision-category">
            <label htmlFor="decision-category" className={labelClass}>
              {spotMode ? 'Category (the spots this vendor may pick)' : 'Space type'}
            </label>
            <select id="decision-category" value={tierId} onChange={(e) => setTierId(e.target.value)} className={fieldClass} required>
              {spotMode && categories.length !== 1 && <option value="">Choose a category…</option>}
              {!spotMode && <option value={VENDOR_CHOOSES}>Let the vendor choose</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {money(c.price)} · {c.remaining} left
                </option>
              ))}
            </select>
            <p className={hintClass} data-testid="decision-category-hint">
              {vendorChooses
                ? 'The vendor picks from your active tiers and pays. Nothing is reserved until they pay, so a tier can sell out first.'
                : spotMode
                  ? reserves
                    ? 'Approving reserves a space in this category. Nothing is charged: the vendor picks a spot of this category on the floor map and pays.'
                    : 'Approving reserves nothing (first come, first served). Nothing is charged: the vendor picks a spot of this category on the floor map and pays.'
                  : reserves
                    ? 'Approving reserves a space in this tier. Nothing is charged: the vendor pays, and you place them on the floor.'
                    : 'Approving reserves nothing (first come, first served). Nothing is charged: the vendor pays, and you place them on the floor.'}
            </p>
            {full && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300" data-testid="decision-category-full">
                {chosen?.name} is full. Waitlist the application, pick another category, or raise its quantity.
              </p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="decision-note" className={labelClass}>
            Internal note (optional)
          </label>
          <textarea ref={noteRef} id="decision-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} />
          <p className={hintClass}>Only your team sees this.</p>
        </div>

        {!standingFormId && (
          <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
            Email the applicant
          </label>
        )}

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
              {!template && !error && <p className={errorClass}>{assignsCategory && !tierId ? 'Choose a category to preview the email.' : 'Loading template…'}</p>}
            </div>
          </div>
        )}
      </div>
    </SettingsDialog>
  );
}
