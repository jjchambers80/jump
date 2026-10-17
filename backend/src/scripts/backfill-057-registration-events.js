/**
 * Spec 057: move every application form that sits on a live event onto a
 * registration event of its own, linked to that live event.
 *
 * Per form, in one transaction:
 *   - a REGISTRATION event: the form's name, the live event's venue, date,
 *     end, image, tax rate and category; PUBLISHED when the live event is
 *     published and the form is not a draft, CANCELLED with a cancelled
 *     live event, else DRAFT; linked to the live event
 *   - the form, its applications and their APPLICATION orders move to it
 *   - add-ons the form's tiers offer: an application-only add-on that only
 *     this form offers moves with it; a ticket-and-application (BOTH) add-on
 *     stays on the live event for tickets and is copied, application-only,
 *     onto the registration event, and this form's tiers are re-pointed
 *
 * Never touched: the floor map (it stays on the live event; registrations
 * sell it through services/mapEvents.js), the special guest lineup, ticket
 * orders, forms on deleted events (reported), and forms already on a
 * registration event. Idempotent: a second run finds nothing to move.
 *
 * Usage (dry run unless DRY_RUN=false):
 *   cd backend && npm run db:backfill:057-registration-events
 *   cd backend && DRY_RUN=false npm run db:backfill:057-registration-events
 */

import 'dotenv/config';
import { prisma } from '@jump/db';
import auditLogService from '../audit/AuditLogService.js';
import { resolveUniqueSlug } from '../utils/slug.js';

const FORM_SELECT = {
  id: true,
  name: true,
  status: true,
  kind: true,
  eventId: true,
  tiers: { select: { id: true, addOns: { select: { addOnId: true } } } },
  _count: { select: { applications: true } },
  event: {
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      deletedAt: true,
      venueId: true,
      date: true,
      endDate: true,
      logoUrl: true,
      imageId: true,
      category: true,
      taxRate: true,
      taxRateSource: true,
      salesClosedAt: true,
      addOns: { select: { id: true, productId: true, scope: true, allTiers: true, name: true } },
      applicationForms: { select: { id: true, kind: true, tiers: { select: { addOns: { select: { addOnId: true } } } } } },
    },
  },
};

/** The status a form's registration event starts in. */
export function registrationStatus(live, form) {
  if (live.status === 'CANCELLED') return 'CANCELLED';
  return live.status === 'PUBLISHED' && form.status !== 'DRAFT' ? 'PUBLISHED' : 'DRAFT';
}

/**
 * Pure: which of the live event's add-ons this form takes along. An add-on is
 * offered to a form's tiers when attached to one of them, or (allTiers) to every
 * PAID form's tiers. MOVE = application-only and no other form offers it; COPY =
 * offered to tickets too; REPORT = application-only but shared between forms.
 */
export function planAddOns(form, live) {
  const offers = (f, addOn) =>
    f.tiers.some((t) => t.addOns.some((a) => a.addOnId === addOn.id)) || (addOn.allTiers && f.kind === 'PAID' && f.tiers.length > 0);
  return live.addOns
    .filter((addOn) => addOn.scope !== 'TICKET' && offers(form, addOn))
    .map((addOn) => {
      if (addOn.scope === 'BOTH') return { addOn, action: 'COPY' };
      const others = live.applicationForms.filter((f) => f.id !== form.id && offers(f, addOn));
      return { addOn, action: others.length ? 'REPORT' : 'MOVE' };
    });
}

