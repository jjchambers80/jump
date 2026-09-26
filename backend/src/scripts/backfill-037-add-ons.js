/**
 * Spec 037 phase 4: dedupe per-event add-ons into saved add-ons.
 *
 * Event duplication copied every AddOn onto the new event, so an organization
 * that ran the same show five times has five "Booth power" rows. This links
 * every AddOn without a `productId` to one `AddOnProduct` per
 * (organization, lower(trim(name)), scope, taxable) — plan §4.2 steps 1–7:
 *
 *   1. Group unlinked AddOns by organization + lower(trim(name)) + scope + taxable.
 *   2. One saved add-on per group: name = most recent spelling, description =
 *      most recent non-empty, defaultPrice = most common price (ties → most recent).
 *      A saved add-on that already has the name (case-insensitive) and the same
 *      scope / taxable is reused instead.
 *   3. Point every AddOn of the group at it. Prices stay on the offerings (D9),
 *      and the offerings' own name / description are left as they are, so no
 *      storefront changes; the next edit through the saved add-on syncs them.
 *   4. Same name, different scope / taxable → separate saved add-ons; all but
 *      the primary group (the existing saved add-on, else the largest group,
 *      ties → most recent) get a suffix such as "(applications, not taxable)".
 *      Listed under "conflicts" for a manual merge.
 *   5. Two offerings of one saved add-on on the same event are reported, never
 *      merged: each has its own sales and inventory. The
 *      @@unique([eventId, productId]) constraint waits for a clean report.
 *   6. OrderAddOn.name was backfilled by migration 20261010100000_saved_add_ons;
 *      the report counts lines whose snapshot differs from the live name.
 *   7. Prints the report.
 *
 * Idempotent: only AddOns with `productId IS NULL` are grouped, so a second
 * run creates nothing and links nothing (duplicates are still reported).
 *
 * Usage:
 *   cd backend && npm run db:backfill:037-add-ons                  # dry run (default)
 *   cd backend && DRY_RUN=false npm run db:backfill:037-add-ons    # write changes
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { prisma } from '@jump/db';

const SCOPE_LABEL = { TICKET: 'tickets', APPLICATION: 'applications', BOTH: 'tickets & applications' };

const key = (name) => String(name ?? '').trim().toLowerCase();
const cents = (price) => Math.round(Number(price) * 100);
const time = (d) => new Date(d).getTime();

/** "Booth power (applications, not taxable)" */
export function suffixedName(name, scope, taxable) {
  return `${name} (${SCOPE_LABEL[scope] ?? scope}${taxable ? '' : ', not taxable'})`;
}

/** Most common price in cents; ties go to the most recent offering's price. */
function mostCommonPrice(offerings) {
  const counts = new Map();
  for (const o of offerings) counts.set(cents(o.price), (counts.get(cents(o.price)) ?? 0) + 1);
  const best = Math.max(...counts.values());
  const tied = new Set([...counts].filter(([, n]) => n === best).map(([c]) => c));
  const byRecent = [...offerings].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  return byRecent.find((o) => tied.has(cents(o.price))).price;
}

/**
 * Pure planning step — testable without a database.
 * @param {Array<{ id, eventId, organizationId, name, description, price, scope, taxable, createdAt }>} offerings unlinked AddOns
 * @param {Array<{ id, organizationId, name, scope, taxable }>} existingProducts saved add-ons already in the database
 * @param {Array<{ id, eventId, productId }>} linkedOfferings AddOns already linked (for the same-event duplicate report)
 * @returns {{ products: Array, conflicts: Array, sameEventDuplicates: Array }}
 */
