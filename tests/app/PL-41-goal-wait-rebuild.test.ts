/**
 * PL-41 (§6.1.6, third half): the restart rebuild registers a Goal only when its own candidate
 * facts still wait. The world is the existing S6A Host world with a real adopted Plan and a real
 * pending candidate written through `plans/propose`; the shared `PL-reads-fixture` gives
 * `createPlanReaders` the world's real owners, exactly the bag the composition root will
 * inject. Nothing is written by hand and no store is read: the candidate, the active Plan and
 * the Goal all come from public steps.
 *
 * The registry is the real `createGoalWaitWakes`, wrapped only to record the basis it was handed
 * (rule sheet A3: forward the call unchanged, count it).
 *
 * The crash variants are in `tests/app/PL-41-restart-settlement.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalWaitBasisV1 } from '../../src/business/workflow/contracts.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { createGoalWaitRebuild, createGoalWaitWakes, type GoalWaitWakes } from '../../src/app/goal-wait-wakes.js';
import { openPLReadingsWorld, type PLReadingsWorld } from '../helpers/PL-readings-fixture.js';
import { openPlanReaders } from '../helpers/PL-reads-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';

import { readS7BMessage } from '../helpers/S7B-fixture.js';
import { completeS7BGoal, firstPlan, refinementPlan } from '../helpers/S7B-V-fixture.js';
import { readActivePlan, proposeCandidate } from '../scenarios/support/S5-decisions.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { cancelS7AGoal, committed, ready } from '../helpers/S7A-fixture.js';
import { openConsumeWorld, openIdleLine, createLine, awaitPlanningAnswer, awaitProposal, candidateCards,
  heartbeat, notices, proposalRefOf, readProposal } from '../helpers/IV-host-fixture.js';
import { createPLAdviserLine, needsDecisionAnswer, openPLConsumptionWorld, seedPLHistoryQuestion,
  seedPLSenderPlan } from '../helpers/PL-consumption-fixture.js';
import { waitDriver } from '../helpers/DRV-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { waitFor } from '../scenarios/harness.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';

const worlds: Array<PLReadingsWorld | S6AHostWorld> = [];
afterEach(async () => {
  for (const fixture of worlds.splice(0)) await fixture.close().catch(() => undefined);
});

/** One real pending candidate on the active Plan, proposed through the shared S5 helper. */
async function seedCandidate(fixture: PLReadingsWorld, label: string): Promise<void> {
  const world = fixture.world;
  const active = await readActivePlan(world.platform, world.humanContext(), fixture.goal);
  const text = await refinementPlan(world, fixture.goal, {
    label, taskId: `${label}-task`, role: S6A_WORK_ROLE.templateId,
  });
  const draft = (JSON.parse(text) as { plan: PlanRevisionDraft }).plan;
  await proposeCandidate(world.platform, world.humanContext(), {
    goalRef: fixture.goal, basedOn: active.ref, draft, requestRef: null,
    requestId: `${label}-propose`,
  });
}

/** The Host's own `held` read (`host.ts`): a Goal with a pending restart interruption is held. */
async function heldByDisplay(world: S6AHostWorld, ctx: CoreCallContext,
  goalRef: GoalRef): Promise<boolean> {
  const read = await world.platform.plans.queryGoalDisplay!(ctx, { goalRef });
  if (read.status !== 'ready') throw new Error(`PL-41: the Goal display read is ${read.status}`);
  return read.value.display.causes.some(cause => 'interruption' in cause);
}

/** The real registry plus the A3 recording wrapper around its one method. */
function recordingRegistry(): { waits: GoalWaitWakes; registered: GoalWaitBasisV1[] } {
  const waits = createGoalWaitWakes();
  const registered: GoalWaitBasisV1[] = [];
  return {
    registered,
    waits: {
      ...waits,
      register(basis, cursor) {
        registered.push(structuredClone(basis));
        waits.register(basis, cursor);
      },
    },
  };
}

