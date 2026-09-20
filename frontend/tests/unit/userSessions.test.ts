import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = new Map<string, { userId: string; revokedAt: Date | null }>();
let nextId = 1;
vi.mock('@jump/db', () => ({
  prisma: {
    userSession: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: { userId: string } }) => {
        const id = `sess_${nextId++}`;
        rows.set(id, { userId: data.userId, revokedAt: null });
        return { id };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { revokedAt: Date } }) => {
        const row = rows.get(where.id);
        if (!row || row.revokedAt) return { count: 0 };
        row.revokedAt = data.revokedAt;
        return { count: 1 };
      }),
    },
  },
}));

const { resolveSessionId, revokeSessionOnSignOut } = await import('@/lib/userSessions');

describe('resolveSessionId (spec 030 D)', () => {
  beforeEach(() => {
    rows.clear();
    nextId = 1;
  });

  it('creates a row on sign-in even if the token already had a sid', async () => {
    expect(await resolveSessionId('u1', undefined, { signIn: true, provider: 'google' })).toBe('sess_1');
    expect(await resolveSessionId('u1', 'sess_1', { signIn: true, provider: 'google' })).toBe('sess_2');
  });

  it('keeps a live sid on refresh and adopts a legacy token', async () => {
    const sid = (await resolveSessionId('u1', undefined, { signIn: true }))!;
    expect(await resolveSessionId('u1', sid, { signIn: false })).toBe(sid);
    expect(await resolveSessionId('u1', undefined, { signIn: false })).toBe('sess_2');
  });

  it('returns null for a revoked row so the cookie is dropped', async () => {
    const sid = (await resolveSessionId('u1', undefined, { signIn: true }))!;
    await revokeSessionOnSignOut(sid);
    expect(await resolveSessionId('u1', sid, { signIn: false })).toBeNull();
  });

  it('replaces a sid that belongs to someone else or was swept', async () => {
    const theirs = (await resolveSessionId('u2', undefined, { signIn: true }))!;
    expect(await resolveSessionId('u1', theirs, { signIn: false })).toBe('sess_2');
    expect(await resolveSessionId('u1', 'gone', { signIn: false })).toBe('sess_3');
  });

  it('sign-out without a sid is a no-op', async () => {
    await expect(revokeSessionOnSignOut(undefined)).resolves.toBeUndefined();
  });
});
