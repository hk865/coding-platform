/**
 * 7A-1 fixture (book §5 "Fixtures"; start ruling SR13): the public setups a 7A-1 row drives its real subject from.
 * One S6A host world carries every backend; this file composes the frozen steps of the request, host, cards and
 * 6B-1 fixtures and never opens a second world, copies a step or writes a fact by hand.
 *
 * Rules:
 * - Every state comes from a public step: the Host's own start and routes, the public Workflow (`workflow/advance`),
 *   the public owners (`notes`, `messages`, `goals`, `sessions`), the real read-only copy (`makeReadonlyCopy`), the
 *   6B-1 held request round and the scripted model's real tool calls. Every pin and pointer revision a step sends is
 *   what a public read returned just before.
 * - The commit gate is `commitBarrier.hold`; the crash is the world's own `crash()` (one call, never `reopen`). The
 *   held commit stays held after the crash and up to the test's teardown; only the test calls `commitBarrier.reset()`
 *   before closing the world. No step releases a held commit in a `finally`.
 * - A wrapper delegates to the real dependency, returns its result unchanged and is restored on every path.
 * - Steps a later 7A-1 wave has to complete (X's mailbox, L's Host injections) call the real owner and surface its
 *   named rejection; they never build the owner or a result themselves.
 * - Cleanup: every step takes a world or Session a test already has; `openS7A*` closes its world only when its own
 *   setup fails, otherwise the test closes it. `holdS7AQueryRound` restores its wrapper in a `finally`; the round's
 *   own gate is released by `holdS6BRequestRound`.
 */
import { fileURLToPath } from 'node:url';
import { expect, vi } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { GoalControlOutcomeV1, GoalDisplayHostReadV1 } from '../../src/app/goal-fan-out-driver.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { GoalAutonomyV1 } from '../../src/contracts/goal-decisions.js';
import type { NoteAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { RoleConfigurationRef, SessionRef, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RoleBindingRefV1, RunRef } from '../../src/contracts/dispatch.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type {
  MessageSecretaryRoundSender, MessageSender, SessionMessage,
} from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import * as toolGroupAssembly from '../../src/core/agent-runtime/tool-group-assembly.js';
import { AG2B_RUNTIME_BUDGET, ag2bPlanDraft, graphWrite, permissionRevision, plain } from './AG2b-collaboration-fixture.js';
import { driveWorkflow, advanceUntil } from './A2-restart-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { commitBarrier, type CommitHold, type CommitMatch } from './S6A-commit-barrier.js';
import { openS6AHostWorld, type S6AHostWorld } from './S6A-host-fixture.js';
import {
  S6A_SCRIBE_ROLE, S6A_SCOPE, S6A_SECRETARY_ROLE, S6A_WORK_ROLE,
  type S6AExtraBinding, type S6ARequestWorld, type S6ASession, type S6AWorldOptions,
} from './S6A-request-fixture.js';
import {
  adoptS6BPlan, createS6BLine, governS6B, holdS6BRequestRound, understandingPointer,
  type S6BHeldRound,
} from './S6B1-fixture.js';

const OPERATOR = { kind: 'human' as const, id: 's6a-operator' };
const ADVISER_ROLE = platformRoleProfile('adviser').template;
const ADVISER_ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 's7a-adviser-binding', templateId: ADVISER_ROLE.templateId,
  templateRevision: ADVISER_ROLE.templateRevision, bindingVersion: 1, policyRevision: 'legacy-template',
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function answerOf(body: unknown): unknown {
  const record = asRecord(body);
  return 'httpStatus' in record && 'body' in record ? record['body'] : body;
}
function ready<T>(body: unknown, what: string): T {
  const answer = asRecord(answerOf(body));
  if (answer['status'] !== 'ready') throw new Error(`S7A: ${what} is not ready: ${JSON.stringify(body)}`);
  return answer['value'] as T;
}
function committed<T>(body: unknown, what: string): T {
  const answer = asRecord(answerOf(body));
  if (answer['status'] !== 'committed') throw new Error(`S7A: ${what} did not commit: ${JSON.stringify(body)}`);
  return answer['value'] as T;
}
export const sameSession = (left: SessionRef, right: SessionRef): boolean =>
  left.projectId === right.projectId && left.sessionId === right.sessionId;
export const sameRun = (left: RunRef, right: RunRef): boolean =>
  left.aggregateType === right.aggregateType && left.projectId === right.projectId
  && left.goalId === right.goalId && left.runId === right.runId;
const sameQueryRun = (left: QueryRunRef, right: QueryRunRef): boolean =>
  left.aggregateType === right.aggregateType && left.projectId === right.projectId
  && left.workspaceId === right.workspaceId && left.queryJobId === right.queryJobId && left.runId === right.runId;
