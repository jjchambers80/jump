'use client';

// Read-only sections of the admin Event Details page (spec 037 phase 1). Each
// section shows what is set and links to the one place it is edited; nothing
// here writes. Event times use the venue's zone (spec 033), operational
// numbers come from the one overview request.

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Pencil, Plus, Settings2 } from 'lucide-react';
import ContentHtml from '@/components/storefront/ContentHtml';
import { CapacityMeter, tierAccent } from '@/components/events/EventEditSummary';
import { formatEventDate, formatEventDateTime, formatEventTime } from '@/lib/eventTime';
import { timeZoneLabel } from '@/lib/timeZones';
import {
  formatCount as n,
  formatMoney,
  type ApplicationState,
  type BoothState,
  type EventOverview,
  type OverviewForm,
  type OverviewMap,
  type OverviewTier,
} from '@/lib/eventOverview';

const eyebrow = 'text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-slate-400';
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-800';
const editButton = `inline-flex min-h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-400/60 dark:hover:text-indigo-200 ${focusRing}`;
const quietLink = `inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 hover:underline dark:text-indigo-300 dark:hover:text-indigo-200 ${focusRing}`;

/** One card on the page: a numbered-free eyebrow title and its Edit link. */
export function OverviewSection({
  id,
  title,
  editHref,
  onEdit,
  editLabel,
  aside,
  children,
  delay = 0,
  flush = false,
}: {
  id: string;
  title: string;
  /** Where this section is edited; omitted for sections that are not edited here. */
  editHref?: string;
  /** Opens a flyout editor in place (spec 037 D10); wins over `editHref`. */
  onEdit?: () => void;
  /** Accessible name of the Edit link, e.g. "Edit sales". */
  editLabel?: string;
  /** Extra header content next to Edit (links, badges). */
  aside?: React.ReactNode;
  children: React.ReactNode;
  /** Stagger for the first-paint settle, in ms. */
  delay?: number;
  /** Children run edge to edge (tables). */
  flush?: boolean;
}) {
  const headingId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      style={{ animationDelay: `${delay}ms` }}
      className="scroll-mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm shadow-gray-900/[0.03] motion-safe:animate-card-in dark:border-slate-700/80 dark:bg-slate-800 dark:shadow-none"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-100 px-5 py-3 dark:border-slate-700/70">
        <h2 id={headingId} className="text-sm font-semibold text-gray-900 dark:text-white">
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {aside}
          {onEdit ? (
            <button type="button" onClick={onEdit} aria-label={editLabel ?? `Edit ${title.toLowerCase()}`} aria-haspopup="dialog" className={editButton}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit
            </button>
          ) : editHref ? (
            <Link href={editHref} aria-label={editLabel ?? `Edit ${title.toLowerCase()}`} className={editButton}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit
            </Link>
          ) : null}
        </div>
      </header>
      <div className={flush ? '' : 'px-5 py-4'}>{children}</div>
    </section>
  );
}

