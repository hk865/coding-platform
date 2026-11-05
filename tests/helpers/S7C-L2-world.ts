/**
 * FL-1: the one L2 Host world, shared by `L2-attention`, `T-01`, `T-02`, `L2-wiring`, `L2-outbox` and
 * `T-receipt`. It takes FT-1's already-opened world (`openS7CToolWorld`; the same Host and database) instead
 * of opening a second one, and adds what every L2 row reads:
 *
 * - the real adviser and attention-target lines through the public `sessions/create` (`createS6BLine`) and the
 *   Goal's secretary as the owner of a real request round, all before/after the one restart: only real
 *   Session refs are configured into attention, and no Session id is pre-created;
 * - attention configured through the existing `world.reopen` (never a second Host) after those refs exist. The
 *   memory backend reopens through the A4 shared records/body seam, so the caller's test file installs the two
 *   mocks (`tests/app/S7A-host-gates.test.ts:31`–`:47`); SQLite needs no seam. The same restart installs FL-1's
 *   trusted check configuration, because a check configuration is a Host input and cannot change while a Host
 *   runs. The scope watches one fixed file and leaves the Goal graph off: the fixture's own counted-rework drive
 *   changes the graph before a row runs, and the rows' attention signal is the file;
 * - two real counted automatic reworks of the same Task through the public `workflow/advance` and real
 *   inspection results (drill L2-13): a registered static check FAILs the Task's first round, the automatic
 *   requeue counts 1, the requeued Run's round is made INCONCLUSIVE by a real workspace source change after the
 *   round froze its source, and the automatic reverify counts 1 on its own arm — one counting chain across both
 *   arms (the Task's counted total is the projection's read-only `rework.taskCount`, never computed here). No
 *   requeue or round record is built by hand, and no `{ kind: 'fail' }` model reply is used as the source;
 * - `restart`, the SQLite-only `crashS7AHost` (which reopens the same directory) used by the storage rows.
 *
 * Nothing here reads the store, builds a `CoreCallContext` or impersonates the Host/Runtime. Business rows keep
 * `backend: 'memory'`; the restart cells of `L2-outbox` and `T-receipt` open the SQLite copy of the same world.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AttentionScopeV1 } from '../../src/app/attention-observer.js';
import type {
  ResolveDecisionReadV1, WorkflowAdvanceInput, WorkflowStepReceipt,
} from '../../src/business/workflow/contracts.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1, DecisionQueueReadV1, NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { S6AHostWorld, S6AToolCall } from './S6A-host-fixture.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { TrustedCheckConfiguration, VerificationRoundRef } from '../../src/contracts/verification.js';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { advanceUntil, driveWorkflow, type AdvanceValue } from './A2-restart-fixture.js';
import type { CommitHold } from './S6A-commit-barrier.js';
import {
  OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6ABackend, type S6ASession,
} from './S6A-request-fixture.js';
import { createS6BLine, holdS6BRequestRound } from './S6B1-fixture.js';
import { checkConfiguration, claimedRunOf, crashS7AHost, ready, receiptOf, sessionOf } from './S7A-fixture.js';
import { understandingNote } from './S4C2-note-card-fixture.js';
import { withConfiguredHost } from './S7C-member-fixture.js';
import { openLink } from './S7D1-role-line-world.js';
import { plain } from './AG2b-collaboration-fixture.js';
import { inboxOf } from './S7B-F-support.js';
import { readBody } from './IV-host-fixture.js';
import type { QueueInput } from './S2A-queue-fixture.js';
import { openS7CToolWorld, type S7CDuty, type S7CToolWorld } from './S7C-t-fixture.js';

const ADVISER_ROLE = platformRoleProfile('adviser').template;

/** The one watched fixed file a row writes to produce a real attention delivery. */
export const S7C_L2_ATTENTION_PATH = 'src/s7c-l2-attention.txt';
const S7C_L2_RESULT_PATH = 'src/s7c-l2-result.txt';
const S7C_L2_SOURCE_CHANGE_PATH = 'src/s7c-l2-source-change.txt';
const S7C_L2_CHECK_ID = 's7c-l2-static-check';
let runSeq = 0;