const sameQueryJob = (left: QueryJobRef, right: QueryJobRef): boolean =>
  left.aggregateType === right.aggregateType && left.projectId === right.projectId
  && left.workspaceId === right.workspaceId && left.queryJobId === right.queryJobId;

function receiptOf<K extends WorkflowStepReceipt['kind']>(receipts: readonly WorkflowStepReceipt[], kind: K):
Extract<WorkflowStepReceipt, { kind: K }> | undefined {
  return receipts.find((receipt): receipt is Extract<WorkflowStepReceipt, { kind: K }> => receipt.kind === kind);
}
/** This Workflow call's committed claim and its checked `start`; never the Task's current execution. */
export function claimedRunOf(receipts: readonly WorkflowStepReceipt[], what: string): { claim: TaskClaim; run: RunRef } {
  const claim = receiptOf(receipts, 'claim_task');
  const start = receiptOf(receipts, 'start');
  if (claim === undefined || claim.result.status !== 'committed'
    || start === undefined || start.result.status !== 'ready') throw new Error(
    `S7A: the Workflow did not claim and start ${what}`);
  if (!sameRun(start.result.value.run.ref, claim.result.value.runRef)) throw new Error(
    `S7A: the start is not ${what}'s claim`);
  return { claim: claim.result.value, run: claim.result.value.runRef };
}
/** The public Task read proves the first Task is satisfied; `verifying` is never accepted. */
export async function assertTaskCompleted(world: S6AHostWorld, goal: GoalRef, taskId: string): Promise<void> {
  const graph = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string }> }>(
    await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal })), `the task graph of ${goal.goalId}`);
  if (!graph.tasks.some(task => task.ref.taskId === taskId && task.effectivePhase === 'satisfied')) throw new Error(
    'S7A: the first Task did not complete');
}

/** A trusted runtime binding of the shape the Host's real start accepts; only the adviser is new, the others merge. */
function bindingOf(id: string, role: Extract<RoleConfigurationRef, { kind: 'legacy_template' }>, instruction: string,
  tools: readonly string[]): WorkbenchRuntimeBinding {
  const skillsRoot = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
  return {
    id, label: `S7A ${id}`, scope: S6A_SCOPE, role: structuredClone(role), configurationRevision: `${id}@1`,
    model: { revision: `${id}-model@1`, provider: 'deepseek', model: `s7a-scripted-${id}`,
      secretEnvironmentVariable: 'S6A_CONTROLLED_SECRET' },
    grant: {
      budget: AG2B_RUNTIME_BUDGET,
      hostTemplate: { templateId: role.templateId, revision: role.templateRevision, digest: sha256Hex(instruction) },
      tools: [...tools], writeScope: [], skills: { resourceRoot: skillsRoot, enabledIds: [] },
      systemInstruction: instruction, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
    },
  };
}

const ADVISER_WORKFLOW = { workspace: S6A_SCOPE, sessionRole: ADVISER_ROLE, roleBinding: ADVISER_ROLE_BINDING,
  budget: { tokenBudget: 1_000_000, deadline: null } };

/** The four extension entries: one new adviser binding (Runtime + Workflow) and three tool merges by binding id. */
const S7A_EXTRA_BINDINGS: readonly S6AExtraBinding[] = [
  { binding: bindingOf('s7a-adviser-binding', ADVISER_ROLE, 'S7A trusted adviser guidance',
    ['read', 'send_session_message']), workflow: ADVISER_WORKFLOW },
  { binding: bindingOf('s6a-work-binding', S6A_WORK_ROLE, 'S6A trusted work guidance', ['read']),
    mergeTools: ['send_session_message'] },
  { binding: bindingOf('s6a-scribe-binding', S6A_SCRIBE_ROLE, 'S6A trusted scribe guidance', ['read', 'record_note']),
    mergeTools: ['send_session_message'] },
  { binding: bindingOf('s6a-secretary-binding', S6A_SECRETARY_ROLE, 'S6A trusted secretary guidance', ['read']),
    mergeTools: ['look_graph'] },
];

/** The Host input a reply Run needs: the Work binding with `respond_session_message` merged in. */
export const S7A_REPLY_TOOLS: S6AExtraBinding = {
  binding: bindingOf('s6a-work-binding', S6A_WORK_ROLE, 'S6A trusted work guidance', ['read']),
  mergeTools: ['respond_session_message'],
};

const worlds = new WeakSet<S6ARequestWorld>();

/** The full Session handle of a line the 6B-1 step created (`sessions/read`). */
export async function sessionOf(world: S6AHostWorld, line: Awaited<ReturnType<typeof createS6BLine>>): Promise<S6ASession> {
  const card = await world.readSession(line.ref);
  return { label: line.label, ref: line.ref, aggregateRef: card.record.ref,
    role: structuredClone(card.record.role), createdAt: card.record.createdAt };
}

