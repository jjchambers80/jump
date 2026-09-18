// Admin › Event › Application detail (spec 011): profile, photos, answers,
// payment state, decision history, notes and the decision actions. Phase 2
// adds the payment timeline, retry charge, refunds and the Stripe link;
// spec 012 the add-on lines and their pre-payment edit; spec 018 tier change,
// adjustments, waive and offline payment.
'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACTION_LABEL,
  decisionsFor,
  DECISION_LABEL,
  formatDate,
  money,
  OFFLINE_METHOD_LABEL,
  PAYMENT_LABEL,
  PAYMENT_STYLE,
  STATUS_LABEL,
  STATUS_STYLE,
  type AdminApplication,
  type Decision,
} from '@/lib/applications';
import ApplicationsHeader from '../ApplicationsHeader';
import DecisionDialog from '../DecisionDialog';
import EditAddOnsDialog from '../EditAddOnsDialog';
import { AdjustmentDialog, ChangeTierDialog, OfflinePaymentDialog, WaiveDialog } from '../CorrectionDialogs';
import RefundDialog from '../RefundDialog';
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

/** Older payloads (and test fixtures) predate spec 012; default the add-on fields. */
function withAddOns(a: AdminApplication): AdminApplication {
  return {
    ...a,
    addOns: a.addOns ?? [],
    addOnsEditable: a.addOnsEditable ?? { allowed: false, reason: null },
    adjustments: a.adjustments ?? [],
    amountEditable: a.amountEditable ?? { allowed: false, reason: null },
    canSettleOffline: a.canSettleOffline ?? false,
    paymentSource: a.paymentSource ?? 'stripe',
    offlinePayment: a.offlinePayment ?? null,
  };
}

const PAYMENT_HINT: Partial<Record<AdminApplication['paymentStatus'], string>> = {
  AWAITING_CARD: 'The applicant has not finished saving a card; they cannot be approved yet.',
  CARD_ON_FILE: 'Approving charges this card off-session.',
  PROCESSING: 'Charge in flight — confirming with Stripe.',
  PAYMENT_DUE: 'The card on file was declined. The applicant has a pay-now link; you can retry the card after they update it, record a payment taken outside Jump, or waive the balance.',
};