/**
 * The L2 rows' executor grant: the names FT-1's spec puts on the caller binding. The tool world's own first Run
 * is not used here; the names are read back through the public preparation.
 */
const S7C_L2_EXECUTOR_TOOLS = [
  'read', 'record_note', 'hand_off', 'request_rework', 'request_recheck', 'withdraw_session_message', 'create_member',
] as const;

/** A counted automatic rework as its public receipt returned it: this arm's own count and the record's ref. */
export type S7CCountedRework = {
  readonly operation: 'requeue' | 'reverify';
  /** The Run whose real inspection result produced this counted rework. */
  readonly run: RunRef;
  readonly ref: TaskRequeueRef | VerificationRoundRef;
  /** The finalized round the rework acted on (`afterRoundRef` / `predecessorRoundRef`). */
  readonly round: VerificationRoundRef | null;
  /** The arm's own automatic count (`automation.autoCount` / `chain.autoCount`); the counted chain adds both. */
  readonly count: number;
  readonly reason: string;
};

export type S7CSystemWorldOptions = {
  /** `false` opens without the adviser line; the same opener and the same attention scope, never a second world. */
  adviser?: boolean;
  /** Default `memory` for the business rows; `sqlite` for the restart cells of `L2-outbox` and `T-receipt`. */
  backend?: S6ABackend;
  /** The FT-1 caller duty; the system rows use the default `executor`. */
  duty?: S7CDuty;
  /** The caller binding's grant; defaults to the L2 executor names above. */
  grantTools?: readonly string[];
  /** L2-wiring: the complete production grant (the real `localWorkbenchGrant`) instead of the name list. */
  grant?: WorkbenchRuntimeBinding['grant'];
  /** L2-wiring: the real local workbench Role that grant's hostTemplate belongs to. */
  role?: Extract<RoleConfigurationRef, { kind: 'legacy_template' }>;
  /**
   * Runs after the world-build restart and before the counted-rework drive: the storage rows install their A2
   * commit hold here, so a crash can stop the notifier between one source's branches.
   */
  onReopened?: (world: S6AHostWorld) => void | Promise<void>;
  /**
   * Runs after the Goal's Secretary round and before the counted-rework drive: the `L2-outbox` rows arm their one
   * send fault or hold here, where no round send is left to match and the next `session-message-send:` is the
   * notifier's.
   */
  beforeCountedRework?: (world: S6AHostWorld, secretary: S6ASession) => void | Promise<void>;
};