/** The one governance seed of a world (its request ids restart with every call). */
async function ensureGovernance(world: S6AHostWorld, main: S6ACardsWorkspace): Promise<void> {
  if (worlds.has(world)) return;
  worlds.add(world);
  await governS6B(world, main, world.goals);
}

/** The trusted check configuration: one static echo covers every Task (the round's own check command). */
function checkConfiguration(actor: { kind: 'human'; id: string }): TrustedCheckConfiguration {
  return {
    configurationRevision: 's7a-static-check@1', workspace: { aggregateType: 'Workspace', ...S6A_SCOPE },
    executor: { ...actor }, permissionRevision: permissionRevision(actor, S6A_SCOPE, ['.']),
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 's7a-static-check', kind: 'static', command: 'echo S7A_CHECKS_OK',
      cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
}

function requestWorldOptions(options: S6AWorldOptions): S6AWorldOptions {
  const actor: { kind: 'human'; id: string } = options.actor !== undefined && options.actor.kind === 'human'
    ? { kind: 'human', id: options.actor.id } : { ...OPERATOR };
  return {
    ...options, scribe: true, extraBindings: S7A_EXTRA_BINDINGS,
    extraHostOptions: { checks: checkConfiguration(actor), ...(options.extraHostOptions ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// The worlds and the goal/plan/pointer seeds
// ---------------------------------------------------------------------------

/** A Work line with a completed first Task and a pending second Task. */
export async function openS7AWorkWorld(options: S6AWorldOptions) {
  const world = await openS6AHostWorld(requestWorldOptions(options));
  try {
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await world.setResumeOnStartup(false);
    await ensureGovernance(world, main);
    const goal = (await main.createGoal('s7a-goal', 'S7A work goal')).ref;
    const { plan, tasks } = await adoptS6BPlan(main, goal, { label: 's7a-work',
      taskIds: ['s7a-run-1', 's7a-run-2'], role: S6A_WORK_ROLE.templateId });
    const line = await sessionOf(world, await createS6BLine(main, { label: 's7a-line', role: S6A_WORK_ROLE, tasks }));
    await world.scripted.script(line, [{ kind: 'text', text: 'S7A first Work answer' }]);
    // The first Run ends; its own round opens. The drive stops before the SECOND Task's claim, after this
    // Task's successful `complete_task` and its public read-back.
    const claimInput = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: goal, flowId: 's7a-first',
      sessionHint: line.ref, kind: 'select_work' as const, taskId: tasks[0]!.taskId }, 'claim_task');
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, claimInput, { stopBefore: 'claim_task', receipts });
    const { run } = claimedRunOf(receipts, 'the first Task');
    ready(await world.post('executions/read', plain(S6A_SCOPE, run)), 'the first Task Run');
    const completed = receiptOf(receipts, 'complete_task');
    if (completed === undefined || completed.result.status !== 'committed') throw new Error(
      'S7A: the first Task did not complete');
    await assertTaskCompleted(world, goal, tasks[0]!.taskId);
    return { world, goal, plan, line, run };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** A real read-only copy of a Work line: the copy's Query is admitted by the consultation, never by a Work claim. */
export async function openS7AQueryWorld(options: S6AWorldOptions) {
  const world = await openS6AHostWorld(requestWorldOptions(options));
  try {
    const source = await world.createWorkSession('s7a-copy-source');
    const copy = await world.makeReadonlyCopy(source, 's7a-copy');
    const card = await world.readSession(copy.copy);
    if (card.record.provenance.kind !== 'readonly_copy') {
      throw new Error(`S7A: the copy is not a read-only copy: ${JSON.stringify(card.record.provenance)}`);
    }
    return { world, goal: world.goals.first, session: copy.copy, query: copy.query };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

const GOAL_ANCHOR = (goal: GoalRef): NoteAnchorV1 => ({ kind: 'goal', goalId: goal.goalId });

/** The person's goal understanding over the current pointer (`notes/write`; a person's note is accepted at once). */
async function writeGoalPointer(world: S6AHostWorld, goal: GoalRef, label: string) {
  const anchor = GOAL_ANCHOR(goal);
  const before = await understandingPointer(world, anchor);
  const draft = {
    kind: 'understanding' as const, topic: 's7a-understanding', conclusion: `S7A goal pointer ${label}`,
    anchor, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: before.noteId === null ? [] : [before.noteId], contradicts: [], coexistWith: [],
    sections: { status: 'ready', decided: label, open: 'none', next: 'continue', risks: 'none' },
  } satisfies NoteDraftV1;
  const written = await world.dispatch('notes/write', world.humanContext(), plain(S6A_SCOPE, {
    commandId: `s7a-note-${label}`, goalId: goal.goalId, expectedPointerRevision: before.revision, note: draft,
  })) as Record<string, unknown>;
  const write = asRecord(written['write']);
  if (write['status'] !== 'accepted') throw new Error(`S7A: the ${label} goal pointer was not accepted: ${JSON.stringify(written)}`);
  const after = await understandingPointer(world, anchor);
  if (after.noteId === write['noteId'] && after.revision === (before.revision ?? 0) + 1) return { before, after, write };
  throw new Error(`S7A: the ${label} goal pointer did not move: ${JSON.stringify(after)}`);
}

/** `goals/create`, `plans/propose` + adoption, then (with `pointer`) the person's goal pointer write. */
export async function seedS7AGoalPlan(world: S6AHostWorld, input: { pointer?: string } = {}) {
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await ensureGovernance(world, main);
  const label = input.pointer ?? 'one';
  const goal = (await main.createGoal(`s7a-goal-${label}`, `S7A goal ${label}`)).ref;
  const { plan } = await adoptS6BPlan(main, goal, { label: `s7a-${label}`,
    taskIds: [`s7a-${label}-1`, `s7a-${label}-2`], role: S6A_WORK_ROLE.templateId });
  const pointer = input.pointer === undefined ? null : await writeGoalPointer(world, goal, label);
  return { goal, plan, pointer };
}

/** `goals/settings/set` at the Goal's current revision, then the settings `goals/settings` publishes. */
export async function setS7AAutonomy(world: S6AHostWorld, goal: GoalRef, autonomy: GoalAutonomyV1) {
  const read = ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, goal)),
    `the goal ${goal.goalId}`);
  committed(await world.post('goals/settings/set', graphWrite(S6A_SCOPE, {
    goalRef: goal, autonomy, waitForGoalRef: null,
  }, `s7a-autonomy-${autonomy}`, [{ ref: goal, revision: read.goal.revision }])), `the ${autonomy} setting`);
  const settings = ready<{ settings: { autonomy: GoalAutonomyV1 } }>(
    await world.post('goals/settings', plain(S6A_SCOPE, { goalRef: goal })), `the settings of ${goal.goalId}`);
  if (settings.settings.autonomy !== autonomy) throw new Error(`S7A: the Goal autonomy did not move to ${autonomy}`);
  return settings.settings;
}

/** The two pins `goals/control` requires: the Goal and its GoalPhase at their public revisions. */
async function goalControlPins(world: S6AHostWorld, goal: GoalRef) {
  const read = ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, goal)),
    `the goal ${goal.goalId}`);
  const graph = ready<{ completion?: { status: 'not_recorded' } | { status: 'recorded'; snapshot: { revision: number } } }>(
    await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal })), `the task graph of ${goal.goalId}`);
  return [{ ref: goal, revision: read.goal.revision },
    { ref: { aggregateType: 'GoalPhase' as const, projectId: goal.projectId, goalId: goal.goalId },
      revision: graph.completion?.status === 'recorded' ? graph.completion.snapshot.revision : 0 }];
}

