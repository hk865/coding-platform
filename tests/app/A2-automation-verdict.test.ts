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
 *    live verdict (GOAL-27 RUNNING "等待推进" while the next 推进 would requeue,
 *    GOAL-30 NEEDS_DECISION once it stops).
 * 2. A Run that `start` returns ended with a failure (`crashed`) goes back to
 *    `select_work`; the verdict is AV-12 `requeue` of class `run_failed`.
 * 3. AV-7d (5.9 part 2): an INCONCLUSIVE round (`check_incomplete`) reads
 *    `reverify`; the next selection performs `reverify_round` as the platform
 *    automation (`auto-reverify:check_incomplete#1`), the successor round runs on
 *    the same Run and passes, and the Goal completes with no further model call.
 * 4. (Moved in A.2 step 6 to tests/scenarios/C8-human-stop-respected.test.ts:
 *    AV-4 kept as written, STEP5-FLIPS §14.)
 *
 * These tests read the verdict, so they stop the Workflow before any selection
 * that follows a failure: since step 5.8 part 2 that selection acts on the
 * verdict (the automatic requeue is tests/scenarios/A1-rework-same-session.test.ts).
 * Scripted model replies only; no real model is called.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PLATFORM_TOKEN_HEADER, type GoalDisplayHostReadV1, type RuntimeCapabilitiesResponse, type TaskRow,
} from '../../src/app/core-http-types.js';
import {
  SETTINGS_API_PREFIX, type HostSettingsSnapshot, type SettingsResponse,
} from '../../src/app/host-settings-types.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { WORKFLOW_AUTOMATION_ACTOR, type TaskAutomationPolicyV1, type TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import { LOCAL_WORKBENCH_ROLE, LOCAL_WORKBENCH_TEMPLATE_ID } from '../../src/app/runtime-configuration.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import {
  AG2B_GOAL_REF, AG2B_SCOPE, cleanupAG2b, graphWrite, plain, seedAG2bWorkGraph, startAG2bHost, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  advanceUntil, cleanupRestart, driveWorkflow, post, publicDirectory, readExecution, readGoal, selectWork, TASK, workRow,
} from '../helpers/A2-restart-fixture.js';
import { g8Check, g8PlanCall, g8PlanDraft, g8PlanForm, openG8Project } from '../helpers/G8-world.js';
import { adoptWithChecks } from '../helpers/G8B-world.js';
import { initializeProject, threeIdeas } from '../helpers/S6A-history-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { committed, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { linkS7D2Scopes } from '../helpers/S7D2-role-line-world.js';
import { taskRowOf, waitFor } from '../scenarios/harness.js';

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

const RESUME_ON_STARTUP_OFF = '启动时只核对，不续做、不处理排队';

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
    // GOAL-27 (C8): a pending automatic rework is RUNNING "等待推进", not GOAL-24 FAILED; the next 推进 performs it
    // (step 5.8 part 2: the read-only selection answers the automatic requeue, not performed here).
    expect(await goalDisplay(host)).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null,
      causes: expect.arrayContaining([{ code: 'auto_rework_pending', taskId: TASK.taskId, operation: 'requeue', failureClass: 'check_failed' }]) });
    expect(await advance(host, selectWork('a2-verdict-peek'))).toMatchObject({ state: 'advance', receipt: null,
      next: { kind: 'perform', operation: { kind: 'requeue_task', request: { input: { reason: 'auto-rework:check_failed#1' } } } } });
    const run1Ref = failed.execution;
    if (run1Ref === null) throw new Error('Run 1 must be selected');

    // `automation/save` (LA-6): cap 0 and no start-up re-drive, installed with no restart.
    const off: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: 'off' };
    expect(await saveAutomation(host, { autoReworkLimit: 0, resumeOnStartup: 'off' }))
      .toMatchObject({ status: 'ready', value: { automation: off } });
    // AV-8: a counted automatic requeue would pass the cap.
    expect(await workRow(host)).toMatchObject({ failure: { automation: { cap: 0,
      verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'requeue' } } } } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
      cause: { code: 'auto_rework_cap_reached', taskId: TASK.taskId, detail: { operation: 'requeue' } } });
    // The capability report reads the same installed setting (5.7 `resumeOnStartup` sentence).
    expect(await recoverRunReason(host)).toContain(RESUME_ON_STARTUP_OFF);
    // A refused save changes nothing.
    expect(await saveAutomation(host, { autoReworkLimit: 11, resumeOnStartup: 'auto' }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await workRow(host)).toMatchObject({ failure: { automation: { cap: 0 } } });
    // Raising the cap again lifts the stop at once; the stored refusal-free facts are unchanged.
    expect(await saveAutomation(host, { autoReworkLimit: 3, resumeOnStartup: 'auto' }))
      .toMatchObject({ status: 'ready', value: { automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'auto' } } });
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