export type S7CSystemWorld = {
  readonly world: S6AHostWorld;
  /** FT-1's world handle: its workspace, plan, caller line, binding and public reads. */
  readonly tools: S7CToolWorld;
  readonly goal: GoalRef;
  /** The same Task both counted reworks act on. */
  readonly task: TaskTriple;
  /** The caller line the real Workflow drove; the first counted rework's Run belongs to it. */
  readonly line: S6ASession;
  /** The configured attention target: a real `S6A_WORK_ROLE` line (`AG2B_WORK_ROLE`). */
  readonly target: S6ASession;
  readonly adviser: S6ASession | null;
  readonly secretary: S6ASession;
  readonly firstRework: S7CCountedRework;
  readonly secondRework: S7CCountedRework;
  /** The Run of the requeued Task whose INCONCLUSIVE round produced the second counted rework. */
  readonly secondReworkRun: RunRef;
  /** Start a real Work Run of the caller line on `task` (the caller scripts its replies on `line` first). */
  readonly startRun: (task: TaskTriple, stopBefore?: string) =>
    Promise<{ run: RunRef; receipts: WorkflowStepReceipt[]; execution: TaskExecutionRecord }>;
  /** The same real Run with the caller line's own `hand_off` tool call; the understanding note is written first. */
  readonly handOff: (input: { task: TaskTriple; target: SessionRef; reason: string; callId: string }) =>
    Promise<{ call: S6AToolCall; result: unknown; run: RunRef; receipts: WorkflowStepReceipt[];
      execution: TaskExecutionRecord }>;
  /** SQLite only: wait for `hold`, crash the Host and reopen the same directory; returns the reopened world. */
  readonly restart: (hold: CommitHold) => Promise<S6AHostWorld>;
  readonly close: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// The public message/queue/body reads every L2 row shares: one copy.
// ---------------------------------------------------------------------------

/** The queue's section names: the existing `QueueInput` field, never a second string union. */
export type QueueSection = QueueInput['sections'][number];

/** The attention notices at one recipient: the watched path is their one unique body marker. */
export async function attentionNotices(world: S6AHostWorld, recipient: SessionRef): Promise<SessionMessage[]> {
  const found: SessionMessage[] = [];
  for (const item of await inboxOf(world, recipient)) {
    if (item.intent !== 'notify') continue;
    if ((await readBody(world, item.ref, 'message')).includes(S7C_L2_ATTENTION_PATH)) found.push(item);
  }
  return found;
}

/** The automatic-rework notices at one recipient, in commit order. */
export async function reworkNotices(world: S6AHostWorld, recipient: SessionRef): Promise<SessionMessage[]> {
  const found: SessionMessage[] = [];
  for (const item of await inboxOf(world, recipient)) {
    if (item.intent !== 'notify') continue;
    if ((await readBody(world, item.ref, 'message')).startsWith('自动返工')) found.push(item);
  }
  return found;
}

export async function decisionQueueOf(world: S6AHostWorld, goalRef: GoalRef,
  sections: readonly QueueSection[]): Promise<DecisionQueueReadV1> {
  return ready<DecisionQueueReadV1>(await world.post('decisions/queue', plain(S6A_SCOPE,
    { workspace: S6A_SCOPE, goalRef, sections, page: { limit: 100 } })), 'the decision queue');
}

export async function mainNotices(world: S6AHostWorld, goalRef: GoalRef): Promise<NoticeItemV1[]> {
  const page = ready<{ notices: (NoticeItemV1 & { memberViews?: NoticeItemV1[] })[] }>(
    await world.post('main/read', plain(S6A_SCOPE, { goalId: goalRef.goalId, cursor: null })), 'the main read');
  return page.notices.flatMap(notice => notice.memberViews ?? [notice]);
}

/** One answer at the card's own pins (a person's `graph_write`). */
export async function answerDecisionCard(world: S6AHostWorld, card: DecisionCardV1, optionId: 'approve' | 'reject',
  requestId: string): Promise<ResolveDecisionReadV1> {
  return ready<ResolveDecisionReadV1>(await world.post('decisions/answer',
    { scope: S6A_SCOPE, request: { input: {
      source: card.source, selection: { kind: 'option', optionId }, text: '', annotations: [],
    }, meta: { requestId, expected: card.source.pins } } }), 'the card answer');
}

export function nextOf(steps: readonly AdvanceValue[], what: string): WorkflowAdvanceInput {
  const next = steps.at(-1)?.next;
  if (next === null || next === undefined) {
    const last = steps.at(-1);
    throw new Error(`S7C L2: the Workflow stopped before ${what}: ${last?.state ?? 'no step'}: ${last?.reason ?? ''}`);
  }
  return next;
}

type HostFactory = Parameters<Parameters<typeof withConfiguredHost>[1]>[0];

/**
 * Every restart of this world re-applies FT-1's open-time runtime binding: its grant carries the formal
 * `platformDuty`/`createMember` facts the Work tool group reads, and a plain `Host.reopen` would rebuild the
 * binding from the base options without them. The configured binding is the one `openS7CToolWorld` handed the
 * Host; only the base options' copy is replaced.
 */
function configuredBindingOf(tools: S7CToolWorld): (original: HostFactory) => HostFactory {
  return original => async hostOptions => {
    const configuration = hostOptions.runtimeConfiguration;
    const binding = configuration?.bindings.find(candidate => candidate.id === tools.binding.id);
    if (configuration === undefined || binding === undefined) {
      throw new Error(`S7C L2: the restarted Host has no ${tools.binding.id}`);
    }
    binding.grant = structuredClone(tools.binding.grant);
    return await original(hostOptions);
  };
}

/** The one world-build restart: attention + the trusted checks after the real Session refs exist. */
async function reopenSystemHost(world: S6AHostWorld, tools: S7CToolWorld,
  options: Parameters<S6AHostWorld['reopen']>[0]): Promise<void> {
  await withConfiguredHost(() => world.reopen(options), configuredBindingOf(tools));
}

/**
 * FL-1's trusted check configuration: the S7A one (same executor, permission revision, verification workspace
 * and denied prefixes) with one registered static inspection that FAILs until the Task's result file exists.
 */
function systemCheckConfiguration(): TrustedCheckConfiguration {
  const base = checkConfiguration({ kind: 'human', id: OPERATOR.id });
  return {
    ...base,
    configurationRevision: 's7c-l2-static-check@1',
    checks: [{
      checkId: S7C_L2_CHECK_ID, kind: 'static',
      command: `node -e "process.exit(require('node:fs').existsSync('${S7C_L2_RESULT_PATH}')?0:1)"`,
      cwd: '.', timeoutMs: 60_000, taskIds: 'all',
    }],
  };
}

/**
 * The one attention scope: the real watched file and the real target Session. The Goal graph is left off: the
 * L2 rows' attention signal is the watched file, and the fixture's own counted-rework drive changes the graph
 * before a row runs, which would make "exactly one notice" unmeasurable.
 */
function attentionScopeOf(target: SessionRef): AttentionScopeV1 {
  return {
    scope: { ...S6A_SCOPE },
    paths: [S7C_L2_ATTENTION_PATH],
    pathsKind: 'files',
    maxBytes: 4096,
    goalRef: null,
    targetSession: { projectId: target.projectId, sessionId: target.sessionId },
    config: {
      schemaVersion: 1, heartbeatMs: 25, maxCoalesceMs: 50,
      files: { minChangedLines: 1, minRatio: 1, scopePrefixes: ['src'] },
      graph: { minChangedElements: 1, minRatio: 1 },
    },
  };
}

/** The real check FAIL of the Task's first Run, the automatic requeue it asks for, and its committed record. */
async function firstCountedRework(world: S6AHostWorld, goal: GoalRef, line: S6ASession, task: TaskTriple,
  receipts: WorkflowStepReceipt[]): Promise<{ rework: S7CCountedRework; next: WorkflowAdvanceInput }> {
  const select: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: goal, flowId: 's7c-l2-rework-1',
    sessionHint: line.ref, kind: 'select_work', taskId: task.taskId };
  const failed = await driveWorkflow(world.ag2b, select, { stopBefore: 'requeue_task', receipts });
  const requeueInput = nextOf(failed, 'the automatic requeue');
  const requeued = await driveWorkflow(world.ag2b, requeueInput, { stopBefore: 'claim_task', receipts });
  const receipt = receiptOf(receipts, 'requeue_task');
  if (receipt === undefined || receipt.result.status !== 'committed' || receipt.result.value.kind !== 'requeued') {
    throw new Error(`S7C L2: the automatic requeue did not commit: ${JSON.stringify(receipt)}`);
  }
  const requeue = receipt.result.value.requeue;
  if (!requeue.automation.counted || requeue.automation.autoCount !== 1
    || requeue.failureClass !== 'check_failed') {
    throw new Error(`S7C L2: the first rework is not the counted check_failed requeue: ${JSON.stringify(requeue)}`);
  }
  return {
    rework: { operation: 'requeue', run: failureRunOf(receipts, 'the first counted rework'), ref: requeue.ref,
      round: requeue.afterRoundRef, count: requeue.automation.autoCount, reason: requeue.reason },
    next: nextOf(requeued, 'the requeued claim'),
  };
}

