/**
 * P's filter-table delta on the C directory world (fixture spec FX-7C1-03, drill rulings DR-03/DR-04/DS-08).
 *
 * One `openS7B2DirectoryWorld` supplies the named busy/idle lines; this step adds only the states the filter table
 * still lacks, through the same public steps:
 * - one archived line (`sessions/archive-line` through `world.archive`),
 * - one other-duty line (a secretary role through `sessions/create`),
 * - one module link `{kind:'module', ref:{projectId, moduleId:'s6a-core'}}` through `sessions/create`'s
 *   `initialLinks` (the plan's `TaskScope` module arm is not a link target),
 * - one real ended Work Run (claim, start and end through `workflow/advance`/`driveWorkflow`) so key 3 has
 *   `executionHistory.sessionRef`,
 * - the waiting line from `runS7BWait` (DR-03; `idlePerson`/`idleInquiry` are reusable, not waits), and its
 *   `complete:false` chain: nine real `messages/forward` hops (DR-04), so the 8-hop walk cannot reach the tail,
 * - one second plain `runS7BWait` line without forwards: the book's `waiting` filter arm (`facts.wait !== null`,
 *   every `waits[].complete === true`), kept apart from the chained sender's `waits_incomplete`,
 * - one archive-requested line built **after** the waiting Run, because that Run's maintenance archives a pending
 *   request (the world's own `archiveRequested` predates it).
 *
 * Every state comes from a public step and the world's own trusted contexts; there is no store read, hand-built
 * record/envelope/card/ctx, no second paging world and no wall clock.
 *
 * It also carries P's one real-deps builder for the chooser (all three rows use it): the directory/facts/responsibility
 * owners are the Host's published platform ports, the binding is the Work binding from the exported startup values,
 * the owned context is the world's own human context, and the Goal is a real `goals/read`. No row assembles a second
 * copy of that wiring.
 */
