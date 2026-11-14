/**
 * acc (the automatic-mode delivery page): rows ACC-T01..T11 of `acc-tests.frozen.md`, with
 * `acc-build.frozen.md` §3.1–§3.5 and the erratum `acc-repoint.md` §2.1 E6 (a second completion uses its own
 * flowId and requestId; P1/P2 never replay one requestId) and §2.2 A10 (a trusted non-operator CoreCallContext,
 * tests/app/S5-decision-routes.test.ts:207–208, not the pure state guard).
 *
 * Every state is a public step: `openS7BPlanningWorld` (`tests/helpers/S7B3-planning-world.ts:27`),
 * ACC-T08's consuming start (`openS6AHostWorld` with the input consumer at start) and `completeS7BGoal`
 * (`tests/helpers/S7B-V-fixture.ts:22`), then the public routes `goals/read`, `goals/display`,
 * `goals/delivery`, `goals/accept-delivery`, `queries/ask`, `messages/send` and `main/read`. R/P come from those
 * reads, never from a hard-coded Goal revision. Business rows run memory; the storage rows (ACC-T03/04/05/10) run
 * the same table on memory and SQLite, and ACC-T09 is SQLite only because it reopens the Host (RULES :193, :208).
 *
 * ACC-T01/05/07/08/11 start at the read `goals/delivery`, ACC-T02/03/04/09/10 at the write
 * `goals/accept-delivery`, ACC-T06 at the published `platform.goalDelivery`; together they cover the package's
 * record, its write guard and receipt, and the read join. Each row names one mutation of that code.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { GoalAutonomyV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskGraph } from '../../src/core/work-graph/model/plan-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { AG2B_WORK_TASK_ID, plain, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { completeS7BGoal, refinementPlanFrom } from '../helpers/S7B-V-fixture.js';
import { applyDNRPlan, goalRevision } from '../helpers/S7D2-DNR-node-world.js';
import { openS7BPlanningWorld, type S7BPlanningWorld } from '../helpers/S7B3-planning-world.js';
import { readActivePlan } from '../scenarios/support/S5-decisions.js';
import { waitFor } from '../scenarios/harness.js';

type Acceptance = {
  ref: { aggregateType: 'GoalDeliveryAcceptance'; phaseRevision: number };
  acceptedAt: string;
  acceptedBy: { kind: 'human'; id: string };
};
type Delivery = {
  goal: { revision: number };
  display: { phase: string };
  phaseRevision: number | null;
  acceptance: Acceptance | null;
  secretary: SessionRef | null;
};
type AcceptBody =
  | { status: 'committed'; replayed: boolean; cursor: string; value: Acceptance }
  | { status: 'rejected'; code: string; reason: string; current?: VersionPin[] };
type MainPage = { goalId: string | null; requests: Array<{ rounds: Array<{ input: string }> }> };
type DraftTask = { taskId: string; requirementLevel: string; taskKind: string; scope: { kind: string } };
type DraftObligation = { taskIds: string[] };
type AcceptPort = { acceptDelivery(ctx: CoreCallContext, request: GraphWrite<{ goalRef: GoalRef }>): Promise<AcceptBody> };
const BACKENDS = ['memory', 'sqlite'] as const;
const PHASE_REASON = 'the Goal is not completed for its active Plan; there is no delivery to accept';
const ALREADY_REASON = 'the delivery was already accepted';
const FORBIDDEN_REASON = 'only the configured operator may accept a Goal delivery';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

async function planningWorld(backend: (typeof BACKENDS)[number] = 'memory'): Promise<S7BPlanningWorld> {
  const planning = await openS7BPlanningWorld({ backend });
  worlds.push(planning.world);
  return planning;
}

/**
 * ACC-T08's problem entry needs the Host's own consume pass on the completed Goal, so the 25 ms input consumer is a
 * start option: a memory reopen would need A4's shared record/body mocks and would read an empty store
 * (S7A-host-gates:31–:53). The ids are the fake period precedent (S7B3-disconnect-notices:251–:254); the world is
 * otherwise `openS7BPlanningWorld`'s first two steps.
 */
