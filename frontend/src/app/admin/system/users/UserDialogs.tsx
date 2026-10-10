'use client';

// Dialogs for System administration › Users. Both run their request through
// withReauth (the backend needs a step-up proof) and keep server errors inside
// the dialog (role="alert") so the person can read them and decide.

import { FormEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { errorMessage } from '@/app/admin/settings/users/shared';
import { isReauthCancelled, useReauth } from '@/app/admin/account/useReauth';
import { systemAdminApi, type SystemUser } from '@/services/api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const userLabel = (u: Pick<SystemUser, 'name' | 'email'>) => u.name || u.email;

/** Run fn behind withReauth; resolves to an error message, or null on success / cancel → undefined. */
function useGuarded() {
  const { withReauth } = useReauth();
  return async (fn: () => Promise<unknown>, explain: (err: any) => string): Promise<string | null | undefined> => {
    try {
      await withReauth(fn);
      return null;
    } catch (err) {
      if (isReauthCancelled(err)) return undefined;
      return explain(err);
    }
  };
}

export function InviteDialog({
  returnFocusRef,
  onClose,
  onDone,
}: {
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const guarded = useGuarded();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = EMAIL_RE.test(email.trim());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) {
      setError('Enter a valid email address.');
      return;
    }
    setSaving(true);
    setError(null);
    let result: { promoted: boolean; emailSent: boolean } | undefined;
    const failure = await guarded(
      async () => {
        result = await systemAdminApi.inviteAdmin({ email: email.trim(), ...(name.trim() ? { name: name.trim() } : {}) });
      },
      (err) =>
        err?.status === 429
          ? 'Too many invitations in a short time. Wait a few minutes and try again.'
          : errorMessage(err, 'Could not send the invitation.')
    );
    setSaving(false);
    if (failure === undefined) return;
    if (failure) {
      setError(failure);
      return;
    }
    const who = email.trim();
    const granted = result?.promoted
      ? `${who} is now a system admin and no longer belongs to any organization.`
      : `${who} was invited as a system admin.`;
    const mail = result?.emailSent
      ? ' We emailed them a sign-in link.'
      : ' The invitation email could not be sent: ask them to sign in at this site with that address.';
    onDone(granted + mail);
  };

  return (
    <SettingsDialog
      titleId="invite-system-admin-title"
      title="Invite system admin"
      dirty={!!email || !!name}
      saving={saving}
      saveDisabled={!email.trim()}
      submitLabel="Send invite"
      savingLabel="Sending…"
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="space-y-5">
        <p className="text-sm text-gray-700 dark:text-slate-300">
          A system admin has full access to every organization on the platform. Someone who already has an account is
          promoted and leaves their organizations.
        </p>
        {error && (
          <div role="alert" className={formAlertClass}>
            {error}
          </div>
        )}
        <div>
          <label htmlFor="invite-email" className={labelClass}>
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            required
            aria-required="true"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="invite-name" className={labelClass}>
            Name <span className="font-normal text-gray-500 dark:text-slate-400">(optional)</span>
          </label>
          <input
            id="invite-name"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClass}
            aria-describedby="invite-name-hint"
          />
          <p id="invite-name-hint" className={hintClass}>
            Used only for a new account.
          </p>
        </div>
      </div>
    </SettingsDialog>
  );
}

export type UserAction = 'promote' | 'demote' | 'deactivate' | 'reactivate';

const ACTIONS: Record<
  UserAction,
  { title: string; submit: string; body: { role?: 'SYSTEM_ADMIN' | 'UNASSIGNED'; isActive?: boolean }; done: string }
> = {
  promote: { title: 'Make system admin', submit: 'Make system admin', body: { role: 'SYSTEM_ADMIN' }, done: 'is now a system admin.' },
  demote: { title: 'Remove system admin', submit: 'Remove system admin', body: { role: 'UNASSIGNED' }, done: 'is no longer a system admin.' },
  deactivate: { title: 'Deactivate user', submit: 'Deactivate', body: { isActive: false }, done: 'was deactivated.' },
  reactivate: { title: 'Reactivate user', submit: 'Reactivate', body: { isActive: true }, done: 'was reactivated.' },
};

function Explanation({ action, user }: { action: UserAction; user: SystemUser }) {
  const who = <strong>{userLabel(user)}</strong>;
  if (action === 'promote') {
    return (
      <>
        <p>
          {who} will get full access to every organization on the platform.
        </p>
        {user.organizations.length > 0 ? (
          <>
            <p className="mt-3">They will be removed from these organizations:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5" aria-label="Memberships that will be removed">
              {user.organizations.map((o) => (
                <li key={o.id}>
                  {o.name} <span className="text-gray-500 dark:text-slate-400">({o.role.toLowerCase()})</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3">They are not a member of any organization.</p>
        )}
      </>
    );
  }
  if (action === 'demote') {
    return (
      <p>
        {who} loses access to system administration and every organization. Their sessions end immediately. To give them
        back a store, add them in that organization&apos;s Settings › Users.
      </p>
    );
  }
  if (action === 'deactivate') {
    return <p>{who} can no longer sign in, and every session they have open ends immediately.</p>;
  }
  return <p>{who} can sign in again with their existing access.</p>;
}

export function UserActionDialog({
  action,
  user,
  returnFocusRef,
  onClose,
  onDone,
}: {
  action: UserAction;
  user: SystemUser;
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const guarded = useGuarded();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spec = ACTIONS[action];
  const bodyRef = useRef<HTMLDivElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const failure = await guarded(
      () => systemAdminApi.updateUser(user.id, spec.body),
      (err) => errorMessage(err, 'Could not update this user.')
    );
    setSaving(false);
    if (failure === undefined) return;
    if (failure) setError(failure);
    else onDone(`${userLabel(user)} ${spec.done}`);
  };

  return (
    <SettingsDialog
      titleId="system-user-action-title"
      title={spec.title}
      dirty={false}
      submitWhenClean
      saving={saving}
      submitLabel={spec.submit}
      savingLabel="Saving…"
      initialFocusRef={bodyRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <div ref={bodyRef} tabIndex={-1} className="space-y-4 text-sm focus:outline-none text-gray-700 dark:text-slate-300">
        {error && (
          <div role="alert" className={formAlertClass}>
            {error}
          </div>
        )}
        <div>
          <Explanation action={action} user={user} />
        </div>
      </div>
    </SettingsDialog>
  );
}
