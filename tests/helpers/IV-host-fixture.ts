/**
 * IV host fixture: the real Host consume loop the intervention rows drive, plus the public reads and public steps
 * those rows use. Every state comes from a public step: the Host's own start and its `inputConsumers` pass,
 * `messages/send` / `messages/release` / `queries/read` / `plans/proposal` / `plans/apply` / `decisions/queue` and
 * `sessions/*` reads. The scripted model is the Host's configured provider; no test calls `handleIntervention`
 * directly.
 *
 * The frozen S6A Host world publishes only the secretary and plain Query profiles. `openConsumeWorld` delegates to
 * the existing `openConsumeHostWorld` wrapper (`tests/helpers/S7B2-consumable-sessions.ts`), which installs the one
 * Work profile the Work line needs: an A8 Host input, not a record.
 */
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import * as hostModule from '../../src/app/host.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryRunSnapshot } from '../../src/contracts/query-job.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { PlanProposal, PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { ConsumableSessionV1 } from '../../src/core/work-graph/views/consumable-sessions.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { planProposalIdFor } from '../../src/core/work-graph/tasks/plan-service.js';
import { plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import type { S6AHostWorld, S6AHostWorldOptions } from './S6A-host-fixture.js';
import { openConsumeHostWorld } from './S7B2-consumable-sessions.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from './S6A-request-fixture.js';
import { createS6BLine, governS6B } from './S6B1-fixture.js';
import { ready, sessionOf } from './S7A-fixture.js';
import { sendS7A2PersonMessage } from './S7A2-fixture.js';

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

/**
 * Advances the real Host until the held model request of the line arrives. The pass that reaches it stays pending
 * on the gate; `settled` is that pass's barrier, awaited after the gate is released.
 */
export async function heartbeatUntilModel(world: S6AHostWorld,
  gate: Awaited<ReturnType<S6AHostWorld['gates']['modelRequest']>>,
  maxPasses = 12): Promise<{ settled: Promise<void> }> {
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const settled = world.consumeBarrier();
    world.clock.advance(25);
    const held = await Promise.race([gate.reached.then(() => true), settled.then(() => false)]);
    if (held) return { settled };
  }
  throw new Error(`IV: the Run did not reach its held model request in ${String(maxPasses)} Host passes`);
}