async function consumingPlanningWorld(): Promise<Pick<S7BPlanningWorld, 'world' | 'goalRef'>> {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { inputConsumers: [{
    scope: S6A_SCOPE,
    sessionRef: { projectId: S6A_SCOPE.projectId, sessionId: 'acc-t08-consume-period' },
    goalRef: { aggregateType: 'Goal' as const, ...S6A_SCOPE, goalId: 'acc-t08-consume-period' },
    queryProfileId: S6A_SECRETARY_PROFILE_ID, heartbeatMs: 25 }] } });
  try {
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, ws, world.goals);
    await adoptS6BPlan(ws, world.goals.first, { label: 'acc-t08', taskIds: [AG2B_WORK_TASK_ID],
      role: S6A_WORK_ROLE.templateId });
    worlds.push(world);
    return { world, goalRef: world.goals.first };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

const phaseRef = (goal: GoalRef) =>
  ({ aggregateType: 'GoalPhase' as const, projectId: goal.projectId, goalId: goal.goalId });

async function phaseRevisionOf(world: S6AHostWorld, goal: GoalRef): Promise<number> {
  const graph = ready<{ completion?: { status: string; snapshot?: { revision: number } } }>(
    await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal })), 'the task graph');
  return graph.completion?.status === 'recorded' ? graph.completion.snapshot!.revision : 0;
}

async function goalPhasePins(world: S6AHostWorld, goal: GoalRef): Promise<VersionPin[]> {
  return [{ ref: goal, revision: await goalRevision(world, goal) },
    { ref: phaseRef(goal), revision: await phaseRevisionOf(world, goal) }];
}

async function deliveryOf(world: S6AHostWorld, goal: GoalRef): Promise<Delivery> {
  return ready<Delivery>(await world.post('goals/delivery', plain(S6A_SCOPE, { goalRef: goal })),
    'goals/delivery');
}

async function acceptDelivery(world: S6AHostWorld, goal: GoalRef, requestId: string,
  expected: VersionPin[]): Promise<AcceptBody> {
  return (await world.post('goals/accept-delivery',
    graphWrite(S6A_SCOPE, { goalRef: goal }, requestId, expected))).body as AcceptBody;
}

/** `openW4`'s public adoption step: a refinement that only adds future nodes (P2), while the GoalPhase stays P1. */
async function adoptRefinement(world: S6AHostWorld, goal: GoalRef, label: string, taskId: string): Promise<void> {
  const active = await readActivePlan(world.platform, world.humanContext(), goal);
  const draft = (JSON.parse(refinementPlanFrom(active, goal, {
    label, taskId, role: S6A_WORK_ROLE.templateId })) as {
      plan: { tasks: DraftTask[]; obligations: DraftObligation[] } }).plan;
  // `refinementPlanFrom` copies the seed obligations unchanged, so the added carrier would belong to no obligation
  // and its completion round would admit no Evidence. The goal obligation is the one already carrying the Plan's
  // required goal work task; the fallback is the one carrying any goal-scoped task.
  const carrier = draft.tasks.find(row => row.taskId !== taskId && row.requirementLevel === 'required'
    && row.taskKind === 'work' && row.scope.kind === 'goal');
  const obligation = draft.obligations.find(entry => carrier !== undefined && entry.taskIds.includes(carrier.taskId))
    ?? draft.obligations.find(entry => entry.taskIds.some(id => draft.tasks.some(row => row.taskId === id
      && row.scope.kind === 'goal')));
  if (obligation === undefined) throw new Error(`acc ${label}: the refinement draft has no goal obligation`);
  if (!obligation.taskIds.includes(taskId)) obligation.taskIds.push(taskId);
  await applyDNRPlan(world, goal, active.ref, draft, label);
}

/**
 * The second completion of one Goal with its own flowId and requestId (E6). `completeS7BGoal` fixes both, so a
 * second call would replay/conflict with the first receipt; the steps are the same public Workflow + completeGoal
 * ones, with the new Plan's still-unsatisfied work task given its own line.
 */
