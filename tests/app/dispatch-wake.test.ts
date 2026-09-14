import { afterEach, expect, it, vi } from 'vitest';
import { DispatchWake } from '../../src/app/scheduling/dispatch-wake.js';
import type { DispatchDriveResult } from '../../src/contracts/ports.js';
const empty: DispatchDriveResult = { scanned: 0, started: 0, completed: 0, pendingRemaining: 0, failures: [] };
afterEach(() => vi.useRealTimers());

it('rescans at a durable retry deadline and closing removes only the local timer', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T00:00:00Z'));
  const drive = vi.fn(async () => empty);
  const deferred: DispatchDriveResult = { ...empty, pendingRemaining: 1, backlog: { pending: 1, due: 0, delayed: 1, quarantined: 0,
    oldestPendingAt: '2026-09-14T00:00:00Z', oldestPendingAgeMs: 0, nextAvailableAt: '2026-09-14T00:00:10Z', blocked: [] } };
  drive.mockResolvedValueOnce(deferred);
  const afterDrive = vi.fn(async () => {}), onError = vi.fn();
  const deps = { drive, afterDrive, onError, now: () => new Date().toISOString() };
  const wake = new DispatchWake(deps);
  await wake.request('accepted');
  await vi.advanceTimersByTimeAsync(9999); expect(drive).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(drive).toHaveBeenCalledTimes(2);
  expect(drive.mock.calls[1]).toEqual([{ reason: 'dispatch-retry-deadline', maxIntents: 64 }]);
  drive.mockResolvedValueOnce({ ...deferred, backlog: { ...deferred.backlog!, nextAvailableAt: '2026-09-14T00:01:00Z' } });
  await wake.request('another-persistent-intent'); await wake.close();
  await vi.advanceTimersByTimeAsync(60000); expect(drive).toHaveBeenCalledTimes(3);
  const reopened = new DispatchWake(deps); await reopened.request('restart-scan'); await reopened.close();
  expect(drive).toHaveBeenCalledTimes(4); expect(onError).not.toHaveBeenCalled();
});

it('a new wake can use a free execution slot while an earlier drive is waiting for a Run', async () => {
  let release!: (result: DispatchDriveResult) => void;
  const drive = vi.fn(async () => empty);
  drive.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const wake = new DispatchWake({ drive, afterDrive: async () => {}, now: () => new Date().toISOString(), onError: () => {} });
  const first = wake.request('first');
  await wake.request('second'); expect(drive).toHaveBeenCalledTimes(2);
  release(empty); await first; await wake.close();
});