it('§15.2 5.9 (AV-7d, C5): check_incomplete reads reverify; the Workflow opens the successor round as the automation and the Goal completes', async () => {
  const host = await startAG2bHost(await publicDirectory(), { replies: [
    { kind: 'calls', calls: [{ callId: 'a2-verdict-edit', name: 'edit', args: { mode: 'create', path: 'src/ag2b-result.txt',
      newText: 'AG2B_RESULT_FROM_A' } }] },
    { kind: 'text', text: 'A2 verdict: the work is done' }] });
  try {
    await seedAG2bWorkGraph(host);
    const runCheck = await advanceUntil(host, selectWork('a2-verdict-incomplete'), 'run_check');
    // VD-8: the source changes after the round froze it, so the check ends its attempts and the round is INCONCLUSIVE.
    await writeFile(join(host.root, 'src', 'module.ts'), 'export const ag2bMarker = "A2_SOURCE_CHANGED_AFTER_OPEN";\n');
    const refused = await advance(host, runCheck);
    expect(refused).toMatchObject({ state: 'advance', next: { kind: 'perform', operation: { kind: 'finalize_checks' } } });
    if (refused.next === null) throw new Error('the Workflow must finalize');
    const finalized = await advance(host, refused.next);
    expect(finalized).toMatchObject({ state: 'advance', next: { kind: 'select_work' },
      receipt: { kind: 'finalize_checks', result: { status: 'committed', value: { outcome: 'INCONCLUSIVE' } } } });
    if (finalized.receipt?.kind !== 'finalize_checks' || finalized.receipt.result.status !== 'committed') throw new Error('finalize');
    const r1 = finalized.receipt.result.value.snapshot;
    // AV-7d: the verdict asks a successor round on the finalized head, without a source condition.
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'round_inconclusive' },
      failure: { failureClass: 'check_incomplete', round: { roundRef: r1.ref, revision: r1.revision },
        automation: { verdict: { kind: 'reverify', roundRef: r1.ref, needsFinalize: false, onlyIfSourceChanged: false,
          failureClass: 'check_incomplete', retryAfterRefusal: false } } } });
    // GOAL-27: a pending automatic re-verification is RUNNING "等待推进".
    expect(await goalDisplay(host)).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null,
      causes: expect.arrayContaining([{ code: 'auto_rework_pending', taskId: TASK.taskId, operation: 'reverify',
        failureClass: 'check_incomplete' }]) });

    // The next selection performs reverify_round as the platform automation (pins: the head and the absent refusal).
    const selected = await advance(host, selectWork('a2-verdict-incomplete-2'));
    expect(selected).toMatchObject({ state: 'advance', receipt: null, next: { kind: 'perform', operation: { kind: 'reverify_round',
      request: { input: { predecessorRoundRef: r1.ref, reason: 'auto-reverify:check_incomplete#1' }, meta: { expected: [
        { ref: r1.ref, revision: r1.revision }, { ref: { aggregateType: 'TaskReworkRefusal', projectId: TASK.projectId,
          goalId: TASK.goalId, taskId: TASK.taskId, operation: 'reverify', subjectId: r1.ref.roundId }, revision: 0 }] } } } } });
    if (selected.next === null) throw new Error('the Workflow must re-verify');
    const reverified = await advance(host, selected.next);
    expect(reverified).toMatchObject({ state: 'advance', next: { kind: 'select_work' }, receipt: { kind: 'reverify_round',
      result: { status: 'committed', value: { kind: 'reverified', round: { status: 'open', subjectRunRef: r1.subjectRunRef,
        chain: { ordinal: 2, predecessorRoundRef: r1.ref, autoCount: 1, reverify: { actorClass: 'system',
          requestedBy: WORKFLOW_AUTOMATION_ACTOR, failureClass: 'check_incomplete', exemption: 'none', sourceChanged: true,
          reason: 'auto-reverify:check_incomplete#1' } } } } } } });
    // TASK-29: the Task follows the open successor head; GOAL-27 counts the automatic re-verification.
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'verifying',
      phaseCause: { code: 'verification_running', detail: { ordinal: 2, predecessorRoundRef: r1.ref } } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'RUNNING',
      causes: expect.arrayContaining([{ code: 'auto_rework_count', taskId: TASK.taskId, operation: 'reverify', n: 1, cap: 3 }]) });
    // The successor's check runs on the same Run and passes; the Task, the gate and the Goal complete.
    if (reverified.next === null) throw new Error('the Workflow must select again');
    const steps = await driveWorkflow(host, reverified.next);
    expect(steps.at(-1)).toMatchObject({ state: 'completed' });
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'satisfied' });
    const goalSteps = await driveWorkflow(host, selectWork('a2-verdict-incomplete-goal', true));
    expect(goalSteps.at(-1)).toMatchObject({ state: 'completed', receipt: { kind: 'complete_goal' } });
    expect(await goalDisplay(host)).toMatchObject({ phase: 'COMPLETED' });
    // A successor round builds no Run: the one Run's two model calls.
    expect(host.scripted.calls()).toBe(2);
  } finally {
    await host.host.close();
  }
}, 120_000);

