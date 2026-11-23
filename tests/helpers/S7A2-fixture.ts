/**
 * 7A-2 fixture (RGP E0.5; C's CR13): the shared steps the early 7A-2 parts drive their real subject from. One
 * `S6AHostWorld` carries every backend; this file composes the frozen 7A-1, host and request steps and never opens
 * a second world, copies a step or writes a fact by hand.
 *
 * Rules:
 * - Every state comes from a public step: the Host's own start and routes, the public owners (`messages`, `goals`),
 *   the held request round's own Runtime `query_run` context and the person's trusted context. Every expected value
 *   a step sends is what a public read returned just before.
 * - A later 7A-2 wave's platform member is looked up at call time and called in process as the Host's human
 *   operator bound to the caller's scope; an unpublished member rejects with the stable named error and the owner's
 *   whole envelope comes back unchanged. Same shape and behaviour as 6B-3's `callS6B3PublishedOwner`.
 * - Cleanup: every step takes a world a test already has; `holdS7AQueryRound` restores its wrapper in a `finally`
 *   and `holdS6BRequestRound` releases and awaits its own gate on every path.
 */
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { DispatchBasisV1, GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { advanceUntil } from './A2-restart-fixture.js';
import { callPublishedOwnerAsHost, type S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE, type S6ASession } from './S6A-request-fixture.js';
import type { ApplicationProofV1, DecisionApplicationReceiptV1 } from '../../src/contracts/core/session-message.js';
import type { DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import type { DecisionCardV1, ResolveDecisionReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import {
  cancelS7AGoal, committed, ready, runS7ASameSessionAgain, seedS7AGoalPlan, sendS7ASecretaryMessage,
  sendS7ASecretaryMessageAfter,
} from './S7A-fixture.js';

// ---------------------------------------------------------------------------
// The shared block: a later wave's published owner
// ---------------------------------------------------------------------------

/**
 * A published platform member called in process as the Host's human operator bound to `scope`
 * (`world.humanContext()`'s actor through `createHostCoreCallContext`). The owner's whole envelope comes back; the
 * helper composes no fact.
 */
export function callS7A2PublishedOwner(world: S6AHostWorld, call: {
  owner: string; wave: string; scope: { projectId: string; workspaceId: string }; signal?: AbortSignal;
}, input: unknown): Promise<unknown> {
  return callPublishedOwnerAsHost(world, 'S7A2', call, input);
}

// ---------------------------------------------------------------------------
// R's block: the dispatch basis, the request send and the person's decisions
// ---------------------------------------------------------------------------

/** `goals/dispatch-basis` as the person: the Goal's three current values. */
export async function readS7A2DispatchBasis(world: S6AHostWorld, goal: GoalRef): Promise<DispatchBasisV1> {
  return ready<DispatchBasisV1>(await world.post('goals/dispatch-basis', plain(S6A_SCOPE, { goalRef: goal })),
    `the dispatch basis of ${goal.goalId}`);
}

/**
 * A real secretary send in a held request round of `goal`, through the shared secretary send step
 * `sendS7ASecretaryMessage(world, { label, goalId: goal.goalId }, recipient, text)` (which sends `needsReply: true`);
 * the step returns its `message`. The old `intent` parameter and its branch are gone: the message carries only
 * `needsReply`/`wake` and the dispatch version lives in `dispatch_task`'s own `expected`, never on the message. The
 * release follows the autonomy the test set with `setS7AAutonomy`.
 */
export async function sendS7A2Request(
  world: S6AHostWorld, input: { label: string; goal: GoalRef; recipient: SessionRef }): Promise<SessionMessage> {
  const text = `S7A2 ${input.label} request`;
  const sent = await sendS7ASecretaryMessage(world, { label: input.label, goalId: input.goal.goalId },
    input.recipient, text);
  return sent.message;
}

/**
 * The `action_release` card this message asked for, answered `approve` as the person, then `messages/read`. A Goal can
 * hold several cards, so the step selects the one whose action request names this message as its `basis.sourceMessage`
 * (read from the owner), never the queue's first card. The card source still comes from the queue read.
 */
export async function approveS7A2Message(world: S6AHostWorld, message: SessionMessage, label: string):
Promise<SessionMessage> {
  const goal = message.goalRef;
  if (goal === null) throw new Error(`S7A2: the ${label} message has no Goal to answer a card for`);
  const cards = s6aCardsWorkspace(world, S6A_SCOPE);
  const listed = (await cards.readCards(goal))
    .filter(card => card.source.kind === 'action_release' && card.state === 'waiting_answer');
  let source: DecisionSourceV1 | null = null;
  for (const card of listed) {
    const ref = card.actionRelease?.ref;
    if (ref === undefined) continue;
    const read = await world.platform.actionRequests.readRequest(world.humanContext(), { ref });
    if (read.status !== 'ready') continue;
    const from = read.value.basis?.sourceMessage ?? null;
    if (from !== null && canonicalRefKey(from) === canonicalRefKey(message.ref)) {
      source = card.source;
      break;
    }
  }
  if (source === null) {
    throw new Error(`S7A2: the ${label} message has no waiting action_release card`);
  }
  await answerS7A2Card(world, { source, optionId: 'approve', label });
  return ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message.ref)),
    `the ${label} approved message`);
}

