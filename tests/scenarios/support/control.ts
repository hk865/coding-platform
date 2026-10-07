/**
 * Help code of the A.2 step 6 control group (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步":
 * tests/scenarios/A7-control.test.ts, A7-control-goal29.test.ts, C3-paused-continue-brief.test.ts).
 * Help code other groups use too is in ./common.ts; the Host route reads are the restart fixture's.
 *
 * Three parts:
 * - the helpers of the cases moved from tests/composition/A2-control-platform.test.ts (the
 *   composition root without a Runtime Host, `submit` / `intentOf`);
 * - the helpers of the cases moved from tests/app/A2-goal-control-route.test.ts (a real Host per
 *   case, `goals/control` bodies; their Workflow drives are common.ts `driveChecked`);
 * - the route writes the new scenarios make on a harness Host (tests/scenarios/harness.ts): Run
 *   controls, Goal controls, the operator's resume re-entry, and the deterministic fan-out intent refs.
 *
 * Scripted model replies only; no real model is called.
 */
import { expect } from 'vitest';
import type { GoalControlOutcomeV1, GoalDisplayHostReadV1 } from '../../../src/app/core-http-types.js';
import type { WorkflowAdvanceInput } from '../../../src/business/workflow/contracts.js';
import { createTargetPlatform, type TargetPlatformOptions } from '../../../src/composition/create-platform.js';
import type {
  ControlIntentKindV1, ControlIntentRef, ControlIntentSnapshotV1, SubmittedControl,
} from '../../../src/contracts/control-intent.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../src/contracts/core/results.js';
import type { RunRef } from '../../../src/contracts/dispatch.js';
import { GOAL_FAN_OUT_ACTOR } from '../../../src/contracts/task-requeue.js';
import { goalFanOutRequestId, type GoalControl } from '../../../src/core/work-graph/state/goal-machine.js';
import { controlIntentRefFor } from '../../../src/core/work-graph/tasks/control-service.js';
import type { ScriptedReply } from '../../helpers/B2-runtime-fixture.js';
import {
  AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, AG2B_WORK_TASK_ID, corePost, graphWrite, plain, seedAG2bWorkGraph,
  startAG2bHost, type AG2bHost, type AG2bOverrides,
} from '../../helpers/AG2b-collaboration-fixture.js';
import { post, publicDirectory, readExecution, readGoal, selectWork } from '../../helpers/A2-restart-fixture.js';
import { CLAIM_FIXTURE_AT, type TaskClaimFixture } from '../../helpers/task-claim-fixture.js';
import type { InvariantTarget, Platform } from '../harness.js';
import { driveChecked } from './common.js';

// ---------------------------------------------------------------------------
// Moved from tests/composition/A2-control-platform.test.ts (D-7, D-8, CD-4)
// ---------------------------------------------------------------------------

/** The composition root over the claim fixture's SQLite files without a Runtime Host (no workspace grant). */
export function hostOptions(directory: string): TargetPlatformOptions {
  return {
    storage: { kind: 'sqlite', directory },
    now: () => CLAIM_FIXTURE_AT,
    workspace: {
      async resolveRoot() {
        return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'control needs no workspace root' };
      },
      async authorize() {
        return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'control needs no source grant' };
      },
    },
  };
}

/** `submitControl` at the Run's current revision; the receipt must commit fresh. */
export async function submit(
  platform: Platform, ctx: TaskClaimFixture['ctx'], runRef: RunRef, requestId: string, kind: ControlIntentKindV1,
  reason: string | null = null,
): Promise<{ request: Parameters<Platform['controls']['submitControl']>[1]; value: SubmittedControl }> {
  const read = await platform.executions.readExecution(ctx, runRef);
  if (read.status !== 'ready') throw Error('the Run must be readable');
  const request = { input: { runRef, kind, reason }, meta: { requestId, expected: [{ ref: runRef, revision: read.value.run.revision }] } };
  const result = await platform.controls.submitControl(ctx, request);
  expect(result, `${kind} (${requestId})`).toMatchObject({ status: 'committed', replayed: false });
  if (result.status !== 'committed') throw Error(`${kind} must commit`);
  return { request, value: result.value };
}

export async function intentOf(platform: Platform, ctx: TaskClaimFixture['ctx'], ref: ControlIntentRef) {
  const read = await platform.controls.readControl(ctx, ref);
  if (read.status !== 'ready') throw Error('the control intent must be readable');
  return read.value;
}

/** `createTargetPlatform` (re-exported so the moved cases build the platform the way they did). */
export { createTargetPlatform };

// ---------------------------------------------------------------------------
// Moved from tests/app/A2-goal-control-route.test.ts (A7-G1)
// ---------------------------------------------------------------------------

