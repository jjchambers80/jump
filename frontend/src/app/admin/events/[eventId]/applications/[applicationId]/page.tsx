// Admin › Event › Application detail (spec 011): profile, photos, answers,
// payment state, decision history, notes and the decision actions.
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  decisionsFor,
  DECISION_LABEL,
  formatDate,
  money,
  PAYMENT_LABEL,
  PAYMENT_STYLE,
  STATUS_LABEL,
  STATUS_STYLE,
  type AdminApplication,
  type Decision,
} from '@/lib/applications';
import ApplicationsHeader from '../ApplicationsHeader';
import DecisionDialog from '../DecisionDialog';
import { describeError, useApplicationsApi } from '../useApplicationsApi';

const card = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const btn = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
const primary = 'rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50';
const danger = 'rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-slate-800 dark:text-red-300';
const field = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

function answerText(value: string | string[] | null): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === 'true') return 'Yes';
  if (value === 'false') return 'No';
  return value ?? '—';
}

export default function ApplicationDetailPage({ params }: { params: { eventId: string; applicationId: string } }) {
  const api = useApplicationsApi(params.eventId);
  const [app, setApp] = useState<AdminApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [booth, setBooth] = useState('');
  const [note, setNote] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const decisionBtnRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const a = await api.get(params.applicationId);
      setApp(a);
      setBooth(a.boothLabel ?? '');
      setNote(a.internalNote ?? '');
    } catch (err) {
      setError(describeError(err, 'Could not load the application'));
    }
  }, [api, params.applicationId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveNotes = async () => {
    if (!app || savingNotes) return;
    setSavingNotes(true);
    setNotice(null);
    try {
      const next = await api.updateNotes(app.id, { boothLabel: booth.trim() || null, internalNote: note.trim() || null });
      setApp(next);
      setNotice('Notes saved.');
    } catch (err) {
      setError(describeError(err, 'Could not save notes'));
    } finally {
      setSavingNotes(false);
    }
  };

  const decisions = app ? decisionsFor(app.status) : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ApplicationsHeader eventId={params.eventId} title={app?.profile.businessName ?? 'Application'} subtitle={app ? `${app.form.name}${app.tier ? ` · ${app.tier.name}` : ''}` : undefined} />
      <Link href={`/admin/events/${params.eventId}/applications`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
        ← All applications
      </Link>

      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          {notice}
        </p>
      )}

      {app && (
        <div className="mt-4 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Status + actions */}
            <div className={card} data-testid="application-status-card">
              <div className="flex flex-wrap items-center gap-2">
                <span data-testid="application-status" className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[app.status]}`}>{STATUS_LABEL[app.status]}</span>
                {app.form.kind === 'PAID' && (
                  <span data-testid="application-payment" className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PAYMENT_STYLE[app.paymentStatus]}`}>
                    {PAYMENT_LABEL[app.paymentStatus]}
                    {app.amounts.applicantPays > 0 ? ` · ${money(app.amounts.applicantPays)}` : ''}
                  </span>
                )}
                <span className="text-xs text-gray-500 dark:text-slate-400">
                  Submitted {formatDate(app.submittedAt, true)}
                  {app.decidedAt ? ` · decided ${formatDate(app.decidedAt, true)}` : ''}
                </span>
              </div>
              {decisions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2" data-testid="application-actions">
                  {decisions.map((d, i) => (
                    <button
                      key={d}
                      ref={i === 0 ? decisionBtnRef : undefined}
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setDecision(d);
                      }}
                      className={d === 'APPROVE' ? primary : d === 'REJECT' || d === 'WITHDRAW' ? danger : btn}
                    >
                      {DECISION_LABEL[d]}
                    </button>
                  ))}
                </div>
              )}
              {app.withdrawnBy && (
                <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">
                  Withdrawn by {app.withdrawnBy.toLowerCase()}
                  {app.withdrawReason ? ` — ${app.withdrawReason}` : ''}
                </p>
              )}
            </div>

            {/* Profile */}
            <div className={card} data-testid="application-profile">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">{app.profile.businessName}</h3>
              <p className="mt-1 text-sm text-gray-700 dark:text-slate-300">
                {app.contact.firstName} {app.contact.lastName} ·{' '}
                <a href={`mailto:${app.contact.email}`} className="text-indigo-600 hover:underline dark:text-indigo-300">
                  {app.contact.email}
                </a>
              </p>
              {app.profile.description && <p className="mt-3 whitespace-pre-line text-sm text-gray-800 dark:text-slate-200">{app.profile.description}</p>}
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {app.profile.website && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Website</dt>
                    <dd>
                      <a href={app.profile.website} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-300">
                        {app.profile.website}
                      </a>
                    </dd>
                  </div>
                )}
                {Object.entries(app.profile.socials || {}).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">{k}</dt>
                    <dd className="text-gray-800 dark:text-slate-200">{v}</dd>
                  </div>
                ))}
              </dl>
              {app.profile.photos.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-2" data-testid="application-photos">
                  {app.profile.photos.map((p) => (
                    <li key={p.imageId}>
                      <a href={p.urls?.original} target="_blank" rel="noreferrer">
                        <img src={p.urls?.thumb ?? p.urls?.original} alt="" className="h-24 w-24 rounded-md object-cover" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Answers */}
            {app.answers.length > 0 && (
              <div className={card} data-testid="application-answers">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Answers</h3>
                <dl className="mt-3 space-y-3">
                  {app.answers.map((a) => (
                    <div key={a.questionId}>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        {a.label}
                        {a.archived && ' (archived question)'}
                      </dt>
                      <dd className="text-sm text-gray-800 dark:text-slate-200">
                        {a.image ? (
                          <a href={a.image.urls.original} target="_blank" rel="noreferrer">
                            <img src={a.image.urls.thumb} alt={a.label} className="mt-1 h-24 w-24 rounded-md object-cover" />
                          </a>
                        ) : a.type === 'URL' && a.value ? (
                          <a href={String(a.value)} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-300">
                            {String(a.value)}
                          </a>
                        ) : (
                          <span className="whitespace-pre-line">{answerText(a.value)}</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {/* Payment */}
            {app.form.kind === 'PAID' && (
              <div className={card} data-testid="application-payment-card">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Payment</h3>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-600 dark:text-slate-400">Applicant pays</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">{money(app.amounts.applicantPays)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-600 dark:text-slate-400">You receive</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">{money(app.amounts.orgReceives)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-600 dark:text-slate-400">Fees ({app.amounts.feeMode === 'ABSORB' ? 'absorbed' : 'passed on'})</dt>
                    <dd className="text-gray-700 dark:text-slate-300">{money(app.amounts.platformFee + app.amounts.processingFee)}</dd>
                  </div>
                  {app.amounts.tax > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-gray-600 dark:text-slate-400">Tax</dt>
                      <dd className="text-gray-700 dark:text-slate-300">{money(app.amounts.tax)}</dd>
                    </div>
                  )}
                  {app.payment.paidAt && (
                    <div className="flex justify-between">
                      <dt className="text-gray-600 dark:text-slate-400">Paid</dt>
                      <dd className="text-gray-700 dark:text-slate-300">{formatDate(app.payment.paidAt, true)}</dd>
                    </div>
                  )}
                  {app.payment.paymentDueAt && (
                    <div className="flex justify-between">
                      <dt className="text-gray-600 dark:text-slate-400">Due</dt>
                      <dd className={app.payment.overdue ? 'font-semibold text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-slate-300'}>{formatDate(app.payment.paymentDueAt)}</dd>
                    </div>
                  )}
                </dl>
                {app.payment.stripePaymentIntentId && (
                  <a
                    href={`https://dashboard.stripe.com/payments/${app.payment.stripePaymentIntentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                  >
                    View in Stripe ↗
                  </a>
                )}
              </div>
            )}

            {/* Notes */}
            <div className={card} data-testid="application-notes">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Notes</h3>
              <label htmlFor="booth-label" className="mt-3 block text-sm font-medium text-gray-700 dark:text-slate-300">
                Booth / placement
              </label>
              <input id="booth-label" value={booth} maxLength={60} onChange={(e) => setBooth(e.target.value)} className={field} placeholder="e.g. 104" />
              <label htmlFor="internal-note" className="mt-3 block text-sm font-medium text-gray-700 dark:text-slate-300">
                Internal note
              </label>
              <textarea id="internal-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
              <button type="button" onClick={saveNotes} disabled={savingNotes || (booth === (app.boothLabel ?? '') && note === (app.internalNote ?? ''))} className={`${btn} mt-3`}>
                {savingNotes ? 'Saving…' : 'Save notes'}
              </button>
            </div>

            {/* History */}
            <div className={card} data-testid="application-history">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">History</h3>
              {app.decisions.length === 0 ? (
                <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">No decisions yet.</p>
              ) : (
                <ol className="mt-2 space-y-3 text-sm">
                  {app.decisions.map((d) => (
                    <li key={d.id}>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {d.action.charAt(0) + d.action.slice(1).toLowerCase()} <span className="font-normal text-gray-500 dark:text-slate-400">· {formatDate(d.createdAt, true)}</span>
                      </p>
                      {d.note && <p className="text-gray-700 dark:text-slate-300">{d.note}</p>}
                      {d.emailSubject && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-indigo-600 dark:text-indigo-300">Email sent: {d.emailSubject}</summary>
                          <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700 dark:bg-slate-900/40 dark:text-slate-300">{d.emailBody}</pre>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      {decision && app && (
        <DecisionDialog
          eventId={params.eventId}
          application={app}
          decision={decision}
          returnFocusRef={decisionBtnRef}
          onClose={() => setDecision(null)}
          onDecided={(next) => {
            setApp(next);
            setDecision(null);
            setNotice(`${STATUS_LABEL[next.status]}.`);
          }}
        />
      )}
    </div>
  );
}
