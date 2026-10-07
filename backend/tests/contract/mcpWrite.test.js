// MCP draft write tools (spec 045 phase E): scopes decide which tools exist,
// everything an agent creates is hidden, and live records are never changed.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { prisma } from '@jump/db';
import { AGENT_RESOURCE, hashOAuthToken } from '../../src/services/AgentAuthService.js';
import { resetCacheCountersForTests } from '../../src/utils/cache.js';

const { createApp } = await import('../../../mcp/src/app.js');
const { WRITE_TOOL_NAMES } = await import('../../../mcp/src/writeTools.js');

const TAG = 'mcp-write';
let app;
let org;
let other;
let venue;
let liveVenue;
let liveEvent;
let otherEvent;
let staff;
let readToken;
let writeToken;
let oldEnv;

async function grantToken(organizationId, userId, scopes, label) {
  // One client per grant: a grant is unique per user, store and client.
  const client = await prisma.oAuthClient.create({
    data: { clientId: `${TAG}-client-${label}`, kind: 'DCR', name: `MCP write test ${label}`, redirectUris: ['https://example.com/cb'] },
  });
  const grant = await prisma.oAuthGrant.create({ data: { userId, organizationId, clientId: client.clientId, scopes } });
  const raw = `jmp_at_${TAG}_${grant.id}`;
  await prisma.oAuthToken.create({
    data: {
      grantId: grant.id, kind: 'ACCESS', tokenHash: hashOAuthToken(raw), audience: AGENT_RESOURCE,
      familyId: grant.id, expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
  return raw;
}

function rpc(body, bearer) {
  return request(app)
    .post('/mcp')
    .set('Host', '127.0.0.1')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
    .set('Authorization', `Bearer ${bearer}`)
    .send(body);
}

function message(res) {
  if (res.headers['content-type']?.includes('text/event-stream')) {
    const data = res.text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));
    return JSON.parse(data.at(-1));
  }
  return res.body;
}

async function call(name, args, bearer = writeToken) {
  const msg = message(await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, bearer));
  const text = msg.result?.content?.[0]?.text;
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  return { msg, isError: Boolean(msg.error || msg.result?.isError), data };
}

async function cleanup() {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = orgs.map((o) => o.id);
  await prisma.agentAuditLog.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.oAuthGrant.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.oAuthClient.deleteMany({ where: { clientId: { startsWith: `${TAG}-client` } } });
  await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: { in: ids } } } } });
  await prisma.event.deleteMany({ where: { venue: { organizationId: { in: ids } } } });
  await prisma.venue.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.blogPost.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.blog.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.page.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: `staff@${TAG}.test` } });
}

beforeAll(async () => {
  oldEnv = { enabled: process.env.AGENT_ACCESS_ENABLED, pepper: process.env.OAUTH_TOKEN_PEPPER };
  process.env.AGENT_ACCESS_ENABLED = 'true';
  process.env.OAUTH_TOKEN_PEPPER = 'mcp-write-pepper';
  await cleanup();
  await prisma.platformSetting.upsert({
    where: { key: 'agentAccessEnabled' }, update: { value: true }, create: { key: 'agentAccessEnabled', value: true },
  });
  org = await prisma.organization.create({ data: { name: `${TAG} A`, agentAccessEnabled: true } });
  other = await prisma.organization.create({ data: { name: `${TAG} B`, agentAccessEnabled: true } });
  venue = await prisma.venue.create({ data: { organizationId: org.id, name: 'Draft Hall', address: '1 Main St', timezone: 'America/New_York' } });
  liveVenue = await prisma.venue.create({ data: { organizationId: org.id, name: 'Live Hall', address: '2 Main St', timezone: 'America/New_York' } });
  liveEvent = await prisma.event.create({
    data: { venueId: liveVenue.id, name: 'Live Show', date: new Date(Date.now() + 864e5), capacity: 100, status: 'PUBLISHED' },
  });
  const otherVenue = await prisma.venue.create({ data: { organizationId: other.id, name: 'Other Hall', address: '3 Main St' } });
  otherEvent = await prisma.event.create({
    data: { venueId: otherVenue.id, name: 'Other Draft', date: new Date(Date.now() + 864e5), capacity: 100, status: 'DRAFT' },
  });
  staff = await prisma.user.create({
    data: { email: `staff@${TAG}.test`, name: 'Write Staff', role: 'ADMIN', memberships: { create: { organizationId: org.id, role: 'ADMIN' } } },
  });
  readToken = await grantToken(org.id, staff.id, ['store:read'], 'read');
  writeToken = await grantToken(org.id, staff.id, ['store:read', 'events:write', 'content:write'], 'write');
  app = createApp();
});

beforeEach(() => resetCacheCountersForTests());

