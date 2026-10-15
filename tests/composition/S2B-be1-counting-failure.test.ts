/**
 * Slice 2B BE1 acceptance row 2B-08 (spec §5.2, entry BE1).
 *
 * Ending is not affected by counting. The same real tool script runs; the test
 * observes once mid-run (so the observer's cache is non-empty and the ending
 * observe must re-read the whole Turn, L6), then arms a Kernel-store read fault
 * that fails the full-Turn page read the counting re-read issues. The Run still
 * ends; the tally is `unknown('history_read_failed')`; the calendar hour it
 * covers shows one uncounted Run (L5, L6; rule 4).
 *
 * The only seam is the Kernel store locator: every `withStore` still opens the
 * REAL Kernel store, and the wrapper fails exactly one public `store.read` (the
 * first full page read from the Turn's start position after arming — the
 * counting re-read), the same shape the BE1r fixture uses.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { ActivityCalendarV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import { createS2BBe1Platform, S2B_SLOW_TIMEOUT_MS, type S2BBe1PlatformFixture } from '../helpers/S2B-be1-platform-fixture.js';

const kernelFault = vi.hoisted(() => ({
  armed: false,
  startPosition: 0,
  matchingPageReads: 0,
  injected: 0,
}));

vi.mock('../../src/core/agent-runtime/kernel-store-locator.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/agent-runtime/kernel-store-locator.js')>();
  const { StoreError } = await import('../../vendor/coding-agent/dist/public-api.js');
  return {
    ...actual,
    async createKernelStoreRegistry(input: Parameters<typeof actual.createKernelStoreRegistry>[0]) {
      const registry = await actual.createKernelStoreRegistry(input);
      return {
        ...registry,
        async withStore<T>(adapterId: string, use: (store: unknown) => Promise<T>): Promise<T> {
          return registry.withStore(adapterId, async (store) => {
            const proxy = new Proxy(store as object, {
              get(target, property, receiver) {
                if (property === 'read') {
                  return async (...args: unknown[]) => {
                    const after = Number(args[1]);
                    const limit = Number(args[2]);
                    if (limit > 1 && after === kernelFault.startPosition - 1) {
                      kernelFault.matchingPageReads += 1;
                      // After arming, the next full page read from the Turn's
                      // start position is the counting re-read (L6 step 3).
                      if (kernelFault.armed && kernelFault.matchingPageReads === 1) {
                        kernelFault.injected += 1;
                        throw new StoreError('corrupt', 'S2B BE1 injected Kernel read failure (counting re-read)');
                      }
                    }
                    const real = Reflect.get(target, 'read', receiver) as (...inner: unknown[]) => Promise<unknown>;
                    return real.apply(target, args);
                  };
                }
                const value = Reflect.get(target, property, receiver) as unknown;
                return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
              },
            });
            return use(proxy);
          });
        },
      };
    },
  };
});

const opened: S2BBe1PlatformFixture[] = [];
afterEach(async () => {
  for (const fixture of opened.splice(0)) await fixture.close();
  kernelFault.armed = false;
  kernelFault.startPosition = 0;
  kernelFault.matchingPageReads = 0;
  kernelFault.injected = 0;
});

it('2B-08 a failed counting re-read still ends the Run and records unknown, with the hour marked uncounted', async () => {
  const f = await createS2BBe1Platform({
    toolNames: ['read', 'write'],
    writeScope: ['.'],
    initialAt: '2026-10-15T10:00:00.000Z',
    workspaceFiles: { 'a.ts': 'count fail\n' },
    beforeReply: async (_request, index) => {
      if (index !== 1) return;
      // Observe once mid-run: the observer caches the Turn head, so the ending
      // observe must re-read the whole Turn (L6). Only then arm the fault.
      const observed = await f.platform.runtime.observeRun(f.ctx, { runRef: f.runRef });
      expect(observed.status).toBe('ready');
      kernelFault.startPosition = observed.status === 'ready'
        ? (observed.value.run.executionHistory?.startPosition ?? 0) : 0;
      kernelFault.matchingPageReads = 0;
      // End the Run at 10:30 so its `run_times` span really covers the 10:00 hour.
      f.setClock('2026-10-15T10:30:00.000Z');
      kernelFault.armed = true;
    },
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'be1-count-read', name: 'read', args: { path: 'a.ts' } }] },
      { kind: 'text', text: '2B-08 done' },
    ],
  });
  opened.push(f);

  const record = await f.run('2b08');
  // The Run ends normally despite the counting read failure.
  expect(record.run.status).toBe('ended');
  expect(record.run.outcome).toBe('completed');
  expect(kernelFault.injected).toBe(1);

  const views = await f.readRuns();
  expect(views[0]).toMatchObject({
    status: 'unknown', reason: 'history_read_failed', error: false,
    totals: null, changedFiles: null, usage: null,
    recordedBy: 'run_end', countedThroughTurnEnd: null, unresolvedCalls: null,
  });
  expect(views[0]?.recordedAt).not.toBeNull();

  // Read the calendar after the covered hour so the cell is not "now".
  f.setClock('2026-10-15T12:00:00.000Z');
  const calendar: ActivityCalendarV1 = await f.calendar({ from: '2026-10-15T10:00:00.000Z',
    to: '2026-10-15T11:00:00.000Z', granularity: 'hour', timeZone: 'UTC' });
  const cell = calendar.cells.find(candidate => candidate.localHour === 10);
  expect(cell).toMatchObject({ uncountedRuns: 1, steps: 0, edits: 0, complete: false, future: false });
  expect(calendar.totals.complete).toBe(false);
  const coverage = calendar.coverage.runsUncounted.find(entry => entry.reason === 'history_read_failed');
  expect(coverage?.count).toBe(1);
}, S2B_SLOW_TIMEOUT_MS);
