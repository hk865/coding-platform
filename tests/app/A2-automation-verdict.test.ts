/**
 * A.2 step 5.8, part 1 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 5.8; §4
 * TD-9 AV-3, AV-4, AV-8, AV-9, AV-12; C8; LA-6; lead decision STEP5-FLIPS §14)
 * through the real Host over HTTP on one SQLite ledger and Kernel store:
 *
 * 1. The automation verdict is judged from the failure facts and the policy the
 *    Host installed: a FAIL is AV-12 `requeue`; `automation/save` lowers the cap
 *    to 0 with no restart and the verdict reads AV-8 at once (the capability
 *    report follows the same save); an operator requeue reads AV-3
 *    `claim_requeued`; a `no_new_basis` refusal reads AV-9. A non-PASS finalize
 *    goes back to `select_work` (result mapping). `goals/display` reduces the
 *    live verdict (GOAL-27 / GOAL-30); until part 2 that is a known transient
 *    (RUNNING "等待推进" for a FAIL the Workflow does not requeue yet).
 * 2. A Run that `start` returns ended with a failure (`crashed`) goes back to
 *    `select_work`; the verdict is AV-12 `requeue` of class `run_failed`.
 * 3. The successor-round rows AV-7a..AV-7d are 5.9: an INCONCLUSIVE round
 *    (`check_incomplete`) reads `none`, and its finalize still goes back to
 *    `select_work`.
 * 4. AV-4 kept as written (STEP5-FLIPS §14): an operator's pause superseded by
 *    the Run's natural completion (CTL-06) fences rework only; the verdict is
 *    `stopped/task_paused` while the round still opens, passes and completes
 *    the Task, and no TaskRequeue is written.
 *
 * The Workflow does not act on the verdict yet (step 5.8 part 2), so these
 * tests stop the Workflow before any selection that follows a failure. Scripted
 * model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PLATFORM_TOKEN_HEADER, type GoalDisplayHostReadV1, type RuntimeCapabilitiesResponse,
} from '../../src/app/core-http-types.js';
import {
  SETTINGS_API_PREFIX, type HostSettingsSnapshot, type SettingsResponse,
} from '../../src/app/host-settings-types.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { TaskAutomationPolicyV1, TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import {
  AG2B_GOAL_REF, AG2B_SCOPE, cleanupAG2b, graphWrite, plain, seedAG2bWorkGraph, startAG2bHost, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  advanceUntil, cleanupRestart, driveWorkflow, post, publicDirectory, readControl, readExecution, readGoal, selectWork,
  submitControl, TASK, workRow,
} from '../helpers/A2-restart-fixture.js';

afterEach(async () => {
  await cleanupAG2b();
  await cleanupRestart();
});

/** One `workflow/advance` call that must be ready. */
async function advance(host: AG2bHost, input: WorkflowAdvanceInput): Promise<Extract<WorkflowAdvanceResult, { status: 'ready' }>['value']> {
  const result = await post<WorkflowAdvanceResult>(host, 'workflow/advance', plain(AG2B_SCOPE, input));
  if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
  return result.value;
}

async function saveAutomation(host: AG2bHost, body: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
  const response = await fetch(new URL(`${SETTINGS_API_PREFIX}automation/save`, host.base), { method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: host.token }, body: JSON.stringify(body) });
  return await response.json() as SettingsResponse<HostSettingsSnapshot>;
}

async function recoverRunReason(host: AG2bHost): Promise<string> {
  const report = await post<RuntimeCapabilitiesResponse>(host, 'runtime/capabilities', plain(AG2B_SCOPE, AG2B_SCOPE));
  if (report.status !== 'ready') throw new Error(`the capability report must be ready: ${JSON.stringify(report)}`);
  return report.value.recoverRun.reason;
}

