/**
 * Help code that two or more A.2 step 6 scenario groups use (docs/refactor/STATE-MACHINES-SPEC.md §15.2
 * "第 6 步"), on top of the shared harness (../harness.ts) and the fixtures
 * (tests/helpers/AG2b-collaboration-fixture.ts, tests/helpers/A2-restart-fixture.ts). A helper only one group
 * uses stays in that group's tests/scenarios/support/<group>.ts (user decision 31: one copy of each helper).
 *
 * - Scripted replies, automation policies and the §11.11 steps of owner writes made outside `advance()`.
 * - Host routes on the AG2b seed: a Run, its bound continuation brief, a message, the Goal display, the
 *   operator's `tasks/requeue` pinned at the current revisions.
 * - Workflow drives and their readers: `driveChecked` (an `AG2bHost` drive with the §11 invariants after every
 *   step that returned a receipt), receipts, finalize outcomes, the request a stopped `start` carries.
 * - Readers over the scenario files (Kernel records, the ledger's last event) and the crash points the Host
 *   has no seam for (§12.10 step 1, "故障注入"): the ledger's write lock (`lockLedger`, `lockLedgerAfter`),
 *   the Kernel store moved aside (`startWithKernelAside`), a Host closed with a Run paused at a safe point.
 * - Plans: the next v2 draft of an accepted Plan; `PlanBoard`, the AG2b scope on a composition root whose work
 *   grant also holds the W2 plan-write tools.
 * - `openWorkRoot`: a composition root on a Host scenario's files with the Host's Runtime grant (an Agent's
 *   owner call, or a crash point between two commits of one Runtime call), and `authorizeWithoutBegin` (W-02).
 *
 * Call `cleanupCommon` from `afterEach` before `cleanupScenarios` in a file that opens a `PlanBoard`.
 * Scripted model replies only; no real model is called.
 */
import { expect } from 'vitest';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type {
  GoalControlOutcomeV1, GoalDisplayHostReadV1, TaskExecutionRecord,
} from '../../../src/app/core-http-types.js';
import { createPlatformCoreRouteBindings } from '../../../src/app/core-routes.js';
import { HOST_INSTANCE_LOCK_FILE } from '../../../src/app/host-instance-lease.js';
import { createWorkbenchServer, type WorkbenchServer } from '../../../src/app/server.js';
import type {
  WorkflowAdvanceInput, WorkflowAdvanceResult, WorkflowOperation, WorkflowStepReceipt,
} from '../../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../../src/business/workflow/ports.js';
import type { RecordCommitObserver } from '../../../src/composition/commit-observer.js';
import { createTargetPlatform } from '../../../src/composition/create-platform.js';
import type { ActorRef } from '../../../src/contracts/command-event.js';
import type { ControlIntentSnapshotV1, SubmittedControl } from '../../../src/contracts/control-intent.js';
import type { ContinuationBriefV1 } from '../../../src/contracts/continuation-brief.js';
import type { CoreCallContext } from '../../../src/contracts/core/call-context.js';
import type { PreparedTaskExecution } from '../../../src/contracts/core/prepared-execution.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../../src/contracts/core/session-message.js';
import type { RunRef } from '../../../src/contracts/dispatch.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../../src/contracts/plan.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, type TaskAutomationPolicyV1, type TaskRequeueOutcomeV1,
} from '../../../src/contracts/task-requeue.js';
import type { RoundSnapshot } from '../../../src/contracts/verification.js';
import { VerificationWorkspaceReader } from '../../../src/core/workspace/verification-workspace-reader.js';
import type { GoalDisplayV1 } from '../../../src/core/work-graph/state/goal-machine.js';
import type { HostInstanceFacts } from '../../../src/core/work-graph/model/execution-entry-contracts.js';
import type { TaskRow } from '../../../src/core/work-graph/model/plan-contracts.js';
import type { ModelRequest } from '../../../vendor/coding-agent/dist/public-api.js';
import { createScriptedModel, type ScriptedModel, type ScriptedReply } from '../../helpers/B2-runtime-fixture.js';
import {
  AG2B_AT, AG2B_CHECK_COMMAND, AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, AG2B_WORK_ROLE,
  AG2B_WORK_ROLE_BINDING, AG2B_WORK_TASK_ID, ag2bChecksConfiguration, corePost, graphWrite, permissionRevision, plain,
  seedAG2bWorkGraph, startAG2bHost, writeAG2bWorkspace, type AG2bHost,
} from '../../helpers/AG2b-collaboration-fixture.js';
import {
  answer, goalControlPins, moveKernelAside, post, readExecution, readGoal, restoreKernel, selectWork, tempDir, workRow, writeStaleLock,
  type AdvanceValue, type PausedOnClosedHost,
} from '../../helpers/A2-restart-fixture.js';
import type { FuzzStep, FuzzStepKind } from '../../state/invariants.js';
import {
  ag2bWorkRuntime, ag2bWorkspaceBindings, assertInvariantsAt, hostCtx, readSqlite, SCENARIO_OPERATOR, seedThroughOwners,
  stepOfReceipt, type Driven, type HostScenario, type InvariantTarget, type Platform, type ScenarioBase,
} from '../harness.js';

// ---------------------------------------------------------------------------
// Scripted replies, automation policies, §11.11 steps
// ---------------------------------------------------------------------------

/** One scripted text reply. */
export function textReply(text: string): ScriptedReply {
  return { kind: 'text', text };
}

/** A Run that creates `path` with `text` through the Kernel `edit` tool (call `<label>-edit`), then answers. */
export function createFileReplies(label: string, path: string, text: string): ScriptedReply[] {
  return [{ kind: 'calls', calls: [{ callId: `${label}-edit`, name: 'edit', args: { mode: 'create', path, newText: text } }] },
    { kind: 'text', text: `scenario ${label}: ${path} is written` }];
}

