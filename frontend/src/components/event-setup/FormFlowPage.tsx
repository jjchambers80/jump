'use client';

// A setup flow (spec 051) in the event wizard's shell (header, progress bar,
// footer, live preview): a registration event's one form (spec 057), set up
// step by step inside its event wizard, or a live event's special guest
// lineup. Cards save explicitly: Next submits a step's settings and
// moves on only when the save succeeded; list editors (tiers,
// questions, the lineup) save each change themselves.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useCan, useOrg } from '@/components/OrgContext';
import { useApplicationsApi } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import { QuestionsCard, SettingsCard, TiersCard } from '@/components/applications/FormEditorCards';
import SetupShell from './SetupShell';
import SetupHeader from './SetupHeader';
import SetupProgress from './SetupProgress';
import SetupFooter from './SetupFooter';
import PreviewPane from './PreviewPane';
import LoadingFields from './LoadingFields';
import { PREVIEW_MESSAGE, draftPreviewForm, previewForm, type DraftForm } from './previewMessages';
import { FORM_FLOWS, flowSteps, type FormFlowKey } from './formFlows';
import { useFormFlow } from './useFormFlow';
import { useIsDesktop } from './EventSetupPage';
import { collectsMore, wizardProgress } from './steps';
import { EMPTY_FIELDS } from './useSetupFlow';
import StartFormStep, { KindChoice, OptInSettings, PaidStagesHint, START_FORM_ID, type NewFormBody } from './steps/StartFormStep';
import FloorMapStep from './steps/FloorMapStep';
import GuestLineupEditor from './lineup/GuestLineupEditor';
import { hintClass, secondaryButton } from './ui';

const SETTINGS_FORM_ID = 'flow-settings-form';
const alertClass = 'rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200';
const noop = () => {};