// ---------------------------------------------------------------------------
// RC (7D2): a person's adoption of a candidate that changes a failed check's
// definition lets the next selection re-verify the failed work head (AV-7e,
// VR-14, §15.2 5.9) instead of requeueing it (AV-12). T1/T2 are the TDD red
// lines until the production package lands; T3/T4 guard the "only an adopted
// plan check changed" limit and are green today.
// ---------------------------------------------------------------------------

type RCScope = { projectId: string; workspaceId: string };
const rcCloses: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.allSettled(rcCloses.splice(0).reverse().map(close => close())); });

type RCQueueCause = { taskRef: TaskTriple | null; code: string };
/** The queue's goal-cause cards as `{ taskRef, code }`: the Task and the generic cause code, never only
 *  the source key or the action behind the cause (`rc-rulings.md` §4 T2 `:256`; R-3 `:200-201`). */
async function rcWaitingCauses(world: S6AHostWorld, scope: RCScope, goal: GoalRef): Promise<RCQueueCause[]> {
  const answer = await world.post('decisions/queue', plain(scope, { workspace: scope, goalRef: goal,
    sections: ['waiting_answer'], page: { limit: 100 } }));
  const body = answer.body as ReadResult<DecisionQueueReadV1>;
  if (body.status !== 'ready') throw new Error(`decisions/queue must be readable: ${JSON.stringify(body)}`);
  return body.value.waitingAnswer.flatMap(card => {
    if (card.source.kind !== 'goal_cause') return [];
    const cause = JSON.parse(card.source.key) as { code?: unknown };
    return typeof cause.code === 'string' ? [{ taskRef: card.taskRef, code: cause.code }] : [];
  });
}

/** The main scope's world: an adopted plan whose `g8-r1-check` fails on a real work Run. */
async function rcFailingWorkWorld(tag: string, autonomy: 'after_plan_confirmation' | 'every_step') {
  const world = await openS6AHostWorld({ backend: 'memory',
    workspaceGrants: { writePrefixes: ['.'], allowCommands: true } });
  rcCloses.push(() => world.close());
  await initializeProject(world);
  const goal = (await s6aCardsWorkspace(world, S6A_SCOPE).createGoal(`${tag}-goal`, `${tag} RC world`)).ref;
  await setS7AAutonomy(world, goal, autonomy);
  const role = S6A_WORK_ROLE.templateId;
  await adoptWithChecks(world, S6A_SCOPE, goal, `${tag}-base`,
    [g8Check('g8-r1-check', 'all', 'test -f g8-r1-result.txt')], g8PlanDraft(goal, `${tag}-base`, role));
  const line = await world.createWorkSession(`${tag}-exec`);
  const taskId = `${tag}-base-work`;
  await linkS7D2Scopes(world, { line, targets: [{ kind: 'task', ref: { projectId: goal.projectId,
    goalId: goal.goalId, taskId } }], label: `${tag}-link` });
  await world.scripted.script(line, [{ kind: 'text', text: `${tag} work text` }], S6A_SCOPE);
  return { world, goal, line, taskId };
}

function rcSelect(world: S6AHostWorld, goal: GoalRef, line: S6ASession, taskId: string, flowId: string): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: goal, flowId, sessionHint: line.ref, kind: 'select_work', taskId };
}

