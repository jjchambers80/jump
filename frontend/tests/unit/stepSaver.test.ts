// useStepSave's state machine (spec 050 §11.5): debounced autosave on DRAFT,
// no autosave on PUBLISHED, invalid changes never sent, retry after failure.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createStepSaver, type SaveSnapshot } from '@/components/event-setup/stepSaver';

let snapshots: SaveSnapshot[];
const last = () => snapshots[snapshots.length - 1];
const make = (autosave: boolean, save = vi.fn().mockResolvedValue(undefined)) => ({
  save,
  saver: createStepSaver({ autosave, delay: 800, save, onChange: (s) => snapshots.push(s) }),
});

beforeEach(() => {
  snapshots = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('autosave (DRAFT)', () => {
  test('sends once, 800 ms after the last change', async () => {
    const { saver, save } = make(true);
    saver.change({ name: 'A' });
    await vi.advanceTimersByTimeAsync(500);
    saver.change({ name: 'Ab' });
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ name: 'Ab' });
    expect(last().status).toBe('saved');
    expect(last().savedAt).toBeInstanceOf(Date);
  });

  test('flush saves at once and cancels the timer', async () => {
    const { saver, save } = make(true);
    saver.change({ name: 'A' });
    await expect(saver.flush()).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('invalid changes are not sent', async () => {
    const { saver, save } = make(true);
    saver.change({ date: 'x' }, 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ status: 'invalid', invalidCount: 1 });
    await expect(saver.flush()).resolves.toBe(false);
  });

  test('a change typed during a save is saved after it', async () => {
    let release!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => (release = r))).mockResolvedValue(undefined);
    const { saver } = make(true, save);
    saver.change({ name: 'A' });
    await vi.advanceTimersByTimeAsync(800);
    saver.change({ name: 'AB' });
    release();
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenLastCalledWith({ name: 'AB' });
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('retry', () => {
  test('a failed save keeps the change and retry sends it again', async () => {
    const save = vi.fn().mockRejectedValueOnce({ status: 500, message: 'down' }).mockResolvedValue(undefined);
    const { saver } = make(true, save);
    saver.change({ name: 'A' });
    await vi.advanceTimersByTimeAsync(800);
    expect(last()).toMatchObject({ status: 'error', error: { status: 500, message: 'down' } });
    await expect(saver.retry()).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(last().status).toBe('saved');
  });
});

describe('explicit save (PUBLISHED)', () => {
  test('never autosaves; flush sends', async () => {
    const { saver, save } = make(false);
    saver.change({ name: 'Live' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).not.toHaveBeenCalled();
    expect(last().status).toBe('dirty');
    await expect(saver.flush()).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith({ name: 'Live' });
  });

  test('nothing pending flushes as done', async () => {
    const { saver, save } = make(false);
    saver.change(null);
    await expect(saver.flush()).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('flush and dispose', () => {
  test('flush resolves only when a change typed during the save is saved too', async () => {
    let release!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => (release = r))).mockResolvedValue(undefined);
    const { saver } = make(false, save);
    saver.change({ name: 'A' });
    const done = saver.flush();
    saver.change({ name: 'AB' });
    release();
    await expect(done).resolves.toBe(true);
    expect(save).toHaveBeenLastCalledWith({ name: 'AB' });
  });

  test('dispose sends a DRAFT change still in its debounce', async () => {
    const { saver, save } = make(true);
    saver.change({ name: 'A' });
    saver.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledWith({ name: 'A' });
  });

  test('dispose never saves a PUBLISHED change', async () => {
    const { saver, save } = make(false);
    saver.change({ name: 'Live' });
    saver.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
  });
});
