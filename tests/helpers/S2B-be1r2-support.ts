/**
 * Slice 2B BE1r rows 2B-41/2B-44 shared seams (spec §7 "Kernel storage-boundary
 * fault injection", "RecordStore boundary pause", "page-cap injection").
 *
 * What it builds and through which public calls:
 *   - `withProbeMissing`: a thin `KernelStoreRegistry` proxy over a real
 *     registry. Every `withStore(adapterId, use)` still opens the REAL Kernel
 *     store; while `missing` is on, the public `store.get(sessionId, ...)` throws
 *     `StoreError('not_found')`, which `SessionHistoryCursorOwner.probe` maps to
 *     the `missing` verdict (RUN-20(ii)). Nothing is written and no fact is
 *     fabricated. The switch is released as soon as the test flips it.
 *   - `createPausingRecords`: a proxy over the real WorkGraph records port. The
 *     first `commit(prepared)` after `arm()` signals `entered` and waits for
 *     `release` BEFORE the real commit runs, so a concurrent RUN-21 commit can
 *     win the same RunActivity key (L8's `record_changed` race). Reads pass
 *     through unchanged.
 *   - `restartedHostOver`: the reviewed `restartedHost` copy
 *     (`tests/helpers/S2B-runtime-tools-support.ts`) with the P7 Kernel-store
 *     override the two rows need; the classifier body is unchanged.
 *
 * Production code is never touched; the switches live only in tests. The
 * counting-off double lives in `tests/helpers/S2B-counting-off-support.ts`.
 */
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import type { RunControlPort } from '../../src/core/work-graph/tasks/control-contracts.js';
import type { HostInstanceFacts } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { reconcileRunAtStartup, type RunReconcileClassifierDependencies } from '../../src/core/agent-runtime/run-reconcile.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import { StoreError, type SqliteStores } from '../../vendor/coding-agent/dist/public-api.js';
import { B2_AT, type B2RuntimeFixture } from './B2-runtime-fixture.js';

/** §7 probe fault: while `state.missing`, the real Kernel store's public `get`
 * throws `StoreError('not_found')`, which the probe maps to `missing`. The
 * Session is never mutated; flipping the switch back recovers the real store. */
export function withProbeMissing(
  base: RuntimeExecutionDependencies['kernelStores'],
  state: { missing: boolean },
): RuntimeExecutionDependencies['kernelStores'] {
  return {
    ...base,
    async withStore<T>(adapterId: string, use: (store: SqliteStores) => Promise<T>): Promise<T> {
      return base.withStore(adapterId, async (store) => {
        const proxy = new Proxy(store, {
          get(target, property, receiver) {
            if (property === 'get') {
              return async (...args: unknown[]) => {
                if (state.missing) {
                  throw new StoreError('not_found', 'S2B BE1r2 injected: the mapped Kernel database is missing');
                }
                const real = Reflect.get(target, 'get', receiver) as (...inner: unknown[]) => Promise<unknown>;
                return real.apply(target, args);
              };
            }
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
          },
        });
        return use(proxy as unknown as SqliteStores);
      });
    },
  };
}

/** §7 RecordStore-boundary pause around a real records port's `commit`. */
export function createPausingRecords<T extends object>(base: T): {
  records: T; arm(): void; entered: Promise<void>; release(): void;
} {
  let armed = false;
  let paused = false;
  let enterResolve!: () => void;
  let releaseResolve!: () => void;
  const entered = new Promise<void>((resolve) => { enterResolve = resolve; });
  const releasePromise = new Promise<void>((resolve) => { releaseResolve = resolve; });
  const records = new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'commit') {
        return async (prepared: unknown) => {
          if (armed && !paused) {
            armed = false;
            paused = true;
            enterResolve();
            await releasePromise;
          }
          const real = Reflect.get(target, 'commit', receiver) as (input: unknown) => Promise<unknown>;
          return real.call(target, prepared);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { records: records as T, arm() { armed = true; }, entered, release() { releaseResolve(); } };
}

/** The reviewed `restartedHost` with the P7 Kernel-store override; the classifier
 * body is the reviewed one, unchanged. */
export function restartedHostOver(
  fx: B2RuntimeFixture,
  host: HostInstanceFacts,
  controls: RunControlPort,
  kernelStores: RuntimeExecutionDependencies['kernelStores'],
) {
  const deps = fx.rebuildDeps({ hostInstance: host, runReconcile: true, kernelStores });
  let seq = 0;
  const classifier: RunReconcileClassifierDependencies = {
    owner: createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores }), controls,
    entry: deps.entry, reconcile: deps.runReconcile!, now: () => B2_AT,
    newId: () => `s2b-be1r2-reconcile-${host.hostInstanceId}-${++seq}`,
  };
  const reconcile = async () => {
    const record = await deps.executions.readExecution(fx.ctx, fx.claim.runRef);
    if (record.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(record)}`);
    const probe = await classifier.owner.probe({ session: record.value.session, signal: fx.ctx.signal });
    return reconcileRunAtStartup(classifier, fx.ctx, { record: record.value, hostInstanceId: host.hostInstanceId, probe });
  };
  return { deps, classifier, reconcile };
}