/** A first tool group (a read of the seeded module) whose end is the Run's first safe point. */
export function readCall(label: string): ScriptedReply {
  return { kind: 'calls', calls: [{ callId: `${label}-read`, name: 'read', args: { path: 'src/module.ts' } }] };
}

/** A Run that writes the AG2b result file (the registered check then PASSes), then answers. */
export function editThenText(label: string): ScriptedReply[] {
  return createFileReplies(label, AG2B_RESULT_FILE, AG2B_RESULT_TEXT);
}

/** The file a Run writes through its tools (the brief's "上一次执行经工具改动的文件"), which no check reads. */
export const NOTES_FILE = 'src/ag2b-notes.txt';

/** A first tool group (a read) and a final text: a crash that holds the second model call leaves the Turn open. */
export const READ_THEN_TEXT: ScriptedReply[] = [
  { kind: 'calls', calls: [{ callId: 'a2-crash-read', name: 'read', args: { path: 'src/module.ts' } }] },
  { kind: 'text', text: 'A2 crash: never answered on the crashed Host' }];

/** The `{ automation }` Host setting: rework limit 3, the start-up re-drive on or off (§12.10 step 5, LA-6). */
export function redrivePolicy(resumeOnStartup: boolean): TaskAutomationPolicyV1 {
  return { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup };
}

/** The start-up re-drive off: the scenario drives every step itself, and a restart writes only the reconcile's records. */
export const NO_REDRIVE: TaskAutomationPolicyV1 = redrivePolicy(false);

/** A §11.11 step of an owner write outside the Workflow (a route call, an owner call, the fan-out driver's requeue). */
export function ownerStep(kind: FuzzStepKind, actor: ActorRef, policy: TaskAutomationPolicyV1, label: string): FuzzStep {
  return { kind, actor: structuredClone(actor), automationPolicy: { ...policy }, label };
}

/** The same on a scenario: its automation policy in effect, the Host operator unless `actor` is given. */
export function stepOf(h: ScenarioBase, kind: FuzzStepKind, label: string, actor: ActorRef = SCENARIO_OPERATOR): FuzzStep {
  return ownerStep(kind, actor, h.automationPolicy(), label);
}

// ---------------------------------------------------------------------------
// Host routes on the AG2b seed
// ---------------------------------------------------------------------------

/** The AG2b work Task triple (`taskId` another seeded Task). */
export function taskRefOf(taskId: string = AG2B_WORK_TASK_ID): { projectId: string; goalId: string; taskId: string } {
  return { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId };
}

/** The work Task as a Session link target (a wait message's recipient must take part in the work). */
export const WORK_TARGET = { kind: 'task' as const, ref: taskRefOf() };

/** A Session as the start-up reconcile report keys it (`HostReconcileReportV1.report.sessions[].ref`). */
export function sessionKey(session: TaskExecutionRecord['session']): string {
  return JSON.stringify({ projectId: session.ref.projectId, sessionId: session.ref.sessionId });
}

/** The Task's selected Run (throws when none is selected). */
export async function selectedRun(h: ScenarioBase, taskId: string = AG2B_WORK_TASK_ID): Promise<RunRef> {
  const runRef = (await h.taskRow(taskId)).execution;
  if (runRef === null) throw new Error(`the Task ${taskId} must select a Run`);
  return runRef;
}

/** `executions/read` of one Run on the scenario's live Host. */
export function execution(h: HostScenario, runRef: RunRef): Promise<TaskExecutionRecord> {
  return readExecution(h.host, runRef);
}