async function goalDisplay(host: AG2bHost): Promise<GoalDisplayHostReadV1['display']> {
  const read = await post<ReadResult<GoalDisplayHostReadV1>>(host, 'goals/display', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
  return read.value.display;
}

/** An operator `tasks/requeue` pinned to the Goal and the afterRun as they are now. */
async function operatorRequeue(host: AG2bHost, afterRunRef: RunRef, requestId: string): Promise<WriteResult<TaskRequeueOutcomeV1>> {
  const goal = await readGoal(host);
  const run = (await readExecution(host, afterRunRef)).run;
  return post<WriteResult<TaskRequeueOutcomeV1>>(host, 'tasks/requeue', graphWrite(AG2B_SCOPE,
    { taskRef: TASK, afterRunRef, reason: 'the result file is missing' }, requestId,
    [{ ref: AG2B_GOAL_REF, revision: goal.revision }, { ref: afterRunRef, revision: run.revision }]));
}

/** Drives the Workflow to the finalize of the selected Run's round, performs it and returns its answer. */
async function finalizeRound(host: AG2bHost, flowId: string): Promise<Extract<WorkflowAdvanceResult, { status: 'ready' }>['value']> {
  return advance(host, await advanceUntil(host, selectWork(flowId), 'finalize_checks'));
}

const RESUME_ON_STARTUP_OFF = 'This Host has automation.resumeOnStartup turned off';

it('C8 (§15.2 5.8): the verdict follows the failure facts and the live policy: FAIL → requeue, cap 0 → stopped, requeue → claim_requeued, no new basis → stopped', async () => {
  const host = await startAG2bHost(await publicDirectory(), { replies: [
    { kind: 'text', text: 'A2 verdict: Run 1 answers without the result file' },
    { kind: 'text', text: 'A2 verdict: Run 2 answers without the result file again' }] });
  try {
    await seedAG2bWorkGraph(host);
    // Result mapping: the FAIL finalize goes back to the selection, with the receipt kept.
    const finalized = await finalizeRound(host, 'a2-verdict-1');
    expect(finalized).toMatchObject({ state: 'advance', reason: null,
      next: { kind: 'select_work', flowId: 'a2-verdict-1', taskId: TASK.taskId },
      receipt: { kind: 'finalize_checks', result: { status: 'committed', value: { outcome: 'FAIL' } } } });
    // AV-12: class check_failed, nothing counted yet, the default cap 3.
    const failed = await workRow(host);
    expect(failed).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'check_failed' },
      failure: { failureClass: 'check_failed', automation: { cap: 3, requeueAutoCount: 0, coveringRequeue: null, lastRefusal: null,
        verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false } } } });
    // Known transient until step 5.8 part 2: `goals/display` already reduces the live verdict (GOAL-27
    // "等待推进" instead of GOAL-24 FAILED) while the Workflow does not requeue yet. Part 2 changes these
    // display assertions on purpose when the Workflow starts acting on the verdict.
    expect(await goalDisplay(host)).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null,
      causes: expect.arrayContaining([{ code: 'auto_rework_pending', taskId: TASK.taskId, operation: 'requeue', failureClass: 'check_failed' }]) });
    const run1Ref = failed.execution;
    if (run1Ref === null) throw new Error('Run 1 must be selected');

    // `automation/save` (LA-6): cap 0 and no start-up re-drive, installed with no restart.
    const off: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: false };
    expect(await saveAutomation(host, { autoReworkLimit: 0, resumeOnStartup: false }))
      .toMatchObject({ status: 'ready', value: { automation: off } });
    // AV-8: a counted automatic requeue would pass the cap.
    expect(await workRow(host)).toMatchObject({ failure: { automation: { cap: 0,
      verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'requeue' } } } } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
      cause: { code: 'auto_rework_cap_reached', taskId: TASK.taskId, detail: { operation: 'requeue' } } });
    // The capability report reads the same installed setting (5.7 `resumeOnStartup` sentence).
    expect(await recoverRunReason(host)).toContain(RESUME_ON_STARTUP_OFF);
    // A refused save changes nothing.
    expect(await saveAutomation(host, { autoReworkLimit: 11, resumeOnStartup: true }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await workRow(host)).toMatchObject({ failure: { automation: { cap: 0 } } });
    // Raising the cap again lifts the stop at once; the stored refusal-free facts are unchanged.
    expect(await saveAutomation(host, { autoReworkLimit: 3, resumeOnStartup: true }))
      .toMatchObject({ status: 'ready', value: { automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: true } } });
    expect(await workRow(host)).toMatchObject({ failure: { automation: { cap: 3,
      verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false } } } });
    expect(await recoverRunReason(host)).not.toContain(RESUME_ON_STARTUP_OFF);

    // AV-3: the operator's requeue covers Run 1; the verdict names it (no pinned budget).
    const requeued = await operatorRequeue(host, run1Ref, 'a2-verdict-requeue-1');
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue: ${JSON.stringify(requeued)}`);
    const requeueRef = requeued.value.requeue.ref;
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'pending', requeueRef, failure: { automation: {
      coveringRequeue: requeueRef, verdict: { kind: 'claim_requeued', requeueRef, budget: null } } } });

    // The Workflow claims the requeue (W-21); Run 2 fails the same way on the same source.
    const finalized2 = await finalizeRound(host, 'a2-verdict-2');
    expect(finalized2).toMatchObject({ state: 'advance', next: { kind: 'select_work' },
      receipt: { kind: 'finalize_checks', result: { status: 'committed', value: { outcome: 'FAIL' } } } });
    const failedAgain = await workRow(host);
    const run2Ref = failedAgain.execution;
    if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be the selected Run');
    expect((await readExecution(host, run2Ref)).run).toMatchObject({ requeueRef, outcome: 'completed' });
    // The operator requeue counted nothing: AV-12 again.
    expect(failedAgain).toMatchObject({ failure: { automation: { requeueAutoCount: 0,
      verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false } } } });

    // AV-9: a requeue with nothing new is the committed no_new_basis refusal; the verdict stops on it.
    const refused = await operatorRequeue(host, run2Ref, 'a2-verdict-requeue-2');
    if (refused.status !== 'committed' || refused.value.kind !== 'refused') throw new Error(`requeue 2: ${JSON.stringify(refused)}`);
    expect(refused.value.refusal).toMatchObject({ code: 'no_new_basis', matchedRequeueRef: requeueRef });
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'failed', failure: { automation: {
      lastRefusal: { code: 'no_new_basis', stale: false },
      verdict: { kind: 'stopped', reason: 'no_new_basis', detail: { operation: 'requeue' } } } } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
      cause: { code: 'no_new_basis', taskId: TASK.taskId, detail: { operation: 'requeue' } } });
    expect(host.scripted.calls(), 'one model call per Run').toBe(2);
  } finally {
    await host.host.close();
  }
}, 120_000);

it('§15.2 5.8 result mapping: a Run that start returns crashed goes back to select_work; the verdict is requeue run_failed', async () => {
  // No scripted reply: the first model request fails and the Kernel ends the Turn with run.failed.
  const host = await startAG2bHost(await publicDirectory(), { replies: [] });
  try {
    await seedAG2bWorkGraph(host);
    const started = await advance(host, await advanceUntil(host, selectWork('a2-verdict-crash'), 'start'));
    expect(started).toMatchObject({ state: 'advance', reason: null,
      next: { kind: 'select_work', flowId: 'a2-verdict-crash', taskId: TASK.taskId },
      receipt: { kind: 'start', result: { status: 'ready', value: { run: { status: 'ended', outcome: 'crashed' } } } } });
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'run_failed' },
      failure: { failureClass: 'run_failed', run: { outcome: 'crashed', origin: 'observed' },
        automation: { verdict: { kind: 'requeue', failureClass: 'run_failed', retryAfterRefusal: false } } } });
  } finally {
    await host.host.close();
  }
}, 120_000);

it('§15.2 5.8: check_incomplete reads none until 5.9 wires AV-7a..AV-7d; the INCONCLUSIVE finalize still goes back to select_work', async () => {
  const host = await startAG2bHost(await publicDirectory(), { replies: [{ kind: 'text', text: 'A2 verdict: the work is done' }] });
  try {
    await seedAG2bWorkGraph(host);
    const runCheck = await advanceUntil(host, selectWork('a2-verdict-incomplete'), 'run_check');
    // VD-8: the source changes after the round froze it, so the check ends its attempts and the round is INCONCLUSIVE.
    await writeFile(join(host.root, 'src', 'module.ts'), 'export const ag2bMarker = "A2_SOURCE_CHANGED_AFTER_OPEN";\n');
    const refused = await advance(host, runCheck);
    expect(refused).toMatchObject({ state: 'advance', next: { kind: 'perform', operation: { kind: 'finalize_checks' } } });
    if (refused.next === null) throw new Error('the Workflow must finalize');
    expect(await advance(host, refused.next)).toMatchObject({ state: 'advance', next: { kind: 'select_work' },
      receipt: { kind: 'finalize_checks', result: { status: 'committed', value: { outcome: 'INCONCLUSIVE' } } } });
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'round_inconclusive' },
      failure: { failureClass: 'check_incomplete', automation: { verdict: { kind: 'none' } } } });
  } finally {
    await host.host.close();
  }
}, 120_000);

it('AV-4 (STEP5-FLIPS §14): a pause superseded by the natural completion fences rework only; the round opens, passes and completes the Task', async () => {
  let host: AG2bHost | undefined;
  let pauseRef: Awaited<ReturnType<typeof submitControl>>['intent']['ref'] | undefined;
  host = await startAG2bHost(await publicDirectory(), {
    // The check passes without the result file, so the completed Run's round is PASS.
    checkCommand: 'node -e "console.log(\'A2_AV4_CHECK_OK\')"',
    replies: [{ kind: 'text', text: 'A2 AV-4: the work is done before any safe point' }],
    beforeReply: async (_request, index) => {
      if (index !== 0 || host === undefined) return;
      const runRef = (await workRow(host)).execution;
      if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
      // The operator pauses the running Turn; it completes before any safe point consumes the pause.
      pauseRef = (await submitControl(host, runRef, 'pause', 'operator pause before the Run finishes', 'a2-av4-pause')).intent.ref;
    },
  });
  try {
    await seedAG2bWorkGraph(host);
    const toOpen = await advanceUntil(host, selectWork('a2-av4'), 'open_checks');
    if (pauseRef === undefined) throw new Error('the pause must be submitted during the Turn');
    const row = await workRow(host);
    const runRef = row.execution;
    if (runRef === null) throw new Error('the work Task must have a Run');
    // CTL-06: the natural terminal superseded the queued pause; the pointer stays on the Run as history.
    expect((await readExecution(host, runRef)).run).toMatchObject({ status: 'ended', outcome: 'completed',
      controlState: { intentRef: pauseRef, desiredState: 'paused' } });
    expect(await readControl(host, pauseRef)).toMatchObject({ status: 'superseded',
      observation: { kind: 'terminal_without_cancel' } });
    // AV-4 in literal row order: the operator's pause pointer fences the Task (FC-12 has nothing to rework).
    expect(row).toMatchObject({ effectivePhase: 'verifying', phaseCause: { code: 'awaiting_verification' },
      failure: { failureClass: null, notReworkableCause: null, stop: { intentRef: pauseRef, kind: 'pause', requester: 'human' },
        automation: { verdict: { kind: 'stopped', reason: 'task_paused', detail: { fence: 'human_pause', pausedBy: 'human' } } } } });
    // `stopped` blocks rework only: the round opens, the check passes and the Task completes.
    const steps = await driveWorkflow(host, toOpen);
    expect(steps.map(step => step.receipt?.kind)).toEqual(['open_checks', 'run_check', 'finalize_checks', 'complete_task', undefined]);
    expect(steps.find(step => step.receipt?.kind === 'finalize_checks'))
      .toMatchObject({ receipt: { result: { status: 'committed', value: { outcome: 'PASS' } } } });
    expect(steps.at(-1)).toMatchObject({ state: 'completed' });
    const done = await workRow(host);
    expect(done).toMatchObject({ effectivePhase: 'satisfied', execution: runRef });
    expect(done.failure).toBeUndefined();
    // No TaskRequeue (nor any refusal) was written for the fenced Task.
    expect(done.rework).toBeUndefined();
    expect(done.requeueRef).toBeUndefined();
    expect(host.scripted.calls()).toBe(1);
  } finally {
    await host.host.close();
  }
}, 120_000);