export function planAddOnDedupe(offerings, existingProducts = [], linkedOfferings = []) {
  const products = [];
  const conflicts = [];

  const orgs = new Map();
  for (const o of offerings) {
    if (!orgs.has(o.organizationId)) orgs.set(o.organizationId, []);
    orgs.get(o.organizationId).push(o);
  }

  for (const [organizationId, orgOfferings] of orgs) {
    const existing = existingProducts.filter((p) => p.organizationId === organizationId);
    const usedNames = new Set(existing.map((p) => key(p.name)));

    // name key → group key → offerings
    const byName = new Map();
    for (const o of orgOfferings) {
      const nk = key(o.name);
      if (!byName.has(nk)) byName.set(nk, new Map());
      const gk = `${o.scope}|${o.taxable}`;
      const groups = byName.get(nk);
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(o);
    }

    for (const [nk, groups] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
      const match = existing.find((p) => key(p.name) === nk);
      const entries = [...groups.values()].map((list) => {
        const recent = [...list].sort((a, b) => time(b.createdAt) - time(a.createdAt));
        return {
          offerings: list,
          scope: list[0].scope,
          taxable: list[0].taxable,
          name: recent[0].name.trim(),
          description: recent.find((o) => o.description && o.description.trim())?.description.trim() ?? null,
          defaultPrice: Number(mostCommonPrice(list)),
          latest: time(recent[0].createdAt),
        };
      });

      let primary = null;
      if (match) {
        primary = entries.find((e) => e.scope === match.scope && e.taxable === match.taxable) ?? null;
      } else {
        primary = [...entries].sort((a, b) => b.offerings.length - a.offerings.length || b.latest - a.latest)[0];
      }

      const planned = [];
      for (const e of entries) {
        const isPrimary = e === primary;
        let name = e.name;
        let existingId = null;
        if (isPrimary && match) {
          existingId = match.id;
          name = match.name;
        } else if (isPrimary) {
          // Only a suffixed name planned earlier can clash here.
          for (let n = 2; usedNames.has(key(name)); n++) name = `${e.name} ${n}`;
          usedNames.add(key(name));
        } else {
          const base = suffixedName(e.name, e.scope, e.taxable);
          name = base;
          for (let n = 2; usedNames.has(key(name)); n++) name = `${base} ${n}`;
          usedNames.add(key(name));
        }
        const product = {
          organizationId,
          existingId,
          name,
          description: e.description,
          defaultPrice: e.defaultPrice,
          scope: e.scope,
          taxable: e.taxable,
          suffixed: !isPrimary,
          offeringIds: e.offerings.map((o) => o.id),
          offerings: e.offerings,
        };
        products.push(product);
        planned.push(product);
      }
      if (planned.length > 1 || (match && !primary)) {
        conflicts.push({
          organizationId,
          name: match?.name ?? planned.find((p) => !p.suffixed)?.name ?? planned[0].name,
          ...(match && { existingSavedAddOn: { id: match.id, name: match.name, scope: match.scope, taxable: match.taxable } }),
          savedAddOns: planned.map((p) => ({ name: p.name, scope: p.scope, taxable: p.taxable, offerings: p.offeringIds.length, existing: !!p.existingId })),
        });
      }
    }
  }

  // Same-event duplicates across the final links (planned + already linked).
  const target = new Map(); // `${productRef}|${eventId}` → offering ids
  const refOf = (p, i) => p.existingId ?? `new:${i}`;
  products.forEach((p, i) => {
    for (const o of p.offerings) {
      const k = `${refOf(p, i)}|${o.eventId}`;
      if (!target.has(k)) target.set(k, { name: p.name, eventId: o.eventId, addOnIds: [] });
      target.get(k).addOnIds.push(o.id);
    }
  });
  for (const o of linkedOfferings) {
    const k = `${o.productId}|${o.eventId}`;
    if (!target.has(k)) {
      const p = existingProducts.find((x) => x.id === o.productId);
      target.set(k, { name: p?.name ?? o.productId, eventId: o.eventId, addOnIds: [] });
    }
    target.get(k).addOnIds.push(o.id);
  }
  const sameEventDuplicates = [...target.values()].filter((t) => t.addOnIds.length > 1);

  return { products, conflicts, sameEventDuplicates };
}

/**
 * Run the backfill. DRY_RUN is on unless DRY_RUN=false.
 * @returns {Promise<{ offeringsScanned, productsCreated, productsReused, offeringsLinked, conflicts, sameEventDuplicates, snapshotDrift }>}
 */