async function moveForm(form, addOnPlan) {
  const live = form.event;
  return prisma.$transaction(async (tx) => {
    const slug = await resolveUniqueSlug(tx.event, { title: form.name });
    const registration = await tx.event.create({
      data: {
        type: 'REGISTRATION',
        linkedEventId: live.id,
        name: form.name,
        ...slug,
        venueId: live.venueId,
        date: live.date,
        endDate: live.endDate,
        logoUrl: live.logoUrl,
        imageId: live.imageId,
        category: live.category,
        taxRate: live.taxRate,
        taxRateSource: live.taxRateSource,
        salesClosedAt: live.salesClosedAt,
        capacity: null,
        status: registrationStatus(live, form),
      },
      select: { id: true, slug: true, status: true },
    });
    await tx.applicationForm.update({ where: { id: form.id }, data: { eventId: registration.id } });
    const applications = await tx.application.findMany({ where: { formId: form.id }, select: { id: true } });
    const ids = applications.map((a) => a.id);
    await tx.application.updateMany({ where: { formId: form.id }, data: { eventId: registration.id } });
    const orders = ids.length
      ? await tx.order.updateMany({ where: { kind: 'APPLICATION', applicationId: { in: ids } }, data: { eventId: registration.id } })
      : { count: 0 };

    const tierIds = form.tiers.map((t) => t.id);
    for (const { addOn, action } of addOnPlan) {
      if (action === 'MOVE') {
        await tx.addOn.update({ where: { id: addOn.id }, data: { eventId: registration.id } });
      } else if (action === 'COPY') {
        const source = await tx.addOn.findUnique({ where: { id: addOn.id } });
        const copy = await tx.addOn.create({
          data: {
            eventId: registration.id,
            productId: source.productId,
            name: source.name,
            description: source.description,
            price: source.price,
            scope: 'APPLICATION',
            allTiers: source.allTiers,
            quantityTotal: source.quantityTotal,
            maxPerOrder: source.maxPerOrder,
            taxable: source.taxable,
            isActive: source.isActive,
            displayOrder: source.displayOrder,
          },
          select: { id: true },
        });
        if (tierIds.length) {
          const attached = await tx.applicationTierAddOn.findMany({ where: { addOnId: addOn.id, applicationTierId: { in: tierIds } } });
          await tx.applicationTierAddOn.deleteMany({ where: { addOnId: addOn.id, applicationTierId: { in: tierIds } } });
          if (attached.length) {
            await tx.applicationTierAddOn.createMany({ data: attached.map((a) => ({ applicationTierId: a.applicationTierId, addOnId: copy.id })) });
          }
        }
      }
    }
    return { registration, applications: ids.length, orders: orders.count };
  });
}

/** `organizationId` limits the run to one organization (tests share a database). */
export async function run({ dryRun = process.env.DRY_RUN !== 'false', log = console.log, organizationId } = {}) {
  const forms = await prisma.applicationForm.findMany({
    where: { eventId: { not: null }, event: { type: 'LIVE' }, ...(organizationId && { organizationId }) },
    select: FORM_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  log(`[057-registration-events] ${dryRun ? 'DRY RUN — nothing is written' : 'Writing'}; ${forms.length} form(s) on live events`);
  const result = { checked: forms.length, moved: 0, skipped: 0, reported: 0 };
  for (const form of forms) {
    const live = form.event;
    const who = `${live.name} · ${form.name} (${form.status}, ${form._count.applications} application(s))`;
    if (live.deletedAt) {
      log(`  SKIP    ${form.id}  ${who}\n          the live event is deleted`);
      result.skipped += 1;
      continue;
    }
    const plan = planAddOns(form, live);
    const shared = plan.filter((p) => p.action === 'REPORT');
    if (shared.length) {
      log(`  REPORT  ${form.id}  ${who}\n          application add-on(s) shared with another form: ${shared.map((p) => p.addOn.name).join(', ')}`);
      result.reported += 1;
      continue;
    }
    const addOns = plan.map((p) => `${p.action === 'MOVE' ? 'move' : 'copy'} ${p.addOn.name}`).join(', ');
    log(`  MOVE    ${form.id}  ${who}\n          → registration event "${form.name}" (${registrationStatus(live, form)})${addOns ? `; add-ons: ${addOns}` : ''}`);
    if (dryRun) continue;
    const done = await auditLogService.runAsSystem('backfill:057', 'Registration events backfill', () => moveForm(form, plan));
    log(`          created ${done.registration.id} /events/${done.registration.slug}; moved ${done.applications} application(s), ${done.orders} order(s)`);
    result.moved += 1;
  }
  log('');
  log(`[057-registration-events] ${dryRun ? 'Would move' : 'Moved'} ${dryRun ? forms.length - result.skipped - result.reported : result.moved}; skipped ${result.skipped}; needs a look ${result.reported}`);
  if (dryRun && forms.length - result.skipped - result.reported > 0) log('  → Run with DRY_RUN=false to write.');
  return result;
}

// Run when invoked directly (not imported), like the other backfill scripts.
import { fileURLToPath } from 'url';
import path from 'path';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error('[057-registration-events] Fatal:', err.message);
      await prisma.$disconnect();
      process.exit(1);
    });
}