async function controlGoal(world: S6AHostWorld, goal: GoalRef, control: 'pause' | 'resume') {
  const value = committed<GoalControlOutcomeV1>(await world.post('goals/control', graphWrite(S6A_SCOPE, {
    goalRef: goal, control, reason: `S7A operator ${control}`,
  }, `s7a-control-${control}-${goal.goalId}`, await goalControlPins(world, goal))), `the ${control} control`);
  const display = ready<GoalDisplayHostReadV1>(await world.post('goals/display', plain(S6A_SCOPE, { goalRef: goal })),
    `the display of ${goal.goalId}`);
  return { goal: value.goal, display: display.display };
}

/** `goals/control` pause, then the public display read (`Phase` `PAUSED`). */
export async function pauseS7AGoal(world: S6AHostWorld, goal: GoalRef) {
  const result = await controlGoal(world, goal, 'pause');
  if (result.display.phase !== 'PAUSED') throw new Error(`S7A: the Goal is not paused: ${JSON.stringify(result.display)}`);
  return result;
}

/** `goals/control` resume, then the public display read (not `PAUSED`). */
export async function resumeS7AGoal(world: S6AHostWorld, goal: GoalRef) {
  const result = await controlGoal(world, goal, 'resume');
  if (result.display.phase === 'PAUSED') throw new Error(`S7A: the Goal is still paused: ${JSON.stringify(result.display)}`);
  return result;
}

