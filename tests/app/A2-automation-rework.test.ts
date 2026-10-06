/**
 * A.2 step 5.8, part 2 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 5.8; §4.3
 * "Workflow"; §4 TD-9 AV-3, AV-8, AV-9, AV-12; §2.1 GOAL-27, GOAL-30; §12.1
 * step 6b (a); §12.2 W-11, W-21, W-22, W-23; §13.4 #15, #17, #21; C8, LA-1, LA-6)
 * through the real Host over HTTP on one SQLite ledger and Kernel store:
 *
 * 1. C8 automatic rework: Run 1's round FAILs, the Workflow requeues the Task
 *    as `WORKFLOW_AUTOMATION_ACTOR` (counted 1 of 3) and claims the requeue in
 *    Run 1's Session (W-21); Run 2 passes, the gate passes and the Goal
 *    completes. No `tasks/requeue` and no operator action.
 * 2. The cap, the refusal and the other Tasks: with the cap 1 the second
 *    automatic requeue is never issued (AV-8, §13.4 #15; GOAL-30
 *    NEEDS_DECISION); raising the cap with `automation/save` lets the next
 *    推进 try it, the owner commits the `no_new_basis` refusal and the
 *    Workflow goes back to the selection (AV-9, GOAL-30); the Goal-level
 *    selection skips the stopped Task and runs the other one; that Run's end
 *    makes the refusal stale, the Workflow retries once with the refusal pin
 *    @1 (a new request), the changed source lets it through, and the Goal
 *    completes (W-22, §13.4 #21).
 * 3. Start-up re-drive condition (a) (§12.1 step 6b, LA-6, W-11, RUN-19): a
 *    Run interrupted mid-Turn ends `crashed`/`interrupted` at the restart; the
 *    re-drive selects its Goal, the Workflow requeues it without counting it
 *    (§13.4 #17), continues in a new Session (LA-1) and completes the Goal with
 *    no `workflow/advance`; with `resumeOnStartup` off the Goal is selected but
 *    nothing runs until a `workflow/advance`, and the requeue that answers is
 *    the same request from any flow, so another flow's retry replays the
 *    original receipt (W-23).
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import {
  PLATFORM_TOKEN_HEADER, type GoalDisplayHostReadV1, type TaskExecutionRecord,
} from '../../src/app/core-http-types.js';
import { SETTINGS_API_PREFIX, type HostSettingsSnapshot, type SettingsResponse } from '../../src/app/host-settings-types.js';
import type { ContinuationBriefV1 } from '../../src/contracts/continuation-brief.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, AG2B_WORK_TASK_ID, cleanupAG2b, plain, seedAG2bWorkGraph,
  startAG2bHost, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  advanceUntil, cleanupRestart, deferred, driveWorkflow, post, publicDirectory, readExecution, selectWork, tempDir, workRow,
  writeAutomationSettings, writeStaleLock, type AdvanceValue,
} from '../helpers/A2-restart-fixture.js';

afterEach(async () => {
  await cleanupAG2b();
  await cleanupRestart();
});

const WORK_2 = 'ag2b-work-2';
const EDIT_THEN_TEXT = (label: string): ScriptedReply[] => [
  { kind: 'calls', calls: [{ callId: `${label}-edit`, name: 'edit', args: { mode: 'create', path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
  { kind: 'text', text: `A2 ${label}: the result file is written` }];

async function goalDisplay(host: AG2bHost): Promise<GoalDisplayHostReadV1['display']> {
  const read = await post<ReadResult<GoalDisplayHostReadV1>>(host, 'goals/display', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
  return read.value.display;
}

async function saveAutomation(host: AG2bHost, autoReworkLimit: number): Promise<void> {
  const response = await fetch(new URL(`${SETTINGS_API_PREFIX}automation/save`, host.base), { method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: host.token },
    body: JSON.stringify({ autoReworkLimit, resumeOnStartup: true }) });
  expect(await response.json() as SettingsResponse<HostSettingsSnapshot>).toMatchObject({ status: 'ready',
    value: { automation: { autoReworkLimit } } });
}

async function readBrief(host: AG2bHost, runRef: RunRef): Promise<ContinuationBriefV1> {
  const read = await post<ReadResult<{ brief: ContinuationBriefV1 } | null>>(host, 'executions/brief', plain(AG2B_SCOPE, { runRef }));
  if (read.status !== 'ready' || read.value === null) throw new Error(`the brief must be readable: ${JSON.stringify(read)}`);
  return read.value.brief;
}

/** The receipts of `kind` in the order the Workflow produced them. */
function receiptsOf(steps: readonly AdvanceValue[], kind: string): unknown[] {
  return steps.flatMap(step => step.receipt !== null && step.receipt.kind === kind ? [step.receipt.result] : []);
}
/** The `requeue_task` requests the Workflow returned (performed by the next call). */
function requeueRequestsOf(steps: readonly AdvanceValue[]): unknown[] {
  return steps.flatMap(step => step.next !== null && step.next.kind === 'perform' && step.next.operation.kind === 'requeue_task'
    ? [step.next.operation.request] : []);
}
function finalizeOutcomes(steps: readonly AdvanceValue[]): unknown[] {
  return receiptsOf(steps, 'finalize_checks').map(result => (result as { value?: { outcome?: unknown } }).value?.outcome);
}