afterAll(async () => {
  await cleanup();
  await prisma.platformSetting.update({ where: { key: 'agentAccessEnabled' }, data: { value: false } }).catch(() => {});
  for (const [key, value] of [['AGENT_ACCESS_ENABLED', oldEnv.enabled], ['OAUTH_TOKEN_PEPPER', oldEnv.pepper]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('MCP draft write tools', () => {
  it('lists write tools only for grants with the scope', async () => {
    const names = async (bearer) =>
      message(await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, bearer)).result.tools.map((t) => t.name);
    const readOnly = await names(readToken);
    expect(readOnly.filter((n) => WRITE_TOOL_NAMES.includes(n))).toEqual([]);
    expect(await names(writeToken)).toEqual(expect.arrayContaining(WRITE_TOOL_NAMES));
    expect((await call('create_page_draft', { title: 'X', content: '<p>x</p>' }, readToken)).isError).toBe(true);
  });

  it('creates events as DRAFT in the venue’s wall clock', async () => {
    const { isError, data } = await call('create_event_draft', {
      venueId: venue.id, name: 'Agent Show', startsAtLocal: '2027-07-10T19:00', capacity: 50,
      priceTiers: [{ name: 'GA', price: 20, quantityTotal: 40 }],
    });
    expect(isError).toBe(false);
    expect(data.status).toBe('DRAFT');
    expect(new Date(data.date).toISOString()).toBe('2027-07-10T23:00:00.000Z');
    expect(data.priceTiers).toHaveLength(1);

    const updated = await call('update_event', { eventId: data.id, name: 'Agent Show 2' });
    expect(updated.data.name).toBe('Agent Show 2');
    const tier = await call('create_price_tier', { eventId: data.id, name: 'VIP', price: 50, quantityTotal: 10 });
    expect(tier.data.priceTiers.map((t) => t.name)).toEqual(['GA', 'VIP']);
  });

  it('never changes a live event, its tiers or a venue it uses', async () => {
    expect((await call('update_event', { eventId: liveEvent.id, name: 'Hacked' })).isError).toBe(true);
    expect((await call('create_price_tier', { eventId: liveEvent.id, name: 'Free', price: 0, quantityTotal: 1000 })).isError).toBe(true);
    expect((await call('update_venue', { venueId: liveVenue.id, name: 'Hacked Hall' })).isError).toBe(true);
    expect((await prisma.event.findUnique({ where: { id: liveEvent.id } })).name).toBe('Live Show');
    expect(await prisma.priceTier.count({ where: { eventId: liveEvent.id } })).toBe(0);
    expect((await prisma.venue.findUnique({ where: { id: liveVenue.id } })).name).toBe('Live Hall');
  });

  it('refuses status, visibility and organization arguments', async () => {
    const draft = await call('create_event_draft', { venueId: venue.id, name: 'Sneaky', startsAtLocal: '2027-08-01T20:00', capacity: 10, status: 'PUBLISHED' });
    expect(draft.isError).toBe(true);
    expect((await call('create_page_draft', { title: 'P', content: '<p>p</p>', isVisible: true })).isError).toBe(true);
    expect((await call('update_event', { eventId: otherEvent.id, name: 'Cross' })).isError).toBe(true);
    expect((await prisma.event.findUnique({ where: { id: otherEvent.id } })).name).toBe('Other Draft');
  });

  it('creates pages and blog posts hidden, sanitised, and only edits hidden ones', async () => {
    const page = await call('create_page_draft', { title: 'Agent Page', content: '<p>Hi</p><script>alert(1)</script>' });
    expect(page.data.isVisible).toBe(false);
    expect(page.data.content.untrusted_text).not.toContain('<script');

    const post = await call('create_blog_post_draft', { title: 'Agent Post', content: '<p>Post</p>' });
    expect(post.data.isVisible).toBe(false);
    expect((await call('update_blog_post', { postId: post.data.id, title: 'Agent Post 2' })).data.title).toBe('Agent Post 2');

    const live = await prisma.page.create({ data: { organizationId: org.id, title: 'Live Page', slug: `${TAG}-live`, content: '<p>live</p>', isVisible: true } });
    expect((await call('update_page', { pageId: live.id, title: 'Hacked' })).isError).toBe(true);
    expect((await prisma.page.findUnique({ where: { id: live.id } })).title).toBe('Live Page');
  });

  it('audits each write with its target', async () => {
    const { data } = await call('create_venue', { name: 'Audit Hall', address: '9 Main St', state: 'NC', postalCode: '27601' });
    const row = await prisma.agentAuditLog.findFirst({ where: { organizationId: org.id, tool: 'create_venue' }, orderBy: { createdAt: 'desc' } });
    expect(row).toMatchObject({ outcome: 'ok', targetType: 'Venue', targetId: data.id });
    expect(data.isPublic).toBe(false);
  });
});