/** `plans/propose` + its public adoption: the Goal's next Plan revision. */
export async function moveS7APlan(world: S6AHostWorld, goal: GoalRef) {
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const current = await main.activePlan(goal);
  if (current === null) throw new Error('S7A_PRECONDITION: the Goal has no adopted Plan to move from');
  const workIds = current.tasks.filter(task => task.taskKind === 'work').map(task => task.taskId);
  const draft = { ...ag2bPlanDraft(workIds), planId: 's7a-plan-move', goalId: goal.goalId,
    planRevision: current.planRevision + 1 };
  const proposed = committed<{ ref: unknown; revision: number }>(await world.post('plans/propose',
    graphWrite(S6A_SCOPE, { goalRef: goal, basedOn: current.ref, draft,
      reason: { text: 'S7A plan move', sources: [] } }, 's7a-plan-move-propose', [])), 'the moved Plan proposal');
  const adopted = committed<NonNullable<typeof current>>(await world.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, 's7a-plan-move-apply', [])), 'the moved Plan adoption');
  const plan = await main.activePlan(goal);
  if (plan === null) throw new Error('S7A: the Goal has no adopted Plan after the move');
  expect(plan.ref).toEqual(adopted.ref);
  expect(plan.planRevision).toBe(current.planRevision + 1);
  return { ref: plan.ref, planRevision: plan.planRevision };
}

/** The person's goal pointer move: `notes/list`'s old pointer, `notes/write` over it, the new `notes/list` pointer. */
export async function moveS7APointer(world: S6AHostWorld, goal: GoalRef) {
  const moved = await writeGoalPointer(world, goal, `move-${goal.goalId}`);
  return moved.after;
}

// ---------------------------------------------------------------------------
// The four real senders
// ---------------------------------------------------------------------------

type Sender = { line: S6ASession; task: { goalId: string; taskId: string; projectId: string };
  run: RunRef; message: SessionMessage; waiting: boolean };

async function sendFrom(world: S6AHostWorld, input: {
  goal: GoalRef; line: Sender['line']; task: Sender['task']; recipient: SessionRef; label: string; waitAfterSend: boolean;
}): Promise<Sender> {
  await world.scripted.script(input.line, [
    { kind: 'calls', calls: [{ callId: `s7a-send-${input.label}`, name: 'send_session_message',
      args: { recipient: input.recipient, text: `S7A message from ${input.label}`, intent: 'inquiry', needsReply: true,
        ...(input.waitAfterSend ? { waitAfterSend: true } : {}) } }] },
    { kind: 'text', text: `S7A ${input.label} answered` },
  ]);
  const select = { schemaVersion: 1 as const, goalRef: input.goal, flowId: `s7a-${input.label}`,
    sessionHint: input.line.ref, kind: 'select_work' as const, taskId: input.task.taskId };
  const receipts: WorkflowStepReceipt[] = [];
  if (input.waitAfterSend) await driveWorkflow(world.ag2b, select, { receipts });
  else await driveWorkflow(world.ag2b, select, { stopBefore: 'open_checks', receipts });
  const { claim, run } = claimedRunOf(receipts, `the ${input.label} sender`);
  const outbox = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
    plain(S6A_SCOPE, { senderRun: run, page: { limit: 20 } })), `the ${input.label} outbox`);
  const message = outbox.items[0];
  if (message === undefined) throw new Error(`S7A: the ${input.label} send is not in its Run's outbox`);
  const body = ready<{ text: string }>(await world.post('messages/body',
    plain(S6A_SCOPE, { messageRef: message.ref, part: 'message' })), `the ${input.label} body`);
  if (body.text !== `S7A message from ${input.label}`) throw new Error(`S7A: the ${input.label} body does not read back`);
  if (message.sender.kind !== 'work_run' || !sameSession(message.sender.sessionRef, input.line.ref)
    || !sameRun(message.sender.runRef, claim.runRef)) {
    throw new Error(`S7A: the ${input.label} message was not sent by its own Work Run: ${JSON.stringify(message.sender)}`);
  }
  const record = ready<{ run: { outcome: string } }>(await world.post('executions/read', plain(S6A_SCOPE, run)),
    `the ${input.label} Run`);
  const waiting = record.run.outcome === 'yielded';
  if (waiting !== input.waitAfterSend) throw new Error(`S7A: the ${input.label} Run outcome is ${record.run.outcome}`);
  return { line: input.line, task: input.task, run, message, waiting };
}