/**
 * The requeued Run, its round made INCONCLUSIVE by a real source change after the round froze the source (the
 * `VD-8` shape `tests/app/A2-automation-verdict.test.ts:200` uses), and the automatic reverify that asks for.
 */
async function secondCountedRework(world: S6AHostWorld, goal: GoalRef, line: S6ASession, task: TaskTriple,
  claim: WorkflowAdvanceInput, receipts: WorkflowStepReceipt[]): Promise<{ rework: S7CCountedRework; run: RunRef }> {
  const started = await driveWorkflow(world.ag2b, claim, { stopBefore: 'open_checks', receipts });
  const start = started.find(step => step.receipt?.kind === 'start');
  if (start === undefined || start.receipt?.kind !== 'start' || start.receipt.result.status !== 'ready') {
    throw new Error('S7C L2: the requeued Task did not start a Run');
  }
  const run = start.receipt.result.value.run.ref;
  const opened = await driveWorkflow(world.ag2b, nextOf(started, 'the second round open'), { stopBefore: 'run_check', receipts });
  // The round froze its source at open; this real file change makes the registered check's source not match.
  await mkdir(join(world.root, 'src'), { recursive: true });
  await writeFile(join(world.root, S7C_L2_SOURCE_CHANGE_PATH), 'S7C L2: the source changed after the round opened\n');
  const toFinalize = await driveWorkflow(world.ag2b, nextOf(opened, 'the second round check'),
    { stopBefore: 'finalize_checks', receipts });
  const toReverify = await driveWorkflow(world.ag2b, nextOf(toFinalize, 'the second round finalize'),
    { stopBefore: 'reverify_round', receipts });
  await driveWorkflow(world.ag2b, nextOf(toReverify, 'the automatic reverify'), { stopBefore: 'run_check', receipts });
  const receipt = receiptOf(receipts, 'reverify_round');
  if (receipt === undefined || receipt.result.status !== 'committed' || receipt.result.value.kind !== 'reverified') {
    throw new Error(`S7C L2: the automatic reverify did not commit: ${JSON.stringify(receipt)}`);
  }
  const round = receipt.result.value.round;
  const reverify = round.chain.reverify;
  if (reverify === null || reverify.actorClass !== 'system' || reverify.exemption !== 'none'
    || round.chain.autoCount !== 1) {
    throw new Error(`S7C L2: the second rework is not the counted automatic reverify: ${JSON.stringify(round.chain)}`);
  }
  return {
    rework: { operation: 'reverify', run, ref: round.ref, round: round.chain.predecessorRoundRef,
      count: round.chain.autoCount, reason: reverify.reason ?? '' },
    run,
  };
}