it('C8 (§15.2 5.8, AV-12, W-21): a FAILed round is requeued automatically, claimed in Run 1\'s Session, passes and completes the Goal', async () => {
  const host = await startAG2bHost(await publicDirectory(), { replies: [
    { kind: 'text', text: 'A2 rework: Run 1 answers without the result file' }, ...EDIT_THEN_TEXT('a2-rework-run2')] });
  try {
    await seedAG2bWorkGraph(host);
    const steps = await driveWorkflow(host, selectWork('a2-rework-1', true));
    expect(steps.at(-1), JSON.stringify(steps.map(step => [step.state, step.reason, step.receipt?.kind])))
      .toMatchObject({ state: 'completed', receipt: { kind: 'complete_goal', result: { status: 'committed' } } });
    // Run 1 FAILs, Run 2 passes, then the gate passes.
    expect(finalizeOutcomes(steps)).toEqual(['FAIL', 'PASS', 'PASS']);
    const [requeued, ...moreRequeues] = receiptsOf(steps, 'requeue_task');
    expect(moreRequeues).toEqual([]);
    expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: {
      failureClass: 'check_failed', basisComparison: 'compared', reason: 'auto-rework:check_failed#1',
      requestedBy: WORKFLOW_AUTOMATION_ACTOR, automation: { automatic: true, counted: true, autoCount: 1, cap: 3 } } } });
    // The requeue answer goes back to the selection, which claims the requeue (W-21).
    const requeueStep = steps.findIndex(step => step.receipt?.kind === 'requeue_task');
    expect(steps[requeueStep]).toMatchObject({ state: 'advance', next: { kind: 'select_work' } });
    expect(steps[requeueStep + 1]).toMatchObject({ state: 'advance', next: { kind: 'perform', operation: { kind: 'claim_task' } } });
    const requeueRef = (requeued as { value: { requeue: { ref: unknown; afterRunRef: RunRef } } }).value.requeue.ref;
    const run1Ref = (requeued as { value: { requeue: { afterRunRef: RunRef } } }).value.requeue.afterRunRef;

    const done = await workRow(host);
    expect(done).toMatchObject({ effectivePhase: 'satisfied', rework: { requeueAutoCount: 1, cap: 3,
      entries: [{ afterRunRef: run1Ref, failureClass: 'check_failed', automatic: true, autoCount: 1,
        requestedBy: WORKFLOW_AUTOMATION_ACTOR, reason: 'auto-rework:check_failed#1' }] } });
    const run2Ref = done.execution;
    if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be the selected Run');
    const run1: TaskExecutionRecord = await readExecution(host, run1Ref);
    const run2: TaskExecutionRecord = await readExecution(host, run2Ref);
    expect(run2.run).toMatchObject({ requeueRef, status: 'ended', outcome: 'completed' });
    // Run 1's Turn has a Kernel terminal, so the continuation stays in its Session.
    expect(run2.outbox.claim.sessionRef).toEqual(run1.outbox.claim.sessionRef);
    // C3: the brief names the automatic rework and its count.
    expect(await readBrief(host, run2Ref)).toMatchObject({ requeueRef, mode: 'rework', failureClass: 'check_failed',
      trigger: { actorClass: 'system', goalResume: false, requeueNumber: 1, autoRework: { count: 1, cap: 3 } } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'COMPLETED' });
    expect(host.scripted.calls(), 'Run 1, then Run 2 (edit and final text)').toBe(3);
  } finally {
    await host.host.close();
  }
}, 180_000);

