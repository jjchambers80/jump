'use client';

// Event setup wizard, container (spec 050 §8.1). `/admin/events/new` (no row
// yet, steps 1–3) and `/admin/events/[eventId]/setup?step=` both render this.
// State lives in useSetupFlow, actions in useSetupActions; this file wires
// focus, the announcement, the mobile sheets and the load states.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SetupShell from './SetupShell';
import SetupHeader from './SetupHeader';
import SetupProgress from './SetupProgress';
import SetupFooter from './SetupFooter';
import SaveIndicator from './SaveIndicator';
import PreviewPane from './PreviewPane';
import StepContent from './StepContent';
import { StepMenuSheet, StepRail, type MenuItem } from './StepMenu';
import { isReachable, stepState, type StepKey } from './steps';
import { useSetupFlow } from './useSetupFlow';
import { useSetupActions } from './useSetupActions';
import { focusAfterStepChange, takeStepFocus } from './stepFocus';
import { toSaved } from './useSetupData';
import { markSetupFinished } from './doneMarker';
import LoadingFields from './LoadingFields';
import { LOCKED_REASON_ID } from './SetupFooter';
import { secondaryButton } from './ui';

function useIsDesktop() {
  const query = '(min-width: 1024px)';
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return matches;
}

export default function EventSetupPage({ eventId = null }: { eventId?: string | null }) {
  const flow = useSetupFlow(eventId);
  const actions = useSetupActions(flow);
  const { data, ctx, list, current, step, at, saveState, mode, fields, setFields, orgId, urlFor } = flow;
  const saved = ctx.saved;
  const isDesktop = useIsDesktop();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // A publish in flight holds the organizer on Review (Back and the step menu wait).
  const [publishing, setPublishing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const firstStep = useRef(true);

  const position = `Step ${at + 1} of ${list.length}`;
  // Step change: focus the h1 (or the field an error link named) and announce
  // the step (§11.4). Not on a plain first load, but after the create, which
  // remounts this page on the event's own route.
  useEffect(() => {
    if (!flow.initialised) return;
    const queued = takeStepFocus();
    // Done moves focus to its heading even on a fresh load (050-I).
    if (firstStep.current && !queued && current !== 'done') {
      firstStep.current = false;
      return;
    }
    firstStep.current = false;
    const field = queued?.field ? document.getElementById(queued.field) : null;
    (field ?? headingRef.current)?.focus();
    setAnnouncement(current === 'done' ? '' : `${position}, ${step.title}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, flow.initialised]);
  useEffect(() => {
    if (isDesktop) setPreviewOpen(false);
  }, [isDesktop]);

  const states = list.map((s) => stepState(s, current, ctx));
  const items: MenuItem[] = list.map((s, i) => ({ step: s, state: states[i], href: urlFor(s.key), reachable: isReachable(s.key, ctx) }));
  const readOnly = saveState.error?.status === 403;
  const loadError = data.load.status === 'error' ? data.load : null;

  let body: React.ReactNode;
  if (loadError) {
    const forbidden = loadError.code === 403;
    body = (
      <div role="alert" className="mx-auto max-w-[640px] px-4 py-8 sm:px-6">
        <p className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {forbidden ? "You don't have access to change this." : loadError.code === 404 ? 'This event was not found in this organization.' : `Couldn't load this event: ${loadError.message}`}
        </p>
        <div className="mt-4 flex gap-2">
          {!forbidden && loadError.code !== 404 && (
            <button type="button" onClick={data.reload} className={secondaryButton}>
              Try again
            </button>
          )}
          <Link href={eventId ? `/admin/events/${eventId}` : '/admin/events'} className={secondaryButton}>
            Back to {eventId ? 'the event' : 'events'}
          </Link>
        </div>
      </div>
    );
  } else if (!flow.initialised) body = <LoadingFields />;
  else
    body = (
      <StepContent
        ref={headingRef}
        step={step}
        fields={fields}
        onChange={(patch) => setFields((f) => ({ ...f, ...patch }))}
        summary={actions.summary}
        inline={actions.inline}
        summaryRef={actions.summaryRef}
        onOpenStep={(error) => error.step && actions.go(error.step as StepKey, error.field)}
        status={saved?.status ?? null}
        orgId={orgId ?? ''}
        venues={data.venues}
        zone={flow.zone}
        readOnly={readOnly}
        event={saved}
        review={{ createMode: mode === 'create', flush: saveState.flush, onBusyChange: setPublishing, onFinished: (row) => {
          data.setSaved(toSaved(row));
          // Done is for the tab that just finished setup (050-I doneMarker).
          markSetupFinished(row.id);
          focusAfterStepChange();
          flow.router.push(urlFor('done'));
        } }}
        forms={flow.forms}
        row={saved ? { saved, setSaved: data.setSaved, zone: ctx.savedZone, refreshPreview: flow.refreshPreview } : null}
        onAddOnsSaved={(count) => {
          flow.setAddOnCount(count);
          flow.refreshPreview();
        }}
        onVenueCreated={(venue) => {
          data.addVenue({ id: venue.id, name: venue.name, address: venue.address, timezone: venue.timezone, city: venue.city, state: venue.state });
          setFields((f) => ({ ...f, venueId: venue.id }));
        }}
      />
    );

  const ready = flow.initialised && !loadError;
  const done = current === 'done';
  const railed = mode === 'edit' && !done;

  return (
    <SetupShell
      announcement={announcement}
      header={
        <SetupHeader
          eventName={saved?.name ?? null}
          hasRow={!!saved}
          saving={saveState.status === 'saving'}
          showMenuButton={ready}
          menuButtonClass={railed ? 'xl:hidden' : ''}
          menuLockedBy={publishing ? LOCKED_REASON_ID : undefined}
          onMenu={() => !publishing && setMenuOpen(true)}
          onPreview={() => setPreviewOpen(true)}
          onExit={actions.onExit}
        />
      }
      progress={
        ready && !done && (
          <SetupProgress
            steps={list}
            states={states}
            index={at + 1}
            total={list.length}
            title={step.title}
            aside={<SaveIndicator status={saveState.status} invalidCount={saveState.invalidCount} savedAt={saveState.savedAt} hasRow={!!saved} onRetry={() => void saveState.retry()} />}
          />
        )
      }
      rail={ready && railed ? <StepRail items={items} onGo={actions.go} lockedBy={publishing ? LOCKED_REASON_ID : undefined} /> : undefined}
      footer={
        ready && !done && (
          <SetupFooter
            onBack={actions.onBack}
            locked={publishing ? 'Publishing… Back and the step menu return when it finishes.' : undefined}
            onSkip={actions.onSkip}
            onSave={actions.onSave}
            onNext={current === 'review' ? undefined : () => void actions.onNext()}
            nextLabel={actions.nextLabel}
            busy={actions.creating}
          />
        )
      }
      preview={
        ready && orgId ? (
          <PreviewPane message={flow.preview} isDesktop={isDesktop} open={previewOpen} onClose={() => setPreviewOpen(false)} />
        ) : (
          !loadError && (
            <div aria-hidden className="hidden flex-1 border-l border-gray-200 bg-gray-50 p-6 dark:border-slate-700 dark:bg-slate-900 lg:block">
              <div className="mx-auto h-full max-h-[52rem] max-w-[24rem] animate-pulse rounded-lg bg-gray-200 dark:bg-slate-800" />
            </div>
          )
        )
      }
    >
      {body}
      {menuOpen && <StepMenuSheet items={items} onGo={actions.go} onClose={() => setMenuOpen(false)} />}
    </SetupShell>
  );
}