/** The Run the first rework acted on: the `requeue_task` receipt follows that Run's started round. */
function failureRunOf(receipts: readonly WorkflowStepReceipt[], what: string): RunRef {
  const start = [...receipts].reverse().find((receipt): receipt is Extract<WorkflowStepReceipt, { kind: 'start' }> =>
    receipt.kind === 'start');
  if (start === undefined || start.result.status !== 'ready') {
    throw new Error(`S7C L2: ${what} has no started Run`);
  }
  return start.result.value.run.ref;
}

/** The caller line's real Work Run on one Task: claim, start, drive to `stopBefore`, read the Run publicly. */
async function startRunOn(world: S6AHostWorld, goal: GoalRef, line: S6ASession, task: TaskTriple,
  stopBefore: string): Promise<{ run: RunRef; receipts: WorkflowStepReceipt[]; execution: TaskExecutionRecord }> {
  const select: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: goal,
    flowId: `s7c-l2-run-${task.taskId}-${String(++runSeq)}`, sessionHint: line.ref, kind: 'select_work',
    taskId: task.taskId };
  const claim = await advanceUntil(world.ag2b, select, 'claim_task');
  const receipts: WorkflowStepReceipt[] = [];
  await driveWorkflow(world.ag2b, claim, { stopBefore, receipts });
  const { run } = claimedRunOf(receipts, `the L2 Run of ${task.taskId}`);
  const execution = ready<TaskExecutionRecord>(await world.post('executions/read', plain(S6A_SCOPE, run)),
    `the L2 Run of ${task.taskId}`);
  return { run, receipts, execution };
}