/** `executions/brief`: the brief a requeue Run bound and its digest; null for a Run that bound none. */
export async function briefOf(host: AG2bHost, runRef: RunRef): Promise<{ brief: ContinuationBriefV1; digest: string } | null> {
  const read = await post<ReadResult<{ brief: ContinuationBriefV1; digest: string } | null>>(host, 'executions/brief',
    plain(AG2B_SCOPE, { runRef }));
  if (read.status !== 'ready') throw new Error(`the continuation brief must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

/** The same, for a Run that must have bound one. */
export async function requiredBriefOf(host: AG2bHost, runRef: RunRef): Promise<{ brief: ContinuationBriefV1; digest: string }> {
  const bound = await briefOf(host, runRef);
  if (bound === null) throw new Error(`the Run ${runRef.runId} must have bound a continuation brief`);
  return bound;
}

/** `goals/display` of the seeded Goal. */
export async function hostGoalDisplay(host: AG2bHost): Promise<GoalDisplayHostReadV1['display']> {
  const read = await post<ReadResult<GoalDisplayHostReadV1>>(host, 'goals/display', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
  return read.value.display;
}

/** One stored SessionMessage as `messages/read` answers it. */
export async function readMessage(h: HostScenario, messageRef: SessionMessageRef): Promise<Record<string, unknown>> {
  const read = await h.post<ReadResult<Record<string, unknown>>>('messages/read', plain(AG2B_SCOPE, messageRef));
  if (read.status !== 'ready') throw new Error(`the message must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

/**
 * The body of a person's `tasks/requeue` (继续 / 重新入队) after `afterRunRef`: the Task triple, the afterRun, the
 * reason and `extra` input fields (`newInputRefs`, ...), pinned to the Goal and the afterRun at their current revisions.
 */
export async function requeueBodyOf(host: AG2bHost, afterRunRef: RunRef, requestId: string, reason: string,
  taskId: string = AG2B_WORK_TASK_ID, extra: Record<string, unknown> = {}): Promise<ReturnType<typeof graphWrite>> {
  const goal = await readGoal(host);
  const run = (await readExecution(host, afterRunRef)).run;
  return graphWrite(AG2B_SCOPE, { taskRef: taskRefOf(taskId), afterRunRef, reason, ...extra }, requestId,
    [{ ref: AG2B_GOAL_REF, revision: goal.revision }, { ref: afterRunRef, revision: run.revision }]);
}

/** `tasks/requeue` as the Host operator (`requeueBodyOf`); any answer (a refusal is a non-200 with its body). */
export async function operatorRequeue(host: AG2bHost, afterRunRef: RunRef, requestId: string, reason: string,
  taskId: string = AG2B_WORK_TASK_ID, extra: Record<string, unknown> = {}): Promise<WriteResult<TaskRequeueOutcomeV1>> {
  const body = await requeueBodyOf(host, afterRunRef, requestId, reason, taskId, extra);
  return await answer(host, 'tasks/requeue', body) as unknown as WriteResult<TaskRequeueOutcomeV1>;
}

/** A rejection's code, or the status of anything else. */
export function codeOf(answer: unknown): string {
  const value = answer as Partial<CoreRejection> & { status?: string };
  return value.status === 'rejected' ? String(value.code) : String(value.status);
}

/** The whole-workspace source digest the requeue and the brief capture (ND-2, LA-5). */
export async function sourceDigestOf(root: string): Promise<string> {
  const captured = await new VerificationWorkspaceReader().captureDigest(root);
  if (captured.status !== 'ready') throw new Error(`the workspace digest must be readable: ${captured.reason}`);
  return captured.sourceDigest;
}

// ---------------------------------------------------------------------------
// Workflow drives and their readers
// ---------------------------------------------------------------------------

/** One `workflow/advance` on a Host (it must answer `ready`). */
export async function advance(host: AG2bHost, input: WorkflowAdvanceInput): Promise<AdvanceValue> {
  const result = await post<WorkflowAdvanceResult>(host, 'workflow/advance', plain(AG2B_SCOPE, input));
  if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
  return result.value;
}

/** A checked drive: every step's value, the last one, and the unperformed `stopBefore` request (null once settled). */
export type CheckedDrive = { steps: AdvanceValue[]; last: AdvanceValue; next: WorkflowAdvanceInput | null };

/**
 * Advances until the next step is a `perform` of `stopBefore` (returned unperformed) or the Workflow
 * settles, and checks the §11 invariants after every step that returned a receipt, with that step's
 * `FuzzStep` (`stepOfReceipt`: the Host actor, `WORKFLOW_AUTOMATION_ACTOR` for an automatic requeue or
 * reverify, and `policy`, the default unless the Host's settings file says otherwise). A target with no
 * previous world is read once first, so the first step is judged against the records before it.
 * Labels `<label>#<n> <kind>` (default label: the input's flowId).
 */
export async function driveChecked(host: AG2bHost, inv: InvariantTarget, input: WorkflowAdvanceInput,
  options: { stopBefore?: string; policy?: TaskAutomationPolicyV1; label?: string } = {}): Promise<CheckedDrive> {
  const policy = options.policy ?? DEFAULT_TASK_AUTOMATION_POLICY;
  const label = options.label ?? input.flowId;
  if (inv.lastWorld === undefined) await assertInvariantsAt(inv, `${label} (before the first step)`);
  const steps: AdvanceValue[] = [];
  let current = input;
  for (let step = 0; step < 32; step += 1) {
    const value = await advance(host, current);
    steps.push(value);
    if (value.receipt !== null) {
      const at = `${label}#${step} ${value.receipt.kind}`;
      await assertInvariantsAt(inv, at, stepOfReceipt(value.receipt, host.actor, policy, at));
    }
    if (value.state === 'completed' || value.next === null) return { steps, last: value, next: null };
    if (options.stopBefore !== undefined && value.next.kind === 'perform' && value.next.operation.kind === options.stopBefore) {
      return { steps, last: value, next: value.next };
    }
    current = value.next;
  }
  throw new Error('the Workflow did not settle');
}

/** The receipt results of `kind` in the order the Workflow produced them. */
export function receiptsOf(steps: readonly AdvanceValue[], kind: string): unknown[] {
  return steps.flatMap(step => step.receipt !== null && step.receipt.kind === kind ? [step.receipt.result] : []);
}

/** The `requeue_task` requests the Workflow returned (performed by the next call). */
export function requeueRequestsOf(steps: readonly AdvanceValue[]): unknown[] {
  return steps.flatMap(step => step.next !== null && step.next.kind === 'perform' && step.next.operation.kind === 'requeue_task'
    ? [step.next.operation.request] : []);
}

/** The outcome of every `finalize_checks` receipt of the steps (undefined for one that did not commit). */
export function finalizeOutcomesOf(steps: readonly AdvanceValue[]): unknown[] {
  return receiptsOf(steps, 'finalize_checks').map(result => (result as { value?: { outcome?: unknown } }).value?.outcome);
}

/** The outcomes of a drive's `finalize_checks` receipts that committed. */
export function committedOutcomesOf(driven: Driven): unknown[] {
  return driven.receipts.flatMap(receipt => receipt.kind === 'finalize_checks' && receipt.result.status === 'committed'
    ? [receipt.result.value.outcome] : []);
}

/**
 * What the same request answers when it is sent again after its first answer was lost: a write
 * replays its original receipt (`replayed: true`, the same value and commit cursor); a read-shaped
 * step (`prepare`, `start`, `observe`, `run_check`) answers the same persisted record.
 */
export function replayOf(receipt: WorkflowStepReceipt | null): unknown {
  if (receipt === null) return null;
  const result = receipt.result as { status: string };
  if (result.status === 'committed' || result.status === 'completed') return { ...receipt, result: { ...result, replayed: true } };
  return receipt;
}

/** The prepared value a stopped `start` perform carries (`stopBefore: performs('start')`). */
export function preparedOf(input: WorkflowAdvanceInput | null): PreparedTaskExecution {
  if (input === null || input.kind !== 'perform' || input.operation.kind !== 'start') {
    throw new Error(`a stopped start is expected: ${JSON.stringify(input)}`);
  }
  return structuredClone(input.operation.request.prepared);
}

/** `stopBefore` for the next `perform` of `kind` once the scenario has `requeues` TaskRequeues. */
export function performsAfterRequeues(h: ScenarioBase, kind: string, requeues: number): (input: WorkflowAdvanceInput) => boolean {
  return input => input.kind === 'perform' && input.operation.kind === kind && (h.lastWorld?.requeues.length ?? 0) === requeues;
}

/** The `json` output a tool message carries for `callId` in a model request (success or a mapped refusal). */
export function toolOutputJson(request: ModelRequest | undefined, callId: string): unknown {
  const message = request?.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
  if (message === undefined || message.role !== 'tool') return undefined;
  const output = (message.result as { output?: ReadonlyArray<{ kind: string; value?: unknown }> }).output ?? [];
  return output.find(block => block.kind === 'json')?.value;
}

/** The arguments object of a one-call scripted reply (filled in inside the model call before the call is sent). */
export function callArgs(reply: ScriptedReply | undefined): Record<string, unknown> {
  if (reply?.kind !== 'calls' || reply.calls[0] === undefined) throw new Error('a tool-call reply is expected');
  return reply.calls[0].args;
}

/**
 * A `reverifyRound` request on `round`: pinned to the round, and to its reverify refusal
 * (`TaskReworkRefusal(reverify, round)`) at `refusalRevision` when given.
 */
export function reverifyRequest(round: RoundSnapshot, requestId: string, refusalRevision?: number, reason?: string) {
  return {
    input: { predecessorRoundRef: round.ref, ...(reason === undefined ? {} : { reason }) },
    meta: { requestId, expected: [{ ref: round.ref, revision: round.revision },
      ...(refusalRevision === undefined ? [] : [{ ref: { aggregateType: 'TaskReworkRefusal' as const, projectId: round.ref.projectId,
        goalId: round.ref.goalId, taskId: round.ref.taskId, operation: 'reverify' as const, subjectId: round.ref.roundId },
      revision: refusalRevision }])] },
  };
}

// ---------------------------------------------------------------------------
// Scenario files: Kernel records, the ledger, crash points
// ---------------------------------------------------------------------------

export type KernelRecordRow = { sessionId: string; position: number; recordType: string; json: string };

/** Every Kernel session record in `(session, position)` order, through a read-only connection; none without the file. */
export function kernelRecordRows(database: string): KernelRecordRow[] {
  return readSqlite(join(database, 'kernel.sqlite'), kernel => (kernel.prepare(
    'SELECT session_id, position, record_type, record_json FROM session_records ORDER BY session_id, position').all() as Array<{
    session_id: string; position: number; record_type: string; record_json: string }>)
    .map(row => ({ sessionId: row.session_id, position: Number(row.position), recordType: row.record_type, json: row.record_json })), []);
}

/** The user message of every Kernel `turn.started`, with its Kernel session and Run, in record order. */
export function turnStarts(database: string): Array<{ sessionId: string; runId: string; content: string }> {
  return kernelRecordRows(database).filter(row => row.recordType === 'turn.started').map((row) => {
    const record = JSON.parse(row.json) as { payload: { run: { runId: string; turn: { userMessage: { content: string } } } } };
    return { sessionId: row.sessionId, runId: record.payload.run.runId, content: record.payload.run.turn.userMessage.content };
  });
}

/**
 * The test's own connection takes the ledger's write lock (`BEGIN IMMEDIATE`): every ledger write of the
 * Host then fails after the store's 5 s busy wait, while reads go on (WAL) and the Kernel writes its own
 * store. `release()` rolls back and closes the connection.
 */
export function lockLedger(database: string): { release(): void } {
  return lockStore(join(database, 'ledger.sqlite'));
}

/** The same write lock on the Kernel's own store: its next write fails after the Kernel's 1 s busy wait. */
export function lockKernelStore(database: string): { release(): void } {
  return lockStore(join(database, 'kernel.sqlite'));
}

function lockStore(path: string): { release(): void } {
  const store = new DatabaseSync(path);
  store.exec('BEGIN IMMEDIATE');
  return { release() {
    if (store.isTransaction) store.exec('ROLLBACK');
    store.close();
  } };
}

/** The type of the ledger's last event (its own read-only connection); null for an empty ledger. */
export function lastEventType(database: string): string | null {
  const ledger = new DatabaseSync(join(database, 'ledger.sqlite'), { readOnly: true });
  try {
    const row = ledger.prepare('SELECT event_json FROM events ORDER BY id DESC LIMIT 1').get() as { event_json: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.event_json) as { eventType: string }).eventType;
  } finally { ledger.close(); }
}

/**
 * A commit observer for a composition root on the scenario files (`openWorkRoot`): right after the first commit
 * whose last event is `eventType`, the test takes the ledger's write lock (`lockLedger`), so every later ledger
 * write of that root fails after the store's busy wait while its Kernel goes on in its own store. That is the
 * crash point between two commits of one Runtime call the Host has no seam for (§12.10 step 1, "故障注入"): the
 * begin committed and the entered fact not (A8-2d), the wait message saved and the yielded terminal not booked
 * (A8-3b), the terminal booked and its control acks not (A8-3h), a Query's last usage saved and its terminal not
 * booked (A8-Q3), a restart's control settle inside another writer's window (C7). With `kernelStore` the
 * Kernel's store is locked at the same instant (`lockKernelStore`), so the Kernel cannot record what comes next
 * either: the wait message saved and the send's result never recorded (A8-3j). `eventType` may be a predicate
 * over the last event type (for a commit the caller arms). `release()` rolls the locks back (call it once the
 * root's call returned).
 */
export function lockLedgerAfter(database: string, eventType: string | ((last: string | null) => boolean),
  options: { kernelStore?: boolean } = {}): {
  observer: RecordCommitObserver; locked(): boolean; release(): void;
} {
  const matches = typeof eventType === 'string' ? (last: string | null) => last === eventType : eventType;
  let locks: { release(): void }[] | null = null;
  let released = false;
  return {
    observer: {
      started() { /* the head is not needed */ },
      committed() {
        if (locks === null && !released && matches(lastEventType(database))) {
          locks = [lockLedger(database), ...(options.kernelStore === true ? [lockKernelStore(database)] : [])];
        }
      },
    },
    locked: () => locks !== null,
    release() {
      released = true;
      for (const lock of locks ?? []) lock.release();
    },
  };
}

const KERNEL_FILES = ['kernel.sqlite', 'kernel.sqlite-wal', 'kernel.sqlite-shm', 'kernel.sqlite-journal'];

/** Deletes whatever Kernel store files are at the mapped path (an empty store a reader opened while the real one was aside). */
export async function removeKernelFiles(database: string): Promise<void> {
  for (const name of KERNEL_FILES) await rm(join(database, name), { force: true });
}

/** Puts the real Kernel store back in place of anything opened at its path meanwhile. */
export async function putKernelBack(database: string, aside: string): Promise<void> {
  await removeKernelFiles(database);
  await restoreKernel(database, aside);
}

/**
 * The A8-2 crash point (begin committed, no Kernel Turn): with the Kernel store moved aside, the
 * Workflow's `start` of a prepared Run in a Session with completed history commits the authorization
 * and the begin, then the completed-boundary read finds no Kernel Session and the start answers
 * `waiting`; nothing ran, so the Run stays `Entering` (the in-process RUN-16 needs a readable Kernel,
 * execution-driver.ts `revokeNotEntered`). Returns the directory holding the real store.
 */
export async function startWithKernelAside(h: HostScenario, start: Parameters<HostScenario['advance']>[0]): Promise<string> {
  const aside = await moveKernelAside(h.database);
  const started = await h.advance(start, { invariants: { label: 'start with the Kernel store aside' } });
  expect(started.state, JSON.stringify(started.steps.map(step => [step.state, step.reason]))).toBe('waiting');
  return aside;
}

/**
 * tests/helpers/A2-restart-fixture.ts `pausedRunOnClosedHost` (the same Host 1, script, pause, assertions and
 * stale lock), with the Workflow drive of Host 1 checked step by step: the §11 invariants after every step
 * that returned a receipt (`driveChecked`, Host 1's default automation policy) on `inv`. The moved cases that
 * used the shared helper call this one (A.2 step 6: "invariants after every step").
 */
export async function pausedRunOnClosedHostChecked(root: string, database: string, publicDir: string, inv: InvariantTarget,
  pause: 'run' | 'goal' = 'run',
  options: { beforeClose?: (host: AG2bHost, runRef: RunRef, pauseIntentRef: ControlIntentSnapshotV1['ref']) => Promise<void> } = {}):
Promise<PausedOnClosedHost> {
  let first: AG2bHost | undefined;
  let pauseSubmitted: WriteResult<SubmittedControl> | undefined;
  let goalPaused: WriteResult<GoalControlOutcomeV1> | undefined;
  first = await startAG2bHost(publicDir, { root, database,
    replies: [{ kind: 'calls', calls: [{ callId: 'a2-restart-read', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'text', text: 'A2 restart: never reached on the first Host' }],
    beforeReply: async (_request, index) => {
      if (index !== 0 || first === undefined) return;
      const runRef = (await workRow(first)).execution;
      if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
      if (pause === 'goal') {
        goalPaused = await post<WriteResult<GoalControlOutcomeV1>>(first, 'goals/control', graphWrite(AG2B_SCOPE,
          { goalRef: AG2B_GOAL_REF, control: 'pause', reason: 'operator pauses the Goal before the restart' }, 'a2-restart-goal-pause',
          await goalControlPins(first)));
        return;
      }
      const run = (await readExecution(first, runRef)).run;
      pauseSubmitted = await post<WriteResult<SubmittedControl>>(first, 'controls/submit', graphWrite(AG2B_SCOPE,
        { runRef, kind: 'pause', reason: 'operator pause before the restart' }, 'a2-restart-pause',
        [{ ref: runRef, revision: run.revision }]));
    } });
  let runRef: RunRef;
  let pauseIntentRef: ControlIntentSnapshotV1['ref'];
  let oldSession: TaskExecutionRecord['session'];
  try {
    expect(first.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-01',
      report: { runs: [], queries: [], checks: [], controls: [], redriveGoals: [], problems: [] } });
    await seedAG2bWorkGraph(first);
    const steps = (await driveChecked(first, inv, selectWork('a2-restart-1'))).steps;
    expect(steps.at(-1)).toMatchObject({ state: 'waiting', next: null });
    expect(first.scripted.calls(), 'the pause landed at the safe point after the first tool call').toBe(1);
    if (pause === 'goal') {
      if (goalPaused?.status !== 'committed') throw new Error(`goal pause: ${JSON.stringify(goalPaused)}`);
      const [fanOut] = goalPaused.value.fanOut.runs;
      expect(fanOut).toMatchObject({ outcome: 'submitted', reason: null });
      pauseIntentRef = fanOut!.intentRef!;
    } else {
      if (pauseSubmitted?.status !== 'committed') throw new Error(`pause: ${JSON.stringify(pauseSubmitted)}`);
      pauseIntentRef = pauseSubmitted.value.intent.ref;
    }
    const row = await workRow(first);
    if (row.execution === null) throw new Error('the work Task must select its Run');
    runRef = row.execution;
    const paused = await readExecution(first, runRef);
    expect(paused.run).toMatchObject({ status: 'running', controlState: { intentRef: pauseIntentRef, desiredState: 'paused' } });
    expect(await post(first, 'controls/read', plain(AG2B_SCOPE, pauseIntentRef))).toMatchObject({ status: 'ready',
      value: { kind: 'pause', status: 'applied', observation: { kind: 'paused' } } });
    oldSession = paused.session;
    expect(oldSession.occupancy).toMatchObject({ kind: 'execution', executionRef: { runId: runRef.runId } });
    await options.beforeClose?.(first, runRef, pauseIntentRef);
  } finally {
    await first.host.close();
  }

  // HL-06: the closed Host removed its own lock. A crashed Host leaves one naming an exited process.
  const lockPath = join(database, HOST_INSTANCE_LOCK_FILE);
  expect(existsSync(lockPath)).toBe(false);
  const stale = await writeStaleLock(database);
  return { runRef, pauseIntentRef, oldSession, lockPath, crashedPid: stale.crashedPid };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

type DraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;

/** A v2 copy of an accepted Plan as the next future draft: the draft fields only (no compiler metadata), then `edit`ed. */
export function draftFrom(plan: PlanRevisionSnapshot, planId: string, edit: (draft: DraftV2) => DraftV2 = draft => draft): DraftV2 {
  if (plan.schemaVersion !== 2) throw new Error('the active Plan is a v2 Plan');
  return edit({ schemaVersion: 2, planId, planRevision: plan.planRevision + 1, goalId: plan.goalRef.goalId,
    stages: structuredClone(plan.stages), tasks: structuredClone(plan.tasks), assignments: structuredClone(plan.assignments ?? []),
    obligations: structuredClone(plan.obligations), taskHierarchy: structuredClone(plan.taskHierarchy),
    executionDag: structuredClone(plan.executionDag), taskRelations: structuredClone(plan.taskRelations ?? []),
    inputRequirements: structuredClone(plan.inputRequirements ?? []) });
}

/** The seeded Goal's active Plan (read as `ctx`, the operator by default) and its next v2 revision `planId`, `edit`ed. */
export async function nextPlanDraft(platform: Platform, planId: string, edit: (draft: DraftV2) => DraftV2,
  ctx: CoreCallContext = hostCtx()): Promise<{ source: PlanRevisionSnapshot; draft: DraftV2 }> {
  const graph = await platform.plans.queryTaskGraph(ctx, { goalRef: AG2B_GOAL_REF });
  if (graph.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(graph)}`);
  return { source: graph.value.plan, draft: draftFrom(graph.value.plan, planId, edit) };
}

/** The Goal display headline after every step of a drive and every checked write (`Goal 从不 FAILED`). */
export type PhaseLog = string[];

const BOARD_AT = '2026-10-07T00:00:00.000Z';
/** The PlanBoard work grant: the AG2b file tools plus the two W2 plan-write tools. */
export const PLAN_BOARD_TOOLS: readonly string[] = ['read', 'write', 'propose_future_plan', 'apply_future_plan'];
const PASS_COMMAND = 'node -e "process.exit(0)"';

export type PlanBoardOptions = {
  /** The seeded work Tasks (each carries the AG2b obligation with the gate). */
  workIds: readonly string[];
  /** Work-role replies in call order (an Agent's tool calls get their arguments in `duringReply`). */
  replies: readonly ScriptedReply[];
  /** Runs inside work model call `index`, before its reply (the Turn is open, the Run is `running`). */
  duringReply?: (index: number, request: ModelRequest) => Promise<void>;
  /** `pass` (exit 0) or `result_file` (the AG2b check: PASS only while `src/ag2b-result.txt` holds the result text). */
  check?: 'pass' | 'result_file';
  automation?: TaskAutomationPolicyV1;
};

export type BoardDriven = {
  receipts: WorkflowStepReceipt[];
  /** Every `perform` the drive sent, with its receipt. */
  performed: Array<{ operation: WorkflowOperation; receipt: WorkflowStepReceipt }>;
  state: AdvanceValue['state'] | 'stopped';
  reason: string | null;
  /** The request `stopBefore` matched (not performed), else null. */
  next: WorkflowAdvanceInput | null;
};

const boardPlatforms: Platform[] = [];
const boardServers: WorkbenchServer[] = [];

/** Closes the route servers and platforms the PlanBoards opened (their directories go with `cleanupScenarios`). */
export async function cleanupCommon(): Promise<void> {
  for (const server of boardServers.splice(0)) await server.close().catch(() => undefined);
  for (const platform of boardPlatforms.splice(0)) await platform.close().catch(() => undefined);
}

/**
 * The AG2b scope on fresh SQLite files through the composition root, whose work grant also holds the two W2
 * plan-write tools (`propose_future_plan`, `apply_future_plan`), so a running Run adopts a Plan through the real
 * tools (C6 main path, C7 coordinator, C8 LA-3). The harness's grant has no whiteboard tool, and a Host cannot be
 * given one without a startup file change (the shared fixture). Seeded through the owners with the AG2b seed
 * writes; the registered check is `pass` or the AG2b result-file check. Every Workflow step and every checked
 * write runs the §11 invariants (with the step's `FuzzStep`) and records the Goal display phase (`phases`).
 * `route()` serves the Host's route layer over this root (a person's `plans/apply`).
 */
export class PlanBoard {
  readonly target: InvariantTarget;
  readonly phases: PhaseLog = [];
  private routes: { base: string; token: string } | null = null;
  private constructor(readonly platform: Platform, readonly scripted: ScriptedModel, readonly root: string,
    readonly database: string, readonly policy: TaskAutomationPolicyV1) {
    this.target = { database };
  }

  static async open(options: PlanBoardOptions): Promise<PlanBoard> {
    const root = await tempDir('plan-board-ws-');
    const database = await tempDir('plan-board-db-');
    await writeAG2bWorkspace(root);
    const scripted = createScriptedModel(options.replies, options.duringReply === undefined ? undefined
      : async (request, index) => options.duringReply?.(index, request));
    const workflow: WorkflowHostConfiguration = { consumerId: AG2B_CONSUMER_ID, bindings: [{ workspace: AG2B_SCOPE,
      sessionRole: AG2B_WORK_ROLE, roleBinding: AG2B_WORK_ROLE_BINDING, budget: { tokenBudget: 1_000_000, deadline: null } }] };
    const platform = await createTargetPlatform({
      storage: { kind: 'sqlite', directory: database },
      workspace: ag2bWorkspaceBindings(root, { value: 1 }, permissionRevision(SCENARIO_OPERATOR, AG2B_SCOPE, ['.'])),
      now: () => BOARD_AT,
      kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
        databasePath: join(database, 'kernel.sqlite') }] },
      runtime: ag2bWorkRuntime(() => scripted, { tools: PLAN_BOARD_TOOLS }),
      checks: ag2bChecksConfiguration({ actor: SCENARIO_OPERATOR,
        command: (options.check ?? 'pass') === 'pass' ? PASS_COMMAND : AG2B_CHECK_COMMAND }),
      workflow,
    });
    boardPlatforms.push(platform);
    const policy = structuredClone(options.automation ?? DEFAULT_TASK_AUTOMATION_POLICY);
    platform.registerAutomationPolicy(policy);
    await seedThroughOwners(platform, SCENARIO_OPERATOR, options.workIds);
    const board = new PlanBoard(platform, scripted, root, database, policy);
    await board.check('seeded');
    return board;
  }

  ctx(actor = SCENARIO_OPERATOR): CoreCallContext { return hostCtx(actor); }

  /** §11 invariants after a write outside `advance` (`step` names its kind and writer), then the Goal display phase. */
  async check(label: string, step?: Omit<FuzzStep, 'automationPolicy'>): Promise<void> {
    await assertInvariantsAt(this.target, label, step === undefined ? undefined
      : { ...step, automationPolicy: structuredClone(this.policy), label });
    this.phases.push((await this.goalDisplay()).phase);
  }

  /** Drives the Workflow as the operator until it settles or `stopBefore`; invariants and the display phase after every receipt. */
  async advance(first: WorkflowAdvanceInput, stopBefore: (input: WorkflowAdvanceInput) => boolean = () => false): Promise<BoardDriven> {
    const driven: BoardDriven = { receipts: [], performed: [], state: 'stopped', reason: null, next: null };
    let input = first;
    for (let step = 0; step < 64; step += 1) {
      if (stopBefore(input)) return { ...driven, next: input };
      const result = await this.platform.workflow.advanceWork(this.ctx(), input);
      if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
      const receipt = result.value.receipt;
      if (receipt !== null) {
        driven.receipts.push(receipt);
        if (input.kind === 'perform') driven.performed.push({ operation: input.operation, receipt });
        const label = `${first.flowId}#${step} ${receipt.kind}`;
        await assertInvariantsAt(this.target, label, stepOfReceipt(receipt, SCENARIO_OPERATOR, this.policy, label));
        this.phases.push((await this.goalDisplay()).phase);
      }
      if (result.value.state === 'completed' || result.value.next === null) {
        return { ...driven, state: result.value.state, reason: result.value.reason };
      }
      input = result.value.next;
    }
    throw new Error('the Workflow did not settle within the step guard');
  }

  /** `select_work` on the AG2b Goal; Goal-level unless `taskId` is given. */
  select(flowId: string, taskId?: string): WorkflowAdvanceInput {
    return { schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId, sessionHint: null, kind: 'select_work',
      ...(taskId === undefined ? {} : { taskId }) };
  }

  async graph(): Promise<{ plan: PlanRevisionSnapshot; tasks: TaskRow[] }> {
    const read = await this.platform.plans.queryTaskGraph(this.ctx(), { goalRef: AG2B_GOAL_REF });
    if (read.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(read)}`);
    return read.value;
  }
  async taskRow(taskId: string): Promise<TaskRow> {
    const row = (await this.graph()).tasks.find(candidate => candidate.ref.taskId === taskId);
    if (row === undefined) throw new Error(`the Task ${taskId} must be in the graph`);
    return row;
  }
  async goalDisplay(): Promise<GoalDisplayV1> {
    const read = await this.platform.plans.queryGoalDisplay!(this.ctx(), { goalRef: AG2B_GOAL_REF });
    if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
    return read.value.display;
  }
  async readRun(runRef: RunRef): Promise<TaskExecutionRecord> {
    const read = await this.platform.executions.readExecution(this.ctx(), runRef);
    if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
    return read.value;
  }
  /** The next v2 draft of the active Plan (`planId`), its draft fields copied, then `edit`ed. */
  nextDraft(planId: string, edit: (draft: DraftV2) => DraftV2): Promise<{ source: PlanRevisionSnapshot; draft: DraftV2 }> {
    return nextPlanDraft(this.platform, planId, edit, this.ctx());
  }

  /**
   * One core route over HTTP, served by the Host's route layer on this board's platform: `createWorkbenchServer`
   * with `createPlatformCoreRouteBindings` (the route table `host.ts:1116` binds), the operator as the startup
   * actor, so the owner is called with the Host call context the server builds (`createHostCoreCallContext`).
   * Any answer: a refusal is a non-200 carrying its rejection body.
   */
  async route<T>(suffix: string, body: unknown): Promise<T> {
    if (this.routes === null) {
      const token = 'plan-board-route-token';
      const server = createWorkbenchServer({ token, bindings: createPlatformCoreRouteBindings(this.platform), actor: { ...SCENARIO_OPERATOR },
        bootstrap: () => ({ workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] } }),
        allowsScope: scope => scope.projectId === AG2B_SCOPE.projectId && scope.workspaceId === AG2B_SCOPE.workspaceId });
      boardServers.push(server);
      const address = await server.listen(0);
      this.routes = { base: `http://${address.host}:${address.port}`, token };
    }
    const response = await corePost(this.routes.base, suffix, this.routes.token, body);
    return await response.json() as T;
  }
}