function rebuildFor(world: S6AHostWorld) {
  const readers = openPlanReaders(world);
  return createGoalWaitRebuild({
    ctx: () => world.humanContext(),
    sessions: world.platform.sessions,
    facts: world.platform.sessionFacts,
    released: world.platform.messageRelease,
    held: (ctx, goalRef) => heldByDisplay(world, ctx, goalRef),
    planCandidates: readers.planCandidates.bind(readers),
    acceptedCandidatesOf: readers.acceptedCandidatesOf.bind(readers),
    messages: world.platform.messages,
    queries: world.platform.queries,
    plans: world.platform.plans,
  });
}

/** The Goal's active Plan revision through the public `readActivePlan`. */
async function planRevision(world: S6AHostWorld, goalRef: GoalRef): Promise<number> {
  return (await readActivePlan(world.platform, world.humanContext(), goalRef)).planRevision;
}

/** The Goal's accepted candidates through the platform's own published narrow read. */
async function acceptedOf(world: S6AHostWorld, goalRef: GoalRef) {
  const read = await world.platform.planReaders.acceptedCandidatesOf(goalRef);
  if (read.status !== 'ready') throw new Error(`PL-41: acceptedCandidatesOf is ${read.status}`);
  return read.value;
}

/**
 * The person adopts the candidate the message's planning Query wrote (`plans/apply`, one commit);
 * the answer is what a notice position must carry: that commit's cursor and the adopted plan's id.
 */
async function adoptIntervention(world: S6AHostWorld, messageRef: SessionMessageRef,
  requestId: string): Promise<{ cursor: string; planId: string }> {
  const proposalRef = proposalRefOf(messageRef, world.goals.second);
  const proposal = await awaitProposal(world, proposalRef);
  if (proposal.status !== 'ready') throw new Error(`PL-41: the candidate is ${proposal.status}`);
  const applied = (await world.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef, expectedProposalRevision: proposal.value.revision, decisionRefs: [],
  }, requestId))).body as { cursor: string };
  committed(applied, 'the PL-41 candidate adoption');
  return { cursor: applied.cursor, planId: proposal.value.draft.planId };
}

/** The Goal's `plan_adoption` notice positions, through the public queue read. */
async function adoptionPositions(world: S6AHostWorld, goal: GoalRef): Promise<unknown[]> {
  const read = await s6aCardsWorkspace(world, S6A_SCOPE).readNotices({ goal, categories: ['plan_adoption'] });
  return read.notices.map(notice => notice.position);
}