async function completeGoalAgain(planning: Pick<S7BPlanningWorld, 'world' | 'goalRef'>,
  flowId: string, requestId: string): Promise<void> {
  const { world, goalRef } = planning;
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  const graph = async (): Promise<TaskGraph> => ready<TaskGraph>(
    await world.post('tasks/query', plain(S6A_SCOPE, { goalRef })), 'the task graph');
  const adopted = await graph();
  const work = adopted.tasks.filter(row => row.definition.taskKind === 'work'
    && row.definition.disposition === 'active' && row.effectivePhase !== 'satisfied');
  for (const row of work) {
    const line = await createS6BLine(ws, { label: `acc-${flowId}-${row.ref.taskId}`, role: S6A_WORK_ROLE,
      tasks: [row.ref] });
    await world.scripted.script(await sessionOf(world, line),
      [{ kind: 'text', text: `acc ${flowId} work ${row.ref.taskId}` }]);
  }
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef, flowId, sessionHint: null,
    kind: 'select_work' }, { stopBefore: 'complete_goal' });
  const after = await graph();
  const required = after.tasks.filter(row => row.definition.requirementLevel === 'required'
    && (row.definition.taskKind === 'work' || row.definition.taskKind === 'gate'));
  const unsatisfied = required.filter(row => row.effectivePhase !== 'satisfied').map(row => row.ref.taskId);
  if (unsatisfied.length > 0) throw new Error(`acc: the Workflow did not satisfy ${unsatisfied.join(', ')}`);
  const completed = await world.platform.goals.completeGoal(world.humanContext(), {
    input: { goalRef }, meta: { requestId, expected: await goalPhasePins(world, goalRef) } });
  if (completed.status !== 'committed') throw new Error(`acc: the second completion did not commit: ${JSON.stringify(completed)}`);
}

