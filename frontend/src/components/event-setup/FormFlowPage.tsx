'use client';

// An application flow (spec 051): one vendor, special guest, volunteer or
// other application form, set up step by step in the event wizard's shell
// (header, progress, step menu, footer, live preview). Started from the
// event's Overview. Cards save explicitly: Next submits a step's settings and
// moves on only when the save succeeded; list editors (tiers, shifts,
// questions, the lineup) save each change themselves.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useCan } from '@/components/OrgContext';
import { useParticipantsApi } from '@/components/applications/useParticipantsApi';
import { useApplicationsApi } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import { QuestionsCard, SettingsCard, TiersCard } from '@/components/applications/FormEditorCards';
import type { FormTemplateSummary } from '@/lib/applications';
import SetupShell from './SetupShell';
import SetupHeader from './SetupHeader';
import SetupProgress from './SetupProgress';
import SetupFooter from './SetupFooter';
import PreviewPane from './PreviewPane';
import LoadingFields from './LoadingFields';
import { StepMenuSheet, type MenuItem } from './StepMenu';
import { PREVIEW_MESSAGE } from './previewMessages';
import { APPLICATION_STEPS, PURPOSE_LABEL, formsOnStep } from './applicationSteps';
import { FORM_FLOWS, flowSteps, formEditHref, type FlowStepKey, type FormFlowKey } from './formFlows';
import { useFormFlow } from './useFormFlow';
import { useIsDesktop } from './EventSetupPage';
import StartFormStep, { START_FORM_ID, type NewFormBody } from './steps/StartFormStep';
import ReviewFormStep, { REVIEW_FORM_ID } from './steps/ReviewFormStep';
import ShiftsCard from './steps/ShiftsCard';
import FloorMapStep from './steps/FloorMapStep';
import GuestLineupEditor from './lineup/GuestLineupEditor';
import type { StepState } from './steps';
import { hintClass, inputClass, labelClass, secondaryButton } from './ui';

const SETTINGS_FORM_ID = 'flow-settings-form';
const alertClass = 'rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200';
const noop = () => {};

