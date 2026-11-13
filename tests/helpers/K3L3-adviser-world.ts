/**
 * K3L-3's world: an unknown-outcome record whose Goal has an adviser line the Host consumes (SQLite only: the record
 * comes from a Host crash). K3L-6 and the scribe review package reuse it.
 *
 * Every prior state is a public step: `openPLConsumptionWorld` (the real Host consume world; the adviser binding and
 * Query profile are Host input; the Work binding's `shell` grant on every start; the root a git work tree, so the
 * takeover cleans up, W-26), `plans/propose` + `plans/apply`, `sessions/create`, `role-lines/open` +
 * `goals/adviser-queue/assign` (`createPLAdviserLine`), `workflow/advance`, a scripted `shell` call held by the K3
 * seam and a crash restart (rule sheet A2: the takeover writes the record), `goals/control` and
 * `workflow/driver-start|stop` (the person continues the interrupted Goal), and public reads. The test file owns the
 * `vi.mock`s: the shell factory (`K3-tool-seams.ts`) and the commit barrier's two (`S6A-commit-barrier.ts`).
 */
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { waitFor } from '../scenarios/harness.js';
import { driveWorkflow, type AdvanceValue } from './A2-restart-fixture.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { heartbeatUntil, readBody, readPlanningQuery } from './IV-host-fixture.js';
import { shellSeam } from './K3-tool-seams.js';
import {
  adoptPLMixedPlan, createPLAdviserLine, createPLLine, openPLConsumptionWorld, PL_ADVISER_ROLE,
} from './PL-consumption-fixture.js';
import type { S6AGate, S6AHostWorld, S6AReply } from './S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from './S6A-request-fixture.js';
import { committed, ready } from './S7A-fixture.js';
import { sendS7A2PersonMessage } from './S7A2-fixture.js';
import { listed, readS7BMessage } from './S7B-fixture.js';
import { inboxOf } from './S7B-F-support.js';
import type { S9ToolResult } from './S9-review-fixture.js';

export type K3L3World = {
  readonly world: S6AHostWorld; readonly goal: GoalRef; readonly task: TaskTriple;
  readonly workLine: S6ASession; readonly adviser: S6ASession;
};

/**
 * The `scr:` request numbers found in every Session's saved message body, every workspace line and archived included.
 * Without a scribe line, or without a Goal, the platform must open no review round, so this is empty.
 */
export async function scrRoundsInEverySession(world: S6AHostWorld):
Promise<Array<{ sessionId: string; text: string }>> {
  const rounds: Array<{ sessionId: string; text: string }> = [];
  for (const card of await world.listSessions()) {
    const ref = { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId };
    for (const message of await inboxOf(world, ref)) {
      const text = await readBody(world, message.ref, 'message');
      if (text.startsWith('scr:')) rounds.push({ sessionId: ref.sessionId, text });
    }
  }
  return rounds;
}

/**
 * One SQLite Host world, `resumeOnStartup` off, one Plan on the first Goal with the Work Task `<label>-work` on the
 * work role, its Work line and the Goal's adviser line. `readonlyCommands`: the Work binding may also run the
 * read-only command (a proposal round needs it). `checks`: the trusted check a normally ended Work Run is verified
 * by (K3L-6: a failing check sends the Task to its automatic rework).
 */
export async function openK3L3World(label: string, options: { readonlyCommands?: boolean;
  checks?: boolean | TrustedCheckConfiguration;
  /** A second Work Task (`${label}-other`) on the same line, so a Goal-level selection passes the first. */
  otherTask?: boolean } = {}): Promise<K3L3World> {
  const world = await openPLConsumptionWorld({ backend: 'sqlite', label, write: 'every_start', gitRoot: true,
    readonlyCommands: options.readonlyCommands === true,
    ...(options.checks === undefined ? {} : { checks: options.checks }) });
  try {
    await world.setResumeOnStartup(false);
    const goal = world.goals.first;
    const { tasks } = await adoptPLMixedPlan(world, { goal, label,
      tasks: [{ taskId: `${label}-work`, role: S6A_WORK_ROLE.templateId },
        ...(options.otherTask === true ? [{ taskId: `${label}-other`, role: S6A_WORK_ROLE.templateId }] : [])] });
    const workLine = await createPLLine(world, { label: `${label}-work-line`, role: S6A_WORK_ROLE, tasks });
    return { world, goal, task: tasks[0]!, workLine, adviser: await createPLAdviserLine(world, `${label}-adviser`) };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** The Work Task's `select_work` on `flowId`. */
export function selectK3L3(w: K3L3World, flowId: string): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: w.goal, flowId, sessionHint: w.workLine.ref, kind: 'select_work',
    taskId: w.task.taskId };
}