it('§13.4 #15/#21, AV-8/AV-9, GOAL-27/30: the cap stops the automation, a raised cap meets a committed refusal, the other Task runs and the stale refusal is retried once', async () => {
  const host = await startAG2bHost(await publicDirectory(), { replies: [
    { kind: 'text', text: 'A2 cap: Run 1 answers without the result file' },
    { kind: 'text', text: 'A2 cap: Run 2 answers without the result file again' },
    ...EDIT_THEN_TEXT('a2-cap-work-2'),
    { kind: 'text', text: 'A2 cap: Run 4 finds the result file' }] });
  try {
    await seedAG2bWorkGraph(host, [AG2B_WORK_TASK_ID, WORK_2]);
    await saveAutomation(host, 1);

    // The first automatic requeue (1 of 1) runs; Run 2 FAILs the same way and the cap stops the automation:
    // the second request is never issued, so no refusal is written (AV-8, §13.4 #15).
    const capped = await driveWorkflow(host, selectWork('a2-cap-1'));
    expect(capped.at(-1)).toMatchObject({ state: 'waiting', next: null,
      reason: `the selected Task ${AG2B_WORK_TASK_ID} is not executable right now` });
    expect(finalizeOutcomes(capped)).toEqual(['FAIL', 'FAIL']);
    expect(receiptsOf(capped, 'requeue_task')).toMatchObject([{ status: 'committed', value: { kind: 'requeued',
      requeue: { automation: { automatic: true, counted: true, autoCount: 1, cap: 1 } } } }]);
    const stopped = await workRow(host);
    expect(stopped).toMatchObject({ effectivePhase: 'failed', failure: { automation: { cap: 1, requeueAutoCount: 1, lastRefusal: null,
      verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'requeue' } } } } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
      cause: { code: 'auto_rework_cap_reached', taskId: AG2B_WORK_TASK_ID, detail: { operation: 'requeue' } },
      causes: expect.arrayContaining([{ code: 'auto_rework_count', taskId: AG2B_WORK_TASK_ID, operation: 'requeue', n: 1, cap: 1 }]) });
    // Another 推进 of the stopped Task writes nothing and calls no model.
    expect(await driveWorkflow(host, selectWork('a2-cap-1-again'))).toMatchObject([{ state: 'waiting', next: null }]);
    expect(host.scripted.calls()).toBe(2);
    const run2Ref = stopped.execution;
    if (run2Ref === null) throw new Error('Run 2 must be the selected Run');

    // `automation/save` raises the cap: the stop lifts at once (GOAL-27 "等待推进").
    await saveAutomation(host, 3);
    expect(await workRow(host)).toMatchObject({ failure: { automation: { cap: 3,
      verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false } } } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', causes: expect.arrayContaining([
      { code: 'auto_rework_pending', taskId: AG2B_WORK_TASK_ID, operation: 'requeue', failureClass: 'check_failed' },
      { code: 'auto_rework_count', taskId: AG2B_WORK_TASK_ID, operation: 'requeue', n: 1, cap: 3 }]) });

    // The next 推进 tries it: nothing changed since Run 1's requeue, so the owner commits the no_new_basis
    // refusal; the committed refusal goes back to the selection, which now stops on it (AV-9).
    const refusedSteps = await driveWorkflow(host, selectWork('a2-cap-2'));
    expect(receiptsOf(refusedSteps, 'requeue_task')).toMatchObject([{ status: 'committed', value: { kind: 'refused',
      refusal: { revision: 1, code: 'no_new_basis', afterRunRef: run2Ref, requestedBy: WORKFLOW_AUTOMATION_ACTOR } } }]);
    expect(refusedSteps.find(step => step.receipt?.kind === 'requeue_task')).toMatchObject({ state: 'advance',
      next: { kind: 'select_work', taskId: AG2B_WORK_TASK_ID } });
    expect(refusedSteps.at(-1)).toMatchObject({ state: 'waiting', next: null });
    expect(await workRow(host)).toMatchObject({ failure: { automation: { lastRefusal: { code: 'no_new_basis', revision: 1, stale: false },
      verdict: { kind: 'stopped', reason: 'no_new_basis', detail: { operation: 'requeue' } } } } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
      cause: { code: 'no_new_basis', taskId: AG2B_WORK_TASK_ID, detail: { operation: 'requeue' } } });
    expect(host.scripted.calls()).toBe(2);

    // The Goal-level 推进 skips the stopped Task and runs the other one ("其它 Task 继续"), which writes the
    // result file. Its end makes the refusal stale (W-22): the Workflow retries once, pinning the refusal @1
    // (a new request), the changed source passes the key (§13.4 #21), Run 4 passes and the Goal completes.
    const finished = await driveWorkflow(host, selectWork('a2-cap-3', true));
    expect(finished.at(-1), JSON.stringify(finished.map(step => [step.state, step.reason, step.receipt?.kind])))
      .toMatchObject({ state: 'completed' });
    // work-2 first (work-1 is stopped), then work-1's requeue after the retry.
    const claims = receiptsOf(finished, 'claim_task') as Array<{ value: { task: { taskId: string } } }>;
    expect(claims.map(claim => claim.value.task.taskId)).toEqual([WORK_2, AG2B_WORK_TASK_ID]);
    expect(requeueRequestsOf(finished)).toMatchObject([{ input: { afterRunRef: run2Ref, reason: 'auto-rework:check_failed#2' },
      meta: { expected: [{ ref: AG2B_GOAL_REF }, { ref: run2Ref }, { ref: { aggregateType: 'TaskReworkRefusal',
        operation: 'requeue', subjectId: run2Ref.runId }, revision: 1 }] } }]);
    expect(receiptsOf(finished, 'requeue_task')).toMatchObject([{ status: 'committed', value: { kind: 'requeued',
      requeue: { afterRunRef: run2Ref, reason: 'auto-rework:check_failed#2', automation: { autoCount: 2, cap: 3 } } } }]);
    expect(await workRow(host, WORK_2)).toMatchObject({ effectivePhase: 'satisfied' });
    const work1 = await workRow(host);
    expect(work1).toMatchObject({ effectivePhase: 'satisfied', rework: { entries: [
      { automatic: true, autoCount: 1, reason: 'auto-rework:check_failed#1' },
      { automatic: true, autoCount: 2, reason: 'auto-rework:check_failed#2', afterRunRef: run2Ref }] } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'COMPLETED' });
    expect(host.scripted.calls(), 'Runs 1 and 2 of work-1, the two-step Run of work-2, Run 4 of work-1').toBe(5);
  } finally {
    await host.host.close();
  }
}, 240_000);