/** `workflow/driver-start` for the Goal, exactly the body the person's start uses. */
async function startDriver(world: S6AHostWorld, goalRef: GoalRef, flowId: string): Promise<void> {
  await world.post('workflow/driver-start', plain(S6A_SCOPE, {
    advance: { schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work' },
    queryProfileIds: [],
  }));
}

describe('PL-41 goal-wait rebuild, candidate half', () => {
  it('registers the Goal with a pending candidate and leaves the Goal without one alone', async () => {
    const fixture = await openPLReadingsWorld();
    worlds.push(fixture);
    await seedCandidate(fixture, 'pl41-candidate');

    const { waits, registered } = recordingRegistry();
    await rebuildFor(fixture.world)(S6A_SCOPE, waits);

    const candidateGoal = registered.filter(basis => basis.goalId === fixture.goal.goalId);
    expect(candidateGoal).toHaveLength(1);
    // The candidate basis names the reply/proposal kinds and the restart reason.
    expect(candidateGoal[0]!.recordKinds).toEqual(expect.arrayContaining(['SessionMessage', 'PlanProposal']));
    expect(candidateGoal[0]!.reasons).toEqual(['restart']);
    // The other active Goal has neither a pending candidate nor a question group: not registered.
    const other = fixture.world.goals.second;
    expect(registered.map(basis => basis.goalId)).not.toContain(other.goalId);

    // The registry the rebuild actually fed answers the Goal through its own drain batch.
    waits.queueAll();
    expect(waits.nextDrainBatch().map(c => c.goalRef.goalId)).toContain(fixture.goal.goalId);
    expect(waits.nextDrainBatch().map(c => c.goalRef.goalId)).not.toContain(other.goalId);
  }, 120_000);
});

describe('PL-41 goal-wait rebuild, adopted-unreplied recovery', () => {
  it('replies an accepted candidate\'s open executor message once after a SQLite crash and person start', async () => {
    const world = await openConsumeWorld({ backend: 'sqlite', label: 'pl41-adopted' });
    worlds.push(world);
    await settlePL41(world);
    const { messageRef } = await openIdleLine(world,
      firstPlan({ label: 'pl41-adopted', taskId: 'pl41-adopted-task', role: S6A_WORK_ROLE.templateId }),
      'pl41-adopted-line');
    const query = await awaitPlanningAnswer(world, messageRef);
    expect(query?.job.job.status, 'the planning Query is answered').toBe('answered');
    await adoptIntervention(world, messageRef, 'pl41-adopted-apply');
    const adopted = await readProposal(world, proposalRefOf(messageRef, world.goals.second));
    expect(await planRevision(world, world.goals.second), 'the candidate advanced the Plan one revision').toBe(1);
    expect(await acceptedOf(world, world.goals.second), 'the Goal has one accepted candidate').toHaveLength(1);
    expect((await readS7BMessage(world, messageRef)).response, 'M is still open and unanswered').toBeNull();
    // The rebuild's accepted-candidate arm reads every accepted candidate (not the active Plan's one version)
    // and registers this Goal while its source M is an open wait.
    const recovery = recordingRegistry();
    await rebuildFor(world)(S6A_SCOPE, recovery.waits);
    expect(recovery.registered.map(basis => basis.goalId),
      'the rebuild registers the adopted-unreplied Goal').toContain(world.goals.second.goalId);

    await world.crash();
    // Before the person starts, the restart has written the interruption and nothing has replied or adopted.
    const report = ready<{ report: { interruptedGoals: { goalRef: GoalRef }[] } }>(await world.post(
      'host/reconcile-report', plain(S6A_SCOPE, {})), 'the reconcile report');
    expect(report.report.interruptedGoals.map(entry => entry.goalRef.goalId)).toContain(world.goals.second.goalId);
    expect((await readS7BMessage(world, messageRef)).response, 'no reply before driver-start').toBeNull();
    expect(await acceptedOf(world, world.goals.second), 'no second adoption before driver-start').toHaveLength(1);
    expect(await planRevision(world, world.goals.second), 'no second Plan revision before driver-start').toBe(1);

    await startDriver(world, world.goals.second, 'pl41-adopted-driver');
    const replied = await waitFor(() => readS7BMessage(world, messageRef), message => message.response !== null,
      'the adopted candidate M reply');
    expect(replied.response?.sender.kind, 'the one reply comes from the formal QueryRun').toBe('query_run');
    // The arm only replies: no second proposal, no second adoption, one active Plan revision.
    expect(await acceptedOf(world, world.goals.second), 'still one accepted candidate').toHaveLength(1);
    expect(await planRevision(world, world.goals.second), 'the active Plan still has one revision').toBe(1);
    await heartbeat(world);
    expect(await readS7BMessage(world, messageRef), 'M has exactly this one reply').toEqual(replied);
    expect(await readProposal(world, proposalRefOf(messageRef, world.goals.second)), 'the candidate is untouched').toEqual(adopted);
    expect((await candidateCards(world, world.goals.second)).filter(card => card.state === 'waiting_answer'),
      'no new candidate waits').toEqual([]);
  });

  it('repairs both P2 and P3 messages when the person adopts a second candidate before the crash', async () => {
    const world = await openConsumeWorld({ backend: 'sqlite', label: 'pl41-two-adopted' });
    worlds.push(world);
    await settlePL41(world);
    const { messageRef: p2Message } = await openIdleLine(world,
      firstPlan({ label: 'pl41-p2', taskId: 'pl41-p2-task', role: S6A_WORK_ROLE.templateId }), 'pl41-two-line');
    await awaitPlanningAnswer(world, p2Message);
    const p2 = await adoptIntervention(world, p2Message, 'pl41-p2-apply');
    expect((await readS7BMessage(world, p2Message)).response, 'P2\'s M stays open').toBeNull();

    const p3Line = await createLine(world, 'pl41-p3-line');
    await world.scripted.script(p3Line, [{ kind: 'text', text: await refinementPlan(world, world.goals.second,
      { label: 'pl41-p3', taskId: 'pl41-p3-task', role: S6A_WORK_ROLE.templateId }) }]);
    const p3Message = (await sendS7A2PersonMessage(world, { label: 'pl41-p3', recipient: p3Line.ref,
      goal: world.goals.second })).ref;
    await awaitPlanningAnswer(world, p3Message);
    const p3 = await adoptIntervention(world, p3Message, 'pl41-p3-apply');
    expect((await readS7BMessage(world, p3Message)).response, 'P3\'s M stays open').toBeNull();
    expect(await acceptedOf(world, world.goals.second), 'both candidates are accepted').toHaveLength(2);
    // Each adoption's notice sits at its own `plans/apply` commit, in that order.
    const positions = [p2, p3].map(({ cursor, planId }, index) => {
      const itemKey = `plan-adoption:${planId}:${String(index + 1)}`;
      return { kind: 'commit', cursor, itemKey };
    });
    expect(await adoptionPositions(world, world.goals.second)).toEqual(positions);

    await world.crash();
    expect((await readS7BMessage(world, p2Message)).response, 'P2 is not replied before driver-start').toBeNull();
    expect((await readS7BMessage(world, p3Message)).response, 'P3 is not replied before driver-start').toBeNull();
    expect(await adoptionPositions(world, world.goals.second), 'the restart adds no notice').toEqual(positions);
    await startDriver(world, world.goals.second, 'pl41-two-driver');
    const [p2Replied, p3Replied] = await Promise.all([
      waitFor(() => readS7BMessage(world, p2Message), message => message.response !== null, 'P2\'s one reply'),
      waitFor(() => readS7BMessage(world, p3Message), message => message.response !== null, 'P3\'s one reply'),
    ]);
    expect(p2Replied.response, 'P2\'s M is replied').not.toBeNull();
    expect(p3Replied.response, 'P3\'s M is replied').not.toBeNull();
    expect(await acceptedOf(world, world.goals.second), 'the restart adopts nothing new').toHaveLength(2);
    expect(await planRevision(world, world.goals.second), 'the active Plan does not move again').toBe(2);
    await heartbeat(world);
    expect(await readS7BMessage(world, p2Message), 'P2\'s M has this one reply').toEqual(p2Replied);
    expect(await readS7BMessage(world, p3Message), 'P3\'s M has this one reply').toEqual(p3Replied);
    expect(await adoptionPositions(world, world.goals.second), 'the replies add no notice').toEqual(positions);
  });

  it('a cancelled Goal with the same accepted-unreplied candidate: no restart registration, one reply saying adopted', async () => {
    const world = await openConsumeWorld({ backend: 'sqlite', label: 'pl41-terminal' });
    worlds.push(world);
    await settlePL41(world);
    const { line, messageRef } = await openIdleLine(world,
      firstPlan({ label: 'pl41-terminal', taskId: 'pl41-terminal-task', role: S6A_WORK_ROLE.templateId }),
      'pl41-terminal-line');
    await awaitPlanningAnswer(world, messageRef);
    await adoptIntervention(world, messageRef, 'pl41-terminal-apply');
    await cancelS7AGoal(world, world.goals.second);
    expect((await readS7BMessage(world, messageRef)).response, 'the cancelled Goal\'s M is open').toBeNull();

    await world.crash();
    const report = ready<{ report: { interruptedGoals: { goalRef: GoalRef }[] } }>(await world.post(
      'host/reconcile-report', plain(S6A_SCOPE, {})), 'the reconcile report');
    expect(report.report.interruptedGoals.map(entry => entry.goalRef.goalId),
      'a cancelled Goal has no restart interruption').not.toContain(world.goals.second.goalId);
    await startDriver(world, world.goals.second, 'pl41-terminal-driver');
    // The open source would hold its line's archive for good (window 3): it settles once, telling the truth.
    const replied = await waitFor(() => readS7BMessage(world, messageRef), message => message.response !== null,
      'the cancelled Goal\'s one reply');
    expect(await notices(world, line, '这次规划已经采用，计划的内容在候选卡和回复里。'), 'the reply says adopted')
      .toHaveLength(1);
    await heartbeat(world);
    expect(await readS7BMessage(world, messageRef), 'M has this one reply').toEqual(replied);
    expect(await acceptedOf(world, world.goals.second), 'no new adoption for a cancelled Goal').toHaveLength(1);
    expect(await planRevision(world, world.goals.second), 'its Plan does not move').toBe(1);
  });

  it('leaves a completed Goal with an accepted candidate out of the recovery set', async () => {
    const world = await openPLConsumptionWorld({ backend: 'sqlite', label: 'pl41-completed' });
    worlds.push(world);
    await settlePL41(world);
    const goal = world.goals.first;
    const seeded = await seedPLSenderPlan(world, { goal, label: 'pl41-completed', taskIds: ['pl41-completed-task'] });
    await world.scripted.script(seeded.line, [{ kind: 'text', text: 'PL-41 the last work' }]);
    await completeS7BGoal({ world, goalRef: goal });
    expect(await acceptedOf(world, goal), 'its Plan came from an accepted candidate').toHaveLength(1);
    const { waits, registered } = recordingRegistry();
    await rebuildFor(world)(S6A_SCOPE, waits);
    expect(registered.map(basis => basis.goalId), 'a completed Goal is not in the recovery set').not.toContain(goal.goalId);

    await world.crash();
    const report = ready<{ report: { interruptedGoals: { goalRef: GoalRef }[] } }>(await world.post(
      'host/reconcile-report', plain(S6A_SCOPE, {})), 'the reconcile report');
    expect(report.report.interruptedGoals.map(entry => entry.goalRef.goalId),
      'a completed Goal has no restart interruption').not.toContain(goal.goalId);
    await startDriver(world, goal, 'pl41-completed-driver');
    await heartbeat(world);
    await heartbeat(world);
    expect(await acceptedOf(world, goal), 'no new adoption for a completed Goal').toHaveLength(1);
    expect(await planRevision(world, goal), 'its Plan does not move').toBe(1);
  });
});

describe('PL-41 goal-wait rebuild, a historical question', () => {
  it('a question with no source of this loop is not a group, and neither the rebuild nor the restart rejects', async () => {
    const world = await openPLConsumptionWorld({ backend: 'sqlite', label: 'pl41-history' });
    worlds.push(world);
    await settlePL41(world);
    const goal = world.goals.first;
    const line = await createPLAdviserLine(world, 'pl41-history-adviser');
    await seedPLHistoryQuestion(world, { goal, line, label: 'pl41-history',
      answer: needsDecisionAnswer('PL-41 history questions', ['h1: which old decision is open?']) });
    await seedPLSenderPlan(world, { goal, label: 'pl41-history-plan', taskIds: ['pl41-history-send'] });

    const candidates = async (): Promise<unknown> => await openPlanReaders(world)
      .planCandidates(S6A_SCOPE, world.humanContext(), goal);
    expect(await candidates()).toMatchObject({ status: 'ready', value: { goals: [{ questionGroups: [] }] } });
    const { waits, registered } = recordingRegistry();
    await rebuildFor(world)(S6A_SCOPE, waits);
    expect(registered.map(basis => basis.goalId), 'a historical question registers nothing').not.toContain(goal.goalId);

    await world.crash();
    expect(await candidates()).toMatchObject({ status: 'ready', value: { goals: [{ questionGroups: [] }] } });
    await startDriver(world, goal, 'pl41-history-driver');
    const driver = await waitDriver(world, goal, undefined, snapshot => snapshot.last !== null, 'the PL-41 history pass');
    expect(driver.last?.status, 'the Goal pass is not rejected').toBe('ready');
  });
});

/** Two empty consume passes settle the SQLite Host before the row's own message exists. */
async function settlePL41(world: S6AHostWorld): Promise<void> {
  await heartbeat(world, 60_000);
  await heartbeat(world, 60_000);
}