/** `messages/withdraw` as the person (a person may withdraw any message of the workspace), then `messages/read`. */
export async function withdrawS7A2Message(world: S6AHostWorld, message: SessionMessage, label: string):
Promise<SessionMessage> {
  committed<SessionMessage>(await world.post('messages/withdraw',
    graphWrite(S6A_SCOPE, { messageRef: message.ref }, `s7a2-withdraw-${label}`)), `the ${label} withdrawal`);
  return ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, message.ref)),
    `the ${label} withdrawn message`);
}

// ---------------------------------------------------------------------------
// P's block: the person's message and the Workflow's unperformed claim
// ---------------------------------------------------------------------------

/**
 * The person's `messages/send` to `recipient`, then `messages/read`: one real message. With `goal`, it sends
 * `intent: 'action_request'` with `goalRef` = `goal`; without `goal`, `intent: 'inquiry'` with `goalRef: null`. A
 * person's `action_request` reads no dispatch basis, needs no `expected` and keeps `release: null`: the basis read and
 * the release branch run only for a non-host sender
 * (`src/core/work-graph/communication/mailbox-service.ts:2696`, `:2743`). A Work line's input supply skips an
 * `inquiry` (`src/core/agent-runtime/execution-inputs.ts:134`), so a caller that needs the line's Run to read the
 * message passes the source Goal; the claim row passes none.
 */
export async function sendS7A2PersonMessage(world: S6AHostWorld, input: {
  label: string; recipient: SessionRef; goal?: GoalRef; answeredBy?: 'copy';
}): Promise<SessionMessage> {
  const sent = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: input.recipient, text: `S7A2 ${input.label} message`,
    ...(input.goal === undefined ? {} : { entry: 'person_intervention' as const }),
    needsReply: true, goalRef: input.goal ?? null,
    ...(input.answeredBy === 'copy' ? { answeredBy: 'copy' as const, wake: false } : {}),
  }, `s7a2-person-${input.label}`)), `the ${input.label} person message`);
  return ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, sent.ref)),
    `the ${input.label} person message`);
}

/**
 * The Workflow's own `claim_task` request for the Session's next responsible Task, unperformed. The Task is the
 * `sessions/read` link whose Task is not the latest Work claim; `sessions/facts` supplies that claim, the read
 * `runS7ASameSessionAgain` uses. The drive stops at `advanceUntil(…, 'claim_task')`
 * (`tests/helpers/A2-restart-fixture.ts:106–:117`), and its `perform.operation.request` is the owner's own second
 * argument, not performed here.
 */