/** The three Work senders (adviser, scribe, executor with delegation) and their admitted messages. */
export async function seedS7ASenders(world: S6AHostWorld) {
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await ensureGovernance(world, main);
  const { tasks: executorTasks } = await adoptS6BPlan(main, world.goals.first, { label: 's7a-executor',
    taskIds: ['s7a-executor-send'], role: S6A_WORK_ROLE.templateId });
  const executorLine = await sessionOf(world,
    await createS6BLine(main, { label: 's7a-executor', role: S6A_WORK_ROLE, tasks: executorTasks }));
  const { tasks: adviserTasks } = await adoptS6BPlan(main, world.goals.second, { label: 's7a-adviser',
    taskIds: ['s7a-adviser-send'], role: ADVISER_ROLE.templateId });
  const adviserLine = await sessionOf(world,
    await createS6BLine(main, { label: 's7a-adviser', role: ADVISER_ROLE, tasks: adviserTasks }));
  const scribeGoal = (await main.createGoal('s7a-scribe-goal', 'S7A scribe goal')).ref;
  const { tasks: scribeTasks } = await adoptS6BPlan(main, scribeGoal, { label: 's7a-scribe',
    taskIds: ['s7a-scribe-send'], role: S6A_SCRIBE_ROLE.templateId });
  const scribeLine = await sessionOf(world,
    await createS6BLine(main, { label: 's7a-scribe', role: S6A_SCRIBE_ROLE, tasks: scribeTasks }));
  const adviser = await sendFrom(world, { goal: world.goals.second, line: adviserLine,
    task: adviserTasks[0]!, recipient: executorLine.ref, label: 'adviser', waitAfterSend: false });
  const scribe = await sendFrom(world, { goal: scribeGoal, line: scribeLine,
    task: scribeTasks[0]!, recipient: adviserLine.ref, label: 'scribe', waitAfterSend: false });
  const executor = await sendFrom(world, { goal: world.goals.first, line: executorLine,
    task: executorTasks[0]!, recipient: adviserLine.ref, label: 'executor', waitAfterSend: true });
  return { adviser, scribe, executor, messages: [adviser.message, scribe.message, executor.message] as const };
}

/**
 * One held request round: the real `createQueryGraphToolGroup` is wrapped (its group is returned unchanged) so the
 * Runtime's own context for this round's QueryRun is the one `use` receives. The wrapper is restored on every path;
 * the round's own model gate stays with `holdS6BRequestRound`.
 */
export async function holdS7AQueryRound<T>(world: S6AHostWorld,
  input: { label: string; goalId: string | null },
  use: (context: CoreCallContext, round: S6BHeldRound) => Promise<T>): Promise<T> {
  const original = toolGroupAssembly.createQueryGraphToolGroup;
  const contexts: CoreCallContext[] = [];
  const spy = vi.spyOn(toolGroupAssembly, 'createQueryGraphToolGroup').mockImplementation(group => {
    const real = original(group);
    contexts.push(group.context);
    return real;
  });
  try {
    const held = await holdS6BRequestRound(world, { label: input.label, goalId: input.goalId }, async round => {
      const wanted = round.prepared.queryRunRef;
      const context = contexts.find(candidate => candidate.principal.kind === 'query_run'
        && sameQueryRun(candidate.principal.queryRunRef, wanted));
      if (context === undefined) throw new Error(
        `S7A: the held round has no captured query_run context: ${wanted.runId}`);
      return await use(context, round);
    });
    return held.value;
  } finally {
    spy.mockRestore();
  }
}

/** The secretary round's send: the real Runtime's own `query_run` context, the public mailbox owner, no mailbox tool. */
export async function sendS7ASecretaryMessage(world: S6AHostWorld,
  input: { label: string; goalId: string | null }, to: S6ASession | SessionRef, text: string) {
  const held = await holdS7AQueryRound(world, { label: `s7a-${input.label}`, goalId: input.goalId },
    async (toolContext, round) => {
      const recipient = 'ref' in to ? to.ref : to;
      const saved = await world.platform.messages.sendMessage(toolContext, {
        input: { recipient, text, intent: 'inquiry' as const, needsReply: true },
        meta: { requestId: `s7a-secretary-send-${input.label}`, expected: [] },
      });
      if (saved.status !== 'committed') {
        throw new Error(`S7A_SECRETARY_SEND_UNAVAILABLE: the mailbox refused the secretary send: ${JSON.stringify(saved)}`);
      }
      const message = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, saved.value.ref)),
        'the saved secretary message');
      const sender = message.sender as MessageSender | MessageSecretaryRoundSender;
      if (sender.kind !== 'secretary_round' || !sameSession(sender.sessionRef, round.secretary.ref)
        || !sameQueryRun(sender.queryRunRef, round.prepared.queryRunRef)
        || !sameQueryJob(sender.requestRoot, round.request.requestRoot)) throw new Error(
        `S7A: the secretary message is not this round's: ${JSON.stringify(message.sender)}`);
      const body = ready<{ text: string }>(await world.post('messages/body',
        plain(S6A_SCOPE, { messageRef: message.ref, part: 'message' })), 'the secretary message body');
      if (body.text !== text) throw new Error('S7A: the saved secretary message does not read back');
      return { round, message, context: toolContext };
    });
  return held;
}

// ---------------------------------------------------------------------------
// The commit gate, the crash and the same-Session continuation
// ---------------------------------------------------------------------------

/** Hold the first commit `match` accepts; the hold stays held through the caller's assertions (see the header). */
export function holdS7ACommitter(_world: S6AHostWorld, match: CommitMatch): CommitHold {
  return commitBarrier.hold(match, 'S7A input accepted');
}

/** Await the held commit, then the one real `crash()`; the held commit is not released here. */
export async function crashS7AHost(world: S6AHostWorld, hold: CommitHold) {
  await hold.reached;
  await world.crash();
  return world;
}