export default function FormFlowPage({ eventId, flow }: { eventId: string; flow: FormFlowKey }) {
  const f = useFormFlow(eventId, flow);
  const { form, step, list, at, event } = f;
  const api = useApplicationsApi(eventId);
  const canEdit = useCan('applications.forms');
  const maps = useCan('maps');
  const isDesktop = useIsDesktop();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { selectedOrg } = useOrg();
  // Unsaved settings typed on a step (How registrants choose and pay): the preview shows them as typed.
  const [typed, setTyped] = useState<{ name?: string; intro?: string | null; buttonLabel?: string | null }>({});
  // Start, before the form exists: what is being set up (name, paid).
  const [draft, setDraft] = useState<DraftForm | null>(null);

  // Every step change (and arrival: the organizer came from a link) focuses the h1 and announces the step.
  const show = f.ready && !f.redirecting;
  useEffect(() => {
    if (!show) return;
    setBusy(false);
    setTyped({});
    setError(null);
    setNotice('');
    headingRef.current?.focus();
    setAnnouncement(`Step ${progress.index} of ${progress.total}, ${step.title}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.key, show]);
  useEffect(() => {
    if (isDesktop) setPreviewOpen(false);
  }, [isDesktop]);

  const prev = at > 0 ? list[at - 1] : null;
  const next = at < list.length - 1 ? list[at + 1] : null;
  // Spec 057: a registration event's flow sits inside its event wizard, between Image and Collect more.
  const inWizard = flow === 'registration';
  // Collect more only when the event can sell add-ons (a paid form); else straight to Review.
  const finish = (current = form) =>
    inWizard && event
      ? f.toEventStep(collectsMore({ saved: event, fields: EMPTY_FIELDS, forms: current ? [current] : [] }) ? 'collect-more' : 'review')
      : f.exit(true);
  const progress = inWizard && event
    ? wizardProgress({ saved: event, fields: EMPTY_FIELDS, zone: null, savedZone: null, forms: f.forms.forms }, null, at, list.length)
    : { index: at + 1, total: list.length };
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
    const steps = flowSteps(flow, updated, { maps });
    const after = steps[steps.findIndex((s) => s.key === step.key) + 1];
    if (after) f.go(after.key);
    else finish(updated);
  };
  const create = async (body: NewFormBody) => {
    const created = await api.createForm({ ...body, setup: true });
    f.forms.upsert(created);
    saved();
    // From the created form: a paid one has Options and pricing next, a free one Fields.
    const steps = flowSteps(flow, created, { maps });
    const after = steps[steps.findIndex((s) => s.key === 'start') + 1];
    if (after) f.go(after.key, created.id);
    else finish(created);
  };

  const loadError = f.data.load.status === 'error' ? f.data.load : f.forms.load.status === 'error' ? f.forms.load : null;

  // Next: submit the step's own form when it has one, else just move on.
  const settingsStep = canEdit && !!form && step.key === 'payment';
  const nextForm =
    step.key === 'start' && !form ? (canEdit ? START_FORM_ID : undefined) : settingsStep ? SETTINGS_FORM_ID : undefined;
  const onNext = nextForm ? undefined : step.key === 'start' && !form ? undefined : next ? () => f.go(next.key) : () => finish();
  const nextLabel =
    step.key === 'start' && !form ? (busy ? 'Creating…' : 'Create form') : next || inWizard ? (busy ? 'Saving…' : 'Next') : busy ? 'Saving…' : 'Save and finish';

  // Steps that shape the form preview the form: the saved one, or Start's draft before it exists.
  const previewing = !step.formAnchor
    ? null
    : form
      ? previewForm(form, typed, selectedOrg?.name)
      : step.key === 'start' && draft && canEdit
        ? draftPreviewForm(draft, selectedOrg?.name)
        : null;
  // A paid form has two screens for registrants: the form, then (once approved)
  // the options to choose and pay for. The preview names the one it shows.
  const paidPreview = !!previewing && (form ? form.kind === 'PAID' : draft?.kind === 'PAID');
  const previewCaption = !paidPreview
    ? undefined
    : step.preview === 'space'
      ? { stage: 'Step 2 of 2', text: 'After you approve them: choose an option and pay' }
      : { stage: 'Step 1 of 2', text: 'The form people fill out to register' };

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
          {/* A registration form is named after its event, which the header already shows. */}
          {form && !inWizard ? form.name : FORM_FLOWS[flow].title}
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
              onBusyChange={setBusy}
              onDraftChange={setDraft}
              eventName={event.name}
              onCreate={create}
            />
          )}
          {step.key === 'start' && form && (
            <>
              <KindChoice
                paid={form.kind === 'PAID'}
                disabled={!canEdit || form.applicationCount > 0}
                onChange={(paid) => run('Saved.', async () => f.forms.upsert(await api.updateForm(form.id, { kind: paid ? 'PAID' : 'FREE' }))).then(noop)}
              />
              {form.kind === 'PAID' && <PaidStagesHint />}
              {form.applicationCount > 0 && <p className={hintClass}>Free or paid can&apos;t change once people have registered.</p>}
              <OptInSettings
                value={{ offerAccount: form.offerAccount !== false, offerMarketing: form.offerMarketing !== false }}
                disabled={!canEdit}
                onChange={(patch) => run('Saved.', async () => f.forms.upsert(await api.updateForm(form.id, patch))).then(noop)}
              />
            </>
          )}
          {form && step.key === 'payment' && (
            <SettingsCard
              form={form}
              canEdit={canEdit}
              section="payment"
              formId={SETTINGS_FORM_ID}
              hideSubmit
              onSave={saveAndContinue}
              onChange={(s) => setTyped({ name: s.name as string, intro: (s.intro as string | null) ?? null, buttonLabel: (s.buttonLabel as string | null) ?? null })}
            />
          )}
          {form && step.key === 'options' && (
            <TiersCard
              form={form}
              canEdit={canEdit}
              embedded
              onAdd={(b) => run('Category added.', () => api.addTier(form.id, b)).then(noop)}
              onUpdate={(tierId, b) => run('Category saved.', () => api.updateTier(form.id, tierId, b)).then(noop)}
              onDelete={(tierId) => run('Category deleted.', () => api.deleteTier(form.id, tierId)).then(noop)}
              onSetAddOns={(tierId, ids) => run('Add-ons saved.', () => api.setTierAddOns(form.id, tierId, ids)).then(noop)}
            />
          )}
          {form && step.key === 'floor-map' && <FloorMapStep eventId={(inWizard && event?.linkedEventId) || eventId} returnTo={f.href('floor-map')} refreshPreview={f.refreshPreview} onMapStatus={noop} />}
          {form && step.key === 'questions' && (
            <QuestionsCard
              form={form}
              canEdit={canEdit}
              onAdd={(b) => run('Question added.', () => api.addQuestion(form.id, b)).then(noop)}
              onUpdate={(id, b) => run('Question saved.', () => api.updateQuestion(form.id, id, b)).then(noop)}
              onRemove={(id) => run('Question removed.', () => api.removeQuestion(form.id, id)).then(noop)}
              onReorder={(ids) => run('Order saved.', () => api.reorderQuestions(form.id, ids)).then(noop)}
              onToggleBuiltIn={(patch) => run('Fields saved.', async () => f.forms.upsert(await api.updateForm(form.id, patch))).then(noop)}
              embedded
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
          onPreview={() => setPreviewOpen(true)}
          onExit={() => f.exit()}
        />
      }
      progress={show && <SetupProgress index={progress.index} total={progress.total} />}
      footer={
        show && (
          <SetupFooter
            onBack={prev ? () => f.go(prev.key) : inWizard ? () => f.toEventStep('image') : undefined}
            onNext={onNext}
            nextForm={nextForm}
            nextLabel={nextLabel}
            busy={busy}
          />
        )
      }
      preview={
        show && f.orgId ? (
          <PreviewPane
            message={{
              type: PREVIEW_MESSAGE,
              orgId: f.orgId,
              eventId,
              overlay: {},
              revision: f.revision,
              anchor: (previewing && step.formAnchor) || step.anchor,
              form: previewing,
              ...(previewing && step.preview && { view: step.preview }),
            }}
            subject={previewing ? 'form' : 'event'}
            caption={previewCaption}
            isDesktop={isDesktop}
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
          />
        ) : undefined
      }
    >
      {body}
    </SetupShell>
  );
}