export default function FormFlowPage({ eventId, flow }: { eventId: string; flow: FormFlowKey }) {
  const f = useFormFlow(eventId, flow);
  const { form, step, list, at, event } = f;
  const config = APPLICATION_STEPS[flow];
  const api = useApplicationsApi(eventId);
  const participants = useParticipantsApi();
  const canEdit = useCan('applications.forms');
  const isDesktop = useIsDesktop();
  const [templates, setTemplates] = useState<FormTemplateSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadTemplates = useCallback(() => {
    if (!canEdit) return setTemplates([]);
    participants.templates().then((r) => setTemplates(r.data)).catch(() => setTemplates([]));
  }, [participants, canEdit]);
  useEffect(loadTemplates, [loadTemplates]);

  // Every step change (and arrival: the organizer came from a link) focuses the h1 and announces the step.
  const show = f.ready && !f.redirecting;
  useEffect(() => {
    if (!show) return;
    setBusy(false);
    setError(null);
    setNotice('');
    headingRef.current?.focus();
    setAnnouncement(`Step ${at + 1} of ${list.length}, ${step.title}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.key, show]);
  useEffect(() => {
    if (isDesktop) setPreviewOpen(false);
  }, [isDesktop]);

  const prev = at > 0 ? list[at - 1] : null;
  const next = at < list.length - 1 ? list[at + 1] : null;
  const saved = () => {
    f.forms.reload();
    f.refreshPreview();
  };
  /** Runs a save; reports its error and resolves false when it failed. */
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setNotice('');
    try {
      await fn();
      saved();
      setNotice(label);
      return true;
    } catch (err) {
      setError((err as Error)?.message || "Couldn't save");
      return false;
    }
  };
  /** Next on a settings step: save, then the next step (or back to the event after the last). */
  const saveAndContinue = async (body: Record<string, unknown>) => {
    if (!form) return;
    setBusy(true);
    let updated = form;
    const ok = await run('Saved.', async () => {
      updated = await api.updateForm(form.id, body);
      f.forms.upsert(updated);
    });
    setBusy(false);
    if (!ok) return;
    // From the saved form: choosing a floor map on this step adds the Floor map step next.
    const steps = flowSteps(flow, updated);
    const after = steps[steps.findIndex((s) => s.key === step.key) + 1];
    if (after) f.go(after.key);
    else f.exit(true);
  };
  const create = async (body: NewFormBody) => {
    const created = await api.createForm(body);
    f.forms.upsert(created);
    saved();
    f.go('details', created.id);
  };

  const states: StepState[] = list.map((_, i) => (i === at ? 'current' : i < at ? 'complete' : 'todo'));
  const items: MenuItem<FlowStepKey>[] = list.map((s, i) => ({ step: s, state: states[i], href: f.href(s.key), reachable: f.reachable(s) }));
  const loadError = f.data.load.status === 'error' ? f.data.load : f.forms.load.status === 'error' ? f.forms.load : null;

  // Next: submit the step's own form when it has one, else just move on.
  const settingsStep = canEdit && !!form && (step.key === 'details' || step.key === 'payment');
  const nextForm =
    step.key === 'start' && !form ? (canEdit ? START_FORM_ID : undefined) : settingsStep ? SETTINGS_FORM_ID : step.key === 'review' && canEdit ? REVIEW_FORM_ID : undefined;
  const onNext = nextForm ? undefined : step.key === 'start' && !form ? undefined : next ? () => f.go(next.key) : () => f.exit(true);
  const nextLabel = step.key === 'start' && !form ? (busy ? 'Creating…' : 'Create form') : next ? (busy ? 'Saving…' : 'Next') : busy ? 'Saving…' : 'Save and finish';
  const guestSkip = flow === 'special-guests' && step.key === 'start' && !form;

  let body: React.ReactNode;
  if (loadError)
    body = (
      <div role="alert" className="mx-auto max-w-[640px] px-4 py-8 sm:px-6">
        <p className={alertClass}>
          {loadError.code === 403 ? "You don't have access to this event." : loadError.code === 404 ? 'This event was not found in this organization.' : `Couldn't load this event: ${loadError.message}`}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {loadError.code !== 403 && loadError.code !== 404 && (
            <button type="button" onClick={() => (f.data.load.status === 'error' ? f.data.reload() : f.forms.retry())} className={secondaryButton}>
              Try again
            </button>
          )}
          <Link href={`/admin/events/${eventId}`} className={secondaryButton}>
            Back to the event
          </Link>
        </div>
      </div>
    );
  else if (!show || !event) body = <LoadingFields />;
  else
    body = (
      <div key={step.key} className="mx-auto w-full max-w-[640px] px-4 py-6 motion-safe:animate-fade-in sm:px-6 sm:py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400">
          {form ? form.name : FORM_FLOWS[flow].title}
        </p>
        <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 focus:outline-none dark:text-white">
          {step.title}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">{step.intro}</p>
        <div className="mt-6 space-y-4">
          <p role="status" className="sr-only">{notice}</p>
          {error && (
            <p role="alert" className={alertClass}>
              {error}
            </p>
          )}
          {!canEdit && step.key !== 'lineup' && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              You can view this form, but you don&apos;t have access to change it.
            </p>
          )}
          {step.key === 'lineup' && <GuestLineupEditor orgId={f.orgId ?? ''} eventId={eventId} refreshPreview={f.refreshPreview} />}
          {step.key === 'start' && !form && canEdit && (
            <StartFormStep
              config={config}
              existing={formsOnStep(flow, f.forms.forms).map((x) => ({ id: x.id, name: x.name, status: x.status, href: formEditHref(eventId, x, f.orgId) }))}
              onBusyChange={setBusy}
              eventName={event.name}
              templates={templates}
              canManage={canEdit}
              onDeleteTemplate={async (template) => {
                if (!window.confirm(`Delete the "${template.name}" template? Forms already created from it are kept.`)) return false;
                await participants.deleteTemplate(template.id);
                setTemplates((all) => (all ?? []).filter((t) => t.id !== template.id));
                setNotice(`Template ${template.name} deleted.`);
                return true;
              }}
              onCreate={create}
            />
          )}
          {step.key === 'start' && form && (
            <p className={hintClass}>
              {form.name} is set up. Continue to its details, or go back to the event to add another.
            </p>
          )}
          {form && step.key === 'details' && flow === 'other-applications' && (
            <div>
              <label htmlFor="flow-form-purpose" className={labelClass}>What is this form for?</label>
              <select
                id="flow-form-purpose"
                value={form.purpose ?? 'OTHER'}
                disabled={!canEdit || !!form.purposeLocked}
                aria-describedby={form.purposeLocked ? 'flow-form-purpose-lock' : undefined}
                onChange={(e) => void run('Purpose saved.', () => api.updateForm(form.id, { purpose: e.target.value }))}
                className={inputClass}
              >
                {config.purposes.map((p) => (
                  <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>
                ))}
              </select>
              {form.purposeLocked && (
                <p id="flow-form-purpose-lock" className={hintClass}>
                  Fixed: this form already has applications.
                </p>
              )}
            </div>
          )}
          {form && (step.key === 'details' || step.key === 'payment') && (
            <SettingsCard form={form} canEdit={canEdit} section={step.key} formId={SETTINGS_FORM_ID} hideSubmit onSave={saveAndContinue} />
          )}
          {form && step.key === 'payment' && (
            <TiersCard
              form={form}
              canEdit={canEdit}
              onAdd={(b) => run('Category added.', () => api.addTier(form.id, b)).then(noop)}
              onUpdate={(tierId, b) => run('Category saved.', () => api.updateTier(form.id, tierId, b)).then(noop)}
              onDelete={(tierId) => run('Category deleted.', () => api.deleteTier(form.id, tierId)).then(noop)}
              onSetAddOns={(tierId, ids) => run('Add-ons saved.', () => api.setTierAddOns(form.id, tierId, ids)).then(noop)}
            />
          )}
          {form && step.key === 'floor-map' && <FloorMapStep eventId={eventId} returnTo={f.href('floor-map')} refreshPreview={f.refreshPreview} onMapStatus={noop} />}
          {form && step.key === 'shifts' && <ShiftsCard form={form} api={api} canEdit={canEdit} eventStart={event.date} eventEnd={event.endDate} onSaved={saved} />}
          {form && step.key === 'questions' && (
            <QuestionsCard
              form={form}
              canEdit={canEdit}
              onAdd={(b) => run('Question added.', () => api.addQuestion(form.id, b)).then(noop)}
              onUpdate={(id, b) => run('Question saved.', () => api.updateQuestion(form.id, id, b)).then(noop)}
              onRemove={(id) => run('Question removed.', () => api.removeQuestion(form.id, id)).then(noop)}
              onReorder={(ids) => run('Order saved.', () => api.reorderQuestions(form.id, ids)).then(noop)}
            />
          )}
          {form && step.key === 'review' && (
            <ReviewFormStep
              form={form}
              steps={list}
              stepHref={(key) => f.href(key)}
              canEdit={canEdit}
              eventDraft={event.status === 'DRAFT'}
              api={api}
              templates={templates ?? []}
              onTemplatesChanged={loadTemplates}
              onSaveStatus={saveAndContinue}
              onRemove={async (action) => {
                if (action === 'close') return void (await run(`${form.name} closed.`, () => api.updateForm(form.id, { status: 'CLOSED' })));
                // No reload: the form is gone, and this flow would restart without it.
                try {
                  await api.deleteForm(form.id);
                  f.exit(true);
                } catch (err) {
                  setError((err as Error)?.message || "Couldn't delete the form");
                }
              }}
            />
          )}
        </div>
      </div>
    );

  return (
    <SetupShell
      announcement={announcement}
      header={
        <SetupHeader
          eventName={event?.name ?? null}
          hasRow={false}
          saving={busy}
          showMenuButton={show}
          menuButtonClass=""
          onMenu={() => setMenuOpen(true)}
          onPreview={() => setPreviewOpen(true)}
          onExit={() => f.exit()}
        />
      }
      progress={show && <SetupProgress steps={list} states={states} index={at + 1} total={list.length} title={step.title} aside={null} />}
      footer={
        show && (
          <SetupFooter
            onBack={prev ? () => f.go(prev.key) : undefined}
            onSkip={guestSkip ? () => f.exit(true) : undefined}
            skipLabel="Finish without a form"
            onNext={onNext}
            nextForm={nextForm}
            nextLabel={nextLabel}
            busy={busy || (nextForm === START_FORM_ID && templates === null)}
          />
        )
      }
      preview={
        show && f.orgId ? (
          <PreviewPane
            message={{ type: PREVIEW_MESSAGE, orgId: f.orgId, eventId, overlay: {}, revision: f.revision, anchor: step.anchor }}
            isDesktop={isDesktop}
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
          />
        ) : undefined
      }
    >
      {body}
      {menuOpen && <StepMenuSheet items={items} onGo={(key) => f.go(key)} onClose={() => setMenuOpen(false)} unreachableText="(available once the form is created)" />}
    </SetupShell>
  );
}