/** The next Task of the same Session after its first Run ended and that Task completed: a new claim and Run. */
export async function runS7ASameSessionAgain(world: S6AHostWorld, session: S6ASession) {
  const ref = session.ref;
  const facts = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, ref)),
    `the facts of ${ref.sessionId}`);
  if (facts.latestWork === null) throw new Error('S7A_PRECONDITION: the Session has no Work claim');
  const first = facts.latestWork;
  const execution = ready<{ run: { status: string; outcome: string } }>(
    await world.post('executions/read', plain(S6A_SCOPE, first.runRef)), `the Run ${first.runRef.runId}`);
  if (execution.run.status !== 'ended' || execution.run.outcome !== 'completed') {
    throw new Error(`S7A_PRECONDITION: the first Run is ${execution.run.status}/${execution.run.outcome}`);
  }
  const goal: GoalRef = { aggregateType: 'Goal', projectId: ref.projectId, goalId: first.task.goalId };
  await assertTaskCompleted(world, goal, first.task.taskId);
  const card = await world.readSession(ref);
  const next = card.links.find(link => link.ref.relation === 'responsible'
    && link.ref.target.kind === 'task' && link.ref.target.ref.taskId !== first.task.taskId);
  if (next === undefined || next.ref.target.kind !== 'task') throw new Error('S7A_PRECONDITION: no next Task on the Session');
  const task = next.ref.target.ref;
  await world.scripted.script(session, [{ kind: 'text', text: 'S7A second Work answer' }]);
  const select = { schemaVersion: 1 as const, goalRef: goal, flowId: 's7a-second', sessionHint: ref,
    kind: 'select_work' as const, taskId: task.taskId };
  const claimInput = await advanceUntil(world.ag2b, select, 'claim_task');
  const receipts: WorkflowStepReceipt[] = [];
  await driveWorkflow(world.ag2b, claimInput, { stopBefore: 'open_checks', receipts });
  const { claim, run } = claimedRunOf(receipts, 'the second Task');
  ready(await world.post('executions/read', plain(S6A_SCOPE, run)), 'the second Task Run');
  if (!sameSession(claim.sessionRef, ref) || sameRun(claim.runRef, first.runRef)) throw new Error(
    `S7A: the second claim is not a new Run of this Session: ${JSON.stringify(claim)}`);
  return { run, claim };
}

// ---------------------------------------------------------------------------
// Responsibility transfer, the Host's system sender and the reply handler
// ---------------------------------------------------------------------------

const sameTarget = (left: WorkLinkTarget, right: WorkLinkTarget): boolean =>
  left.kind === right.kind && JSON.stringify(left.ref) === JSON.stringify(right.ref);

/** `sessions/read` both lines, then `sessions/transfer-responsibility` with the two Sessions and two links pinned. */
export async function transferS7ASession(world: S6AHostWorld, from: S6ASession | SessionRef,
  to: S6ASession | SessionRef, target: WorkLinkTarget) {
  const fromRef = 'ref' in from ? from.ref : from;
  const toRef = 'ref' in to ? to.ref : to;
  const [fromCard, toCard] = await Promise.all([world.readSession(fromRef), world.readSession(toRef)]);
  const linkOf = (card: typeof fromCard) => card.links.find(link =>
    link.ref.relation === 'responsible' && sameTarget(link.ref.target, target));
  const fromLink = linkOf(fromCard);
  if (fromLink === undefined) throw new Error('S7A_PRECONDITION: the source line has no responsible link');
  // The destination link may not exist yet: the transfer creates it, so it is pinned at revision 0.
  const toLinkRef = { ...toRef, aggregateType: 'SessionWorkLink' as const, target, relation: 'responsible' as const };
  const toLink = linkOf(toCard) ?? { ref: toLinkRef, revision: 0 };
  const value = committed<{ from: unknown; to: unknown }>(await world.post('sessions/transfer-responsibility',
    graphWrite(S6A_SCOPE, { from: fromRef, to: toRef, target }, `s7a-transfer-${fromRef.sessionId}`,
      [{ ref: fromCard.record.ref, revision: fromCard.record.revision },
        { ref: toCard.record.ref, revision: toCard.record.revision },
        { ref: fromLink.ref, revision: fromLink.revision },
        { ref: toLink.ref, revision: toLink.revision }])), 'the responsibility transfer');
  return { from: value.from, to: value.to };
}