/** Runs the one work Task to `finalize_checks` and performs it; the answer must be a FAIL finalize. */
async function rcFailWork(world: S6AHostWorld, goal: GoalRef, line: S6ASession, taskId: string, tag: string) {
  const toFinalize = await advanceUntil(world.ag2b, rcSelect(world, goal, line, taskId, `${tag}-run`), 'finalize_checks');
  return await advance(world.ag2b, toFinalize);
}

/** `plans/propose` of a future revision on the active plan, with its checks beside the draft. */
async function rcProposeChange(world: S6AHostWorld, scope: RCScope, goal: GoalRef, tag: string,
  baseTag: string, checks: object[], role = S6A_WORK_ROLE.templateId) {
  const answer = await world.post('tasks/query', plain(scope, { goalRef: goal }));
  const body = answer.body as ReadResult<{ plan: { ref: PlanRevisionRef; planRevision: number } }>;
  if (body.status !== 'ready') throw new Error(`the active plan must be readable: ${JSON.stringify(body)}`);
  const draft = { ...g8PlanDraft(goal, baseTag, role), planId: `${tag}-change-plan`,
    planRevision: body.value.plan.planRevision + 1 };
  return committed<{ ref: unknown; revision: number }>(await world.post('plans/propose', graphWrite(scope, {
    goalRef: goal, basedOn: body.value.plan.ref, draft, checks, reason: { text: tag, sources: [] },
  }, `${tag}-change-propose`)), `${tag}: propose`);
}

async function rcApply(world: S6AHostWorld, scope: RCScope, tag: string, proposal: { ref: unknown; revision: number }) {
  const answer = await world.post('plans/apply', graphWrite(scope, { proposalRef: proposal.ref,
    expectedProposalRevision: proposal.revision, decisionRefs: [] }, `${tag}-change-apply`));
  return answer.body as { status?: string; code?: string; reason?: string };
}

it.each([
  { row: 'T1', autonomy: 'after_plan_confirmation' as const },
  { row: 'T2', autonomy: 'every_step' as const },
])('$row: a person\'s adopted replacement of the failed check makes the next selection re-verify the work head ($autonomy)',
  async ({ row, autonomy }) => {
    // Red today at the adoption, not at the later `workflow/advance`: `adoptWithPlanChecks`
    // reads `proposedCheckSplit`, which has no `replaced` bucket, so the same `checkId` with
    // the new command is the `notInstalled('invalid', …)` conflict (`host-settings.ts:1761-1762`).
    // Named mutations, unproven until production lands: T1 = change AV-7e's `return` to
    // `return null`; T2 = lift the release out of the action branch, i.e. make
    // `checkAdoptionConfirmed` (or `releasedBy:'check_adoption'`) in
    // `automationConfirmationCause`/`legacyDecisionActionPolicy` release every automation action,
    // not only `auto_reverify`. T2 itself still sees no card and still re-verifies, but the
    // `system_requeue + checkAdoptionConfirmed` row in `K3-18-requeue-confirmed-pure` goes red
    // (it gets `null` instead of the card) and T3/T4 lose their `system_requeue` card.
    const tag = `a2-${row.toLowerCase()}`;
    const { world, goal, line, taskId } = await rcFailingWorkWorld(tag, autonomy);
    const failed = await rcFailWork(world, goal, line, taskId, tag);
    expect(failed.receipt).toMatchObject({ kind: 'finalize_checks',
      result: { status: 'committed', value: { outcome: 'FAIL' } } });
    expect(await taskRowOf((await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal })))
      .body as ReadResult<{ tasks: TaskRow[] }>, taskId)).toMatchObject({ failure: {
      failureClass: 'check_failed', automation: { verdict: { kind: 'requeue' } } } });

    const replacement = await rcProposeChange(world, S6A_SCOPE, goal, tag, `${tag}-base`,
      [g8Check('g8-r1-check', 'all', 'test -f g8-r1-new-result.txt')]);
    const adopted = await rcApply(world, S6A_SCOPE, tag, replacement);
    expect(adopted, `the same check id with a new command is adopted as a replacement: ${JSON.stringify(adopted)}`)
      .toMatchObject({ status: 'committed' });

    if (autonomy === 'every_step') {
      // R-3 (`rc-rulings.md:200-201`, §4 T2 `:256`): adoption is the confirmation, so this Task's
      // queue has no `automation_confirmation_required` card. The card is checked by its `taskRef`
      // and the generic cause code; the action is read from the selection's own
      // `auto-reverify:check_failed#1` reason below.
      // (Unreachable today because the adoption is red first: today `decision-policy.ts:113-116`
      // turns an `every_step` `auto_reverify` into `needs_decision`, i.e. an `auto_reverify` card.)
      expect(await rcWaitingCauses(world, S6A_SCOPE, goal),
        'the auto_reverify confirmation card must not be in the queue').not.toContainEqual({
        taskRef: { projectId: goal.projectId, goalId: goal.goalId, taskId },
        code: 'automation_confirmation_required' });
    }
    const selected = await advance(world.ag2b, rcSelect(world, goal, line, taskId, `${tag}-select`));
    expect(selected, 'the failed head is re-verified, not requeued').toMatchObject({ state: 'advance',
      next: { kind: 'perform', operation: { kind: 'reverify_round',
        request: { input: { reason: 'auto-reverify:check_failed#1' } } } } });
    if (selected.next === null) throw new Error('the Workflow must re-verify');
    const reverified = await advance(world.ag2b, selected.next);
    expect(reverified).toMatchObject({ receipt: { kind: 'reverify_round', result: { status: 'committed', value: {
      round: { chain: { ordinal: 2, autoCount: 1, reverify: { actorClass: 'system' } } } } } } });
  }, 120_000);