/** `workflow/advance` from `from` until it waits, completes or reaches a `perform` that `stopBefore` names. */
export async function advanceK3L3(w: K3L3World, from: WorkflowAdvanceInput,
  stopBefore?: (op: { kind: string }) => boolean): Promise<{ last: AdvanceValue; receipts: WorkflowStepReceipt[] }> {
  const receipts: WorkflowStepReceipt[] = [];
  const steps = await driveWorkflow(w.world.ag2b, from, { receipts, ...(stopBefore === undefined ? {} : { stopBefore }) });
  return { last: steps.at(-1)!, receipts };
}

/** A gate's step reached while the Host's consume pass holding it stays open: the clock moves without the barrier. */
export async function reachK3L3<T>(w: K3L3World, gate: S6AGate<T>, what: string): Promise<void> {
  let reached = false;
  void gate.reached.then(() => { reached = true; });
  await waitFor(async () => { w.world.clock.advance(25); return reached; }, done => done, what);
}

/**
 * The Work line's next Run calls `shell` once and the seam holds it; the Host crashes there, the new Host's takeover
 * writes the record, and the person continues the interrupted Goal (pause, driver start and stop, resume: the start
 * is the one step that resolves the interruption; on a paused Goal the driver selects nothing). The drive starts at
 * the Task's `select_work`. Returns the held Run; the seam stays armed until the test file releases it.
 *
 * The crashed Host is abandoned, not stopped (rule sheet A2), and its consume loop would go on taking messages from
 * the same store; `occupyK3L3Consumer` keeps it busy first.
 */
export async function crashK3L3Command(w: K3L3World, label: string, command = `${label} runs a program`): Promise<RunRef> {
  await occupyK3L3Consumer(w, label);
  const held = shellSeam.enabled ? shellSeam.calls.length : 0;
  if (!shellSeam.enabled) shellSeam.arm();
  await w.world.scripted.script(w.workLine, [{ kind: 'calls', calls: [
    { callId: `${label}-shell`, name: 'shell', args: { command } }] }]);
  let failure: unknown = null;
  driveWorkflow(w.world.ag2b, selectK3L3(w, `${label}-crash`)).catch(error => { failure = error; });
  await waitFor(async () => shellSeam.calls.length > held || failure !== null, done => done, `${label}: the held shell`);
  if (failure !== null) throw failure;
  const facts = ready<{ latestWork: { runRef: RunRef } | null }>(
    await w.world.post('sessions/facts', plain(S6A_SCOPE, w.workLine.ref)), `${label}: the Work line facts`);
  if (facts.latestWork === null) throw new Error(`K3L3: ${label} reached the shell call with no Work claim`);
  await w.world.crash();
  await continueK3L3Goal(w, label);
  return facts.latestWork.runRef;
}

/**
 * After a crash restart the person continues the interrupted Goal: pause, driver start and stop, resume (the start is
 * the one step that resolves the interruption; on a paused Goal the driver selects nothing). Until then the Host
 * consumes no intervention of the Goal (`intervention.ts`: `busy`, a person continues it by starting the Goal).
 */
export async function continueK3L3Goal(w: K3L3World, label: string): Promise<void> {
  await controlK3L3Goal(w, 'pause', `${label}-pause`);
  ready(await w.world.post('workflow/driver-start', plain(S6A_SCOPE, { advance: { schemaVersion: 1, goalRef: w.goal,
    flowId: `${label}-driver`, sessionHint: null, kind: 'select_work' }, queryProfileIds: [] })), `${label}: driver start`);
  ready(await w.world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: w.goal })), `${label}: driver stop`);
  await controlK3L3Goal(w, 'resume', `${label}-resume`);
}

/**
 * Before a crash: a decoy adviser-role line's round is held at its model request (A3), which keeps the running Host's
 * one workspace consume job busy until the world closes, so only the next Host consumes the adviser's rounds.
 */
export async function occupyK3L3Consumer(w: K3L3World, label: string): Promise<void> {
  const decoy = await createPLLine(w.world, { label: `${label}-decoy`, role: PL_ADVISER_ROLE });
  const busy = await w.world.gates.modelRequest(decoy);
  await sendS7A2PersonMessage(w.world, { label: `${label}-decoy`, recipient: decoy.ref, goal: w.world.goals.second });
  await reachK3L3(w, busy, `${label}: the decoy round at its model request`);
}

/** `goals/control` of the world's Goal (its two pins read publicly). */
export async function controlK3L3Goal(w: K3L3World, control: 'pause' | 'resume', requestId: string): Promise<void> {
  const goal = ready<{ goal: { revision: number } }>(await w.world.post('goals/read', plain(S6A_SCOPE, w.goal)), 'the Goal');
  const graph = ready<{ completion?: { status: 'not_recorded' } | { status: 'recorded'; snapshot: { revision: number } } }>(
    await w.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: w.goal })), 'the Task graph');
  const phase = graph.completion?.status === 'recorded' ? graph.completion.snapshot.revision : 0;
  committed(await w.world.post('goals/control', graphWrite(S6A_SCOPE, { goalRef: w.goal, control,
    reason: `K3L3 ${requestId}` }, requestId, [{ ref: w.goal, revision: goal.goal.revision },
    { ref: { aggregateType: 'GoalPhase', projectId: w.goal.projectId, goalId: w.goal.goalId }, revision: phase }])),
  `the Goal ${control}`);
}