export default function ApplicationDetailPage({ params }: { params: { eventId: string; applicationId: string } }) {
  const api = useApplicationsApi(params.eventId);
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const [app, setAppRaw] = useState<AdminApplication | null>(null);
  const setApp = (next: AdminApplication) => setAppRaw(withAddOns(next));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [editingAddOns, setEditingAddOns] = useState(false);
  const [correction, setCorrection] = useState<'tier' | 'adjust' | 'waive' | 'offline' | null>(null);
  const [removingAdjustment, setRemovingAdjustment] = useState<string | null>(null);
  const [charging, setCharging] = useState(false);
  const [booth, setBooth] = useState('');
  const [note, setNote] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const decisionBtnRef = useRef<HTMLButtonElement>(null);
  const refundBtnRef = useRef<HTMLButtonElement>(null);
  const addOnsBtnRef = useRef<HTMLButtonElement>(null);
  const correctionBtnRef = useRef<HTMLButtonElement>(null);

  const removeAdjustment = async (adjustmentId: string) => {
    if (!app || removingAdjustment) return;
    setRemovingAdjustment(adjustmentId);
    setError(null);
    try {
      setApp(await api.removeAdjustment(app.id, adjustmentId));
      setNotice('Adjustment removed.');
    } catch (err) {
      setError(describeError(err, 'Could not remove the adjustment'));
    } finally {
      setRemovingAdjustment(null);
    }
  };

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

  // A charge that came back `processing` settles by webhook; poll until it does.
  useEffect(() => {
    if (app?.paymentStatus !== 'PROCESSING') return;
    const id = setTimeout(load, 3000);
    return () => clearTimeout(id);
  }, [app?.paymentStatus, app?.updatedAt, load]);

  const retryCharge = async () => {
    if (!app || charging) return;
    setCharging(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api.retryCharge(app.id);
      setApp(next);
      setNotice(next.paymentStatus === 'PAID' ? 'Payment collected.' : next.paymentStatus === 'PROCESSING' ? 'Charge submitted; confirming with Stripe.' : 'The card was declined again. The applicant can pay from their status page.');
    } catch (err) {
      setError(describeError(err, 'Could not charge the card'));
    } finally {
      setCharging(false);
    }
  };

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
                {app.pricing?.changed && (
                  <p role="note" data-testid="application-price-changed" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    Price changed since submission. {app.tier?.name ?? 'This tier'}{app.addOns.length > 0 ? ' with these add-ons' : ''} now costs {money(app.pricing.currentApplicantPays)} to the applicant (you receive {money(app.pricing.currentOrgReceives)}); this application keeps the {money(app.amounts.applicantPays)} quoted when it was submitted.
                  </p>
                )}
                <dl className="mt-2 space-y-1 text-sm">
                  {app.tier && (
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-gray-600 dark:text-slate-400">Tier</dt>
                      <dd className="flex items-center gap-2 text-gray-900 dark:text-white">
                        {app.tier.name}
                        {app.amountEditable.allowed ? (
                          <button
                            type="button"
                            ref={correction === 'tier' ? correctionBtnRef : undefined}
                            onClick={() => {
                              setNotice(null);
                              setCorrection('tier');
                            }}
                            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                            data-testid="application-change-tier"
                          >
                            Change
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500 dark:text-slate-400" title={app.amountEditable.reason ?? undefined}>
                            Locked
                          </span>
                        )}
                      </dd>
                    </div>
                  )}
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
                      <dd className="text-gray-700 dark:text-slate-300">
                        {formatDate(app.payment.paidAt, true)}
                        {app.offlinePayment ? ` · ${OFFLINE_METHOD_LABEL[app.offlinePayment.method]}${app.offlinePayment.reference ? ` ${app.offlinePayment.reference}` : ''} (offline)` : ''}
                      </dd>
                    </div>
                  )}
                  {app.paymentSource === 'offline' && app.paymentStatus === 'NOT_REQUIRED' && (
                    <div className="flex justify-between">
                      <dt className="text-gray-600 dark:text-slate-400">Balance</dt>
                      <dd className="text-gray-700 dark:text-slate-300">Waived</dd>
                    </div>
                  )}
                  {app.payment.paymentDueAt && (
                    <div className="flex justify-between">
                      <dt className="text-gray-600 dark:text-slate-400">Due</dt>
                      <dd className={app.payment.overdue ? 'font-semibold text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-slate-300'}>
                        {formatDate(app.payment.paymentDueAt)}
                        {app.payment.overdue ? ' · overdue' : ''}
                      </dd>
                    </div>
                  )}
                  {app.payment.refundedTotal > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-gray-600 dark:text-slate-400">Refunded</dt>
                      <dd className="text-gray-700 dark:text-slate-300">{money(app.payment.refundedTotal)}</dd>
                    </div>
                  )}
                  {app.payment.stripeAccountId && (
                    <div className="flex justify-between">
                      <dt className="text-gray-600 dark:text-slate-400">Routed to</dt>
                      <dd className="text-gray-700 dark:text-slate-300">
                        Connected account{app.payment.applicationFee != null ? ` · ${money(app.payment.applicationFee)} platform fee` : ''}
                      </dd>
                    </div>
                  )}
                </dl>
                {/* Adjustments (spec 018 phase 3) */}
                {(app.adjustments.length > 0 || app.amountEditable.allowed) && (
                  <div className="mt-3 border-t border-gray-200 pt-3 dark:border-slate-700" data-testid="application-adjustments">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Adjustments</h4>
                      {app.amountEditable.allowed && (
                        <button
                          type="button"
                          ref={correction === 'adjust' ? correctionBtnRef : undefined}
                          onClick={() => {
                            setNotice(null);
                            setCorrection('adjust');
                          }}
                          className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                          data-testid="application-add-adjustment"
                        >
                          Add adjustment
                        </button>
                      )}
                    </div>
                    {app.adjustments.length === 0 ? (
                      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">None</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5 text-sm">
                        {app.adjustments.map((adj) => (
                          <li key={adj.id} className="flex items-center justify-between gap-2" data-testid={`application-adjustment-${adj.id}`}>
                            <span className="text-gray-700 dark:text-slate-300">
                              {adj.kind === 'WAIVER' ? 'Waived' : adj.reason}
                              {adj.kind === 'WAIVER' && adj.reason ? <span className="text-gray-500 dark:text-slate-400"> — {adj.reason}</span> : null}
                            </span>
                            <span className="flex items-center gap-2 text-gray-700 dark:text-slate-300">
                              {adj.amount < 0 ? `−${money(-adj.amount)}` : `+${money(adj.amount)}`}
                              {adj.kind === 'ADJUSTMENT' && app.amountEditable.allowed && (
                                <button
                                  type="button"
                                  onClick={() => removeAdjustment(adj.id)}
                                  disabled={removingAdjustment === adj.id}
                                  className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-300"
                                  aria-label={`Remove adjustment ${adj.reason}`}
                                >
                                  remove
                                </button>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {/* Add-on lines (spec 012) */}
                {(app.addOns.length > 0 || app.addOnsEditable.allowed) && (
                  <div className="mt-3 border-t border-gray-200 pt-3 dark:border-slate-700" data-testid="application-add-ons">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Add-ons</h4>
                      {app.addOnsEditable.allowed ? (
                        <button
                          ref={addOnsBtnRef}
                          type="button"
                          onClick={() => {
                            setNotice(null);
                            setEditingAddOns(true);
                          }}
                          className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                          data-testid="application-edit-add-ons"
                        >
                          Edit add-ons
                        </button>
                      ) : (
                        app.addOns.length > 0 && (
                          <span className="text-xs text-gray-500 dark:text-slate-400" title={app.addOnsEditable.reason ?? undefined}>
                            Locked
                          </span>
                        )
                      )}
                    </div>
                    {app.addOns.length === 0 ? (
                      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">None</p>
                    ) : (
                      <table className="mt-1 w-full text-sm">
                        <tbody>
                          <tr>
                            <td className="py-0.5 text-gray-700 dark:text-slate-300">{app.tier?.name ?? app.form.name}</td>
                            <td className="py-0.5 text-right text-gray-700 dark:text-slate-300">{money(app.amounts.applicantPays - app.addOns.reduce((s, l) => s + l.applicantPays, 0))}</td>
                          </tr>
                          {app.addOns.map((l) => (
                            <tr key={l.id} data-testid={`application-add-on-${l.addOnId}`}>
                              <td className="py-0.5 text-gray-700 dark:text-slate-300">
                                {l.name} <span className="text-gray-500 dark:text-slate-400">×{l.quantity} @ {money(l.unitPrice)}</span>
                              </td>
                              <td className="py-0.5 text-right text-gray-700 dark:text-slate-300">{money(l.applicantPays)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {!app.addOnsEditable.allowed && app.addOnsEditable.reason && app.addOns.length > 0 && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{app.addOnsEditable.reason}</p>
                    )}
                  </div>
                )}
                {PAYMENT_HINT[app.paymentStatus] && <p className="mt-3 text-xs text-gray-600 dark:text-slate-400">{PAYMENT_HINT[app.paymentStatus]}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {app.payment.canRetryCharge && (
                    <button type="button" onClick={retryCharge} disabled={charging} className={primary} data-testid="application-retry-charge">
                      {charging ? 'Charging…' : `Retry card (${app.payment.chargeAttempts} so far)`}
                    </button>
                  )}
                  {app.canSettleOffline && isAdmin && (
                    <>
                      <button
                        type="button"
                        ref={correction === 'offline' ? correctionBtnRef : undefined}
                        onClick={() => {
                          setNotice(null);
                          setCorrection('offline');
                        }}
                        className={btn}
                        data-testid="application-offline-payment"
                      >
                        Record offline payment…
                      </button>
                      <button
                        type="button"
                        ref={correction === 'waive' ? correctionBtnRef : undefined}
                        onClick={() => {
                          setNotice(null);
                          setCorrection('waive');
                        }}
                        className={btn}
                        data-testid="application-waive"
                      >
                        Waive balance…
                      </button>
                    </>
                  )}
                  {app.payment.canRefund && isAdmin && (
                    <button
                      ref={refundBtnRef}
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setRefunding(true);
                      }}
                      className={btn}
                      data-testid="application-refund"
                    >
                      Refund…
                    </button>
                  )}
                  {app.payment.stripeDashboardUrl && (
                    <a href={app.payment.stripeDashboardUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                      View in Stripe ↗
                    </a>
                  )}
                </div>
                {app.refunds.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-gray-200 pt-3 text-xs text-gray-600 dark:border-slate-700 dark:text-slate-400" data-testid="application-refunds">
                    {app.refunds.map((r) => (
                      <li key={r.id} className="flex justify-between gap-2">
                        <span>
                          {money(r.amount)} {r.status.toLowerCase()}
                          {r.reason ? ` — ${r.reason}` : ''}
                          {!r.initiatedBy && r.stripeRefundId ? ' (from Stripe)' : ''}
                          {r.manual ? ' (recorded offline)' : ''}
                        </span>
                        <span>{formatDate(r.createdAt, true)}</span>
                      </li>
                    ))}
                  </ul>
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
                        {ACTION_LABEL[d.action] ?? d.action.charAt(0) + d.action.slice(1).toLowerCase()}{' '}
                        <span className="font-normal text-gray-500 dark:text-slate-400">· {formatDate(d.createdAt, true)}</span>
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

      {refunding && app && (
        <RefundDialog
          eventId={params.eventId}
          application={app}
          returnFocusRef={refundBtnRef}
          onClose={() => setRefunding(false)}
          onRefunded={(next) => {
            setApp(next);
            setRefunding(false);
            setNotice(`Refunded. ${PAYMENT_LABEL[next.paymentStatus]}.`);
          }}
        />
      )}

      {editingAddOns && app && (
        <EditAddOnsDialog
          eventId={params.eventId}
          application={app}
          returnFocusRef={addOnsBtnRef}
          onClose={() => setEditingAddOns(false)}
          onSaved={(next) => {
            setApp(next);
            setEditingAddOns(false);
            setNotice(`Add-ons updated. New total ${money(next.amounts.applicantPays)}; the applicant has been emailed.`);
          }}
        />
      )}
      {app && correction === 'tier' && (
        <ChangeTierDialog
          eventId={params.eventId}
          application={app}
          returnFocusRef={correctionBtnRef}
          onClose={() => setCorrection(null)}
          onSaved={(next) => {
            setApp(next);
            setCorrection(null);
            setNotice(`Moved to ${next.tier?.name}. New total ${money(next.amounts.applicantPays)}.`);
          }}
        />
      )}
      {app && correction === 'adjust' && (
        <AdjustmentDialog
          eventId={params.eventId}
          application={app}
          returnFocusRef={correctionBtnRef}
          onClose={() => setCorrection(null)}
          onSaved={(next) => {
            setApp(next);
            setCorrection(null);
            setNotice(`Adjustment added. New total ${money(next.amounts.applicantPays)}.`);
          }}
        />
      )}
      {app && correction === 'waive' && (
        <WaiveDialog
          eventId={params.eventId}
          application={app}
          returnFocusRef={correctionBtnRef}
          onClose={() => setCorrection(null)}
          onSaved={(next) => {
            setApp(next);
            setCorrection(null);
            setNotice('Balance waived. The applicant has been emailed.');
          }}
        />
      )}
      {app && correction === 'offline' && (
        <OfflinePaymentDialog
          eventId={params.eventId}
          application={app}
          returnFocusRef={correctionBtnRef}
          onClose={() => setCorrection(null)}
          onSaved={(next) => {
            setApp(next);
            setCorrection(null);
            setNotice('Payment recorded. The applicant has been emailed.');
          }}
        />
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
            const paid = next.form.kind === 'PAID' && next.status === 'APPROVED';
            setNotice(
              paid && next.paymentStatus === 'PAID'
                ? 'Approved and paid.'
                : paid && next.paymentStatus === 'PAYMENT_DUE'
                  ? 'Approved, but the card was declined — the applicant has been sent a pay-now link.'
                  : paid && next.paymentStatus === 'PROCESSING'
                    ? 'Approved; confirming the payment with Stripe…'
                    : `${STATUS_LABEL[next.status]}.`
            );
          }}
        />
      )}
    </div>
  );
}