const RC_SHARED_TAG = 'a2-t3t4';
/** T3/T4 build their one shared world before both rows; its real Host setup gets the file's 120 s budget. */
const RC_SHARED_SETUP_MS = 120_000;
type RCReverseWorld = {
  project: Awaited<ReturnType<typeof openG8Project>>;
  goal: GoalRef;
  line: S6ASession;
  taskId: string;
  newCheck: ReturnType<typeof g8Check>;
};

/** T3/T4 share one world (ruling :261, :385): a G8 project whose plan check fails on a real work Run, then two
 *  non-plan sources of a changed definition are applied to the same failed head in turn. */
async function rcReverseWorld(tag: string): Promise<RCReverseWorld> {
  const newCheck = g8Check('g8-r1-check', 'all', 'test -f g8-t4-new-result.txt');
  const oldCheck = g8Check('g8-r1-check', 'all', 'test -f g8-t4-result.txt');
  const project = await openG8Project(tag, [newCheck]);
  try {
    const withdrawn = await project.world.settings('checks/withdraw', { scope: project.scope, checkId: 'g8-r1-check' });
    if (withdrawn.status !== 'ready') throw new Error(`checks/withdraw: ${JSON.stringify(withdrawn)}`);
    // The Goal card is every_step: the driver pauses on the system_requeue card after the FAIL, so the head
    // stays failed for both rows. (`g8NewGoal` cannot be reused here: its card is after_plan_confirmation, and
    // setting every_step after the plan round bumps the Goal revision, so `plans/apply` conflicts; setting it
    // after apply lets the auto-requeue start first.)
    const secretary = await project.line(`${tag}-secretary`);
    await project.world.scripted.script(secretary, [
      { kind: 'calls', calls: [{ callId: `${tag}-ideas`, name: 'submit_secretary_answer', args: {
        body: `${tag} ideas`, ideas: threeIdeas(`${tag}-new`), goalCardDrafts: [{ objective: `${tag}-new goal`,
          completion: [`${tag}-new goal is done`], autonomy: 'every_step', screening: null }] } }] },
      g8PlanCall(`${tag}-plan`, g8PlanForm(`${tag}-new`, LOCAL_WORKBENCH_TEMPLATE_ID, [oldCheck]))], project.scope);
    const asked = await project.ask(`${tag}-new`, secretary);
    const goal = committed<{ goal: { ref: GoalRef } }>(await project.world.post('goals/confirm-draft',
      plain(project.scope, { commandId: `${tag}-confirm`, round: asked.round, index: 0 })), `${tag}: confirm draft`).goal.ref;
    const chosen = await project.post('requests/select-idea', plain(project.scope,
      { commandId: `${tag}-select`, round: asked.round, index: 0 })) as { status: string; followupRound: never };
    if (chosen.status !== 'queued') throw new Error(`requests/select-idea: ${JSON.stringify(chosen)}`);
    await project.roundEnded(asked.requestRoot, chosen.followupRound);
    const line = await project.line(`${tag}-exec`, LOCAL_WORKBENCH_ROLE);
    await project.world.scripted.script(line, [{ kind: 'text', text: `${tag} work text` }], project.scope);
    const first = await project.candidate(goal, asked.requestRoot);
    const applied = await project.apply(goal, first, `${tag}-apply`) as { status?: string };
    if (applied.status !== 'committed') throw new Error(`the first plan was not adopted: ${JSON.stringify(applied)}`);
    const taskId = `${tag}-new-work`;
    const failed = await waitFor(async () => taskRowOf((await project.world.post('tasks/query',
      plain(project.scope, { goalRef: goal }))).body as ReadResult<{ tasks: TaskRow[] }>, taskId),
    row => row.failure?.failureClass === 'check_failed', 'the work Task to read check_failed');
    if (failed.failure?.automation.verdict?.kind !== 'requeue') {
      throw new Error(`the failed Task must read requeue: ${JSON.stringify(failed.failure)}`);
    }
    return { project, goal, line, taskId, newCheck };
  } catch (error) {
    await project.close();
    throw error;
  }
}