/**
 * One real `hand_off` through the caller line's own tool: the source Run writes the Goal's understanding through
 * the real `record_note` tool, then calls `hand_off` at the real tool gate; the Run continues to its text answer.
 */
async function startHandoffRun(world: S6AHostWorld, goal: GoalRef, line: S6ASession, input: {
  task: TaskTriple; target: SessionRef; reason: string; callId: string;
}): Promise<{ call: S6AToolCall; result: unknown; run: RunRef; receipts: WorkflowStepReceipt[];
  execution: TaskExecutionRecord }> {
  const anchor = { kind: 'goal' as const, goalId: goal.goalId };
  const pointer = await world.platform.notes.listByAnchor(world.humanContext(), { anchor, limit: 1, cursor: null });
  if (pointer.status !== 'ready' || pointer.value.pointer === null) {
    throw new Error(`S7C L2: the understanding pointer is not readable: ${JSON.stringify(pointer)}`);
  }
  const pointerValue = pointer.value.pointer;
  const draft = understandingNote({ anchor, topic: 's7c-l2-handoff-understanding',
    conclusion: 'S7C L2: the source Run understands the handed task', structural: false,
    replaces: pointerValue.noteId === null ? [] : [pointerValue.noteId] });
  if (draft.kind !== 'understanding') throw new Error('S7C L2: the handoff note is not an understanding');
  await world.scripted.script(line, [
    { kind: 'calls', calls: [{ callId: `${input.callId}-note`, name: 'record_note', args: {
      op: 'write', kind: draft.kind, topic: draft.topic, conclusion: draft.conclusion, anchor: draft.anchor,
      sections: draft.sections, structural: draft.structural, replaces: draft.replaces,
      expectedPointerRevision: pointerValue.revision } }] },
    { kind: 'calls', calls: [{ callId: input.callId, name: 'hand_off', args: {
      source: { projectId: line.ref.projectId, sessionId: line.ref.sessionId },
      assignments: [{ target: { kind: 'existing',
        session: { projectId: input.target.projectId, sessionId: input.target.sessionId } },
        tasks: [{ ...input.task }] }],
      reason: input.reason } }] },
    { kind: 'text', text: 'S7C L2: the handoff request is recorded' },
  ]);
  const gate = await world.gates.toolCall(line, 'hand_off');
  const select: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: goal,
    flowId: `s7c-l2-handoff-${input.task.taskId}-${input.callId}`, sessionHint: line.ref,
    kind: 'select_work', taskId: input.task.taskId };
  const receipts: WorkflowStepReceipt[] = [];
  const driving = (async () => {
    const claim = await advanceUntil(world.ag2b, select, 'claim_task');
    return await driveWorkflow(world.ag2b, claim, { stopBefore: 'open_checks', receipts });
  })();
  let call: S6AToolCall;
  try {
    call = await Promise.race([gate.reached, driving.then(() => {
      throw new Error(`S7C L2: the handoff Run settled without hand_off: ${
        JSON.stringify(receipts.map(receipt => receipt.kind))}`);
    })]);
  } finally { gate.release(); }
  await driving;
  const { run } = claimedRunOf(receipts, `the handoff Run of ${input.task.taskId}`);
  const execution = ready<TaskExecutionRecord>(await world.post('executions/read', plain(S6A_SCOPE, run)),
    'the handoff Run');
  const requests = await world.scripted.requests(line);
  const result = requests.flatMap(request => request.messages.flatMap(message =>
    message.role === 'tool' ? [message.result as unknown as { callId: string }] : []))
    .find(candidate => candidate.callId === call.callId) ?? null;
  return { call, result, run, receipts, execution };
}