export async function claimRequestS7A2(world: S6AHostWorld, input: { goal: GoalRef; line: S6ASession; label: string }):
Promise<GraphWrite<ClaimTaskInput>> {
  const facts = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, input.line.ref)),
    `the facts of ${input.line.ref.sessionId}`);
  const card = await world.readSession(input.line.ref);
  const previous = facts.latestWork?.task.taskId ?? null;
  const next = card.links.find(link => link.ref.relation === 'responsible'
    && link.ref.target.kind === 'task' && link.ref.target.ref.taskId !== previous);
  if (next === undefined || next.ref.target.kind !== 'task') {
    throw new Error('S7A2_PRECONDITION: the Session has no next responsible Task');
  }
  const task = next.ref.target.ref;
  const claim = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: input.goal,
    flowId: `s7a2-claim-${input.label}`, sessionHint: input.line.ref, kind: 'select_work' as const,
    taskId: task.taskId }, 'claim_task');
  if (claim.kind !== 'perform' || claim.operation.kind !== 'claim_task') {
    throw new Error(`S7A2: the Workflow did not stop at claim_task: ${claim.kind}`);
  }
  return claim.operation.request;
}

// ---------------------------------------------------------------------------
// C's block: the cancelled source, the open execution and the workspace's Goal count
// ---------------------------------------------------------------------------

/**
 * A cancelled source: `seedS7AGoalPlan` (the cards workspace's `goals/create` and an adopted Plan, as
 * `openS7AWorkWorld` makes its own), cancelled through the person's `goals/control` (`cancelS7AGoal`, whose pins read
 * `tasks/query`, so the Goal needs its Plan), then read back through `goals/read`: the cancelled Goal and the revision
 * that read returned.
 */
export async function createCancelledS7A2Goal(world: S6AHostWorld): Promise<{ goal: GoalSnapshot; revision: number }> {
  const { goal } = await seedS7AGoalPlan(world);
  await cancelS7AGoal(world, goal);
  const read = ready<{ goal: GoalSnapshot }>(await world.post('goals/read', plain(S6A_SCOPE, goal)),
    'the cancelled source');
  return { goal: read.goal, revision: read.goal.revision };
}

/**
 * Holds the line's next model request (`world.gates.modelRequest`), starts the line's one pending Task with
 * `runS7ASameSessionAgain` without awaiting it, and waits until the gate is reached or the drive settles: a drive that
 * fails first rejects this step with its own error. The returned release lets the held request answer with the drive's
 * own scripted final text and, in a `finally`, awaits the drive, so the Run ends.
 */
export async function holdS7A2SecondRun(world: S6AHostWorld, line: S6ASession): Promise<() => Promise<void>> {
  const gate = await world.gates.modelRequest(line);
  const drive = runS7ASameSessionAgain(world, line);
  await Promise.race([gate.reached, drive]);
  return async () => { try { gate.release(); } finally { await drive; } };
}

/**
 * The workspace's Goal count through the production reconcile read `listGoals` (`src/app/startup-reconcile.ts`), the
 * read K's copy service makes privately. `scope` and `signal` are the caller's own; the step opens no world and reads
 * no store directly.
 */
export async function countS7A2Goals(world: S6AHostWorld, scope: WorkspaceScope, signal: AbortSignal):
Promise<number> {
  return ready<{ records: GoalSnapshot[] }>(await world.platform.reconcile.candidates.listGoals(scope, signal),
    `the Goal list of ${scope.workspaceId}`).records.length;
}
// ---------------------------------------------------------------------------
// The late block: the card read and its answer, the release drive, the apply command
// ---------------------------------------------------------------------------

/**
 * The Goal's frozen `action_release` card: `decisions/queue` lists it through the cards fixture's own all-pages read
 * (`tests/helpers/S6A-cards-fixture.ts:276–:291`) and `decisions/card` reads it with the queue's own source; no
 * `DecisionSourceV1` is built here (`tests/RULES.md:150` F1). The first `action_release` card of the queue wins;
 * its `cardKey` comes from that queue read, never from a hand-built source.
 */
