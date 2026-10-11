// Steps 1–3 before the server row exists (spec 050 §4): the form is mirrored
// to sessionStorage per organization, so a refresh resumes where it was. The
// Idempotency-Key of the create lives here too: a retried or double-sent create
// replays the same row instead of making a second one. sessionStorage can be
// missing or throw (private mode, blocked storage); the wizard works without it.

import type { SetupFields, StepKey } from './steps';

export interface SessionDraft extends SetupFields {
  step: StepKey;
  /** Idempotency-Key for POST /events {setup:true}; minted on the first attempt. */
  requestKey?: string;
}

const keyFor = (orgId: string) => `jump:event-setup:${orgId}`;

export function readSessionDraft(orgId: string): SessionDraft | null {
  try {
    const raw = window.sessionStorage.getItem(keyFor(orgId));
    return raw ? (JSON.parse(raw) as SessionDraft) : null;
  } catch {
    return null;
  }
}

/** Saves the form; an Idempotency-Key already minted is kept. */
export function writeSessionDraft(orgId: string, draft: SessionDraft) {
  try {
    const requestKey = draft.requestKey ?? readSessionDraft(orgId)?.requestKey;
    window.sessionStorage.setItem(keyFor(orgId), JSON.stringify({ ...draft, requestKey }));
  } catch {
    // Storage unavailable: the draft lives in memory only.
  }
}

export function clearSessionDraft(orgId: string) {
  memoryKeys.delete(orgId);
  try {
    window.sessionStorage.removeItem(keyFor(orgId));
  } catch {
    // Nothing stored.
  }
}

/** The create's Idempotency-Key, stored before the request so a retry reuses it. */
// Fallback when storage is unavailable, so retries in this tab still match.
const memoryKeys = new Map<string, string>();

export function ensureRequestKey(orgId: string, draft: SessionDraft): string {
  const requestKey = readSessionDraft(orgId)?.requestKey ?? memoryKeys.get(orgId) ?? crypto.randomUUID();
  memoryKeys.set(orgId, requestKey);
  writeSessionDraft(orgId, { ...draft, requestKey });
  return requestKey;
}
