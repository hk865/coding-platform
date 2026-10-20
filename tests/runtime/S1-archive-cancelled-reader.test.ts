/**
 * Slice 1 §2.6 / rework 4 row P3: the archive changed-files reader keeps the
 * archive call's OWN cancellation.
 *
 * The not-entered Run precondition is the one of
 * `S1-archive-files-brief.test.ts:168`: a real claim is stopped through the
 * real cancel control before it enters, so the Run reads ended/cancelled with
 * `startedAt: null`, and the Session facts still carry that Work line as
 * `latestWork`. A retired operator line (health `unavailable`, recorded through
 * the real health owner) then anchors its latest Work Run, which is exactly the
 * production path that calls `readArchiveChangedFiles` inside `archiveLine`.
 *
 * The real reader is wrapped (A3) and wired into the real archive composition;
 * a gate holds the reader's real `readExecution` return until the test aborts
 * the archive call's signal. The observer records the reader's own result
 * unchanged, because the composite archive deliberately falls back from a
 * cancelled facts read (`session-archive.ts:244-248`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { ArchiveChangedFilesV1 } from '../../src/contracts/session-anomaly.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import type { ExecutionReadPort } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';
import { createArchiveChangedFilesReader } from '../../src/core/agent-runtime/session-anomaly-facts.js';
import { createSessionArchiveService, type ArchiveLineInput } from '../../src/business/workflow/session-archive.js';
import { DEFAULT_SESSION_ARCHIVE_POLICY } from '../../src/business/workflow/ports.js';
import { committed, installS1DateClock, openS1RuntimeFixture, S1_T0 as t0 } from '../helpers/S1-runtime-scenario-fixture.js';

type Fixture = Awaited<ReturnType<typeof openS1RuntimeFixture>>;

const opened: Fixture[] = [];
let restoreClock: (() => void) | undefined;
beforeEach(() => { restoreClock = installS1DateClock(); });
afterEach(async () => {
  try { for (const f of opened.splice(0)) await f.close(); } finally { restoreClock?.(); }
});
async function open() {
  const f = await openS1RuntimeFixture();
  opened.push(f);
  return f;
}

/** An A3 gate: resolves `entered` when a held call reaches it, then waits. */
function createGate() {
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  let released!: () => void;
  const releasedPromise = new Promise<void>((resolve) => { released = resolve; });
  return {
    entered: enteredPromise,
    async enter(): Promise<void> { entered(); await releasedPromise; },
    release(): void { released(); },
  };
}

type HeldRead = 'return' | 'throw';

/**
 * Establish the not-entered Run, retire its Session through the real health
 * owner, then drive one real `archiveLine` through a gated reader.
 */
async function archiveWithHeldReader(held: HeldRead) {
  const f = await open();
  const claim = await f.claim();
  // The real cancel control: the Run ends before it ever enters.
  committed(await f.controls.submitControl(f.base.ctx, {
    input: { runRef: claim.runRef, kind: 'cancel', reason: 'cancel before entry' },
    meta: { requestId: f.newId(), expected: [await f.pin(claim)] },
  }));
  expect((await f.read(claim)).run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
  // The real health owner retires the line; an operator archive of a retired
  // line anchors its latest Work Run (session-archive.ts:461-478).
  expect(await f.health.recordSessionHealth(f.base.ctx, {
    sessionRef: claim.sessionRef, probe: { verdict: 'missing', activeRunId: null },
  })).toMatchObject({ status: 'observed', session: { health: 'unavailable' } });

  const gate = createGate();
  const executions = f.deps.executions;
  const gatedExecutions: ExecutionReadPort = {
    ...executions,
    async readExecution(ctx, ref, options) {
      // A3: delegate the real read unchanged, then hold its return for the test.
      const result = await executions.readExecution(ctx, ref, options);
      await gate.enter();
      if (held === 'throw') {
        // A2: the real read resolved, but the caller is cancelled before the
        // result is used; the reader must report cancellation, not unavailable.
        throw new Error('S1 injected execution read failure after the archive cancellation');
      }
      return result;
    },
  };

  let observed: ReadResult<ArchiveChangedFilesV1> | undefined;
  const reader = createArchiveChangedFilesReader({ ...f.deps, executions: gatedExecutions });
  const observer: NonNullable<RuntimeExecutionPort['readArchiveChangedFiles']> = async (ctx, input) => {
    const result = await reader.readArchiveChangedFiles(ctx, input);
    observed = result;
    return result;
  };

  const service = createSessionArchiveService({
    sessionLifecycle: f.lifecycle,
    sessionFacts: f.sessionFacts,
    responsibilities: f.responsibilities,
    sessionAnomalies: f.anomalies,
    controls: f.controls,
    plans: f.base.plans,
    claims: f.deps.claims,
    executions: f.reads,
    messages: f.messages,
    archivePolicy: DEFAULT_SESSION_ARCHIVE_POLICY,
    now: () => t0,
    runtime: { ...f.runtime.port,
      createSession: f.deps.sessionOperations.createSession.bind(f.deps.sessionOperations),
      readArchiveChangedFiles: observer },
  });

  const controller = new AbortController();
  const ctx: CoreCallContext = { ...f.base.ctx, signal: controller.signal };
  const write: GraphWrite<ArchiveLineInput> = {
    input: { sessionRef: claim.sessionRef, reason: 'archive the retired not-entered Work line', tasks: [], wait: null },
    meta: { requestId: f.newId(), expected: [await f.base.sessionPin(claim.sessionRef)] },
  };
  const pending = service.archiveLine(ctx, write);
  // Never hang on a gate the archive does not reach: the real call either
  // reaches the reader or resolves without it, and the assertion says which.
  const reached = await Promise.race([
    gate.entered.then(() => true),
    pending.then(() => false, () => false),
  ]);
  if (reached) controller.abort();
  gate.release();
  await pending;
  expect(reached).toBe(true);
  return observed;
}

describe('S1 archive changed-files reader keeps the archive caller cancellation', () => {
  it('a resolved execution read with the archive signal set is rejected/cancelled', async () => {
    const observed = await archiveWithHeldReader('return');
    expect(observed).toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(observed).not.toMatchObject({ status: 'ready' });
  });

  it('a throwing execution read with the archive signal set is rejected/cancelled, not unavailable', async () => {
    const observed = await archiveWithHeldReader('throw');
    expect(observed).toMatchObject({ status: 'rejected', code: 'cancelled' });
  });
});