describe('acc delivery acceptance', () => {
  it('ACC-T01 "got it" writes only the confirmation fact', async () => {
    // Red today at `goals/delivery` (404, route not published). Green when ACC-08's plain read joins the Goal
    // display, the current GoalPhase and the acceptance; the write is ACC-01/04/06.
    // Mutation: let accept also bump the GoalPhase revision or change the phase -> the phaseRevision/display reds.
    const planning = await planningWorld();
    await completeS7BGoal(planning);
    const { world, goalRef } = planning;
    const before = await deliveryOf(world, goalRef);
    const expected: VersionPin[] = [
      { ref: goalRef, revision: (await ready<{ goal: { revision: number } }>(
        await world.post('goals/read', plain(S6A_SCOPE, goalRef)), 'the Goal')).goal.revision },
      { ref: phaseRef(goalRef), revision: before.phaseRevision! },
    ];
    const answer = await acceptDelivery(world, goalRef, 'acc-t01-accept', expected);
    expect(answer).toMatchObject({ status: 'committed', value: { acceptedBy: { kind: 'human' } } });
    if (answer.status !== 'committed') throw new Error(`ACC-T01 did not commit: ${JSON.stringify(answer)}`);
    expect(typeof answer.value.acceptedAt).toBe('string');
    expect(answer.value.acceptedAt.length).toBeGreaterThan(0);
    const goal = await goalRevision(world, goalRef);
    expect(goal).toBe(expected[0]!.revision);
    const display = ready<{ display: { phase: string } }>(await world.post('goals/display',
      plain(S6A_SCOPE, { goalRef })), 'goals/display');
    expect(display.display.phase).toBe('COMPLETED');
    const after = await deliveryOf(world, goalRef);
    expect(after.phaseRevision).toBe(before.phaseRevision);
    expect(after.acceptance?.acceptedAt).toBe(answer.value.acceptedAt);
  });

  it('ACC-T02 an active Goal without a completed phase cannot be accepted', async () => {
    // Red today at `goals/accept-delivery` (404). Green when ACC-04's completion guard answers invalid with the
    // frozen reason and writes nothing; the page read then shows acceptance:null (ACC-09).
    // Mutation: delete the GoalPhase COMPLETED / planRef check -> committed -> red.
    const planning = await planningWorld();
    const { world, goalRef } = planning;
    const answer = await acceptDelivery(world, goalRef, 'acc-t02-accept', await goalPhasePins(world, goalRef));
    expect(answer).toMatchObject({ status: 'rejected', code: 'invalid', reason: PHASE_REASON });
    expect((await deliveryOf(world, goalRef)).acceptance).toBeNull();
  });
  it.each([
    { name: 'a non-operator human actor', actor: { kind: 'human' as const, id: 'acc-not-the-operator' } },
    { name: 'WORKFLOW_AUTOMATION_ACTOR', actor: WORKFLOW_AUTOMATION_ACTOR },
  ] as const)('ACC-T06 $name is forbidden at the port', async ({ actor }) => {
    // Red today at the unpublished `platform.goalDelivery` (no port). Green when ACC-03 checks the configured
    // operator (goal-settings-service.ts:370–:373) before any write.
    // Mutation: drop the operator/automation check -> the human entry commits -> its own red.
    const planning = await planningWorld();
    await completeS7BGoal(planning);
    const { world, goalRef } = planning;
    const port = (world.platform as unknown as { goalDelivery?: AcceptPort }).goalDelivery;
    if (port === undefined) throw new Error('platform.goalDelivery is not published');
    const ctx: CoreCallContext = { ...world.humanContext(), principal: { kind: 'host', actor },
      materialReader: { kind: 'host', ...S6A_SCOPE, actor } };
    const answer = await port.acceptDelivery(ctx, { input: { goalRef },
      meta: { requestId: `acc-t06-${actor.id}`, expected: await goalPhasePins(world, goalRef) } });
    expect(answer).toMatchObject({ status: 'rejected', code: 'forbidden', reason: FORBIDDEN_REASON });
    expect((await deliveryOf(world, goalRef)).acceptance).toBeNull();
  });
  it('ACC-T07 the delivery read feeds the three actions and names the secretary', async () => {
    // Red today at `goals/delivery` (404). Green when ACC-08 joins display, the current phase and the duty
    // recipient; the ask is the existing `queries/ask` (ACC-10, core-routes.ts:704).
    // Mutation: fill `secretary` with an arbitrary agent line -> the duty equality reds.
    const planning = await planningWorld();
    const { world, goalRef } = planning;
    const secretary = await world.createSecretary('acc-t07-secretary');
    await completeS7BGoal(planning);
    const before = await deliveryOf(world, goalRef);
    expect(before.display.phase).toBe('COMPLETED');
    expect(before.phaseRevision).toBe(await phaseRevisionOf(world, goalRef));
    expect(before.acceptance).toBeNull();
    expect(before.secretary).toEqual(secretary.ref);
    const asked = (await world.post('queries/ask', plain(S6A_SCOPE, { sessionRef: secretary.ref,
      question: 'Please review this delivery: implementation, diff, spec and behavior.', commandId: 'acc-t07-ask' }))).body as
      { status: string; round?: { queryJobId: string } };
    expect(asked.status).toBe('queued');
    expect(asked.round?.queryJobId).toBeTruthy();
    const accepted = await acceptDelivery(world, goalRef, 'acc-t07-accept', [
      { ref: goalRef, revision: before.goal.revision },
      { ref: phaseRef(goalRef), revision: before.phaseRevision! }]);
    expect(accepted).toMatchObject({ status: 'committed' });
    expect((await deliveryOf(world, goalRef)).acceptance).not.toBeNull();
    const noSecretary = await planningWorld();
    await completeS7BGoal(noSecretary);
    expect((await deliveryOf(noSecretary.world, noSecretary.goalRef)).secretary).toBeNull();
  });

  it.each([
    { name: 'review: queries/ask queues a round', kind: 'review' as const },
    { name: 'problem: messages/send is consumed into a goal-less request', kind: 'problem' as const },
  ] as const)('ACC-T08 $name', async ({ kind }) => {
    // Red today at `goals/delivery` (404). Green when the two existing actions leave the record alone (ACC-10/11)
    // and the Host's consume turns the person's completed-Goal action_request into a goal-less request (host.ts:2796,
    // intervention.ts:169–:176, request-intake.ts:394–:399); the no-goal read is main-surface-read-model.ts:5–:16.
    // Mutation: write an acceptance (or change the phase) in either action -> that entry reds.
    const planning = kind === 'problem' ? await consumingPlanningWorld() : await planningWorld();
    const { world, goalRef } = planning;
    const secretary = await world.createSecretary('acc-t08-secretary');
    await completeS7BGoal(planning);
    const before = await deliveryOf(world, goalRef);
    if (kind === 'review') {
      const asked = (await world.post('queries/ask', plain(S6A_SCOPE, { sessionRef: secretary.ref,
        question: 'ACC-T08 review question: does the delivery match the spec?', commandId: 'acc-t08-ask' }))).body as
        { status: string; round?: { queryJobId: string } };
      expect(asked).toMatchObject({ status: 'queued' });
      expect(asked.round?.queryJobId).toBeTruthy();
    } else {
      const text = 'ACC-T08 there is a problem with this delivery';
      const sent = (await world.post('messages/send', graphWrite(S6A_SCOPE, { recipient: secretary.ref,
        goalRef, intent: 'action_request', needsReply: true, text }, 'acc-t08-send'))).body as { status: string };
      expect(sent.status).toBe('committed');
      // The fixture clock drives the Host's heartbeat: each poll registers the barrier, advances 25 ms and waits for
      // a real consume pass (S7A-host-gates:57–:67); a wall-clock poll alone never wakes the loop.
      const page = await waitFor(async () => {
        const settled = world.consumeBarrier();
        world.clock.advance(25);
        await settled;
        return ready<MainPage>(await world.post('main/read',
          plain(S6A_SCOPE, { goalId: null, cursor: null })), 'main/read');
      }, current => current.requests.some(request => request.rounds.length > 0
        && request.rounds[request.rounds.length - 1]!.input === text), 'the consumed goal-less request');
      const consumed = page.requests.find(request => request.rounds.length > 0
        && request.rounds[request.rounds.length - 1]!.input === text);
      expect(consumed).toBeDefined();
    }
    const after = await deliveryOf(world, goalRef);
    expect(after.acceptance).toEqual(before.acceptance);
    expect(after.display.phase).toBe('COMPLETED');
  });
  it('ACC-T09 SQLite only: the record and its replay survive a Host restart', async () => {
    // Red today at `goals/delivery` / `goals/accept-delivery` (404). Green when ACC-01/05 store the record and the
    // receipt in the record store, so a reopened Host reads the same acceptedAt and replays the same cursor.
    // Mutation: read the acceptance from process memory only -> after the reopen it is null -> red.
    const planning = await planningWorld('sqlite');
    await completeS7BGoal(planning);
    const { world, goalRef } = planning;
    const expected = await goalPhasePins(world, goalRef);
    const first = await acceptDelivery(world, goalRef, 'acc-t09-accept', expected);
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') throw new Error(`ACC-T09 did not commit: ${JSON.stringify(first)}`);
    await world.reopen();
    const after = await deliveryOf(world, goalRef);
    expect(after.acceptance?.acceptedAt).toBe(first.value.acceptedAt);
    const replay = await acceptDelivery(world, goalRef, 'acc-t09-accept', expected);
    expect(replay).toMatchObject({ status: 'committed', replayed: true, cursor: first.cursor });
  });

  it('ACC-T11 a new Plan completion is a new delivery and the old acceptance is not returned', async () => {
    // Red today at `goals/delivery` (404). Green when ACC-07/09 read by the current phaseRevision AND the current
    // GoalPhase planRef; a second completion is accepted under its own flowId/requestId (E6).
    // Mutation: read by goalId alone (or phaseRevision only without the planRef condition) -> step 2 still returns
    // P1's acceptance -> red.
    const planning = await planningWorld();
    await completeS7BGoal(planning);
    const { world, goalRef } = planning;
    const r1 = await goalRevision(world, goalRef);
    const p1 = (await deliveryOf(world, goalRef)).phaseRevision!;
    const first = await acceptDelivery(world, goalRef, 'acc-t11-p1', [
      { ref: goalRef, revision: r1 }, { ref: phaseRef(goalRef), revision: p1 }]);
    expect(first).toMatchObject({ status: 'committed', value: { ref: { phaseRevision: p1 } } });
    expect(await goalRevision(world, goalRef)).toBe(r1);
    await adoptRefinement(world, goalRef, 'acc-t11-next', 'acc-t11-next-task');
    const adopted = await deliveryOf(world, goalRef);
    expect(adopted.phaseRevision).toBe(p1);
    expect(adopted.acceptance).toBeNull();
    await completeGoalAgain(planning, 'acc-t11-p2-goal', `acc-t11-p2-complete-${goalRef.goalId}`);
    const completed = await deliveryOf(world, goalRef);
    expect(completed.phaseRevision).toBe(p1 + 1);
    expect(completed.acceptance).toBeNull();
    const r2 = await goalRevision(world, goalRef);
    const second = await acceptDelivery(world, goalRef, 'acc-t11-p2', [
      { ref: goalRef, revision: r2 }, { ref: phaseRef(goalRef), revision: p1 + 1 }]);
    expect(second).toMatchObject({ status: 'committed', value: { ref: { phaseRevision: p1 + 1 } } });
    expect(await goalRevision(world, goalRef)).toBe(r2);
    const final = await deliveryOf(world, goalRef);
    expect(final.display.phase).toBe('COMPLETED');
    expect(final.acceptance?.ref.phaseRevision).toBe(p1 + 1);
  });
});