export async function readS7A2Card(world: S6AHostWorld, goal: GoalRef):
Promise<{ card: DecisionCardV1; source: DecisionSourceV1 }> {
  const cards = s6aCardsWorkspace(world, S6A_SCOPE);
  const listed = (await cards.readCards(goal)).find(card => card.source.kind === 'action_release');
  if (listed === undefined) throw new Error(`S7A2: the ${goal.goalId} action_release card is not in the queue`);
  const card = ready<DecisionCardV1>(await cards.route('decisions/card', { source: listed.source }),
    `the ${goal.goalId} release card`);
  return { card, source: listed.source };
}
/**
 * The person's answer of `optionId` on the card `readS7A2Card` returned: `decisions/answer` with the queue's own
 * source and that read's pins as `meta.expected` (A1, `tests/RULES.md:27–:31`) — the chain `resolveS6BProjectNote`
 * (`tests/helpers/S6B1-fixture.ts:214–:230`) uses for the note cards. The route's `ResolveDecisionReadV1` comes back
 * whole: the step asserts nothing and composes no answer.
 */
export async function answerS7A2Card(world: S6AHostWorld, input: {
  source: DecisionSourceV1; optionId: 'approve' | 'deny'; label: string;
}): Promise<ResolveDecisionReadV1> {
  return ready<ResolveDecisionReadV1>(await world.post('decisions/answer', graphWrite(S6A_SCOPE, {
    source: input.source, selection: { kind: 'option', optionId: input.optionId }, text: '', annotations: [],
  }, `s7a2-answer-${input.label}`, input.source.pins)), `the ${input.label} decision answer`);
}
/**
 * The message after the person's `action_release` card answer: `messages/read` plus `goals/dispatch-basis`, and a check
 * that the card closed as `source_resolved` and is read-only. The old Workflow `release_message` step and
 * `messages/release` queue are gone; the card answer is the one release. The step moves no fact and reads no counter
 * store (`tests/RULES.md:170` F7).
 */
export async function driveS7A2Release(world: S6AHostWorld, input: {
  goal: GoalRef; messageRef: SessionMessage['ref']; label: string; source?: DecisionSourceV1;
}): Promise<{ message: SessionMessage; basis: DispatchBasisV1 }> {
  const message = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, input.messageRef)),
    `the ${input.label} released message`);
  // A settled dispatch card leaves the waiting queue (`views/decision-read-model.ts` filters `pending`), so its
  // closed shape is read back by the queue's own source when the caller still has it.
  const releasedCard = input.source === undefined ? await readS7A2Card(world, input.goal)
    : { card: ready<DecisionCardV1>(await s6aCardsWorkspace(world, S6A_SCOPE).route('decisions/card',
      { source: input.source }), `the ${input.label} release card`), source: input.source };
  if (releasedCard.card.state !== 'closed' || releasedCard.card.closedReason !== 'source_resolved') {
    throw new Error(`S7A2: the ${input.label} action_release card is not closed/source_resolved`);
  }
  return { message, basis: await readS7A2DispatchBasis(world, input.goal) };
}
/**
 * The apply command of one real effect: `messages.applyMessage` (`book-7a.md:228–:229`) through the one deferred-call
 * helper, with the effect's own committed receipt and `{ kind, ref }`. The step builds no receipt and no
 * acknowledgement; L replaces the row's last statement with `await exercise();` (`7a2-rgp-v7.md:241–:259`).
 */
export async function applyS7A2Message(world: S6AHostWorld, input: {
  message: SessionMessage; effect: ApplicationProofV1['effect'];
  receipt: DecisionApplicationReceiptV1; label: string;
}): Promise<SessionMessage> {
  const proof: ApplicationProofV1 = { receipt: input.receipt, effect: input.effect };
  return committed<SessionMessage>(await callS7A2PublishedOwner(world,
    { owner: 'messages.applyMessage', wave: '7a2-l', scope: S6A_SCOPE },
    graphWrite(S6A_SCOPE, { messageRef: input.message.ref, proof }, `s7a2-apply-${input.label}`).request),
  `the ${input.label} message application`);
}

