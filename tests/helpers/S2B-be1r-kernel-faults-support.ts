/**
 * Slice 2B BE1r Kernel-read fault seam (spec §7 "Kernel storage-boundary fault
 * injection"; entry BE1r).
 *
 * What it builds and through which public calls:
 *   - a thin `KernelStoreRegistry` wrapper around an existing real registry
 *     (`createS2BRuntimeStoreFixture`'s `deps.kernelStores`). Every
 *     `withStore(adapterId, use)` still opens the REAL Kernel store; the proxy
 *     only observes/steers the public `store.read(sessionId, after, limit, ...)`
 *     call. It is the same seam `tests/runtime/B2-runtime-execution.test.ts:339`
 *     and `:553` use, copied in shape (not in behaviour: this one is generic).
 *   - no production code, no direct record write, no fabricated Kernel fact.
 *
 * The `decide` callback is called for every read with the public coordinates.
 * It may return `'pass'` (the real read runs) or `'unavailable'` (an explicit
 * `StoreError('unavailable')` is thrown, which the owner maps to a rejected
 * `unavailable` read — never success, zero or empty). A caller that wants the
 * "cancel the caller's signal at this read" shape aborts its own
 * `AbortController` from inside `decide` and returns `'pass'`; the observer
 * detects the aborted signal after the read and reports `cancelled`.
 */
import { StoreError, type SqliteStores } from '../../vendor/coding-agent/dist/public-api.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';

/** The public coordinates of one `store.read` call. */
export type Be1rKernelRead = { sessionId: string; after: number; limit: number; index: number };
export type Be1rKernelReadDecision = 'pass' | 'unavailable';

export function withBe1rKernelReadFaults(
  base: RuntimeExecutionDependencies['kernelStores'],
  decide: (read: Be1rKernelRead) => Be1rKernelReadDecision,
): RuntimeExecutionDependencies['kernelStores'] {
  let index = 0;
  return {
    ...base,
    async withStore<T>(adapterId: string, use: (store: SqliteStores) => Promise<T>): Promise<T> {
      return base.withStore(adapterId, async (store) => {
        const proxy = new Proxy(store, {
          get(target, property, receiver) {
            if (property === 'read') {
              return async (...args: unknown[]) => {
                const read: Be1rKernelRead = {
                  sessionId: String(args[0]), after: Number(args[1]), limit: Number(args[2]), index: index++,
                };
                if (decide(read) === 'unavailable') {
                  // `mapHistoryFailure` maps any StoreError that is not
                  // `cancelled`/`not_found` to a rejected `unavailable` read.
                  throw new StoreError('corrupt', `S2B BE1r injected Kernel read failure (#${String(read.index)})`);
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
}