describe.each(BACKENDS)('acc delivery storage (%s)', backend => {
  it('ACC-T03 the same requestId replays the one record', async () => {
    // Red today at `goals/accept-delivery` (404). Green when ACC-05 looks up the receipt first and replays the
    // committed record, cursor included; the page read still shows one acceptance. Both backends (RULES :193).
    // Mutation: delete the receipt lookup -> the same key guard rejects (or a second record appears) -> red.
    const planning = await planningWorld(backend);
    await completeS7BGoal(planning);
    const { world, goalRef } = planning;
    const body = graphWrite(S6A_SCOPE, { goalRef }, `acc-t03-${backend}`, await goalPhasePins(world, goalRef));
    const first = (await world.post('goals/accept-delivery', body)).body as AcceptBody;
    const second = (await world.post('goals/accept-delivery', body)).body as AcceptBody;
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    expect(second).toMatchObject({ status: 'committed', replayed: true });
    if (first.status !== 'committed' || second.status !== 'committed') throw new Error('ACC-T03 replay missing');
    expect(second.cursor).toBe(first.cursor);
    expect((await deliveryOf(world, goalRef)).acceptance?.acceptedAt).toBe(first.value.acceptedAt);
  });

  it('ACC-T04 the same delivery under a new requestId is already accepted', async () => {
    // Red today at `goals/accept-delivery` (404). Green when ACC-05's (goalId, phaseRevision) key refuses a second
    // requestId with the frozen reason before writing; the first acceptedAt survives. Both backends (RULES :193).
    // Mutation: overwrite the record / write a new revision -> the second request commits -> red.
    const planning = await planningWorld(backend);
    await completeS7BGoal(planning);
    const { world, goalRef } = planning;
    const expected = await goalPhasePins(world, goalRef);
    const first = await acceptDelivery(world, goalRef, `acc-t04-first-${backend}`, expected);
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') throw new Error(`ACC-T04 first did not commit: ${JSON.stringify(first)}`);
    expect(await acceptDelivery(world, goalRef, `acc-t04-second-${backend}`, expected))
      .toMatchObject({ status: 'rejected', code: 'invalid', reason: ALREADY_REASON });
    expect((await deliveryOf(world, goalRef)).acceptance?.acceptedAt).toBe(first.value.acceptedAt);
  });

  it('ACC-T05 a stale GoalPhase pin after P2 completes writes nothing', async () => {
    // Red today at `goals/delivery` / `goals/accept-delivery` (404). Green when ACC-04 checks both pins and returns
    // revision_conflict with `current` at the new GoalPhase@2; P2 uses its own flow/request ids (E6). Both backends.
    // Mutation: skip the GoalPhase pin check -> committed -> red.
    const planning = await planningWorld(backend);
    await completeS7BGoal(planning);
    const { world, goalRef } = planning;
    await adoptRefinement(world, goalRef, `acc-t05-next-${backend}`, `acc-t05-next-${backend}`);
    const goalR2 = await goalRevision(world, goalRef);
    const afterAdopt = await deliveryOf(world, goalRef);
    const stalePhase = afterAdopt.phaseRevision!;
    expect(afterAdopt.acceptance).toBeNull();
    await completeGoalAgain(planning, `acc-t05-p2-${backend}`, `acc-t05-p2-complete-${backend}`);
    expect(await acceptDelivery(world, goalRef, `acc-t05-accept-${backend}`, [
      { ref: goalRef, revision: goalR2 }, { ref: phaseRef(goalRef), revision: stalePhase }]))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict',
        current: expect.arrayContaining([{ ref: phaseRef(goalRef), revision: stalePhase + 1 }]) });
    expect((await deliveryOf(world, goalRef)).acceptance).toBeNull();
  });

  it('ACC-T10 a stale Goal pin after two settings writes does not accept', async () => {
    // Red today at `goals/accept-delivery` (404). Green when ACC-04 checks the Goal pin and returns
    // revision_conflict with `current` at Goal@R+2. Both backends (RULES :193).
    // Mutation: skip the Goal pin check -> committed -> red.
    const planning = await planningWorld(backend);
    await completeS7BGoal(planning);
    const { world, goalRef } = planning;
    const expected = await goalPhasePins(world, goalRef);
    const staleGoal = expected[0]!.revision;
    const settings = ready<{ settings: { autonomy: GoalAutonomyV1 } }>(await world.post('goals/settings',
      plain(S6A_SCOPE, { goalRef })), 'goals/settings');
    const other: GoalAutonomyV1 = settings.settings.autonomy === 'every_step'
      ? 'after_plan_confirmation' : 'every_step';
    await setS7AAutonomy(world, goalRef, other);
    await setS7AAutonomy(world, goalRef, settings.settings.autonomy);
    expect(await goalRevision(world, goalRef)).toBe(staleGoal + 2);
    expect(await acceptDelivery(world, goalRef, `acc-t10-accept-${backend}`, expected))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict',
        current: expect.arrayContaining([{ ref: goalRef, revision: staleGoal + 2 }]) });
    expect((await deliveryOf(world, goalRef)).acceptance).toBeNull();
  });
});