/** A real Host send as the automation actor through `messages/send` (the trusted system context). */
export async function seedS7AHostSystemSender(world: S6AHostWorld) {
  const recipient = await world.createWorkSession('s7a-system-recipient');
  const value = committed<SessionMessage>(await world.dispatch('messages/send', world.systemContext(),
    graphWrite(S6A_SCOPE, { recipient: recipient.ref, text: 'S7A system message', intent: 'inquiry', needsReply: true },
      's7a-system-send')), 'the system send');
  const message = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, value.ref)),
    'the saved system message');
  if (message.sender.kind !== 'host' || message.sender.actor.kind !== 'system') {
    throw new Error(`S7A: the system send is not from the automation actor: ${JSON.stringify(message.sender)}`);
  }
  return { message, sender: message.sender };
}

/** Archive the sending line with its wait transferred to `to`, continue the archive, then read `replyHandler`. */
export async function nameS7AReplyHandler(world: S6AHostWorld, message: SessionMessage, to: S6ASession | SessionRef) {
  if (message.sender.kind !== 'work_run') throw new Error('S7A: the reply handler needs a Work Run sender');
  const toRef = 'ref' in to ? to.ref : to;
  const sender = message.sender;
  const facts = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, sender.sessionRef)),
    'the sending line facts');
  if (facts.wait === null || facts.wait.messageRef.messageId !== message.ref.messageId) {
    throw new Error('S7A_PRECONDITION: the sending Run has no open wait on this message');
  }
  const card = await world.readSession(sender.sessionRef);
  const requestId = `s7a-reply-handler-${message.ref.messageId}`;
  const tasks = card.links.filter(link => link.ref.relation === 'responsible')
    .map(link => ({ target: link.ref.target, disposition: { kind: 'transfer' as const, to: toRef } }));
  const archived = ready<ArchiveLineResultV1>(await world.post('sessions/archive-line', graphWrite(S6A_SCOPE, {
    sessionRef: sender.sessionRef, reason: 'S7A reply handler', tasks,
    wait: { kind: 'transfer' as const, runRef: facts.wait.runRef, messageRef: facts.wait.messageRef, to: toRef },
  }, requestId, [{ ref: card.record.ref, revision: card.record.revision }])), 'the sending line archive');
  const continued = ready<ArchiveLineResultV1>(await world.post('sessions/archive-continue',
    plain(S6A_SCOPE, { sessionRef: sender.sessionRef, archiveRequestId: requestId })), 'the archive continuation');
  const read = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message.ref)),
    'the message reply handler');
  if (read.replyHandler == null || !sameSession(read.replyHandler.sessionRef, toRef)) {
    throw new Error(`S7A: the message has no reply handler at ${toRef.sessionId}: ${JSON.stringify(read.replyHandler)}`);
  }
  return { archived, continued, handler: read.replyHandler };
}
export { ready, committed };

/**
 * The recipient line answers one saved message from a real Run: the message and that line's card read publicly, the
 * responsible link to `taskId` opened with both pins, the model's own `respond_session_message` call scripted and the
 * reply Run driven through the public Workflow. Every pin is what the public read returned just before.
 */
export async function replyS7AMessage(world: S6AHostWorld, input: {
  goal: GoalRef; recipient: S6ASession; messageRef: SessionMessage['ref']; taskId: string; label: string; text: string;
}): Promise<void> {
  const before = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, input.messageRef)),
    'the replied message');
  const card = await world.readSession(input.recipient);
  const target = { kind: 'task' as const, ref: { projectId: S6A_SCOPE.projectId, goalId: input.goal.goalId,
    taskId: input.taskId } };
  committed(await world.post('sessions/link', graphWrite(S6A_SCOPE, { sessionRef: input.recipient.ref, target,
    relation: 'responsible', active: true }, `s7a-gate-reply-link-${input.label}`,
  [{ ref: card.record.ref, revision: card.record.revision },
    { ref: { ...input.recipient.ref, aggregateType: 'SessionWorkLink', target, relation: 'responsible' },
      revision: 0 }])), 'the reply link');
  await world.scripted.script(input.recipient, [
    { kind: 'calls', calls: [{ callId: `s7a-gate-reply-${input.label}`, name: 'respond_session_message',
      args: { messageRef: input.messageRef, expectedRevision: before.revision, text: input.text } }] },
    { kind: 'text', text: `the ${input.label} reply is saved` },
  ]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: input.goal, flowId: `s7a-gate-reply-${input.label}`,
    sessionHint: input.recipient.ref, kind: 'select_work', taskId: input.taskId });
}

/**
 * `goals/control` cancel with the two pins `goalControlPins` reads just before the write (`goals/read` and
 * `tasks/query` at their public revisions); returns the committed Goal.
 */
export async function cancelS7AGoal(world: S6AHostWorld, goal: GoalRef) {
  const value = committed<GoalControlOutcomeV1>(await world.post('goals/control', graphWrite(S6A_SCOPE, {
    goalRef: goal, control: 'cancel', reason: 'S7A operator cancel',
  }, `s7a-control-cancel-${goal.goalId}`, await goalControlPins(world, goal))), 'the cancel control');
  return { goal: value.goal };
}
