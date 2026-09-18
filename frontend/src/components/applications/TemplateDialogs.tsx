'use client';

// Spec 019 phase 2 dialogs: New application (event + name + kind, optionally
// from a template), New template (name + kind), Save as template (new name or
// replace an existing one). All ADMIN-only; the pages hide the buttons.

import { FormEvent, RefObject, useEffect, useMemo, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import api from '@/services/api';
import { formatDate, type AdminForm, type FormKind, type FormTemplate, type FormTemplateSummary } from '@/lib/applications';
import { describeError } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import { useParticipantsApi } from '@/app/admin/participants/useParticipantsApi';

const KIND_LABEL: Record<FormKind, string> = { FREE: 'Free (press, panels, creators)', PAID: 'Paid with options (vendors, sponsors)' };

interface PickerEvent {
  id: string;
  name: string;
  date: string;
  status: string;
  organizationName?: string;
}

/** Events an application form can be created on: not ended, not cancelled, drafts included (plan §7.7). */
export function eventsForNewForm(events: PickerEvent[], now = new Date()): PickerEvent[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return events.filter((e) => e.status !== 'CANCELLED' && new Date(e.date) >= today).sort((a, b) => a.date.localeCompare(b.date));
}

// ─── New application ─────────────────────────────────────────────────────────

export function NewApplicationDialog({
  organizationIds,
  templates,
  returnFocusRef,
  onClose,
}: {
  /** Organizations to offer events from (one for members; every org for SYSTEM_ADMIN). */
  organizationIds: { id: string; name: string }[];
  templates: FormTemplateSummary[];
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<PickerEvent[] | null>(null);
  const [eventId, setEventId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FormKind>('FREE');
  const [templateId, setTemplateId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lists = await Promise.all(
          organizationIds.map((org) =>
            api
              .get<{ events: PickerEvent[] }>(`/organizations/${org.id}/events?limit=100`)
              .then((r) => r.events.map((e) => ({ ...e, organizationName: organizationIds.length > 1 ? org.name : undefined })))
          )
        );
        if (!cancelled) setEvents(eventsForNewForm(lists.flat()));
      } catch (err) {
        if (!cancelled) setError(describeError(err, 'Could not load events'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationIds]);

  const sameKind = useMemo(() => templates.filter((t) => t.kind === kind), [templates, kind]);
  useEffect(() => {
    if (templateId && !sameKind.some((t) => t.id === templateId)) setTemplateId('');
  }, [sameKind, templateId]);

  const grouped = useMemo(() => {
    const groups = new Map<string, PickerEvent[]>();
    for (const e of events ?? []) {
      const key = e.organizationName ?? '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    return [...groups.entries()];
  }, [events]);

  const valid = Boolean(eventId) && name.trim().length >= 2;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    try {
      const form = await api.post<AdminForm>(`/admin/events/${eventId}/application-forms`, { kind, name: name.trim(), ...(templateId ? { templateId } : {}) });
      window.location.assign(`/admin/events/${eventId}/applications/forms/${form.id}`);
    } catch (err) {
      setError(describeError(err, 'Could not create the application form'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="new-application-title"
      title="New application"
      dirty={Boolean(eventId || name || templateId)}
      saving={saving}
      saveDisabled={!valid}
      submitLabel="Create"
      savingLabel="Creating…"
      initialFocusRef={eventRef}
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
        <div>
          <label htmlFor="na-event" className={labelClass}>
            Event
          </label>
          <select id="na-event" ref={eventRef} value={eventId} onChange={(e) => setEventId(e.target.value)} className={fieldClass} disabled={!events}>
            <option value="">{events ? (events.length ? 'Choose an event…' : 'No upcoming events') : 'Loading…'}</option>
            {grouped.map(([org, list]) =>
              org ? (
                <optgroup key={org} label={org}>
                  {list.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} · {formatDate(e.date)}
                    </option>
                  ))}
                </optgroup>
              ) : (
                list.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {formatDate(e.date)}
                  </option>
                ))
              )
            )}
          </select>
          <p className={hintClass}>Upcoming events, drafts included. Cancelled and past events are not offered.</p>
        </div>
        <div>
          <label htmlFor="na-name" className={labelClass}>
            Name
          </label>
          <input id="na-name" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} placeholder="Vendor space, Press, Panels…" minLength={2} />
        </div>
        <div>
          <label htmlFor="na-kind" className={labelClass}>
            Type
          </label>
          <select id="na-kind" value={kind} onChange={(e) => setKind(e.target.value as FormKind)} className={fieldClass}>
            {(['FREE', 'PAID'] as FormKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="na-template" className={labelClass}>
            Start from template
          </label>
          <select id="na-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={fieldClass}>
            <option value="">Blank</option>
            {sameKind.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.organization ? ` · ${t.organization.name}` : ''}
              </option>
            ))}
          </select>
          {sameKind.length === 0 && <p className={hintClass}>No {kind === 'PAID' ? 'paid' : 'free'} templates yet.</p>}
        </div>
      </div>
    </SettingsDialog>
  );
}

// ─── New template ────────────────────────────────────────────────────────────

export function NewTemplateDialog({ returnFocusRef, onClose }: { returnFocusRef: RefObject<HTMLButtonElement>; onClose: () => void }) {
  const participants = useParticipantsApi();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FormKind>('FREE');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const valid = name.trim().length >= 2;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    try {
      const t = await participants.createTemplate({ name: name.trim(), kind });
      window.location.assign(`/admin/participants/templates/${t.id}`);
    } catch (err) {
      setError(describeError(err, 'Could not create the template'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="new-template-title"
      title="New template"
      dirty={Boolean(name)}
      saving={saving}
      saveDisabled={!valid}
      submitLabel="Create"
      savingLabel="Creating…"
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
        <div>
          <label htmlFor="nt-name" className={labelClass}>
            Name
          </label>
          <input id="nt-name" ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} placeholder="Exhibitor booths" minLength={2} />
        </div>
        <div>
          <label htmlFor="nt-kind" className={labelClass}>
            Type
          </label>
          <select id="nt-kind" value={kind} onChange={(e) => setKind(e.target.value as FormKind)} className={fieldClass}>
            {(['FREE', 'PAID'] as FormKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <p className={hintClass}>The type cannot change later; forms created from the template share it.</p>
        </div>
      </div>
    </SettingsDialog>
  );
}

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
