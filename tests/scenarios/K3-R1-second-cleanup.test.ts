/**
 * K3 group 2 part 3, ruling 5 / K3-21: the `second_auto_cleanup` guard (L25 G9,
 * L23 example 1) at the R1 entry.
 *
 * Run A is left in flight on a `shell` call and the crash restart closes it by
 * RUN-25 (`W-26`, applied): A's review record therefore carries a `process`
 * item. The Workflow then claims and prepares A's continuation B; B is started
 * with a `read` call in flight and crashed again. The restart's reconcile finds
 * a full classifier candidate but WorkGraph's G9 reads
 * `priorAutoCleanup(B) === true` (A ended by RUN-25 between B and the chain
 * start), so it writes RUN-20(i) with
 * `autoCleanup: { applied: false, blockedBy: 'second_auto_cleanup' }`.
 *
 * `executions/resolve-unknown` on B then creates B's review record in the same
 * commit; its `streak` is the literal L23 example 1 values
 * `{ priorAutoCleanup: true, priorUnknownProcess: true, resetRunRef: null }`.
 *
 * Workflow/state transitions run through `src/core/work-graph/state/`; no check
 * runs. A's `shell` grant has no public Host path (the AG2b work grant has no
 * `shell`), so A is prepared and started on a composition root on the scenario's
 * own files (see ./support/shell-work-root.ts); the crash restart is the real
 * `HostScenario.restart({ crash: true })`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { toolSchema as z } from '../../vendor/coding-agent/dist/public-api.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { openWorkRoot, preparedOf, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';

// The KE6 stand-in: the review round's selection reads `ProcessSandbox.probe`
// with the read-only options; no host process runs. The general (process) probe
// stays `unavailable` exactly as a bwrap-less host, so the shell seam's stand-in
// is not made to await the real resource-capability canary.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});

// --- The shell seam (A's process call) ------------------------------------
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandbox: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandbox),
  };
});
seams.shellSeam = shellSeam;

// --- The read seam (B's call), as tests/scenarios/K3-R1-workspace-capture ----
type ReadCall = { callId: string; arguments: unknown };

class ReadSeam {
  private armed = false;
  private gate: Promise<void> = Promise.resolve();
  private openGate: (() => void) | null = null;
  private waiters: Array<() => void> = [];
  readonly calls: ReadCall[] = [];

  get enabled(): boolean { return this.armed; }
  arm(): void {
    this.armed = true;
    this.calls.length = 0;
    this.gate = new Promise<void>((resolve) => { this.openGate = resolve; });
  }
  release(): void {
    this.armed = false;
    this.openGate?.();
    this.openGate = null;
  }
  async waitForCall(): Promise<void> {
    if (this.calls.length > 0) return;
    await new Promise<void>((resolve) => { this.waiters.push(resolve); });
  }
  private async block(): Promise<void> { if (this.armed) await this.gate; }
  private stub(): ToolDefinition {
    return {
      name: 'read',
      description: 'K3 stand-in read (blocks until released)',
      inputSchema: z.object({ path: z.string() }).loose(),
      effectClass: 'read_only',
      requiredCapabilities: ['workspace_read'],
      independentReadOnly: false,
      defaultTimeoutMs: 15_000,
      outputLimitBytes: 32 * 1024,
      summarize: () => ({ paths: [], cwd: null, commandPreview: 'K3 read' }),
      handler: {
        execute: async (call) => {
          this.calls.push({ callId: call.callId, arguments: call.arguments });
          for (const waiter of this.waiters.splice(0)) waiter();
          await this.block();
          return { schemaVersion: 1, callId: call.callId, status: 'success', output: [],
            effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
        },
      },
    } as ToolDefinition;
  }
  definition(actual: (workspace: never) => ToolDefinition, workspace: never): ToolDefinition {
    return this.armed ? this.stub() : actual(workspace);
  }
}
const readSeams = vi.hoisted(() => ({ readSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js')>();
  return {
    ...actual,
    createReadToolDefinition: (workspace: Parameters<typeof actual.createReadToolDefinition>[0]): ToolDefinition =>
      (readSeams.readSeam as ReadSeam).definition(actual.createReadToolDefinition as never, workspace as never),
  };
});
const readSeam = new ReadSeam();
readSeams.readSeam = readSeam;

afterEach(async () => {
  shellSeam.release();
  readSeam.release();
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

describe('K3 R1 second_auto_cleanup (K3-21 G9)', () => {
  it('K3-21 second_auto_cleanup: A ends by RUN-25, B in flight again is blocked with W-13/blockedBy second_auto_cleanup and its record carries the L23 example 1 streak', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });

    // --- A: a `shell` call in flight, closed by RUN-25 on the restart. -------
    shellSeam.arm();
    const modelA = createScriptedModel([{ kind: 'calls', calls: [
      { callId: 'k3-21-sa-a-shell', name: 'shell', args: { command: 'k3-21-sa A runs a program' } }] }]);
    const rootA = await openShellWorkRoot(h, modelA);
    let runningA: Promise<unknown> | null = null;
    let reportA: Awaited<ReturnType<HostScenario['restart']>>;
    let preparedA: ReturnType<typeof preparedOf>;
    try {
      const startA = await prepareOn(rootA, h.select('k3-21-sa-a', AG2B_WORK_TASK_ID));
      preparedA = preparedOf(startA);
      runningA = rootA.runtime.startRun(hostCtx(), { prepared: preparedA, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-21-sa-a-start' });
      await shellSeam.waitForCall();
      expect(shellSeam.calls.map(call => call.callId)).toEqual(['k3-21-sa-a-shell']);
      reportA = await h.restart({ crash: true });
    } finally {
      shellSeam.release();
      await runningA?.catch(() => undefined);
      await rootA.close();
    }
    expect(reportA).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(preparedA.claim.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });

    // --- A's review round (K3-05 chain): A must settle before B is claimed. -
    const reviewA = await reviewOf(h, preparedA.claim.runRef);
    expect(reviewA.status).toBe('ready');
    if (reviewA.status !== 'ready') return;
    expect(reviewA.value.status).toBe('pending_review');
    expect(reviewA.value.items).toMatchObject([{ kind: 'process' }]);
    const modelReviewA = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-21-sa-a-review', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'the shell call reached its end before the crash',
          crashSuspicion: { verdict: 'unlikely', evidence: 'the command leaves no crash trace behind' } } }] },
      { kind: 'text', text: 'A\'s review round is done' },
    ]);
    const reviewRootA = await openReviewWorkRoot(h, modelReviewA);
    try {
      const reviewStart = await driveReviewUntil(reviewRootA, h.select('k3-21-sa-a-review', AG2B_WORK_TASK_ID),
        performs('start'));
      const preparedReviewA = preparedOf(reviewStart.stopped);
      await reviewRootA.runtime.startRun(hostCtx(), { prepared: preparedReviewA, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-21-sa-a-review-start' });
      expect((await readExecution(h.host, preparedReviewA.claim.runRef)).run)
        .toMatchObject({ status: 'ended', outcome: 'completed' });
    } finally {
      await reviewRootA.close();
    }

    // --- B: A's continuation, a `read` call in flight, crashed again. -------
    const toStartB = await h.advance(h.select('k3-21-sa-b', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const preparedB = preparedOf(toStartB.next);
    expect(preparedB.claim.runRef.runId, 'B is a new Run').not.toBe(preparedA.claim.runRef.runId);
    const settledA = await reviewOf(h, preparedA.claim.runRef);
    expect(settledA.status).toBe('ready');
    if (settledA.status !== 'ready') return;
    expect(settledA.value).toMatchObject({ status: 'resolved', decisionReasons: [] });
    readSeam.arm();
    const modelB = createScriptedModel([{ kind: 'calls', calls: [
      { callId: 'k3-21-sa-b-read', name: 'read', args: { path: 'src/module.ts' } }] }]);
    const rootB = await openWorkRoot(h, modelB);
    let runningB: Promise<unknown> | null = null;
    let reportB: Awaited<ReturnType<HostScenario['restart']>>;
    try {
      runningB = rootB.runtime.startRun(hostCtx(), { prepared: preparedB, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-21-sa-b-start' });
      await readSeam.waitForCall();
      reportB = await h.restart({ crash: true });
      expect(reportB).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
        { ref: JSON.stringify(preparedB.claim.runRef), row: 'W-13', status: 'reconciled', reason: 'unknown',
          autoCleanup: { applied: false, blockedBy: 'second_auto_cleanup' } }] } });

      // --- The attestation creates B's record with the L23 example 1 streak.
      // `readSeam` stays armed: B's read call is still in flight when the person
      // attests, so the surviving in-process root cannot append a Kernel result
      // the crash-time observation (recorded unresolved) would then disagree with.
      const unknownB = await readExecution(h.host, preparedB.claim.runRef);
      expect(unknownB.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
        reconciliation: { status: 'quarantined', observation: { kind: 'unresolved', autoCleanupBlockedBy: 'second_auto_cleanup' } } });
      const attested = await h.post<unknown>('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
        { runRef: preparedB.claim.runRef, reason: 'k3-21 second_auto_cleanup: a person attests B' }, 'k3-21-sa-attest',
        [{ ref: preparedB.claim.runRef, revision: unknownB.run.revision }]));
      expect(attested).toMatchObject({ status: 'committed' });

      const read = await reviewOf(h, preparedB.claim.runRef);
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.streak).toEqual({ priorAutoCleanup: true, priorUnknownProcess: true, resetRunRef: null });
    } finally {
      readSeam.release();
      await runningB?.catch(() => undefined);
      await rootB.close();
    }
  }, 180_000);
});