describe('T3/T4: a non-plan source of a changed failed check still requeues', () => {
  let shared: RCReverseWorld;
  beforeAll(async () => { shared = await rcReverseWorld(RC_SHARED_TAG); }, RC_SHARED_SETUP_MS);
  afterAll(async () => { if (shared !== undefined) await shared.project.close(); });

  it('T3: a candidate that changes another check still reads AV-12 requeue and keeps the every_step system_requeue card', async () => {
    // Green today (§4 T3 `rc-rulings.md:257`): the failed check's definition is unchanged, so the
    // failed work head requeues. This guards a production derivation that compares only
    // `configurationRevision` (named mutation: derive the change from `configurationRevision` alone).
    const { project, goal, line, taskId } = shared;
    const tag = 'a2-t3';
    const unrelated = await rcProposeChange(project.world, project.scope, goal, tag, `${RC_SHARED_TAG}-new`,
      [g8Check('g8-r1-unrelated', 'all', 'true')], LOCAL_WORKBENCH_TEMPLATE_ID);
    const unrelatedApplied = await rcApply(project.world, project.scope, tag, unrelated);
    expect(unrelatedApplied, JSON.stringify(unrelatedApplied)).toMatchObject({ status: 'committed' });
    const waited = await project.world.post('workflow/advance', plain(project.scope,
      rcSelect(project.world, goal, line, taskId, `${tag}-select`)));
    expect(waited.body, 'every_step asks before the system requeue').toMatchObject({ status: 'ready',
      value: { state: 'waiting', next: null, reason: 'automation_confirmation_required:system_requeue' } });
    expect(await rcWaitingCauses(project.world, project.scope, goal),
      'every_step shows the automation confirmation card for this Task').toContainEqual({
      taskRef: { projectId: goal.projectId, goalId: goal.goalId, taskId },
      code: 'automation_confirmation_required' });
  }, 120_000);

  it('T4: the failed check changed by checks/approve, not by a plan adoption, still requeues and keeps its every_step card', async () => {
    // Green today (§4 T4 `rc-rulings.md:258`): `checkAdoptionConfirmed` is false for an
    // approved_list origin. This guards a production package that lets `approved_list`/startup
    // configuration through as well (named mutation: delete the `adoptedPlanChecks` filter).
    // The seed Answer proposes `g8-r1-check` with the NEW command. It is withdrawn, so the
    // Goal's first plan installs the same id with the OLD command as a plan check and the
    // failed round freezes that old definition; `checks/approve` then puts the answer's new
    // definition back as an approved_list check. The change is real, but it is not an adoption.
    const { project, goal, line, taskId, newCheck } = shared;
    const tag = 'a2-t4';
    const approved = await project.world.settings('checks/approve', { scope: project.scope,
      answerRef: project.seedAnswer, checks: [newCheck] });
    expect(approved.status, JSON.stringify(approved)).toBe('ready');
    expect(await taskRowOf((await project.world.post('tasks/query', plain(project.scope, { goalRef: goal })))
      .body as ReadResult<{ tasks: TaskRow[] }>, taskId)).toMatchObject({ failure: {
      failureClass: 'check_failed', automation: { verdict: { kind: 'requeue' } } } });
    const waited = await project.world.post('workflow/advance', plain(project.scope,
      rcSelect(project.world, goal, line, taskId, `${tag}-select`)));
    expect(waited.body, 'every_step asks before the system requeue').toMatchObject({ status: 'ready',
      value: { state: 'waiting', next: null, reason: 'automation_confirmation_required:system_requeue' } });
    expect(await rcWaitingCauses(project.world, project.scope, goal),
      'every_step shows the automation confirmation card for this Task').toContainEqual({
      taskRef: { projectId: goal.projectId, goalId: goal.goalId, taskId },
      code: 'automation_confirmation_required' });
  }, 120_000);
});