// ---------------------------------------------------------------------------
// Composition roots on a Host scenario's files
// ---------------------------------------------------------------------------

/**
 * A composition root on a Host scenario's files with the Host's Runtime grant (the AG2b work binding over `model`,
 * whose default has no reply, and the query binding over `queryModel` when given) and an optional commit observer;
 * no instance lease, no start-up reconcile, the Host's clock. Two uses:
 * - an Agent's owner call (a `work_run` caller): the owners admit it through the delegated-write admission
 *   (`authorizeDelegatedWrite`) as the Host's own platform does, which `HostScenario.direct()` (no Runtime) cannot;
 * - the crash points between two commits of one Runtime call that the Host has no seam for (W-02 with
 *   `authorizeWithoutBegin`; A8-2d, A8-3b, A8-3h, A8-Q3 with `lockLedgerAfter`).
 * The caller closes it, before the next Host start, so the reconcile's "the old process is gone" holds (§12.1).
 */
export async function openWorkRoot(h: HostScenario, model: ScriptedModel = createScriptedModel([]),
  observer?: RecordCommitObserver, queryModel?: ScriptedModel, tools?: readonly string[],
  hostInstance?: HostInstanceFacts): Promise<Platform> {
  return await createTargetPlatform({
    storage: { kind: 'sqlite', directory: h.database },
    workspace: ag2bWorkspaceBindings(h.root, { value: 1 }, permissionRevision(h.stepActor(), AG2B_SCOPE, ['.'])),
    now: () => AG2B_AT,
    kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
      databasePath: join(h.database, 'kernel.sqlite') }] },
    runtime: ag2bWorkRuntime(() => model, { ...(queryModel === undefined ? {} : { queryModel }),
      ...(tools === undefined ? {} : { tools }) }),
    ...(observer === undefined ? {} : { commitObserver: observer }),
    ...(hostInstance === undefined ? {} : { hostInstance }),
  });
}

