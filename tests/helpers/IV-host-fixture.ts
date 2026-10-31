/**
 * IV host fixture: the real Host consume loop the intervention rows drive, plus the public reads and public steps
 * those rows use. Every state comes from a public step: the Host's own start and its `inputConsumers` pass,
 * `messages/send` / `messages/read` / `messages/body` / `messages/release` / `queries/read` / `queries/answer` /
 * `plans/proposal` / `plans/apply` / `plans/abandon` / `decisions/queue` / `decisions/answer` and `sessions/*`
 * reads. The scripted model is the Host's configured provider; no test calls `handleIntervention` directly.
 *
 * `openConsumeWorld` delegates to the existing `openConsumeHostWorld` (`S7B2-consumable-sessions.ts`), which keeps
 * one wrapper on the Host factory for the world's whole life (restored by `close`): the consumer's Work profile is
 * pushed into the Host's `runtimeConfiguration` on every start, so a real `crash()`/`reopen` on SQLite gets the same
 * profile. The profile is an A8 Host input, not a record.
 */
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import * as hostModule from '../../src/app/host.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import type { QueryRunSnapshot } from '../../src/contracts/query-job.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import type {
  DecisionCardV1, ResolveDecisionReadV1,
} from '../../src/core/work-graph/model/decision-contracts.js';
import type { PlanProposal, PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { MessageBody, SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { ConsumableSessionV1 } from '../../src/core/work-graph/views/consumable-sessions.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { planProposalIdFor } from '../../src/core/work-graph/tasks/plan-service.js';
import {
  graphWrite, plain,
} from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import type { S6AHostWorld, S6AHostWorldOptions } from './S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from './S6A-request-fixture.js';
import { createS6BLine, governS6B } from './S6B1-fixture.js';
import { committed, ready, sessionOf } from './S7A-fixture.js';
import { sendS7A2PersonMessage } from './S7A2-fixture.js';
import { listed, readS7BMessage } from './S7B-fixture.js';
import { openConsumeHostWorld } from './S7B2-consumable-sessions.js';

/** The real factory, captured before any row's Host spy can put an older wrapper back on the export. */
const realCreateLocalWorkbenchHost = hostModule.createLocalWorkbenchHost;

/**
 * One real memory-or-SQLite Host world whose consume loop scans the Work line with the shared Work profile the
 * `openConsumeHostWorld` wrapper installs (`'s6a-work-profile'`). `restoreMocks` replays the S6A start spy's old
 * wrapper before the next row, so the export is reset to the real factory first: the existing helper then wraps
 * and restores that one, never a previous row's wrapper.
 */
export async function openConsumeWorld(options: {
  backend?: S6AHostWorldOptions['backend']; label?: string;
} = {}): Promise<S6AHostWorld> {
  const label = options.label ?? 'iv';
  Object.defineProperty(hostModule, 'createLocalWorkbenchHost',
    { value: realCreateLocalWorkbenchHost, configurable: true, writable: true });
  return await openConsumeHostWorld({
    backend: options.backend ?? 'memory',
    extraHostOptions: { inputConsumers: [{ scope: S6A_SCOPE,
      sessionRef: { projectId: S6A_SCOPE.projectId, sessionId: `${label}-consumer` },
      goalRef: { aggregateType: 'Goal' as const, projectId: S6A_SCOPE.projectId, goalId: `${label}-consumer` },
      queryProfileId: 's6a-work-profile', heartbeatMs: 25 }] },
  });
}

/** Two empty passes settle the Host before the row's own message exists. */
export async function settleHost(world: S6AHostWorld): Promise<void> {
  await heartbeat(world, 60_000);
  await heartbeat(world, 60_000);
}

/** One real measured Host consume pass: the barrier observes the throttle the clock just cleared. */
export async function heartbeat(world: S6AHostWorld, ms = 25): Promise<void> {
  const settled = world.consumeBarrier();
  world.clock.advance(ms);
  await settled;
}

/** Bounded polling over real consume passes; no sleep and no assertion on absence. */
export async function heartbeatUntil<T>(world: S6AHostWorld, read: () => Promise<T>,
  done: (value: T) => boolean, maxPasses = 16): Promise<T> {
  let value = await read();
  for (let pass = 0; pass < maxPasses && !done(value); pass += 1) {
    await heartbeat(world);
    value = await read();
  }
  return value;
}

/** What the real consumer view offers this line right now (the same read the Host's loop makes). */
export async function consumeView(world: S6AHostWorld, line: S6ASession): Promise<ConsumableSessionV1 | null> {
  const read = await world.platform.consumableSessions.readConsumableSessions(world.humanContext(),
    { workspace: S6A_SCOPE, after: null, limit: 50 });
  if (read.status !== 'ready') throw new Error(`IV: the consumable view is not ready: ${JSON.stringify(read)}`);
  return read.value.items.find(item => item.session.sessionId === line.ref.sessionId) ?? null;
}

/** One real `sessions/create` on an already governed workspace. */
export async function createLine(world: S6AHostWorld, label: string): Promise<S6ASession> {
  return await sessionOf(world, await createS6BLine(s6aCardsWorkspace(world, S6A_SCOPE),
    { label, role: S6A_WORK_ROLE }));
}

/** The line without a message: governance plus one real `sessions/create`. */
export async function openLine(world: S6AHostWorld, label: string): Promise<{ line: S6ASession }> {
  await governS6B(world, s6aCardsWorkspace(world, S6A_SCOPE), world.goals);
  return { line: await createLine(world, label) };
}

/** An idle Work line on Goal 2 (no adopted Plan) and one real person message, with the model's first plan scripted. */
export async function openIdleLine(world: S6AHostWorld, text: string, label = 'iv-line'): Promise<{
  line: S6ASession; messageRef: SessionMessageRef;
}> {
  const { line } = await openLine(world, label);
  const message = await sendS7A2PersonMessage(world, { label, recipient: line.ref, goal: world.goals.second });
  await world.scripted.script(line, [{ kind: 'text', text }]);
  return { line, messageRef: message.ref };
}

/** The deterministic proposal address of the intervention Query of `messageRef`. */
export function proposalRefOf(messageRef: SessionMessageRef, goal: GoalRef): PlanProposalRef {
  return {
    aggregateType: 'PlanProposal', projectId: messageRef.projectId, workspaceId: messageRef.workspaceId,
    proposalId: planProposalIdFor({ projectId: messageRef.projectId, workspaceId: messageRef.workspaceId,
      goalId: goal.goalId, requestId: `intervention:${sessionMessageRefKey(messageRef)}:propose` }),
  };
}

/** `queries/read` of the intervention planning Query, `null` while the deterministic pair does not exist yet. */
export async function readPlanningQuery(world: S6AHostWorld,
  messageRef: SessionMessageRef): Promise<QueryJobRecord | null> {
  const refs = interventionPlanningQueryRefs(messageRef);
  const read = (await world.post('queries/read', plain(S6A_SCOPE, refs.queryJobRef))).body as ReadResult<QueryJobRecord>;
  return read.status === 'ready' ? read.value : null;
}

/** Polls the planning Query until the Host has answered it; a claimed Query is the defect. */
export async function awaitPlanningAnswer(world: S6AHostWorld, messageRef: SessionMessageRef,
  maxPasses = 16): Promise<QueryJobRecord | null> {
  return await heartbeatUntil(world, () => readPlanningQuery(world, messageRef),
    query => query?.job.job.status === 'answered', maxPasses);
}

/** Polls until the Host has claimed the planning Query (the claimed or prepared phase). */
export async function awaitClaimedPlanning(world: S6AHostWorld, messageRef: SessionMessageRef,
  maxPasses = 12): Promise<QueryJobRecord | null> {
  return await heartbeatUntil(world, () => readPlanningQuery(world, messageRef),
    query => query?.run.run.executionState?.phase === 'claimed'
      || query?.run.run.executionState?.phase === 'prepared', maxPasses);
}

/** Polls until the intervention's first proposal reads `candidate`; the proposal read's whole envelope is returned. */
export async function awaitProposal(world: S6AHostWorld, proposalRef: PlanProposalRef,
  maxPasses = 12): Promise<ReadResult<PlanProposal>> {
  return await heartbeatUntil(world, async () =>
    (await world.post('plans/proposal', plain(S6A_SCOPE, proposalRef))).body as ReadResult<PlanProposal>,
  read => read.status === 'ready' && read.value.status === 'candidate', maxPasses);
}

/** The candidate cards the public `decisions/queue` shows for `goal` (waiting, answered and history). */
export async function candidateCards(world: S6AHostWorld, goal: GoalRef): Promise<DecisionCardV1[]> {
  const cards = await s6aCardsWorkspace(world, S6A_SCOPE).readCards(goal);
  return cards.filter(card => card.source.kind === 'candidate');
}

/** The waiting `planning_question` cards of `goal` (the queue is a read model, not a write). */
export async function questionCards(world: S6AHostWorld, goal: GoalRef): Promise<DecisionCardV1[]> {
  const cards = await s6aCardsWorkspace(world, S6A_SCOPE).readCards(goal);
  return cards.filter(card => card.source.kind === 'planning_question' && card.state === 'waiting_answer');
}

/** The person's `decisions/answer` of one card, with the card's own source and pins. */
export async function answerCard(world: S6AHostWorld, card: DecisionCardV1, requestId: string,
  text: string): Promise<ResolveDecisionReadV1> {
  return ready<ResolveDecisionReadV1>((await world.post('decisions/answer', graphWrite(S6A_SCOPE, {
    source: card.source as DecisionSourceV1, selection: { kind: 'other' }, text, annotations: [],
  }, requestId, card.source.pins))).body, `the card answer ${requestId}`);
}

/** `sessions/executions`: the real claims of the line. */
export async function sessionExecutions(world: S6AHostWorld, line: S6ASession): Promise<TaskClaim[]> {
  const read = ready<{ items: TaskClaim[] }>((await world.post('sessions/executions', plain(S6A_SCOPE,
    { sessionRef: line.ref, page: { limit: 20 } }))).body, 'the Session executions');
  return read.items;
}

/** `sessions/queries`: the real QueryRuns of the line. */
export async function sessionQueries(world: S6AHostWorld, line: S6ASession): Promise<QueryRunSnapshot[]> {
  const read = ready<{ items: QueryRunSnapshot[] }>((await world.post('sessions/queries', plain(S6A_SCOPE,
    { sessionRef: line.ref, page: { limit: 20 } }))).body, 'the Session queries');
  return read.items;
}

/** `sessions/facts` of the line: the public facts the rows compare. */
export async function lineFacts(world: S6AHostWorld, line: S6ASession): Promise<SessionFactsV1> {
  return ready<SessionFactsV1>((await world.post('sessions/facts', plain(S6A_SCOPE, line.ref))).body,
    'the line facts');
}

/** One saved body part, through `messages/body`. */
export async function readBody(world: S6AHostWorld, ref: SessionMessageRef,
  part: 'message' | 'response'): Promise<string> {
  return ready<MessageBody>((await world.post('messages/body', plain(S6A_SCOPE, { messageRef: ref, part }))).body,
    `the ${part} body of ${ref.messageId}`).text;
}

/** The Host notices on the line whose saved body is exactly `text` (the fixed closing sentence). */
export async function notices(world: S6AHostWorld, line: S6ASession, text: string): Promise<SessionMessage[]> {
  const found: SessionMessage[] = [];
  for (const message of await listed(world, 'inbox', line)) {
    if (message.sender.kind !== 'host' || message.intent !== 'notify') continue;
    if (await readBody(world, message.ref, 'message') === text) found.push(message);
  }
  return found;
}

/** The formal Query answer text of one QueryJob, or `null` before it saved one. */
export async function readQueryAnswer(world: S6AHostWorld,
  queryJobRef: ReturnType<typeof interventionPlanningQueryRefs>['queryJobRef']): Promise<string | null> {
  const job = ready<QueryJobRecord>((await world.post('queries/read', plain(S6A_SCOPE, queryJobRef))).body,
    `the Query ${queryJobRef.queryJobId}`);
  const ref = job.job.job.answerRefs.at(-1);
  if (ref === undefined) return null;
  const answer = ready<{ answer: { answer: string } }>((await world.post('queries/answer',
    plain(S6A_SCOPE, ref))).body, `the Query answer ${ref.answerId}`);
  return answer.answer.answer;
}

/** Polls the message until its single response slot is written. */
export async function waitForResponse(world: S6AHostWorld, ref: SessionMessageRef,
  maxPasses = 16): Promise<SessionMessage> {
  return await heartbeatUntil(world, () => readS7BMessage(world, ref),
    message => message.response !== null, maxPasses);
}

/** Polls the message until it is withdrawn. */
export async function waitForWithdrawn(world: S6AHostWorld, ref: SessionMessageRef,
  maxPasses = 24): Promise<SessionMessage> {
  return await heartbeatUntil(world, () => readS7BMessage(world, ref),
    message => message.withdrawnAt !== null, maxPasses);
}

/**
 * The intervention's deterministic candidate proposal of `messageRef`, read through `plans/proposal`, with the
 * formal Query snapshot. A row that needs the candidate has already sent the message and scripted its plan answer.
 */
export async function awaitCandidate(world: S6AHostWorld, messageRef: SessionMessageRef, goal: GoalRef,
  maxPasses = 16): Promise<{ query: QueryRunSnapshot; proposal: PlanProposal }> {
  const read = await awaitProposal(world, proposalRefOf(messageRef, goal), maxPasses);
  if (read.status !== 'ready' || read.value.status !== 'candidate') {
    throw new Error(`IV: the intervention produced no candidate proposal: ${JSON.stringify(read)}`);
  }
  const query = await readPlanningQuery(world, messageRef);
  if (query === null) throw new Error('IV: the candidate has no planning Query');
  return { query: query.run, proposal: read.value };
}

/** The `plans/proposal` read of one proposal. */
export async function readProposal(world: S6AHostWorld, ref: PlanProposalRef): Promise<PlanProposal> {
  return ready<PlanProposal>((await world.post('plans/proposal', plain(S6A_SCOPE, ref))).body,
    `the proposal ${ref.proposalId}`);
}

/**
 * The person's `plans/abandon` of a candidate: the proposal pin read just before and the Goal's own revision,
 * exactly the two pins the owner requires.
 */
export async function abandonCandidate(world: S6AHostWorld, goal: GoalRef,
  proposal: PlanProposal, requestId: string): Promise<PlanProposal> {
  const goalSnapshot = ready<{ goal: GoalSnapshot }>((await world.post('goals/read', plain(S6A_SCOPE,
    goal))).body, 'the Goal').goal;
  const pins: VersionPin[] = [
    { ref: proposal.ref, revision: proposal.revision },
    { ref: goalSnapshot.ref, revision: goalSnapshot.revision },
  ];
  return committed<PlanProposal>((await world.post('plans/abandon', graphWrite(S6A_SCOPE,
    { proposalRef: proposal.ref }, requestId, pins))).body, `the abandon ${requestId}`);
}

/**
 * A second real proposal on the same intervention request head, through `plans/propose` with the `replaces`
 * selector: the public step that makes the first candidate `not_adopted/replaced`. The source message names the
 * intervention Query, the one proof the proposal owner accepts for a source that is not a request root.
 */
export async function proposeReplacement(world: S6AHostWorld, input: {
  goal: GoalRef; requestId: string; queryRef: QueryRunSnapshot['run']['queryJobRef'];
  proposal: PlanProposal; sourceMessageRef: SessionMessageRef; draft: Record<string, unknown>;
}): Promise<PlanProposal> {
  const goalSnapshot = ready<{ goal: GoalSnapshot }>((await world.post('goals/read', plain(S6A_SCOPE,
    input.goal))).body, 'the Goal').goal;
  return committed<PlanProposal>((await world.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: input.goal, basedOn: null, draft: input.draft, requestRef: input.queryRef,
    sourceMessageRef: input.sourceMessageRef,
    replaces: { proposalRef: input.proposal.ref, revision: input.proposal.revision },
    reason: { text: `IV replacement ${input.requestId}`, sources: [] },
  }, input.requestId, [{ ref: goalSnapshot.ref, revision: goalSnapshot.revision }]))).body,
  `the replacement ${input.requestId}`);
}

/** A system Host actor's `messages/withdraw` through the published core route table. */
export async function systemWithdraw(world: S6AHostWorld, ref: SessionMessageRef, requestId: string): Promise<unknown> {
  return await world.dispatch('messages/withdraw', world.systemContext(),
    graphWrite(S6A_SCOPE, { messageRef: ref }, requestId));
}

/**
 * Advances the real Host until the held point (`reached`: a model request or a commit gate) arrives. The pass that
 * reaches it stays pending on the gate; `settled` is that pass's barrier, awaited after the gate is released.
 */
export async function heartbeatUntilModel(world: S6AHostWorld,
  gate: { reached: Promise<unknown> },
  maxPasses = 12): Promise<{ settled: Promise<void> }> {
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const settled = world.consumeBarrier();
    world.clock.advance(25);
    const held = await Promise.race([gate.reached.then(() => true), settled.then(() => false)]);
    if (held) return { settled };
  }
  throw new Error(`IV: the held point was not reached in ${String(maxPasses)} Host passes`);
}