// ---------------------------------------------------------------------------
// Appended export (7D2 CP2T5 rework R6): the request send plus its dispatch request
// ---------------------------------------------------------------------------

/**
 * `sendS7A2Request` plus one dispatch request in the same held round, through the public action owner
 * (`platform.actionRequests.requestDispatch`, P2 §2.5/§2.8): that persisted request is what raises the
 * `action_release` card (`views/decision-read-model.ts`), never the message. `taskId` picks the Task (default: the
 * first one with no open dispatch and no Run yet); the world's secretary grant must carry `dispatch_task`
 * (`openS7AQueryWorldWithActions`/`requestWorldOptionsWithActions` in `S7A-fixture.ts`). The request rides this
 * send's request root, so the message's `requests/read` feedback names the dispatch.
 */
export async function sendS7A2RequestWithDispatch(
  world: S6AHostWorld, input: { label: string; goal: GoalRef; recipient: SessionRef; taskId?: string }):
Promise<SessionMessage> {
  const text = `S7A2 ${input.label} request`;
  const cards = s6aCardsWorkspace(world, S6A_SCOPE);
  const run = async (context: CoreCallContext) => {
    const plan = await cards.activePlan(input.goal);
    if (plan === null) throw new Error(`S7A2_PRECONDITION: the Goal ${input.goal.goalId} has no adopted Plan`);
    const work = plan.tasks.filter(task => task.taskKind === 'work');
    if (work.length === 0) throw new Error(`S7A2_PRECONDITION: the Goal ${input.goal.goalId} has no work Task`);
    const open = await world.platform.actionRequests.listOpenDispatches(context, { goalRef: input.goal });
    if (open.status !== 'ready') throw new Error(`S7A2: the open dispatches are not readable: ${JSON.stringify(open)}`);
    const requested = new Set(open.value.map(entry => entry.request.task.taskId));
    const free: string[] = [];
    for (const task of work) {
      if (requested.has(task.taskId)) continue;
      if (await cards.taskRun(input.goal, task.taskId) === null) free.push(task.taskId);
    }
    const taskId = input.taskId ?? free[0];
    // Never fall back to a completed Task: the dispatch owner would refuse it (P2 §2.5, design §3.2), and the
    // silent fallback hid that the world has no free Task for another request.
    if (taskId === undefined) {
      throw new Error(`S7A2_PRECONDITION: the Goal ${input.goal.goalId} has no free work Task for ${input.label}`
        + ` (open dispatches: ${[...requested].join(', ') || 'none'})`);
    }
    const task = work.find(candidate => candidate.taskId === taskId);
    if (task === undefined) throw new Error(`S7A2: the Goal ${input.goal.goalId} has no work Task ${taskId}`);
    const dispatched = await world.platform.actionRequests.requestDispatch(context, {
      input: { taskRef: { projectId: input.goal.projectId, goalId: input.goal.goalId, taskId },
        reason: `S7A2 ${input.label} dispatch` },
      meta: { requestId: `s7a2-dispatch-${input.label}`, expected: [] },
    });
    // A pending request is the person's card; an automatic one waits for the target loop. An already-open
    // request for this Task is the same persisted request, so the caller's card read finds it too.
    if (dispatched.status !== 'needs_decision' && dispatched.status !== 'requested'
      && dispatched.status !== 'already_requested') {
      throw new Error(`S7A2: the ${input.label} dispatch request was refused: ${JSON.stringify(dispatched)}`);
    }
  };
  const sent = await sendS7ASecretaryMessageAfter(world, { label: input.label, goalId: input.goal.goalId },
    input.recipient, text, async context => { await run(context); });
  return sent.message;
}