/**
 * Refreeze §5 (lead-approved): `openWorkRoot` with an owned Host instance lease,
 * so the real start-up-reconcile health owner runs on the scenario files:
 * `platform.reconcile.recordSessionHealth(ctx,{ sessionRef, probe:{ verdict:'missing' } })`
 * writes SES-12 `unavailable`, and `{ verdict:'ready' }` writes SES-13 recovery.
 * Additive only; `openWorkRoot`'s default behaviour is unchanged.
 */
export async function openOwnedWorkRoot(h: HostScenario, model: ScriptedModel = createScriptedModel([]),
  observer?: RecordCommitObserver, tools?: readonly string[]): Promise<Platform> {
  return await openWorkRoot(h, model, observer, undefined, tools,
    { hostInstanceId: 'wp2-scenario-host', lease: 'owned' });
}

/**
 * W-02 (§12.2 A8-1): the start of `prepared` as the Workflow's consumer (the Host actor), through `openWorkRoot`,
 * cancelled right after the first Run commit (the entry authorization, RUN-02) and before the begin (RUN-04): the
 * Run is `Authorized` and never reaches the Kernel. Its model has no reply, so a call would fail the start.
 * `policy` is registered on the root first when given. Answers the start's answer and the model calls it made.
 */
export async function authorizeWithoutBegin(h: HostScenario, prepared: PreparedTaskExecution, requestId: string,
  options: { consumerId?: string; policy?: TaskAutomationPolicyV1 } = {}): Promise<{ answer: unknown; modelCalls: number }> {
  let abortAfterRunCommit: AbortController | null = null;
  const observer: RecordCommitObserver = {
    started() { /* the head is not needed */ },
    committed(notice) {
      if (abortAfterRunCommit !== null && notice.aggregates.some(aggregate => aggregate.aggregateType === 'Run')) {
        abortAfterRunCommit.abort();
        abortAfterRunCommit = null;
      }
    },
  };
  const model = createScriptedModel([]);
  const platform = await openWorkRoot(h, model, observer);
  if (options.policy !== undefined) platform.registerAutomationPolicy(options.policy);
  try {
    const controller = new AbortController();
    abortAfterRunCommit = controller;
    const answer = await platform.runtime.startRun({ ...hostCtx(h.stepActor()), signal: controller.signal },
      { prepared, consumerId: options.consumerId ?? AG2B_CONSUMER_ID, requestId });
    return { answer, modelCalls: model.calls() };
  } finally {
    await platform.close();
  }
}