/** Definition rows: label left, value right, hairline between. */
function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-gray-100 text-sm dark:divide-slate-700/70">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="shrink-0 text-gray-500 dark:text-slate-400">{label}</dt>
          <dd className="min-w-0 text-right font-medium text-gray-900 dark:text-slate-100">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center dark:border-slate-600">
      <p className="text-sm text-gray-600 dark:text-slate-400">{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// ── Sales (ticketed) ───────────────────────────────────────────────────────

const SALE_STATUS: Record<OverviewTier['saleStatus'], { label: string; className: string }> = {
  ON_SALE: { label: 'On sale', className: 'text-emerald-700 dark:text-emerald-300' },
  NOT_STARTED: { label: 'Not started', className: 'text-sky-700 dark:text-sky-300' },
  ENDED: { label: 'Ended', className: 'text-gray-500 dark:text-slate-400' },
};

function saleWindow(tier: OverviewTier, zone: string | null | undefined): string {
  const fmt = (iso: string) => formatEventDateTime(iso, zone);
  if (tier.saleStartDate && tier.saleEndDate) return `${fmt(tier.saleStartDate)} – ${fmt(tier.saleEndDate)}`;
  if (tier.saleStartDate) return `From ${fmt(tier.saleStartDate)}`;
  if (tier.saleEndDate) return `Until ${fmt(tier.saleEndDate)}`;
  return 'Until the event starts';
}

export function SalesSection({
  overview,
  editHref,
  ordersHref,
  onEditTier,
  delay,
}: {
  overview: EventOverview;
  editHref: string;
  ordersHref: string;
  /** Opens the one-tier flyout; `null` adds a tier. */
  onEditTier?: (tier: OverviewTier | null) => void;
  delay?: number;
}) {
  const { event, money, addOns } = overview;
  const zone = event.venue?.timezone;
  const tiers = event.priceTiers;
  const ticketAddOns = addOns.addOns.filter((a) => a.scope !== 'APPLICATION');

  return (
    <OverviewSection
      id="sales"
      title="Sales"
      editHref={editHref}
      editLabel="Edit tiers and add-ons"
      delay={delay}
      flush
      aside={
        <>
          <Link href={ordersHref} className={quietLink}>
            Orders
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          {onEditTier && (
            <button type="button" onClick={() => onEditTier(null)} aria-haspopup="dialog" className={quietLink}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add tier
            </button>
          )}
        </>
      }
    >
      {tiers.length === 0 ? (
        <div className="p-5">
          <Empty
            action={
              onEditTier ? (
                <button type="button" onClick={() => onEditTier(null)} className={quietLink}>
                  Add a ticket tier
                </button>
              ) : (
                <Link href={editHref} className={quietLink}>Add a ticket tier</Link>
              )
            }
          >
            No ticket tiers yet. Buyers cannot check out until the event has one.
          </Empty>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Ticket tiers for {event.name}</caption>
            <thead>
              <tr className="border-b border-gray-100 text-left dark:border-slate-700/70">
                <th scope="col" className={`${eyebrow} py-2.5 pl-5 pr-3 font-semibold`}>Tier</th>
                <th scope="col" className={`${eyebrow} px-3 py-2.5 text-right font-semibold`}>Price</th>
                <th scope="col" className={`${eyebrow} px-3 py-2.5 font-semibold`}>Sold</th>
                <th scope="col" className={`${eyebrow} px-3 py-2.5 font-semibold`}>Sale window</th>
                <th scope="col" className={`${eyebrow} py-2.5 pl-3 pr-5 font-semibold`}>Rules</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/70">
              {tiers.map((tier, i) => {
                const pct = tier.quantityTotal > 0 ? Math.min(tier.quantitySold / tier.quantityTotal, 1) : 0;
                const status = SALE_STATUS[tier.saleStatus] ?? SALE_STATUS.ON_SALE;
                return (
                  <tr key={tier.id} className="align-top">
                    <td className="py-3 pl-5 pr-3">
                      <div className="flex items-center gap-2">
                        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-sm ${tierAccent(i).dot}`} />
                        {onEditTier ? (
                          <button
                            type="button"
                            onClick={() => onEditTier(tier)}
                            aria-haspopup="dialog"
                            aria-label={`Edit tier ${tier.name}`}
                            className={`rounded text-left font-medium text-gray-900 underline decoration-gray-300 decoration-dotted underline-offset-4 hover:text-indigo-700 hover:decoration-indigo-400 dark:text-white dark:decoration-slate-500 dark:hover:text-indigo-200 ${focusRing}`}
                          >
                            {tier.name}
                          </button>
                        ) : (
                          <span className="font-medium text-gray-900 dark:text-white">{tier.name}</span>
                        )}
                      </div>
                      <p className="mt-0.5 pl-[18px] text-xs">
                        {tier.isActive ? (
                          <span className={status.className}>{status.label}</span>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-300">Inactive</span>
                        )}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-900 dark:text-slate-100">
                      {formatMoney(tier.price)}
                    </td>
                    <td className="px-3 py-3">
                      <p className="tabular-nums text-gray-900 dark:text-slate-100">
                        {n(tier.quantitySold)}
                        <span className="text-gray-400 dark:text-slate-500"> / {n(tier.quantityTotal)}</span>
                      </p>
                      <div aria-hidden className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
                        <div className={`h-full ${tierAccent(i).bar}`} style={{ width: `${pct * 100}%` }} />
                      </div>
                      {tier.quantityReserved > 0 && (
                        <p className="mt-1 text-xs tabular-nums text-gray-500 dark:text-slate-400">
                          {n(tier.quantityReserved)} in checkout
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600 dark:text-slate-300">{saleWindow(tier, zone)}</td>
                    <td className="py-3 pl-3 pr-5 text-xs text-gray-600 dark:text-slate-300">
                      <p>{tier.visibility === 'PUBLIC' ? 'Public' : tier.visibility === 'PRIVATE' ? 'Private link' : 'Hidden'}</p>
                      <p>{tier.isRefundable ? 'Refundable' : 'Non-refundable'}</p>
                      {(tier.minPerOrder || tier.maxPerOrder) && (
                        <p className="tabular-nums">
                          {tier.minPerOrder ?? 1}–{tier.maxPerOrder ?? '∞'} per order
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ticketAddOns.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-4 dark:border-slate-700/70">
          <h3 className={eyebrow}>Add-ons</h3>
          <ul className="mt-2 divide-y divide-gray-100 text-sm dark:divide-slate-700/70">
            {ticketAddOns.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-4 py-1.5">
                <span className="min-w-0 truncate text-gray-900 dark:text-slate-100">
                  {a.name}
                  {!a.isActive && <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">Inactive</span>}
                </span>
                <span className="shrink-0 tabular-nums text-gray-600 dark:text-slate-300">
                  {formatMoney(a.price)} · {n(a.sold)}
                  {a.quantityTotal != null && <span className="text-gray-400 dark:text-slate-500"> / {n(a.quantityTotal)}</span>} sold
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border-t border-gray-100 bg-gray-100 dark:border-slate-700/70 dark:bg-slate-700/70 sm:grid-cols-4">
        {[
          ['Collected', formatMoney(money.gross)],
          ['Refunded', money.refunded > 0 ? `−${formatMoney(money.refunded)}` : formatMoney(0)],
          ['Net', formatMoney(money.net)],
          ['Organization receives', formatMoney(money.orgReceives)],
        ].map(([label, value]) => (
          <div key={label} className="bg-gray-50/70 px-5 py-3 dark:bg-slate-800/60">
            <p className={eyebrow}>{label}</p>
            <p className="mt-0.5 font-semibold tabular-nums text-gray-900 dark:text-white">{value}</p>
          </div>
        ))}
      </div>
    </OverviewSection>
  );
}

// ── RSVP ───────────────────────────────────────────────────────────────────

export function RsvpSection({
  overview,
  editHref,
  rsvpsHref,
  delay,
}: {
  overview: EventOverview;
  editHref: string;
  rsvpsHref: string;
  delay?: number;
}) {
  const { event, rsvp } = overview;
  const headcount = rsvp?.headcount ?? 0;
  const limit = event.rsvpLimit;
  const pct = limit ? Math.min(headcount / limit, 1) : 0;

  return (
    <OverviewSection
      id="rsvps"
      title="RSVPs"
      editHref={editHref}
      editLabel="Edit RSVP settings"
      delay={delay}
      aside={
        <Link href={rsvpsHref} className={quietLink}>
          Guest list
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="text-4xl font-semibold tabular-nums tracking-tight text-gray-900 dark:text-white">
          {n(headcount)}
          <span className="ml-2 text-base font-normal text-gray-500 dark:text-slate-400">
            {limit ? `of ${n(limit)} guests` : 'guests, no limit'}
          </span>
        </p>
        <p className="text-sm tabular-nums text-gray-600 dark:text-slate-300">
          {n(rsvp?.going ?? 0)} RSVP{rsvp?.going === 1 ? '' : 's'} · {n(rsvp?.cancelled ?? 0)} cancelled
        </p>
      </div>
      {limit ? (
        <div
          role="img"
          aria-label={`${n(headcount)} of ${n(limit)} guests`}
          className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700"
        >
          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct * 100}%` }} />
        </div>
      ) : null}
      <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
        Up to {event.rsvpMaxPartySize} {event.rsvpMaxPartySize === 1 ? 'guest' : 'guests'} per RSVP. RSVPs are free and never
        count as revenue.
      </p>
    </OverviewSection>
  );
}

// ── Applications ───────────────────────────────────────────────────────────

const PIPELINE: { state: ApplicationState; label: string; bar: string; dot: string }[] = [
  { state: 'SUBMITTED', label: 'To review', bar: 'bg-sky-500', dot: 'bg-sky-500' },
  { state: 'WAITLISTED', label: 'Waitlisted', bar: 'bg-amber-400', dot: 'bg-amber-400' },
  { state: 'APPROVED', label: 'Approved', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { state: 'REJECTED', label: 'Declined', bar: 'bg-rose-400', dot: 'bg-rose-400' },
  { state: 'WITHDRAWN', label: 'Withdrawn', bar: 'bg-gray-300 dark:bg-slate-500', dot: 'bg-gray-300 dark:bg-slate-500' },
];

const FORM_STATUS: Record<OverviewForm['status'], string> = {
  OPEN: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-400/20',
  DRAFT: 'bg-gray-50 text-gray-700 ring-gray-900/10 dark:bg-slate-900/60 dark:text-slate-300 dark:ring-white/10',
  CLOSED: 'bg-gray-100 text-gray-600 ring-gray-900/10 dark:bg-slate-900/60 dark:text-slate-400 dark:ring-white/10',
};

function FormPipeline({ form }: { form: OverviewForm }) {
  const total = form.total;
  const summary = PIPELINE.map((p) => `${form.counts[p.state]} ${p.label.toLowerCase()}`).join(', ');
  return (
    <div>
      <div
        role="img"
        aria-label={total ? `${total} applications: ${summary}` : 'No applications yet'}
        className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700"
      >
        {total > 0 &&
          PIPELINE.map((p) =>
            form.counts[p.state] ? (
              <span key={p.state} className={`h-full ${p.bar}`} style={{ width: `${(form.counts[p.state] / total) * 100}%` }} />
            ) : null
          )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-hidden>
        {PIPELINE.filter((p) => form.counts[p.state] > 0 || p.state === 'SUBMITTED').map((p) => (
          <li key={p.state} className="flex items-center gap-1.5 text-gray-600 dark:text-slate-300">
            <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
            <span className="tabular-nums font-semibold text-gray-900 dark:text-white">{form.counts[p.state]}</span>
            {p.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ApplicationsSection({
  overview,
  base,
  onFormSettings,
  delay,
}: {
  overview: EventOverview;
  /** /admin/events/:eventId/applications */
  base: string;
  /** Opens the form settings flyout (name, status, window). */
  onFormSettings?: (form: OverviewForm) => void;
  delay?: number;
}) {
  const { forms } = overview.applications;
  const zone = overview.event.venue?.timezone;
  const toReview = forms.reduce((s, f) => s + f.counts.SUBMITTED, 0);

  return (
    <OverviewSection
      id="applications"
      title="Applications"
      delay={delay}
      aside={
        forms.length > 0 ? (
          <Link href={base} className={quietLink}>
            {toReview > 0 ? `Review ${n(toReview)}` : 'Open queue'}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : undefined
      }
    >
      {forms.length === 0 ? (
        <Empty
          action={
            <Link href={`${base}/forms`} className={quietLink}>
              Set up an application form
            </Link>
          }
        >
          Vendors, sponsors and press apply through a form. This event has none yet.
        </Empty>
      ) : (
        <ul className="space-y-5">
          {forms.map((form) => (
            <li key={form.id} className="rounded-lg border border-gray-100 p-4 dark:border-slate-700/70">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{form.name}</h3>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ring-1 ring-inset ${FORM_STATUS[form.status]}`}>
                      {form.status.charAt(0) + form.status.slice(1).toLowerCase()}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-slate-400">{form.kind === 'PAID' ? 'Paid' : 'Free'}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                    {form.opensAt || form.closesAt
                      ? [
                          form.opensAt && `Opens ${formatEventDate(form.opensAt, zone)}`,
                          form.closesAt && `closes ${formatEventDate(form.closesAt, zone)}`,
                        ]
                          .filter(Boolean)
                          .join(', ')
                      : 'No open or close date'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {onFormSettings && (
                    <button
                      type="button"
                      onClick={() => onFormSettings(form)}
                      aria-haspopup="dialog"
                      aria-label={`Settings for ${form.name}`}
                      className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white ${focusRing}`}
                    >
                      <Settings2 className="h-3.5 w-3.5" aria-hidden />
                      Settings
                    </button>
                  )}
                  <Link
                    href={`${base}/forms/${form.id}`}
                    aria-label={`Edit form ${form.name}`}
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white ${focusRing}`}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    Edit form
                  </Link>
                </div>
              </div>

              <div className="mt-3">
                <FormPipeline form={form} />
              </div>

              {form.kind === 'PAID' && form.counts.APPROVED > 0 && (
                <p className="mt-2 text-xs tabular-nums text-gray-600 dark:text-slate-300">
                  Of {n(form.counts.APPROVED)} approved: {n(form.approvedSettled)} settled
                  {form.approvedAwaitingPayment > 0 && (
                    <span className="text-amber-700 dark:text-amber-300"> · {n(form.approvedAwaitingPayment)} awaiting payment</span>
                  )}
                </p>
              )}

              {form.tiers.length > 0 && (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {form.tiers.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-baseline justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 text-sm dark:bg-slate-900/40"
                    >
                      <span className="min-w-0 truncate text-gray-900 dark:text-slate-100">
                        {t.name}
                        {!t.isActive && <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-300">Inactive</span>}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-gray-600 dark:text-slate-300">
                        {t.price > 0 ? formatMoney(t.price) : 'Free'} · {n(t.quantityApproved)}/{n(t.quantityTotal)}
                        {t.booths > 0 && ` · ${n(t.booths)} on map`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </OverviewSection>
  );
}

// ── Description ────────────────────────────────────────────────────────────

export function DescriptionSection({
  overview,
  editHref,
  delay,
}: {
  overview: EventOverview;
  editHref: string;
  delay?: number;
}) {
  const { event } = overview;
  const [expanded, setExpanded] = useState(false);
  const html = event.description?.trim() ?? '';
  // Long descriptions fold; the fold is a height clamp, so markup stays intact.
  const long = html.replace(/<[^>]+>/g, '').length > 600;

  return (
    <OverviewSection id="details" title="Event details" editHref={editHref} editLabel="Edit event details" delay={delay}>
      {html ? (
        <div>
          <div className={`relative ${long && !expanded ? 'max-h-60 overflow-hidden' : ''}`}>
            <ContentHtml html={html} className="text-sm" />
            {long && !expanded && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent dark:from-slate-800"
              />
            )}
          </div>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className={`${quietLink} mt-2`}
            >
              {expanded ? 'Show less' : 'Show the full description'}
            </button>
          )}
        </div>
      ) : (
        <Empty action={<Link href={editHref} className={quietLink}>Write a description</Link>}>
          No description. Buyers see only the name, date and venue.
        </Empty>
      )}
    </OverviewSection>
  );
}

// ── Aside cards ────────────────────────────────────────────────────────────

export function WhenWhereCard({
  overview,
  editHref,
  delay,
}: {
  overview: EventOverview;
  editHref: string;
  delay?: number;
}) {
  const { event } = overview;
  const zone = event.venue?.timezone;
  const date = formatEventDate(event.date, zone, { weekday: 'long' });
  return (
    <OverviewSection id="when-where" title="Date & venue" editHref={editHref} editLabel="Edit date and venue" delay={delay}>
      <p className="text-base font-semibold text-gray-900 dark:text-white">{date}</p>
      <p className="text-sm tabular-nums text-gray-600 dark:text-slate-300">{formatEventTime(event.date, zone)}</p>
      <div className="mt-4 border-t border-dashed border-gray-200 pt-4 dark:border-slate-700">
        {event.venue ? (
          <>
            <p className="font-medium text-gray-900 dark:text-white">{event.venue.name}</p>
            <p className="text-sm text-gray-600 dark:text-slate-300">{event.venue.address}</p>
            {zone && (
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Times shown in {timeZoneLabel(zone)}, the venue&apos;s clock
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-600 dark:text-slate-400">No venue</p>
        )}
      </div>
    </OverviewSection>
  );
}

export function AdmissionCard({
  overview,
  editHref,
  onEdit,
  delay,
}: {
  overview: EventOverview;
  editHref: string;
  onEdit?: () => void;
  delay?: number;
}) {
  const { event, tickets } = overview;
  const ticketed = event.admissionMode === 'TICKETED';
  return (
    <OverviewSection id="admission" title="Admission" editHref={editHref} onEdit={onEdit} editLabel="Edit admission" delay={delay}>
      {ticketed ? (
        <>
          <CapacityMeter
            capacity={event.capacity}
            tiers={event.priceTiers.map((t) => ({ key: t.id, name: t.name, quantityTotal: t.quantityTotal, quantitySold: t.quantitySold }))}
          />
          {tickets && (
            <div className="mt-4 border-t border-gray-100 pt-3 dark:border-slate-700/70">
              <Facts
                rows={[
                  ['Tickets issued', <span key="i" className="tabular-nums">{n(tickets.issued)}</span>],
                  [
                    'Checked in',
                    <span key="c" className="tabular-nums">
                      {n(tickets.checkedIn)}
                      {tickets.issued > 0 && (
                        <span className="font-normal text-gray-500 dark:text-slate-400">
                          {' '}
                          ({Math.round((tickets.checkedIn / tickets.issued) * 100)}%)
                        </span>
                      )}
                    </span>,
                  ],
                ]}
              />
            </div>
          )}
        </>
      ) : (
        <Facts
          rows={[
            ['Mode', 'RSVP, free'],
            ['Guest limit', event.rsvpLimit ? n(event.rsvpLimit) : 'No limit'],
            ['Party size', `Up to ${event.rsvpMaxPartySize}`],
          ]}
        />
      )}
    </OverviewSection>
  );
}

const BOOTH_STYLE: Record<BoothState, { label: string; cell: string }> = {
  SOLD: { label: 'Sold', cell: 'bg-indigo-500 dark:bg-indigo-400' },
  RESERVED: { label: 'Reserved', cell: 'bg-violet-400 dark:bg-violet-400/80' },
  HELD: { label: 'On hold', cell: 'bg-amber-400' },
  AVAILABLE: { label: 'Available', cell: 'bg-white ring-1 ring-inset ring-emerald-500/70 dark:bg-slate-800 dark:ring-emerald-400/60' },
  BLOCKED: {
    label: 'Blocked',
    cell: 'bg-gray-200 [background-image:repeating-linear-gradient(135deg,rgb(100_116_139/0.45)_0_1px,transparent_1px_3px)] dark:bg-slate-700',
  },
};
const BOOTH_ORDER: BoothState[] = ['SOLD', 'RESERVED', 'HELD', 'AVAILABLE', 'BLOCKED'];
const MAX_CELLS = 120;

/** Every booth as one cell, grouped by state — the floor at a glance. */
function BoothMatrix({ map }: { map: OverviewMap }) {
  const per = Math.max(1, Math.ceil(map.boothTotal / MAX_CELLS));
  const cells = BOOTH_ORDER.flatMap((state) =>
    Array.from({ length: Math.ceil(map.booths[state] / per) }, (_, i) => ({ state, key: `${state}-${i}` }))
  );
  const summary = BOOTH_ORDER.filter((s) => map.booths[s] > 0)
    .map((s) => `${map.booths[s]} ${BOOTH_STYLE[s].label.toLowerCase()}`)
    .join(', ');
  return (
    <div>
      <div role="img" aria-label={`${map.boothTotal} booths: ${summary}`} className="flex flex-wrap gap-1">
        {cells.map((c) => (
          <span key={c.key} className={`h-3 w-3 rounded-[3px] ${BOOTH_STYLE[c.state].cell}`} />
        ))}
      </div>
      {per > 1 && <p className="mt-1 text-[0.7rem] text-gray-500 dark:text-slate-400">Each square is {per} booths</p>}
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs" aria-hidden>
        {BOOTH_ORDER.filter((s) => map.booths[s] > 0 || s === 'AVAILABLE' || s === 'SOLD').map((s) => (
          <li key={s} className="flex items-center gap-1.5 text-gray-600 dark:text-slate-300">
            <span className={`h-2.5 w-2.5 rounded-[3px] ${BOOTH_STYLE[s].cell}`} />
            {BOOTH_STYLE[s].label}
            <span className="ml-auto tabular-nums font-semibold text-gray-900 dark:text-white">{map.booths[s]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MapCard({ overview, delay }: { overview: EventOverview; delay?: number }) {
  const { map } = overview;
  return (
    <OverviewSection
      id="map"
      title="Floor map"
      delay={delay}
      editHref={map ? `/admin/maps/${map.id}` : undefined}
      editLabel="Open the map builder"
    >
      {!map ? (
        <Empty action={<Link href={`/admin/events/${overview.event.id}/map`} className={quietLink}>Create a floor map</Link>}>
          No floor map. A map lets approved vendors pick their own booth.
        </Empty>
      ) : (
        <>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate font-medium text-gray-900 dark:text-white">{map.name}</p>
            <span
              className={`shrink-0 text-xs font-semibold ${
                map.status === 'PUBLISHED' ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-slate-400'
              }`}
            >
              {map.status === 'PUBLISHED' ? 'Published' : 'Draft'}
            </span>
          </div>
          {map.boothTotal > 0 ? (
            <BoothMatrix map={map} />
          ) : (
            <p className="text-sm text-gray-600 dark:text-slate-400">No booths drawn yet.</p>
          )}
          {map.unassignedBooths > 0 && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {n(map.unassignedBooths)} booth{map.unassignedBooths === 1 ? ' has' : 's have'} no vendor space tier, so no one can
              buy {map.unassignedBooths === 1 ? 'it' : 'them'}.
            </p>
          )}
        </>
      )}
    </OverviewSection>
  );
}

export function ListingCard({
  overview,
  editHref,
  onEdit,
  publicHref,
  delay,
}: {
  overview: EventOverview;
  editHref: string;
  onEdit?: () => void;
  publicHref: string;
  delay?: number;
}) {
  const { event } = overview;
  return (
    <OverviewSection id="listing" title="Listing" editHref={editHref} onEdit={onEdit} editLabel="Edit listing" delay={delay}>
      <Facts
        rows={[
          ['Category', event.category || <span className="font-normal text-gray-400 dark:text-slate-500">None</span>],
          [
            'Page',
            <a
              key="p"
              href={publicHref}
              target="_blank"
              rel="noreferrer"
              className={`${quietLink} max-w-[14rem] truncate font-mono text-xs`}
            >
              {publicHref}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>,
          ],
          [
            'Visible to buyers',
            event.status === 'PUBLISHED' ? 'Yes' : event.status === 'CANCELLED' ? 'No, cancelled' : 'No, draft',
          ],
        ]}
      />
    </OverviewSection>
  );
}

export function PaymentsCard({ overview, delay }: { overview: EventOverview; delay?: number }) {
  const { event } = overview;
  const tax = event.tax;
  const rate = `${(tax.rate * 100).toFixed(3).replace(/\.?0+$/, '')}%`;
  const source = tax.source === 'STRIPE' ? 'Stripe Tax' : tax.source === 'MANUAL' ? 'Manual rate' : 'Not collecting';
  return (
    <OverviewSection id="payments" title="Tax & payments" delay={delay}>
      <Facts
        rows={[
          ['Sales tax', <span key="t" className="tabular-nums">{rate}</span>],
          ['Rate from', `${source}${tax.region ? ` · ${tax.region}` : ''}`],
          ['Prices', event.taxInclusivePricing ? 'Include tax' : 'Tax added at checkout'],
        ]}
      />
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Link href="/admin/settings/tax" className={quietLink}>
          Settings › Tax
        </Link>
        <Link href="/admin/settings/payments" className={quietLink}>
          Settings › Payments
        </Link>
      </p>
    </OverviewSection>
  );
}
