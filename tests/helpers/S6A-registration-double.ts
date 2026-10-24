/**
 * Slice 6A-1 fixture (book §5.1, check 3 A6; row R-01a's `line_pending` and its
 * replay, the `submit`/drain replay rows): a boundary double around the real
 * `SessionDirectoryPort.recordSessionCreated`.
 *
 * What it is (rule sheet v1 A2 fault injection plus an A3 counting wrapper): a
 * `vi.mock` factory for `src/core/work-graph/sessions/session-directory.ts`
 * that keeps every real export and wraps the port the real
 * `createSessionDirectory` returns (composition builds the one directory at
 * `src/composition/create-platform.ts:806` and hands it to the Session
 * operations at `:1019` and to the tracked `sessions` port at `:1255`).
 *   - Armed (`failNext(n)`): the next `n` calls of `recordSessionCreated` throw
 *     before forwarding, so nothing is written.
 *   - Otherwise every call forwards to the real `recordSessionCreated` and
 *     returns its result unchanged. Every other method is the real closure.
 * Admission and the Kernel Session creation run normally. A thrown
 * registration makes the real `createSession` answer `accepted`
 * (`src/core/agent-runtime/session-operations.ts:540–545`); the same request
 * again replays the admission, finds the Kernel Session already created
 * (`:678–681`) and registers it through the forwarded call (`:694`), so it is
 * `completed` with the planned Session. A Kernel-store failure would take
 * `mapKernelFailure` (`:690`) instead; this double never touches the Kernel.
 *
 * Controls on `registrationDouble`: `failNext(n = 1)` sets the number of
 * calls still to fail (it does not add); `forwarded` and `injected` count the
 * forwarded calls and the injected failures since the last `reset()`;
 * `armed` is the number of failures still pending; `reset()` disarms and zeroes
 * the counts. The counts cover every directory built while the mock is
 * installed (one per platform, so a reopen adds its own).
 *
 * Wiring (the test file owns the hoisted mock, as
 * `tests/app/RL-33-workbench-resource-caps.test.ts:21` does):
 *
 *   import { registrationDouble } from '../helpers/S6A-registration-double.js';
 *   vi.mock('../../src/core/work-graph/sessions/session-directory.js', async (importOriginal) =>
 *     (await import('../helpers/S6A-registration-double.js')).registrationDoubleModule(importOriginal));
 *   afterEach(() => registrationDouble.reset());
 *
 * It combines with `S6A-commit-barrier.ts` in one test file (three `vi.mock`
 * calls); the barrier sees the registration commit only when the double
 * forwards.
 */
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';

type DirectoryModule = typeof import('../../src/core/work-graph/sessions/session-directory.js');

export const S6A_REGISTRATION_FAILURE = 'S6A registration double: injected recordSessionCreated failure';

export class RegistrationDouble {
  private remaining = 0;
  private forwardedCalls = 0;
  private injectedFailures = 0;

  /** The next `n` registrations throw before forwarding (replaces any earlier arming). */
  failNext(n = 1): void {
    if (!Number.isInteger(n) || n < 1) throw new Error(`S6A registration double: failNext needs a positive integer, got ${n}`);
    this.remaining = n;
  }

  get armed(): number { return this.remaining; }
  get forwarded(): number { return this.forwardedCalls; }
  get injected(): number { return this.injectedFailures; }

  reset(): void {
    this.remaining = 0;
    this.forwardedCalls = 0;
    this.injectedFailures = 0;
  }

  /** Wrap one real port: only `recordSessionCreated` changes. */
  wrap(port: SessionDirectoryPort): SessionDirectoryPort {
    const real = port.recordSessionCreated;
    return { ...port, recordSessionCreated: async (ctx, request) => {
      if (this.remaining > 0) {
        this.remaining -= 1;
        this.injectedFailures += 1;
        throw new Error(S6A_REGISTRATION_FAILURE);
      }
      this.forwardedCalls += 1;
      return real(ctx, request);
    } };
  }
}

/** The one shared double the mocked factory and the test file use. */
export const registrationDouble = new RegistrationDouble();

/** `vi.mock` factory for `src/core/work-graph/sessions/session-directory.js`. */
export async function registrationDoubleModule(importOriginal: () => Promise<unknown>): Promise<DirectoryModule> {
  const actual = await importOriginal() as DirectoryModule;
  return { ...actual,
    createSessionDirectory: (stores: Parameters<DirectoryModule['createSessionDirectory']>[0]) =>
      registrationDouble.wrap(actual.createSessionDirectory(stores)) };
}
