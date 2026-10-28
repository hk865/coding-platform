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
import type { DispatchBasisV1, GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { advanceUntil, type AdvanceValue } from './A2-restart-fixture.js';
import { callPublishedOwnerAsHost, type S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE, type S6ASession } from './S6A-request-fixture.js';
import type { ApplicationProofV1, DecisionApplicationReceiptV1 } from '../../src/contracts/core/session-message.js';
import type { DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import type { DecisionCardV1, ResolveDecisionReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import {
  cancelS7AGoal, committed, holdS7AQueryRound, ready, runS7ASameSessionAgain, seedS7AGoalPlan, sendS7ASecretaryMessage,
} from './S7A-fixture.js';

// ---------------------------------------------------------------------------
// The shared block: a later wave's published owner
// ---------------------------------------------------------------------------

/**
 * A platform member a later 7A-2 wave publishes, called in process as the Host's human operator bound to `scope`
 * (`world.humanContext()`'s actor through `createHostCoreCallContext`). The member is looked up at call time and
 * started before this returns. An unpublished member rejects with the stable named error
 * `S7A2: the ${call.owner} command is not published yet (${call.wave})`. The owner's whole envelope comes back; the
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
 * A real secretary send in a held request round of `goal`. An `inquiry` is 7A-1's own step
 * `sendS7ASecretaryMessage(world, { label, goalId: goal.goalId }, recipient, text)` (which sends `needsReply: true`
 * with no `expected`), and this step returns its `message`. An `action_request` takes the path 7A-1 already proves:
 * `holdS7AQueryRound(world, { label, goalId: goal.goalId }, …)` uses the round's own `query_run` context, the send
 * calls `world.platform.messages.sendMessage` with `needsReply: true` and `expected` = the `readS7A2DispatchBasis`
 * read just before, then `messages/read`. The release follows the autonomy the test set with `setS7AAutonomy`.
 */
export async function sendS7A2Request(world: S6AHostWorld, input: {
  label: string; goal: GoalRef; recipient: SessionRef; intent: 'action_request' | 'inquiry';
}): Promise<SessionMessage> {
  const text = `S7A2 ${input.label} request`;
  if (input.intent === 'inquiry') {
    const sent = await sendS7ASecretaryMessage(world, { label: input.label, goalId: input.goal.goalId },
      input.recipient, text);
    return sent.message;
  }
  return holdS7AQueryRound(world, { label: input.label, goalId: input.goal.goalId }, async context => {
    const expected = await readS7A2DispatchBasis(world, input.goal);
    const saved = committed<SessionMessage>(await world.platform.messages.sendMessage(context, {
      input: { recipient: input.recipient, text, intent: 'action_request', needsReply: true, expected },
      meta: { requestId: `s7a2-send-${input.label}`, expected: [] },
    }), 'the action request');
    return ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, saved.ref)),
      'the saved action request');
  });
}

/** `messages/release` with `allow: true` as the person, then `messages/read`. */
export async function approveS7A2Message(world: S6AHostWorld, message: SessionMessage, label: string):
Promise<SessionMessage> {
  committed<SessionMessage>(await world.post('messages/release',
    graphWrite(S6A_SCOPE, { messageRef: message.ref, allow: true }, `s7a2-release-${label}`)), `the ${label} approval`);
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
  label: string; recipient: SessionRef; goal?: GoalRef;
}): Promise<SessionMessage> {
  const sent = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: input.recipient, text: `S7A2 ${input.label} message`,
    intent: input.goal === undefined ? 'inquiry' : 'action_request',
    needsReply: true, goalRef: input.goal ?? null,
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
 * The Goal's `message_release` card: `decisions/queue` lists it through the cards fixture's own all-pages read
 * (`tests/helpers/S6A-cards-fixture.ts:276–:291`) and `decisions/card` reads it with the queue's own source; no
 * `DecisionSourceV1` is built here (`tests/RULES.md:150` F1). The first `message_release` card of the queue wins.
 */
export async function readS7A2Card(world: S6AHostWorld, goal: GoalRef):
Promise<{ card: DecisionCardV1; source: DecisionSourceV1 }> {
  const cards = s6aCardsWorkspace(world, S6A_SCOPE);
  const listed = (await cards.readCards(goal)).find(card => card.source.kind === 'message_release');
  if (listed === undefined) throw new Error(`S7A2: the ${goal.goalId} release card is not in the queue`);
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
 * One release driven by the Workflow explicitly: `advanceUntil` walks `select_work` to the `release_message` perform,
 * the step posts that perform, reads `messages/read` of the row's message and then `goals/dispatch-basis`. It never
 * calls the Host's arm entry and never reads the counter's store (`tests/RULES.md:170` F7).
 */
export async function driveS7A2Release(world: S6AHostWorld, input: {
  goal: GoalRef; messageRef: SessionMessage['ref']; label: string;
}): Promise<{ message: SessionMessage; basis: DispatchBasisV1 }> {
  const perform = await advanceUntil(world.ag2b, { schemaVersion: 1 as const, goalRef: input.goal,
    flowId: `s7a2-release-${input.label}`, sessionHint: null, kind: 'select_work' as const }, 'release_message');
  const done = ready<AdvanceValue>(await world.post('workflow/advance', plain(S6A_SCOPE, perform)),
    `the ${input.label} release step`);
  if (done.state !== 'advance') throw new Error(`S7A2: the ${input.label} release step did not advance`);
  const message = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, input.messageRef)),
    `the ${input.label} released message`);
  if (message.release !== 'released') throw new Error(`S7A2: the ${input.label} message is ${message.release}`);
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