const READ_THEN_TEXT: ScriptedReply[] = [
  { kind: 'calls', calls: [{ callId: 'a2-redrive-read', name: 'read', args: { path: 'src/module.ts' } }] },
  { kind: 'text', text: 'A2 re-drive: never answered on the crashed Host' }];

/**
 * Host 1 enters the work Run; its Turn completes a `read` tool group, then the second model request
 * blocks (the Kernel Turn stays open) and the lock is rewritten as a crashed Host leaves it. `release`
 * fails the blocked request and closes Host 1 after the assertions.
 */
async function crashMidTurn(root: string, database: string, publicDir: string): Promise<{ runRef: RunRef; release(): Promise<void> }> {
  const reached = deferred();
  const hold = deferred();
  const host = await startAG2bHost(publicDir, { root, database, replies: READ_THEN_TEXT,
    beforeReply: async (_request, index) => {
      if (index === 0) return;
      reached.resolve();
      await hold.promise;
    } });
  await seedAG2bWorkGraph(host);
  const start = await advanceUntil(host, selectWork('a2-redrive-crash'), 'start');
  const inFlight = post(host, 'workflow/advance', plain(AG2B_SCOPE, start)).catch(() => undefined);
  await reached.promise;
  const runRef = (await workRow(host)).execution;
  if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
  await writeStaleLock(database);
  return { runRef, async release() {
    hold.reject(new Error('A2 crash: the crashed Host never answers this request'));
    await inFlight;
    await host.host.close();
  } };
}

