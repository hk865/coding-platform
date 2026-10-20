/**
 * K3 row K3-28 (R4, L22; spec line 1459): the human attestation survives on the
 * Run, the continuation requeues after the ATTESTED Run, and the rework is
 * counted once (`run_failed`) while the review round is not counted.
 *
 * The Run is a real RUN-25-blocked crash (`workspace_not_git`), attested
 * through `executions/resolve-unknown`; the review round runs for real
 * (`openReviewWorkRoot` + `record_unknown_call_review`); the Workflow then
 * settles the record, automatically requeues after the attested Run and claims
 * the continuation. Read through `executions/read`, `tasks/query`, the prepared
 * manifest's brief and `unknown-call-reviews/read`.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { cleanupScenarios, HostScenario, hostCtx, performs, SCENARIO_OPERATOR } from './harness.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import {
  AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { preparedBriefOf } from './support/brief.js';

const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});

const seams = vi.hoisted(() => ({ shell: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shell as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});
seams.shell = shellSeam;

afterEach(async () => {
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

it('K3-28: the attestation reason and human stay on the Run; the continuation requeues after it; rework is counted once and the round is not counted', async () => {
  const h = await HostScenario.open({ automation: redrivePolicy(false), check: 'pass',
    script: { replies: [{ kind: 'text', text: 'K3-28: the continuation after the attested Run' }] } });
  const reason = 'K3-28: checked by hand';

  // --- The RUN-25-blocked crash (workspace_not_git) leaves an unknown Run. ----
  shellSeam.arm();
  const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-28-shell', name: 'shell',
    args: { command: 'k3-28 runs a program' } }] }]);
  const root = await openShellWorkRoot(h, model);
  let running: Promise<unknown> | null = null;
  let runRef: RunRef;
  try {
    const prepared = preparedOf(await prepareOn(root, h.select('k3-28', AG2B_WORK_TASK_ID)));
    runRef = prepared.claim.runRef;
    running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
      requestId: 'k3-28-start' });
    await shellSeam.waitForCall();
    await h.restart({ crash: true });
    // The stand-in stays blocked while the entry reads the draft.
    const unknown = await readExecution(h.host, runRef);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
    const attested = await h.post<WriteResult<unknown>>('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
      { runRef, reason }, 'k3-28-attest', [{ ref: runRef, revision: unknown.run.revision }]));
    expect(attested).toMatchObject({ status: 'committed' });
    expect(await reviewOf(h, runRef)).toMatchObject({ status: 'ready', value: {
      status: 'pending_review', origin: { kind: 'human_attested', reason,
        attestedBy: { kind: SCENARIO_OPERATOR.kind, id: SCENARIO_OPERATOR.id } } } });
  } finally {
    shellSeam.release();
    await running?.catch(() => undefined);
    await root.close();
  }

  // --- The real review round writes done/unlikely and ends. ------------------
  const reviewModel = createScriptedModel([
    { kind: 'calls', calls: [{ callId: 'k3-28-conclusion', name: 'record_unknown_call_review',
      args: { item: 1, verdict: 'done', evidence: 'the command finished before the crash',
        crashSuspicion: { verdict: 'unlikely', evidence: 'no crash trace' } } }] },
    { kind: 'text', text: 'K3-28 the review round wrote its conclusion' },
  ]);
  const reviewRoot = await openReviewWorkRoot(h, reviewModel);
  let roundRunRef: RunRef;
  try {
    const claimStop = await driveReviewUntil(reviewRoot, h.select('k3-28-review', AG2B_WORK_TASK_ID),
      performs('claim_task'));
    const startStop = await driveReviewUntil(reviewRoot, claimStop.stopped, performs('start'));
    const preparedRound = preparedOf(startStop.stopped);
    roundRunRef = preparedRound.claim.runRef;
    await reviewRoot.runtime.startRun(hostCtx(), { prepared: preparedRound, consumerId: AG2B_CONSUMER_ID,
      requestId: 'k3-28-review-start' });
    expect((await readExecution(h.host, roundRunRef)).run)
      .toMatchObject({ status: 'ended', outcome: 'completed' });
  } finally {
    await reviewRoot.close();
  }

  // --- settle_review, the automatic requeue after the attested Run, prepare. -
  const toContinue = await h.advance(h.select('k3-28-continue', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const kinds = toContinue.receipts.map(receipt => receipt.kind);
  expect(kinds).toContain('settle_review');
  expect(kinds).toContain('requeue_task');
  const continuation = preparedOf(toContinue.next);
  const brief = await preparedBriefOf(h, continuation.envelope.bundleRef);
  expect(brief.requeueRef, 'the continuation requeues after the attested Run').toMatchObject({
    afterRunId: runRef.runId });

  // --- The attested Run keeps the human and the reason. ----------------------
  const landed = await readExecution(h.host, runRef);
  expect(landed.run.reconciliation?.observation).toEqual({ kind: 'human_attested',
    attestedBy: { kind: SCENARIO_OPERATOR.kind, id: SCENARIO_OPERATOR.id }, reason });

  // --- Rework: one entry, class run_failed, after the attested Run. ----------
  const row = await h.taskRow();
  expect(row.rework).toMatchObject({ requeueAutoCount: 1, entries: [
    { afterRunRef: runRef, failureClass: 'run_failed', automatic: true, autoCount: 1,
      reason: 'auto-rework:run_failed#1' },
  ] });
  // The review round is not one of the counted rework Runs.
  expect(row.rework?.entries ?? []).toHaveLength(1);
  expect((row.rework?.entries ?? []).some(entry => entry.afterRunRef.runId === roundRunRef.runId)).toBe(false);
}, 300_000);
