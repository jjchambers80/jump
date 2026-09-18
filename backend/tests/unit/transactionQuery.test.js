// Unit tests for the transactions SQL builder (spec 018 phase 1).
// Pure function: assert on the SQL shape and the positional parameters.

import { describe, it, expect } from '@jest/globals';
import { buildListSql, buildCountSql, isStripeId, TRANSACTION_STATUSES } from '../../src/services/transactionQuery.js';

const ORG = 'org_1';
const page = { offset: 0, limit: 50 };

describe('transactionQuery', () => {
  it('builds a UNION ALL over both halves, org-scoped on each side, sorted newest first', () => {
    const { sql, params } = buildListSql({ organizationId: ORG }, page);
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain(`'ORDER'::text AS "type"`);
    expect(sql).toContain(`'APPLICATION'::text AS "type"`);
    expect(sql).toContain('v."organizationId" = $1');
    expect(sql).toContain('a."organizationId" = $');
    expect(sql).toMatch(/ORDER BY t\."occurredAt" DESC, t\."type" ASC, t\."id" ASC/);
    expect(params[0]).toBe(ORG);
    expect(params.slice(-2)).toEqual([50, 0]);
  });

  it('never interpolates a value: every occurrence of the search term is a parameter', () => {
    const term = `Robert'); DROP TABLE "Order"; --`;
    const { sql, params } = buildListSql({ organizationId: ORG, search: term }, page);
    expect(sql).not.toContain('DROP TABLE');
    expect(params.some((p) => typeof p === 'string' && p.includes('DROP TABLE'))).toBe(true);
  });

  it('escapes LIKE metacharacters in the search term', () => {
    const { params } = buildListSql({ organizationId: ORG, search: '50%_off' }, page);
    expect(params).toContain('%50\\%\\_off%');
  });

  it('hides PENDING and FAILED orders by default and drops the filter when a status is named', () => {
    const def = buildListSql({ organizationId: ORG }, page);
    expect(def.sql).toContain('o."status"::text NOT IN');
    expect(def.params).toEqual(expect.arrayContaining(['PENDING', 'FAILED']));

    const failed = buildListSql({ organizationId: ORG, status: 'FAILED' }, page);
    expect(failed.sql).not.toContain('NOT IN');
    expect(failed.sql).toContain('o."status"::text IN');
    // FAILED has no application equivalent: the application half is dropped.
    expect(failed.sql).not.toContain('UNION ALL');
    expect(failed.sql).not.toContain(`'APPLICATION'::text AS "type"`);
  });

  it('a row fetched by id is not subject to the default status hiding', () => {
    const { sql, params } = buildListSql({ organizationId: ORG, type: 'ORDER', ids: ['ord_1'] }, { offset: 0, limit: 1 });
    expect(sql).not.toContain('NOT IN');
    expect(sql).toContain('o."id" IN ($2)');
    expect(params).toEqual([ORG, 'ord_1', 1, 0]);
  });

  it('maps every TransactionStatus onto at least one half', () => {
    for (const status of TRANSACTION_STATUSES) {
      const { sql } = buildListSql({ organizationId: ORG, status }, page);
      expect(sql).not.toBeNull();
    }
    expect(buildListSql({ organizationId: ORG, type: 'ORDER', status: 'PAYMENT_DUE' }, page).sql).toBeNull();
    expect(buildListSql({ organizationId: ORG, type: 'APPLICATION', status: 'FAILED' }, page).sql).toBeNull();
  });

  it('type restricts the union to one half', () => {
    const orders = buildListSql({ organizationId: ORG, type: 'ORDER' }, page);
    expect(orders.sql).toContain('FROM "Order" o');
    expect(orders.sql).not.toContain('FROM "Application" a');
    const apps = buildListSql({ organizationId: ORG, type: 'APPLICATION' }, page);
    expect(apps.sql).toContain('FROM "Application" a');
    expect(apps.sql).not.toContain('FROM "Order" o');
  });

  it('a Stripe id search compares id columns by equality and skips ILIKE', () => {
    expect(isStripeId('pi_3Q1abc')).toBe(true);
    expect(isStripeId('re_1')).toBe(true);
    expect(isStripeId('ch_1')).toBe(true);
    expect(isStripeId('vendor@example.com')).toBe(false);
    const { sql, params } = buildListSql({ organizationId: ORG, search: 'pi_3Q1abc' }, page);
    expect(sql).not.toContain('ILIKE');
    expect(sql).toContain('pt."stripePaymentIntentId" = $');
    expect(sql).toContain('a."stripeCheckoutSessionId" = $');
    expect(sql).toContain('r."stripeRefundId" = $');
    expect(params.filter((p) => p === 'pi_3Q1abc')).toHaveLength(2); // once per half
  });

  it('a text search matches orderRef, contact fields and business name with ILIKE', () => {
    const { sql } = buildListSql({ organizationId: ORG, search: 'pixel' }, page);
    expect(sql).toContain('o."orderRef" ILIKE');
    expect(sql).toContain('c."email" ILIKE');
    expect(sql).toContain(`(c."firstName" || ' ' || c."lastName") ILIKE`);
    expect(sql).toContain('p."businessName" ILIKE');
    expect(sql).toContain('a."id" = $');
  });

  it('date range, event and hasRefunds apply to both halves', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    const to = new Date('2026-09-30T23:59:59Z');
    const { sql, params } = buildListSql({ organizationId: ORG, eventId: 'evt_1', from, to, hasRefunds: true }, page);
    expect(sql).toContain('o."eventId" = $');
    expect(sql).toContain('a."eventId" = $');
    expect(sql).toContain('o."createdAt" >= ($');
    expect(sql).toContain('COALESCE(a."paidAt", a."submittedAt", a."createdAt") >= ($');
    expect(sql).toContain('EXISTS (SELECT 1 FROM "Refund" r');
    expect(sql).toContain('EXISTS (SELECT 1 FROM "ApplicationRefund" r');
    expect(params.filter((p) => p === from.toISOString() || p === to.toISOString())).toHaveLength(4);
    expect(sql).toContain(`::timestamptz AT TIME ZONE 'UTC')`);
    expect(params.filter((p) => p === 'evt_1')).toHaveLength(2);
  });

  it('hasRefunds=false is NOT EXISTS', () => {
    const { sql } = buildListSql({ organizationId: ORG, hasRefunds: false }, page);
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "Refund" r');
  });

  it('unscoped (SYSTEM_ADMIN) omits the organization predicate', () => {
    const { sql } = buildListSql({ organizationId: null }, page);
    expect(sql).not.toContain('v."organizationId" = $');
    expect(sql).not.toContain('a."organizationId" = $');
    expect(sql).toContain('org."name" AS "organizationName"');
  });

  it('sort variants keep a stable tiebreak', () => {
    expect(buildListSql({ organizationId: ORG, sort: 'date' }, page).sql).toMatch(/ORDER BY t\."occurredAt" ASC, t\."type" ASC, t\."id" ASC/);
    expect(buildListSql({ organizationId: ORG, sort: '-gross' }, page).sql).toMatch(/ORDER BY t\."gross" DESC, t\."occurredAt" DESC/);
    expect(buildListSql({ organizationId: ORG, sort: 'gross' }, page).sql).toMatch(/ORDER BY t\."gross" ASC/);
  });

  it('count SQL shares the body and has no LIMIT', () => {
    const list = buildListSql({ organizationId: ORG, search: 'x' }, page);
    const count = buildCountSql({ organizationId: ORG, search: 'x' });
    expect(count.sql).toContain('SELECT COUNT(*)::int AS "count"');
    expect(count.sql).not.toContain('LIMIT');
    expect(count.params).toEqual(list.params.slice(0, -2));
  });
});