/**
 * One Host: FT-1's world, the three real lines, one restart that carries attention and the check configuration,
 * then the two real counted reworks of `task`. Closes the world only when its own setup fails.
 */
export async function openS7CSystemWorld(options: S7CSystemWorldOptions = {}): Promise<S7CSystemWorld> {
  const adviser = options.adviser ?? true;
  const backend = options.backend ?? 'memory';
  const duty = options.duty ?? 'executor';
  const tools = await openS7CToolWorld({
    duty, grantTools: options.grantTools ?? S7C_L2_EXECUTOR_TOOLS, backend,
    ...(options.grant === undefined ? {} : { grant: options.grant }),
    ...(options.role === undefined ? {} : { role: options.role }),
  });
  const world = tools.world;
  try {
    const main = tools.main;
    const goal = tools.goal;
    const task = tools.tasks[0]!;
    const line = tools.line;
    const target = await sessionOf(world, await createS6BLine(main, {
      label: 's7c-l2-attention-target', role: S6A_WORK_ROLE,
    }));
    const adviserLine = adviser
      ? await sessionOf(world, await createS6BLine(main, { label: 's7c-l2-adviser', role: ADVISER_ROLE }))
      : null;
    if (adviserLine !== null) {
      const linked = await openLink(world, { line: adviserLine, target: { kind: 'goal', ref: goal },
        requestId: 's7c-l2-adviser-goal-link' });
      if (linked.result.status !== 'committed') {
        throw new Error(`S7C L2: the adviser Goal link did not commit: ${JSON.stringify(linked.result)}`);
      }
    }
    // The refs exist first; the one restart configures attention and the trusted checks. Memory reopens through
    // the A4 shared records/body seam the caller's test file installs; SQLite needs none.
    await reopenSystemHost(world, tools, {
      ...(backend === 'memory' ? { sharedMemoryStore: true as const } : {}),
      extraHostOptions: { checks: systemCheckConfiguration(), attention: [attentionScopeOf(target.ref)] },
    });
    // The Goal's secretary is the owner of a real request root (the resolver prefers it over the duty read); the
    // held round opens and answers on the reopened Host through the request-round public steps.
    await options.onReopened?.(world);
    const round = await holdS6BRequestRound(world, { label: 's7c-l2-secretary', goalId: goal.goalId },
      async held => held.secretary);
    const secretary = round.value;
    await options.beforeCountedRework?.(world, secretary);
    await world.scripted.script(line, [
      { kind: 'text', text: 'S7C L2: the first Run of the counted Task answers' },
      { kind: 'text', text: 'S7C L2: the requeued Run answers' },
    ]);
    const receipts: WorkflowStepReceipt[] = [];
    const first = await firstCountedRework(world, goal, line, task, receipts);
    const second = await secondCountedRework(world, goal, line, task, first.next, receipts);
    return {
      world, tools, goal, task, line, target, adviser: adviserLine, secretary,
      firstRework: first.rework, secondRework: second.rework, secondReworkRun: second.run,
      startRun: (targetTask, stopBefore = 'open_checks') =>
        startRunOn(world, goal, line, targetTask, stopBefore),
      handOff: input => startHandoffRun(world, goal, line, input),
      restart: async hold => {
        if (world.backend !== 'sqlite') {
          throw new Error('S7C L2: the restart half needs the SQLite world (never crash memory)');
        }
        // `crashS7AHost` waits for `hold`, abandons the Host and reopens the same SQLite directory; the
        // configured binding is applied to that start exactly as the world-build restart applies it.
        await withConfiguredHost(() => crashS7AHost(world, hold), configuredBindingOf(tools));
        return world;
      },
      close: () => world.close(),
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}