it('§12.1 step 6b (a), W-11, RUN-19, §13.4 #17, LA-1: an interrupted Run is requeued by the start-up re-drive, uncounted, in a new Session; off, only a workflow/advance requeues it, with the same identity from any flow (W-23)', async () => {
  for (const resumeOnStartup of [true, false]) {
    const root = await tempDir('a2-redrive-ws-');
    const database = await tempDir('a2-redrive-db-');
    const publicDir = await publicDirectory();
    const crashed = await crashMidTurn(root, database, publicDir);
    if (!resumeOnStartup) await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false });
    const second = await startAG2bHost(publicDir, { root, database, replies: EDIT_THEN_TEXT('a2-redrive') });
    try {
      // W-11 at the restart; step 6b selects the Goal by condition (a) (verdict requeue, class interrupted) either way.
      expect(second.host.reconcile, String(resumeOnStartup)).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
        runs: [{ ref: JSON.stringify(crashed.runRef), row: 'W-11', status: 'reconciled', reason: 'interrupted_clean' }],
        redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }], problems: [] } });
      if (resumeOnStartup) {
        let display = await goalDisplay(second);
        for (let attempt = 0; attempt < 300 && display.phase !== 'COMPLETED'; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
          display = await goalDisplay(second);
        }
        expect(display, 'the start-up re-drive completed the Goal without a workflow/advance').toMatchObject({ phase: 'COMPLETED' });
        const done = await workRow(second);
        expect(done).toMatchObject({ effectivePhase: 'satisfied', rework: { requeueAutoCount: 0, entries: [{
          afterRunRef: crashed.runRef, failureClass: 'interrupted', automatic: true, autoCount: 0,
          requestedBy: WORKFLOW_AUTOMATION_ACTOR, reason: 'auto-rework:interrupted#0' }] } });
        const run2Ref = done.execution;
        if (run2Ref === null || run2Ref.runId === crashed.runRef.runId) throw new Error('the continuation Run must be selected');
        const run1 = await readExecution(second, crashed.runRef);
        const run2 = await readExecution(second, run2Ref);
        expect(run1.run).toMatchObject({ status: 'ended', outcome: 'crashed', reconciliation: { observation: { kind: 'interrupted_clean' } } });
        // LA-1: Run 1's Kernel Turn has no terminal, so its Session is retired and the continuation runs in a new one.
        expect(run1.session).toMatchObject({ health: 'unavailable', healthConclusion: 'kernel_turn_open' });
        expect(run2.run).toMatchObject({ outcome: 'completed' });
        expect(run2.session.ref.sessionId).not.toBe(run1.session.ref.sessionId);
        expect(await readBrief(second, run2Ref)).toMatchObject({ mode: 'resume_after_interruption', failureClass: 'interrupted',
          trigger: { actorClass: 'system', requeueNumber: 1 }, previous: { runRef: crashed.runRef } });
        expect(second.scripted.calls(), 'the continuation Run only').toBe(2);
      } else {
        // Off: the reconciliation ran, no driver started; the verdict waits for the next 推进.
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(second.scripted.calls(), 'no driver started').toBe(0);
        expect(await workRow(second)).toMatchObject({ effectivePhase: 'failed', failure: {
          failureClass: 'interrupted', interruption: { kind: 'executing' },
          automation: { verdict: { kind: 'requeue', failureClass: 'interrupted', retryAfterRefusal: false } } } });
        const next = await post<{ status: string; value: AdvanceValue }>(second, 'workflow/advance',
          plain(AG2B_SCOPE, selectWork('a2-redrive-later', true)));
        expect(next).toMatchObject({ status: 'ready', value: { state: 'advance', next: { kind: 'perform', operation: {
          kind: 'requeue_task', request: { input: { afterRunRef: crashed.runRef, reason: 'auto-rework:interrupted#0' } } } } } });
        // W-23: the request's identity is its own, not the flow's. The same step selected by another flow (another
        // driver, or a retry after a lost answer) replays the first one's receipt; one TaskRequeue is written.
        const other = await post<{ status: string; value: AdvanceValue }>(second, 'workflow/advance',
          plain(AG2B_SCOPE, selectWork('a2-redrive-other')));
        const request = (value: AdvanceValue): unknown =>
          value.next?.kind === 'perform' && value.next.operation.kind === 'requeue_task' ? value.next.operation.request : null;
        expect(request(other.value)).toEqual(request(next.value));
        const first = await post<{ status: string; value: AdvanceValue }>(second, 'workflow/advance', plain(AG2B_SCOPE, next.value.next));
        expect(first).toMatchObject({ status: 'ready', value: { state: 'advance', next: { kind: 'select_work' },
          receipt: { kind: 'requeue_task', result: { status: 'committed', replayed: false, value: { kind: 'requeued' } } } } });
        const replayed = await post<{ status: string; value: AdvanceValue }>(second, 'workflow/advance', plain(AG2B_SCOPE, other.value.next));
        const firstResult = first.value.receipt?.kind === 'requeue_task' ? first.value.receipt.result : null;
        expect(replayed).toMatchObject({ status: 'ready', value: { state: 'advance', next: { kind: 'select_work', flowId: 'a2-redrive-other' },
          receipt: { kind: 'requeue_task', result: { status: 'committed', replayed: true,
            value: (firstResult as { value?: unknown } | null)?.value } } } });
        expect(await workRow(second)).toMatchObject({ effectivePhase: 'pending',
          rework: { entries: [{ afterRunRef: crashed.runRef, reason: 'auto-rework:interrupted#0' }] } });
        expect(((await workRow(second)).rework as { entries: unknown[] }).entries).toHaveLength(1);
        expect(second.scripted.calls(), 'performing the requeue calls no model').toBe(0);
      }
    } finally {
      await crashed.release();
      await second.host.close();
    }
  }
}, 360_000);