import { createSessionChooser, type PickReadsV1 } from '../../src/business/workflow/session-chooser.js';
import { ownContext, type Owned } from '../../src/business/workflow/workflow.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type {
  ForwardMessageResultV1, SessionMessage,
} from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import type { SessionFactsPort, SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { driveWorkflow, post, readExecution, readGoal } from './A2-restart-fixture.js';
import { createAG2bSession, plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, WORKFLOW, type S6ASession, type S6AWorldOptions } from './S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from './S6B1-fixture.js';
import { ready, S7A_REPLY_TOOLS, sessionOf } from './S7A-fixture.js';
import { runS7BWait } from './S7B-fixture.js';
import {
  handleOf, openS7B2DirectoryWorld, type S7B2DirectorySession, type S7B2DirectoryWorld,
} from './S7B2-consumable-sessions.js';
import type { S7C1PagingWorld } from './S7C1-p-paging-world.js';

export type S7C1DirectoryDelta = {
  readonly archived: S7B2DirectorySession;
  readonly otherDuty: S7B2DirectorySession;
  readonly moduleLinked: S7B2DirectorySession;
  readonly endedRun: {
    readonly session: S7B2DirectorySession;
    readonly run: RunRef;
    readonly goal: GoalRef;
    readonly task: TaskTriple;
  };
  readonly archiveRequested: S7B2DirectorySession;
  /** A plain Work wait: `facts.wait !== null` and every `waits[].complete === true` (the `waiting` filter arm). */
  readonly waiting: S7B2DirectorySession;
  readonly wait: {
    readonly sender: S6ASession;
    readonly recipient: S6ASession;
    readonly goal: GoalRef;
    /** The wait's original message (the sender's own send). */
    readonly message: SessionMessage['ref'];
    /** The tail after the nine forwards; its `transferredTo` is null. */
    readonly tail: SessionMessage['ref'];
    readonly hops: readonly SessionMessage['ref'][];
  };
};

export type S7C1DirectoryDeltaWorld = S7B2DirectoryWorld & { readonly delta: S7C1DirectoryDelta };

/** `sessions/create` with one module link; returns the line built from its one real `sessions/read` card. */
async function createModuleLine(world: S6AHostWorld, input: { label: string; moduleId: string }) {
  const created = await createAG2bSession(world.ag2b, `s7c1-${input.label}`, S6A_WORK_ROLE, [
    { target: { kind: 'module', ref: { projectId: S6A_SCOPE.projectId, moduleId: input.moduleId } },
      relation: 'responsible' },
  ]);
  const card = await world.readSession(created.sessionRef);
  const session: S6ASession = { label: input.label, ref: created.sessionRef, aggregateRef: card.record.ref,
    role: structuredClone(S6A_WORK_ROLE), createdAt: card.record.createdAt };
  return handleOf(session)!;
}

/** One person `messages/forward`; returns the forwarded message ref. */
async function forward(world: S6AHostWorld,
  input: { index: number; messageRef: SessionMessage['ref']; to: S6ASession }): Promise<SessionMessage['ref']> {
  const result = await post<ForwardMessageResultV1>(world.ag2b, 'messages/forward', plain(S6A_SCOPE, {
    commandId: `s7c1-forward-${input.index}`, messageRef: input.messageRef, to: input.to.ref,
  }));
  if (result.status !== 'forwarded') {
    throw new Error(`S7C1: forward ${input.index} was not forwarded: ${JSON.stringify(result)}`);
  }
  return result.message.ref;
}

export async function openS7C1DirectoryDelta(options: S6AWorldOptions): Promise<S7C1DirectoryDeltaWorld> {
  const base = await openS7B2DirectoryWorld({ ...options, extraBindings: [
    ...(options.extraBindings ?? []),
    S7A_REPLY_TOOLS,
    { ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message'] },
  ] });
  const world = base.world;
  const main = s6aCardsWorkspace(world, S6A_SCOPE);

  const archived = handleOf(await world.createWorkSession('s7c1-archived'))!;
  await world.archive(archived.session);
  const otherDuty = handleOf(await world.createSecretary('s7c1-other-duty'))!;
  const moduleLinked = await createModuleLine(world, { label: 's7c1-module-line', moduleId: 's6a-core' });

  // The waiting line of DR-03: its Run really yields on the Work wait. A second plain wait (no forwards) keeps the
  // `waiting` filter arm distinct from the chained sender's `waits_incomplete` (the A-06 arm below).
  const wait = await runS7BWait(world, { label: 's7c1-wait' });
  const plainWait = await runS7BWait(world, { label: 's7c1-waiting' });

  // One real ended Work Run in its own goal; key 3 reads executionHistory.sessionRef.
  const endedGoal = (await main.createGoal('s7c1-ended-goal', 'S7C1 ended Run')).ref;
  const endedPlan = await adoptS6BPlan(main, endedGoal, {
    label: 's7c1-ended', taskIds: ['s7c1-ended-task'], role: S6A_WORK_ROLE.templateId });
  const endedSession = await sessionOf(world,
    await createS6BLine(main, { label: 's7c1-ended-line', role: S6A_WORK_ROLE, tasks: [endedPlan.tasks[0]!] }));
  await world.scripted.script(endedSession, [{ kind: 'text', text: 'S7C1 ended Run answer' }]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: endedGoal, flowId: 's7c1-ended',
    sessionHint: endedSession.ref, kind: 'select_work', taskId: endedPlan.tasks[0]!.taskId });
  const endedFacts = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, endedSession.ref)),
    'the ended Run line facts');
  if (endedFacts.latestWork === null) throw new Error('S7C1: the ended Run line has no latest Work Run');
  const endedRunRef = endedFacts.latestWork.runRef;
  const endedRun = await readExecution(world.ag2b, endedRunRef);
  if (endedRun.run.status !== 'ended'
    || endedRun.run.executionHistory?.sessionRef?.sessionId !== endedSession.ref.sessionId) {
    throw new Error(`S7C1: the Work Run did not end on its line: ${JSON.stringify(endedRun.run)}`);
  }

  // The archive request is built after every Run: a pending request would be archived by their maintenance.
  const archiveRequested = handleOf(await world.createWorkSession('s7c1-archive-requested'))!;
  await world.requestArchive(archiveRequested.session);

  // DR-04: the waiting send plus nine real forwards. Each preceding destination is archived after its hop so the
  // forwarded message is undelivered for the next hop; the ninth tail is the one the facts read walks to.
  await world.archive(wait.recipient);
  let current = wait.message;
  const hops: SessionMessage['ref'][] = [];
  for (let index = 0; index < 9; index += 1) {
    const destination = await world.createWorkSession(`s7c1-forward-destination-${String(index)}`);
    current = await forward(world, { index, messageRef: current, to: destination });
    hops.push(current);
    if (index < 8) await world.archive(destination);
  }

  return {
    ...base,
    delta: {
      archived, otherDuty, moduleLinked,
      endedRun: { session: handleOf(endedSession)!, run: endedRunRef, goal: endedGoal, task: endedPlan.tasks[0]! },
      archiveRequested,
      waiting: handleOf(plainWait.sender)!,
      wait: { sender: wait.sender, recipient: wait.recipient, goal: wait.goal,
        message: wait.message, tail: current, hops },
    },
  };
}

/** The owned caller the chooser takes: the world's own human context, unwrapped by the production entry. */
export function pickOwned(world: S6AHostWorld): Owned {
  const owned = ownContext(world.humanContext());
  if ('rejection' in owned) {
    throw new Error(`S7C1: the world human context is not ownable: ${JSON.stringify(owned.rejection)}`);
  }
  return owned;
}

/**
 * The real factory over the Host's own published owners. `pick` is the optional extra activity/goal-runs/
 * authorization read set; absent, the chooser keeps its creation-time activity order and no authorization filter.
 * `sessions`/`sessionFacts` are the same real owners unless an A2 wrapper around them is passed (the paging world's
 * fault arms); a wrapper never changes a result it does not fail.
 */
export function pickChooser(world: S6AHostWorld, input: {
  sessions?: SessionDirectoryPort; sessionFacts?: SessionFactsPort; pick?: PickReadsV1;
} = {}) {
  return createSessionChooser({
    sessions: input.sessions ?? world.platform.sessions,
    sessionFacts: input.sessionFacts ?? world.platform.sessionFacts,
    responsibilities: world.platform.responsibilities,
    ...(input.pick === undefined ? {} : { pick: input.pick }),
  });
}

/** The one chooser composition the reads rows share: the paging world's real directory/facts owners, the world's own
 *  first Goal, the bound caller and the Host's Work binding. No row assembles a second copy. */
export async function openS7C1Chooser(world: S7C1PagingWorld) {
  const chooser = pickChooser(world.world, { sessions: world.directory, sessionFacts: world.facts });
  const goal = await readGoal(world.world.ag2b, world.world.goals.first);
  return { chooser, goal, owned: pickOwned(world.world), binding: WORKFLOW.bindings[0]! };
}