export const REPLIES: ScriptedReply[] = [
  { kind: 'calls', calls: [{ callId: 'a2-goal-edit', name: 'edit', args: { mode: 'create', path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
  { kind: 'text', text: 'A2 goal control: the result file is written' },
];

/** One real Host on fresh files with the AG2b seed (its directories are removed by `cleanupScenarios`). */
export async function startHost(beforeReply?: AG2bOverrides['beforeReply']): Promise<AG2bHost> {
  const publicDir = await publicDirectory();
  const host = await startAG2bHost(publicDir, { replies: REPLIES, ...(beforeReply === undefined ? {} : { beforeReply }) });
  await seedAG2bWorkGraph(host);
  return host;
}

/** A refused graph write: the HTTP error boundary carries the exact rejection body. */
export async function refused(host: AG2bHost, suffix: string, body: unknown): Promise<CoreRejection> {
  const response = await corePost(host.base, suffix, host.token, body);
  expect(response.status, suffix).not.toBe(200);
  return await response.json() as CoreRejection;
}

/** A `goals/control` body at the Goal's current revision (or the given one). */
export async function control(host: AG2bHost, kind: 'pause' | 'resume' | 'cancel', requestId: string, goalRevision?: number) {
  const revision = goalRevision ?? (await readGoal(host)).revision;
  return graphWrite(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF, control: kind, reason: `operator ${kind}` }, requestId,
    [{ ref: AG2B_GOAL_REF, revision }]);
}

export async function display(host: AG2bHost): Promise<GoalDisplayHostReadV1> {
  const read = await post<ReadResult<GoalDisplayHostReadV1>>(host, 'goals/display', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

export async function claimedRun(host: AG2bHost, flowId: string, inv: InvariantTarget): Promise<{ runRef: RunRef; next: WorkflowAdvanceInput }> {
  // select_work → create_session → claim (each checked); stop before the prepare of the claimed Run.
  const claimed = await driveChecked(host, inv, selectWork(flowId), { stopBefore: 'prepare' });
  if (claimed.next === null) throw new Error(`the Workflow did not reach the prepare: ${JSON.stringify(claimed.last)}`);
  const graph = await post<ReadResult<{ tasks: Array<{ ref: { taskId: string }; execution: RunRef | null }> }>>(
    host, 'tasks/query', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  if (graph.status !== 'ready') throw new Error('the task graph must be readable');
  const runRef = graph.value.tasks.find(row => row.ref.taskId === AG2B_WORK_TASK_ID)?.execution ?? null;
  if (runRef === null) throw new Error('the work Task must be claimed');
  return { runRef, next: claimed.next };
}

// ---------------------------------------------------------------------------
// The new scenarios: route writes and reads on one live Host
// ---------------------------------------------------------------------------

/** `controls/submit` of one control at the Run's current revision; any answer (a refusal is a non-200 with its body). */
export async function submitRunControl(host: AG2bHost, runRef: RunRef, kind: ControlIntentKindV1, reason: string | null,
  requestId: string): Promise<WriteResult<SubmittedControl>> {
  const run = (await readExecution(host, runRef)).run;
  const response = await corePost(host.base, 'controls/submit', host.token, graphWrite(AG2B_SCOPE, { runRef, kind, reason }, requestId,
    [{ ref: runRef, revision: run.revision }]));
  expect(response.status, 'controls/submit').not.toBe(500);
  return await response.json() as WriteResult<SubmittedControl>;
}

/** `controls/read` of one intent: any answer (`not_found` for an intent never submitted). */
export async function readIntentAnswer(host: AG2bHost, ref: ControlIntentRef): Promise<ReadResult<ControlIntentSnapshotV1>> {
  const response = await corePost(host.base, 'controls/read', host.token, plain(AG2B_SCOPE, ref));
  return await response.json() as ReadResult<ControlIntentSnapshotV1>;
}

/** `goals/control` of the seeded Goal at its current revision; any answer. */
export async function goalControl(host: AG2bHost, kind: GoalControl, requestId: string): Promise<WriteResult<GoalControlOutcomeV1>> {
  const response = await corePost(host.base, 'goals/control', host.token, await control(host, kind, requestId));
  expect(response.status, 'goals/control').not.toBe(500);
  return await response.json() as WriteResult<GoalControlOutcomeV1>;
}

/** The same, for a Goal control that must commit. */
export async function goalControlled(host: AG2bHost, kind: GoalControl, requestId: string): Promise<GoalControlOutcomeV1> {
  const written = await goalControl(host, kind, requestId);
  if (written.status !== 'committed') throw new Error(`goal ${kind} (${requestId}): ${JSON.stringify(written)}`);
  return written.value;
}

/** `executions/start` of an entered Run's original Turn (the operator's resume re-entry, as the UI sends it). */
export async function reenter(host: AG2bHost, runRef: RunRef, requestId: string): Promise<ReadResult<{ run: { status: string; outcome: string | null } }>> {
  const record = await readExecution(host, runRef);
  const authorization = record.run.executionAuthorization;
  if (record.run.envelope === null || record.run.inputBinding === undefined || authorization === undefined || !('consumerId' in authorization)) {
    throw new Error('the entered Run must carry its prepared envelope, input binding and consumer');
  }
  const response = await corePost(host.base, 'executions/start', host.token, plain(AG2B_SCOPE, {
    prepared: { kind: 'task', claim: record.outbox.claim, envelope: record.run.envelope, inputBinding: record.run.inputBinding },
    consumerId: authorization.consumerId, requestId }));
  expect(response.status, 'executions/start').not.toBe(500);
  return await response.json() as ReadResult<{ run: { status: string; outcome: string | null } }>;
}

/** The deterministic fan-out intent of one epoch and Run (§2.3: `GOAL_FAN_OUT_ACTOR`, `goalFanOutRequestId`). */
export function fanOutIntentRef(epoch: number, runRef: RunRef, kind: GoalControl): ControlIntentRef {
  return controlIntentRefFor(GOAL_FAN_OUT_ACTOR, AG2B_SCOPE, goalFanOutRequestId(AG2B_GOAL_REF, epoch, runRef, kind));
}
