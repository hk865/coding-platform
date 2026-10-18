/**
 * Help code of the receipts group (tests/scenarios/A4-duplicate-receipts.test.ts,
 * tests/scenarios/A11-no-progress.test.ts) over the shared harness
 * (tests/scenarios/harness.ts) and the help code other groups use too (./common.ts).
 *
 * - `performOnce`: one Workflow call on the live Host, checked like a step of
 *   `advance()` (the invariants with the receipt's `FuzzStep`), so a scenario can
 *   send the same request twice (a lost answer) or keep a request for later.
 * - `failCommitOf`: the §12.9 "单笔提交中途崩溃" without a `src` seam. A SQLite
 *   trigger on the ledger aborts the transaction that appends one event type at
 *   its LAST write (the idempotency row, after the events and snapshots of the
 *   same transaction were written), so the record store rolls the whole
 *   transaction back exactly as a process dying before `COMMIT` would leave the
 *   file. No record is changed or forged; the trigger is dropped before the Host
 *   restarts.
 * - small readers of the ledger and Kernel files the counters do not cover, the
 *   operator's `tasks/requeue` with the body it sent, and the raw answer of a
 *   route whose commit failed (`rawPost`, `writeStatusOf`).
 * - platform mode: `requeueTask` as the operator or the automation actor, a
 *   W16 adoption (`adoptPlan`, as the C7 platform tests build it), and a checks
 *   configuration of two registered checks (`registerTwoChecks`).
 * - the helpers of the case moved from tests/app/A2-automation-rework.test.ts
 *   (test 2), unchanged.
 *
 * Scripted model replies only; no real model is called.
 */
import { expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { PLATFORM_TOKEN_HEADER, type TaskExecutionRecord, type WorkbenchActor } from '../../../src/app/core-http-types.js';
import { SETTINGS_API_PREFIX, type HostSettingsSnapshot, type SettingsResponse } from '../../../src/app/host-settings-types.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../../src/business/workflow/contracts.js';
import type { WriteResult } from '../../../src/contracts/core/results.js';
import type { RunRef } from '../../../src/contracts/dispatch.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../../src/contracts/plan.js';
import type { TaskRequeueOutcomeV1 } from '../../../src/contracts/task-requeue.js';
import type { RequeueTaskInput } from '../../../src/core/work-graph/model/claim-contracts.js';
import type { PlanChangeReason } from '../../../src/core/work-graph/model/plan-contracts.js';
import {
  AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, ag2bChecksConfiguration, corePost, plain, type AG2bHost,
} from '../../helpers/AG2b-collaboration-fixture.js';
import type { AdvanceValue } from '../../helpers/A2-restart-fixture.js';
import { assertInvariants, stepOfReceipt, type HostScenario, type PlatformScenario } from '../harness.js';
import { requeueBodyOf, taskRefOf } from './common.js';

/**
 * One `workflow/advance` call on the live Host (a `select_work` or one `perform`), then the
 * invariants with the receipt's step, as `advance()` checks each step. Fails on a non-ready answer.
 */
export async function performOnce(h: HostScenario, input: WorkflowAdvanceInput, label: string): Promise<AdvanceValue> {
  const result = await h.answer('workflow/advance', plain(AG2B_SCOPE, input)) as WorkflowAdvanceResult;
  if (result.status !== 'ready') throw new Error(`${label}: the Workflow call was not ready: ${JSON.stringify(result)}`);
  const receipt = result.value.receipt;
  if (receipt !== null) await assertInvariants(h, label, stepOfReceipt(receipt, h.stepActor(), h.automationPolicy(), label));
  if (receipt?.kind === 'finalize_checks') await h.settleAutoCapture();
  return result.value;
}

export type CommitFault = {
  /** Removes the trigger (call before the Host that failed is replaced). */
  drop(): void;
};

/**
 * Makes the next ledger commit that appends an event of `eventType` fail at its last write, inside
 * the transaction (see the header). The owners store hashed identity keys, so the commit is picked by
 * the event it appends: the trigger fires only while an event of that type newer than the arming point
 * is in the file, which before `COMMIT` means the failing transaction's own event. Every other commit
 * is untouched; a rolled-back transaction leaves no such event, so the trigger stays armed until `drop()`.
 */
export function failCommitOf(database: string, eventType: string): CommitFault {
  if (!/^[A-Za-z]+$/.test(eventType)) throw new Error(`the event type ${eventType} cannot be quoted safely`);
  const path = join(database, 'ledger.sqlite');
  const ddl = new DatabaseSync(path);
  try {
    const armedAt = Number((ddl.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM events').get() as { id: number }).id);
    ddl.exec(`CREATE TRIGGER scenario_mid_commit_crash BEFORE INSERT ON idempotency WHEN EXISTS (SELECT 1 FROM events `
      + `WHERE id > ${armedAt} AND instr(event_json, '"${eventType}"') > 0) `
      + `BEGIN SELECT RAISE(ABORT, 'scenario: the Host stopped before COMMIT'); END;`);
  } finally {
    ddl.close();
  }
  return { drop: () => {
    const drop = new DatabaseSync(path);
    try { drop.exec('DROP TRIGGER IF EXISTS scenario_mid_commit_crash'); } finally { drop.close(); }
  } };
}

export type RawAnswer = { status: number; body: unknown };

/** The raw HTTP answer of one core route (for a call the Host may fail to answer with a 200 or a 4xx). */
export async function rawPost(h: HostScenario, suffix: string, body: unknown): Promise<RawAnswer> {
  const response = await corePost(h.host.base, suffix, h.host.token, body);
  return { status: response.status, body: await response.json() as unknown };
}

/** The raw HTTP answer of one `workflow/advance`. */
export function rawAdvance(h: HostScenario, input: WorkflowAdvanceInput): Promise<RawAnswer> {
  return rawPost(h, 'workflow/advance', plain(AG2B_SCOPE, input));
}

/**
 * The status of the write a raw answer carries: the Workflow's receipt result when the route answered
 * `ready`, else the route's own status. A commit that failed inside its transaction must give anything
 * but `committed` (§12.9, W-23, C-05); how the Host words it (a route failure or an owner's
 * `rejected unavailable`) is not fixed by the spec (DEFECTS.md O-1), so the scenarios assert only this.
 */
export function writeStatusOf(answer: RawAnswer): unknown {
  const body = answer.body as { status?: unknown; value?: { receipt?: { result?: { status?: unknown } } | null } };
  return body.status === 'ready' ? body.value?.receipt?.result?.status : body.status;
}

/** How many ledger events of `eventType` the scenario's ledger holds. */
export function eventCount(h: HostScenario, eventType: string): number {
  return h.ledgerEventTypes().filter((type) => type === eventType).length;
}

/** Kernel session records whose JSON contains `text` (a steer or a message accepted into a Turn). */
export function kernelRecordsContaining(database: string, text: string): number {
  const kernel = new DatabaseSync(join(database, 'kernel.sqlite'), { readOnly: true });
  try {
    const row = kernel.prepare('SELECT COUNT(*) AS n FROM session_records WHERE instr(record_json, ?) > 0').get(text) as { n: number };
    return Number(row.n);
  } finally {
    kernel.close();
  }
}

/** The reason of the operator's requeues in this group. */
export const OPERATOR_RETRY = 'the operator retries the same work';

/** `tasks/requeue` as the Host operator (common.ts `requeueBodyOf`, `OPERATOR_RETRY`), with the body it sent and its answer. */
export async function requeueWithBody(h: HostScenario, requestId: string, afterRunRef: RunRef, taskId: string,
  extra: Record<string, unknown> = {}): Promise<{ body: unknown; answer: Record<string, unknown> }> {
  const body = await requeueBodyOf(h.host, afterRunRef, requestId, OPERATOR_RETRY, taskId, extra);
  return { body, answer: await h.answer('tasks/requeue', body) };
}

// ---------------------------------------------------------------------------
// Platform mode (in process)
// ---------------------------------------------------------------------------

export async function platformRun(h: PlatformScenario, runRef: RunRef): Promise<TaskExecutionRecord> {
  const read = await h.platform.executions.readExecution(h.ctx(), runRef);
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

export async function platformGoalRevision(h: PlatformScenario): Promise<number> {
  const read = await h.platform.plans.queryGoal(h.ctx(), AG2B_GOAL_REF);
  if (read.status !== 'ready') throw new Error(`the Goal must be readable: ${JSON.stringify(read)}`);
  return read.value.goal.revision;
}

/**
 * `requeueTask` through the owner as `actor` (the operator by default; `WORKFLOW_AUTOMATION_ACTOR`
 * makes it a system request, as the Workflow's `automationContext`), pinning the Goal and the afterRun
 * at their current revisions and, when `refusalPin` is given, `TaskReworkRefusal(requeue, afterRun)@k`.
 */
export async function platformRequeue(h: PlatformScenario, requestId: string, afterRunRef: RunRef, options: {
  taskId?: string; actor?: WorkbenchActor; input?: Partial<RequeueTaskInput>; refusalPin?: number;
} = {}): Promise<WriteResult<TaskRequeueOutcomeV1>> {
  const taskId = options.taskId ?? AG2B_WORK_TASK_ID;
  const run = await platformRun(h, afterRunRef);
  const refusalRef = { aggregateType: 'TaskReworkRefusal' as const, projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId,
    taskId, operation: 'requeue' as const, subjectId: afterRunRef.runId };
  const expected = [{ ref: AG2B_GOAL_REF, revision: await platformGoalRevision(h) }, { ref: afterRunRef, revision: run.run.revision },
    ...(options.refusalPin === undefined ? [] : [{ ref: refusalRef, revision: options.refusalPin }])];
  return h.platform.claims.requeueTask!(h.ctx(options.actor), { meta: { requestId, expected },
    input: { taskRef: taskRefOf(taskId), afterRunRef, reason: 'retry the same work', ...options.input } });
}

/**
 * Registers a checks configuration of two static checks over all Tasks, `a11-c1` and `a11-c2`, that exit
 * with the given codes whatever the workspace holds (revision `a11-two-checks@<revision>`). The harness's
 * one-check configuration is replaced; a round already open keeps the configuration it froze.
 */
export function registerTwoChecks(h: PlatformScenario, revision: number, exits: { c1: number; c2: number }): void {
  const base = ag2bChecksConfiguration({ actor: h.stepActor(), revision: `a11-two-checks@${revision}` });
  const check = base.checks[0]!;
  h.platform.registerCheckConfiguration({ configuration: { ...base, checks: [
    { ...check, checkId: 'a11-c1', command: `node -e "process.exit(${exits.c1})"` },
    { ...check, checkId: 'a11-c2', command: `node -e "process.exit(${exits.c2})"` }] } });
}

/** `proposePlan` then `applyPlanChange` as the operator (a W16 adoption); returns the adopted Plan. */
export async function adoptPlan(h: PlatformScenario, requestId: string, next: { source: PlanRevisionSnapshot; draft: PlanRevisionDraft },
  reason: PlanChangeReason): Promise<PlanRevisionSnapshot> {
  const proposed = await h.platform.plans.proposePlan(h.ctx(), { meta: { requestId: `${requestId}-propose`, expected: [] },
    input: { goalRef: AG2B_GOAL_REF, basedOn: next.source.ref, draft: next.draft, reason } });
  if (proposed.status !== 'committed') throw new Error(`the proposal must commit: ${JSON.stringify(proposed)}`);
  const applied = await h.platform.plans.applyPlanChange(h.ctx(), { meta: { requestId: `${requestId}-apply`, expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`the adoption must commit: ${JSON.stringify(applied)}`);
  return applied.value;
}

// ---------------------------------------------------------------------------
// The moved `tests/app/A2-automation-rework.test.ts` test 2 (A11) keeps its own helpers (unchanged)
// ---------------------------------------------------------------------------

export const WORK_2 = 'ag2b-work-2';

export async function saveAutomationLimit(host: AG2bHost, autoReworkLimit: number): Promise<void> {
  const response = await fetch(new URL(`${SETTINGS_API_PREFIX}automation/save`, host.base), { method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: host.token },
    body: JSON.stringify({ autoReworkLimit, resumeOnStartup: true }) });
  expect(await response.json() as SettingsResponse<HostSettingsSnapshot>).toMatchObject({ status: 'ready',
    value: { automation: { autoReworkLimit } } });
}