export async function run({ dryRun = process.env.DRY_RUN !== 'false', log = console.log, organizationId } = {}) {
  log(`[037-add-ons] Dedupe add-ons into saved add-ons — ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);

  const orgFilter = organizationId ? { event: { venue: { organizationId } } } : {};
  const rows = await prisma.addOn.findMany({
    where: { productId: null, ...orgFilter },
    select: {
      id: true,
      eventId: true,
      name: true,
      description: true,
      price: true,
      scope: true,
      taxable: true,
      createdAt: true,
      event: { select: { name: true, venue: { select: { organizationId: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const offerings = rows.map((r) => ({ ...r, organizationId: r.event.venue.organizationId }));
  const orgIds = organizationId ? [organizationId] : [...new Set(offerings.map((o) => o.organizationId))];
  const existingProducts = await prisma.addOnProduct.findMany({
    where: organizationId ? { organizationId } : { organizationId: { in: orgIds } },
    select: { id: true, organizationId: true, name: true, scope: true, taxable: true },
  });
  const linkedOfferings = await prisma.addOn.findMany({
    where: { productId: { not: null }, ...orgFilter },
    select: { id: true, eventId: true, productId: true },
  });
  // Products referenced by already-linked offerings in other orgs are irrelevant; keep names for the report.
  const allLinkedProducts = linkedOfferings.length
    ? await prisma.addOnProduct.findMany({
        where: { id: { in: [...new Set(linkedOfferings.map((o) => o.productId))] } },
        select: { id: true, organizationId: true, name: true, scope: true, taxable: true },
      })
    : [];
  const known = new Map([...existingProducts, ...allLinkedProducts].map((p) => [p.id, p]));

  const plan = planAddOnDedupe(offerings, [...known.values()], linkedOfferings);
  const eventNames = new Map(rows.map((r) => [r.eventId, r.event.name]));

  let productsCreated = 0;
  let productsReused = 0;
  let offeringsLinked = 0;

  log(`[037-add-ons] Unlinked add-ons: ${offerings.length} across ${orgIds.length} organization(s)`);
  for (const p of plan.products) {
    const verb = p.existingId ? 'reuse ' : 'create';
    log(`  ${verb} "${p.name}" [${p.scope}${p.taxable ? '' : ', not taxable'}] default $${p.defaultPrice.toFixed(2)} ← ${p.offeringIds.length} add-on(s)${p.suffixed ? '  (suffixed: name conflict)' : ''}`);
    if (dryRun) {
      if (p.existingId) productsReused++;
      else productsCreated++;
      offeringsLinked += p.offeringIds.length;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      let productId = p.existingId;
      if (!productId) {
        const created = await tx.addOnProduct.create({
          data: {
            organizationId: p.organizationId,
            name: p.name,
            description: p.description,
            defaultPrice: p.defaultPrice,
            scope: p.scope,
            taxable: p.taxable,
          },
        });
        productId = created.id;
        productsCreated++;
      } else {
        productsReused++;
      }
      const linked = await tx.addOn.updateMany({ where: { id: { in: p.offeringIds }, productId: null }, data: { productId } });
      offeringsLinked += linked.count;
    });
  }

  // Step 6: lines whose snapshot no longer matches the live add-on name (informational).
  const [{ drift }] = organizationId
    ? await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS drift FROM "OrderAddOn" l JOIN "AddOn" a ON a."id" = l."addOnId" JOIN "Event" e ON e."id" = a."eventId" JOIN "Venue" v ON v."id" = e."venueId" WHERE l."name" <> a."name" AND v."organizationId" = $1`,
        organizationId
      )
    : await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS drift FROM "OrderAddOn" l JOIN "AddOn" a ON a."id" = l."addOnId" WHERE l."name" <> a."name"`
      );

  log('');
  log(`[037-add-ons] Conflicts (same name, different scope / taxable): ${plan.conflicts.length}`);
  for (const c of plan.conflicts) {
    log(`  "${c.name}" (org ${c.organizationId}): ${c.savedAddOns.map((s) => `"${s.name}" ×${s.offerings}`).join(', ')}`);
  }
  log(`[037-add-ons] Same-event duplicates (not merged): ${plan.sameEventDuplicates.length}`);
  for (const d of plan.sameEventDuplicates) {
    log(`  "${d.name}" on event ${eventNames.get(d.eventId) ?? d.eventId} (${d.eventId}): add-ons ${d.addOnIds.join(', ')}`);
  }
  log('');
  log(`[037-add-ons] Summary${dryRun ? ' (dry run)' : ''}:`);
  log(`      Saved add-ons created: ${productsCreated}`);
  log(`      Saved add-ons reused:  ${productsReused}`);
  log(`      Add-ons linked:        ${offeringsLinked}`);
  log(`      Conflicts:             ${plan.conflicts.length}`);
  log(`      Same-event duplicates: ${plan.sameEventDuplicates.length}${plan.sameEventDuplicates.length ? ' — resolve before adding @@unique([eventId, productId])' : ''}`);
  log(`      Receipt lines renamed since purchase: ${drift}`);
  if (dryRun && offerings.length) log(`\n  → Run with DRY_RUN=false to write.`);

  return {
    offeringsScanned: offerings.length,
    productsCreated,
    productsReused,
    offeringsLinked,
    conflicts: plan.conflicts,
    sameEventDuplicates: plan.sameEventDuplicates,
    snapshotDrift: drift,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error('[037-add-ons] failed:', error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