/** `unknown-call-reviews/read` of the record of `runRef`. */
export async function readK3L3Review(w: K3L3World, runRef: RunRef): Promise<UnknownCallReviewV1> {
  return ready<UnknownCallReviewV1>(await w.world.post('unknown-call-reviews/read', plain(S6A_SCOPE, { runRef })),
    `the record of ${runRef.runId}`);
}

/** The adviser line's system rounds of one kind (`ucr:`, K3L-6's `crr:`; inbox order) with their saved bodies. */
export async function adviserRoundsOf(w: K3L3World, prefix = 'ucr:'): Promise<Array<{ message: SessionMessage; text: string }>> {
  const rounds: Array<{ message: SessionMessage; text: string }> = [];
  for (const message of await listed(w.world, 'inbox', w.adviser)) {
    const text = await readBody(w.world, message.ref, 'message');
    if (message.intent === 'action_request' && text.startsWith(prefix)) rounds.push({ message, text });
  }
  return rounds;
}

/** The Host's notices to the adviser line (their saved bodies). */
export async function adviserNoticesOf(w: K3L3World): Promise<string[]> {
  const notices: string[] = [];
  for (const message of await listed(w.world, 'inbox', w.adviser)) {
    if (message.sender.kind === 'host' && message.intent === 'notify') notices.push(await readBody(w.world, message.ref, 'message'));
  }
  return notices;
}

/**
 * Scripts the adviser line with `replies` (none: already scripted), runs Host passes until the round's Query has
 * ended and until the Host closed the source (reply or withdraw); returns the ended Query and the closed source.
 */
export async function answerK3L3Round(w: K3L3World, round: SessionMessage, replies: readonly S6AReply[]):
Promise<{ query: QueryJobRecord; source: SessionMessage }> {
  if (replies.length > 0) await w.world.scripted.script(w.adviser, replies);
  const ended = (value: QueryJobRecord | null): boolean => value?.job.job.status === 'answered'
    || value?.run.run.status === 'closed' || value?.run.run.executionState?.phase === 'settled';
  const query = await heartbeatUntil(w.world, () => readPlanningQuery(w.world, round.ref), ended, 32);
  if (query === null || !ended(query)) throw new Error(`K3L3: the adviser Query of ${round.ref.messageId} did not end`);
  const source = await heartbeatUntil(w.world, () => readS7BMessage(w.world, round.ref),
    message => message.response !== null || message.withdrawnAt !== null, 16);
  if (source.response === null && source.withdrawnAt === null) {
    throw new Error(`K3L3: the Host did not close the adviser round ${round.ref.messageId}`);
  }
  return { query, source };
}

/** The frozen manifest of the round's prepared Query (`materials/open` of its bundle). */
export async function adviserManifestOf(w: K3L3World, round: SessionMessage): Promise<PreparedQueryManifestV1> {
  const prepared = (await readPlanningQuery(w.world, round.ref))?.run.run.executionState?.prepared;
  if (prepared === null || prepared === undefined) throw new Error(`K3L3: the Query of ${round.ref.messageId} was not prepared`);
  const bundle = ready<{ body: string }>(await w.world.post('materials/open', plain(S6A_SCOPE,
    { ref: prepared.bundleRef, usage: 'historical_explanation' })), 'the adviser Query manifest');
  return JSON.parse(bundle.body) as PreparedQueryManifestV1;
}

/** The tool result the adviser line's (or `line`'s) model was served for `callId` (read off its model requests). */
export async function adviserToolResult(w: K3L3World, callId: string, line: S6ASession = w.adviser): Promise<S9ToolResult> {
  for (const request of await w.world.scripted.requests(line)) {
    const message = request.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
    if (message !== undefined && message.role === 'tool') return message.result as unknown as S9ToolResult;
  }
  throw new Error(`K3L3: no adviser model request carries the tool result ${callId}`);
}

/** One `decisions/queue` read of the main workspace. */
export async function k3l3Queue(w: K3L3World, sections: readonly string[], categories?: readonly string[]):
Promise<DecisionQueueReadV1> {
  return ready<DecisionQueueReadV1>(await w.world.post('decisions/queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE,
    sections: [...sections], ...(categories === undefined ? {} : { categories: [...categories] }),
    page: { limit: 100 } })), 'the decision queue');
}

/** The waiting card of the record at its current revision, `undefined` when it has none. */
export async function k3l3CardOf(w: K3L3World, record: UnknownCallReviewV1): Promise<DecisionCardV1 | undefined> {
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  return (await k3l3Queue(w, ['waiting_answer'])).waitingAnswer.find(card => card.source.key === key);
}
