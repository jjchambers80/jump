#!/usr/bin/env node
// Dispute reconciliation (spec 037) — read-only. `npm run report:disputes`
//
// Counts both directions: every Dispute row → exactly one Order, and every
// dispute money-out Refund row → exactly one Dispute that is still holding the
// money. A clean run prints no discrepancy list; anything listed is real drift
// between Jump's ledger and Stripe and must be chased in the Dashboard.
//
// Optional: ORGANIZATION_ID=<id> to scope to one organization.

import { prisma } from '@jump/db';
import disputeService from '../services/DisputeService.js';

async function main() {
  const organizationId = process.env.ORGANIZATION_ID || null;
  const report = await disputeService.reconcile({ organizationId });

  console.log('Dispute reconciliation');
  console.log(`  scope                 ${organizationId ?? 'all organizations'}`);
  console.log(`  disputes              ${report.disputes}`);
  console.log(`  distinct orders       ${report.orders}`);
  console.log(`  holding money         ${report.withMoneyOut}`);
  console.log(`  missing projection    ${report.missingProjection.length}`);
  console.log(`  orphan projections    ${report.orphanProjections.length}`);
  console.log(`  dangling refund links ${report.danglingRefunds}`);
  console.log(`  duplicate dispute ids ${report.multiOrder}`);

  for (const row of report.missingProjection) {
    console.log(`  ! no money-out row    ${row.stripeDisputeId} order=${row.orderId} amount=${row.amount}`);
  }
  for (const row of report.orphanProjections) {
    console.log(`  ! money out with no live dispute  ${row.stripeDisputeId} order=${row.orderId} refunds=${row.refundIds.join(',')}`);
  }

  console.log(report.clean ? '\nClean: every dispute maps to one order and back.' : '\nDISCREPANCIES FOUND — see the lines marked !');
  await prisma.$disconnect();
  process.exit(report.clean ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
