/**
 * BK-D partial-acceptance rows (PA-01, PA-02, PA-04 … PA-12; PA-03 is cut for the 400-line budget): the write is
 * `goals/accept-partial`; the reads are `goals/display`,
 * `goals/list`, `tasks/query` and `goals/read`; every prior state is a public step in `BKD-world.ts`. At the base the
 * route is unpublished, so each row stops on its first acceptance; each comment names the mutation the row catches.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskGraph } from '../../src/contracts/task-graph.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { s7aGoalControlPins } from '../helpers/S7A-fixture.js';
import { interveneS7B, s7bVWorkProfile } from '../helpers/S7B-V-fixture.js';
import {
  acceptPartial, bkdControl, bkdDisplay, bkdGraph, bkdLine, bkdPost, driveBKDWork, openBKDWorld,
  satisfyBKDGoal, type BKDWorld,
} from '../helpers/BKD-world.js';

const RATIONALE = 't-b 先不做：外部接口没开放';
const BACKENDS = ['memory', 'sqlite'] as const;
const worlds: BKDWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});
async function openBKD(backend: 'memory' | 'sqlite' = 'memory'): Promise<BKDWorld> {
  const world = await openBKDWorld(backend);
  worlds.push(world);
  return world;
}
const goalPinsNow = (w: BKDWorld) => s7aGoalControlPins(w.world, w.goal);
const bkdRow = (graph: TaskGraph, taskId: string) => graph.tasks.find(row => row.ref.taskId === taskId)!;

/** PA-01's prior state: `t-a` formally satisfied, `t-b` never claimed. */
async function satisfiedTA(w: BKDWorld) {
  await driveBKDWork(w, 't-a');
  const graph = await bkdGraph(w);
  const reduction = bkdRow(graph, 't-a').reduction;
  if (reduction === undefined) throw new Error('BKD: t-a has no reduction after its satisfied Run');
  return { graph, reduction: { ref: reduction.ref, revision: reduction.revision } };
}
// Mutation: plan-service passes `partialAcceptance: null` again, or takes the evidence as all Tasks / none.
it('PA-01 records the accepted part as ACCEPTED_PARTIAL with the rationale and the satisfied reductions', async () => {
  const w = await openBKD();
  const { graph, reduction } = await satisfiedTA(w);
  const answer = await acceptPartial(w, { rationale: RATIONALE, requestId: 'bkd-pa-01' });
  expect(answer).toMatchObject({ status: 'committed', replayed: false, value: { phase: 'ACCEPTED_PARTIAL',
    revision: 1, planRef: graph.plan.ref, adoptedTaskReductions: [reduction],
    partialAcceptance: { rationale: RATIONALE, acceptedBy: { kind: 'human', id: 's6a-operator' } } } });
  expect(await bkdDisplay(w)).toMatchObject({ phase: 'ACCEPTED_PARTIAL', row: 'GOAL-19', cause: null });
  const list = await bkdPost(w.world, 'goals/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE }));
  const listed = (list['value'] as { goals: Array<{ ref: GoalRef; display: { phase: string | null } }> }).goals;
  expect(listed.find(entry => entry.ref.goalId === w.goal.goalId)?.display.phase).toBe('ACCEPTED_PARTIAL');
  expect(bkdRow(await bkdGraph(w), 't-b').execution).toBeNull();
});
// Mutation: `workflow.ts` keeps `&& graph.completion.snapshot.phase === 'COMPLETED'` on the Goal loop's stop.
it('PA-02 the Goal loop ends on the partial acceptance and claims no new work', async () => {
  const w = await openBKD();
  await satisfiedTA(w);
  expect(await acceptPartial(w, { rationale: RATIONALE, requestId: 'bkd-pa-02' }))
    .toMatchObject({ status: 'committed' });
  const before = bkdRow(await bkdGraph(w), 't-b');
  expect((await driveBKDWork(w, 't-b')).at(-1)).toMatchObject({ state: 'completed' });
  const after = bkdRow(await bkdGraph(w), 't-b');
  expect({ effectivePhase: after.effectivePhase, execution: after.execution })
    .toEqual({ effectivePhase: before.effectivePhase, execution: null });
});

type RejectEntry = { label: string; code: 'invalid' | 'busy'; setup?: (w: BKDWorld) => Promise<unknown>;
  input: (pins: VersionPin[], graph: TaskGraph) => { rationale: string; requestId: string;
    expected: readonly VersionPin[] } };
// Mutations, one per entry: the empty/2049-byte rationale, the exact two-pin count, and the paused-Goal guard.
const PA07_REJECTS: RejectEntry[] = [
  { label: 'an empty rationale', code: 'invalid', input: pins => ({ rationale: '', requestId: 'bkd-pa-07-empty', expected: pins }) },
  { label: '2049 UTF-8 bytes', code: 'invalid', input: pins => ({ rationale: '界'.repeat(683), requestId: 'bkd-pa-07-long', expected: pins }) },
  { label: 'three pins', code: 'invalid', input: (pins, graph) => ({ rationale: RATIONALE, requestId: 'bkd-pa-07-three', expected: [...pins, { ref: graph.plan.ref, revision: graph.plan.revision }] }) },
  { label: 'one pin', code: 'invalid', input: pins => ({ rationale: RATIONALE, requestId: 'bkd-pa-07-one', expected: [pins[0]!] }) },
  { label: 'a paused Goal', code: 'busy', setup: w => bkdControl(w, 'pause', 'bkd-pa-07-pause'), input: pins => ({ rationale: RATIONALE, requestId: 'bkd-pa-07-paused', expected: pins }) },
];

describe('rejects: accepting a partial result', () => {
// Mutation: drop the `unsettledExecutions` check (the running Run then looks accepted).
it('PA-04 refuses while the accepted part still has a running execution', async () => {
  const w = await openBKD();
  const line = await bkdLine(w, 't-a');
  await w.world.scripted.script(line, [{ kind: 'text', text: 'BKD t-a running' }]);
  const gate = await w.world.gates.modelRequest(line);
  const pending = driveWorkflow(w.world.ag2b, { schemaVersion: 1, goalRef: w.goal, flowId: 'bkd-pa-04',
    sessionHint: line.ref, kind: 'select_work', taskId: 't-a' });
  try {
    await gate.reached;
    expect(await acceptPartial(w, { rationale: RATIONALE, requestId: 'bkd-pa-04' }))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    expect(await bkdDisplay(w)).not.toMatchObject({ phase: 'ACCEPTED_PARTIAL' });
    expect((await bkdGraph(w)).completion?.status).toBe('not_recorded');
  } finally {
    gate.release();
    await pending.catch(() => undefined);
  }
});
// Mutation: accept a Goal whose evaluation is already `completed`, recording the full result as partial.
it('PA-05 refuses an already complete Goal and lets the platform record COMPLETED', async () => {
  const w = await openBKD();
  await satisfyBKDGoal(w);
  expect(await acceptPartial(w, { rationale: RATIONALE, requestId: 'bkd-pa-05-partial' }))
    .toMatchObject({ status: 'rejected', code: 'invalid' });
  const completed = await w.world.platform.goals.completeGoal(w.world.humanContext(), { input: { goalRef: w.goal },
    meta: { requestId: 'bkd-pa-05-complete', expected: await goalPinsNow(w) } });
  expect(completed).toMatchObject({ status: 'committed', value: { phase: 'COMPLETED' } });
});
// Mutation: drop `operatorProblem` from the accept service (an automation actor then writes).
it('PA-06 refuses an automation identity', async () => {
  const w = await openBKD();
  await satisfiedTA(w);
  const answer = await w.world.dispatch('goals/accept-partial', w.world.systemContext(),
    graphWrite(S6A_SCOPE, { goalRef: w.goal, rationale: RATIONALE }, 'bkd-pa-06', await goalPinsNow(w)));
  expect(answer).toMatchObject({ status: 'rejected', code: 'forbidden', reason: expect.stringContaining('partial result') });
  expect(await bkdDisplay(w)).not.toMatchObject({ phase: 'ACCEPTED_PARTIAL' });
});
it.each(PA07_REJECTS)('PA-07 rejects $label and leaves the display unchanged', async ({ code, setup, input }) => {
  const w = await openBKD();
  await satisfiedTA(w);
  if (setup !== undefined) expect(await setup(w)).toMatchObject({ status: 'committed' });
  const before = await bkdDisplay(w);
  expect(await acceptPartial(w, input(await goalPinsNow(w), await bkdGraph(w))))
    .toMatchObject({ status: 'rejected', code });
  expect(await bkdDisplay(w)).toEqual(before);
});
// Mutation: drop the Goal pin guard (a stale screen then writes over a newer Goal).
it.each(BACKENDS)('PA-08 (%s) a stale Goal pin is a revision conflict carrying the current pin', async backend => {
  const w = await openBKD(backend);
  await satisfiedTA(w);
  const pins = await goalPinsNow(w);
  const revision = pins[0]!.revision;
  const answer = await acceptPartial(w, { rationale: RATIONALE, requestId: 'bkd-pa-08',
    expected: [{ ref: w.goal, revision: revision - 1 }, pins[1]!] });
  expect(answer).toMatchObject({ status: 'rejected', code: 'revision_conflict',
    current: expect.arrayContaining([{ ref: w.goal, revision }]) });
});
});
// Mutation: the receipt is not looked up, or its fingerprint leaves the rationale out.
it.each(BACKENDS)('PA-09 (%s) replays the same request and refuses the same request with another rationale',
  async backend => {
    const w = await openBKD(backend);
    await satisfiedTA(w);
    const expected = await goalPinsNow(w);
    const first = await acceptPartial(w, { rationale: RATIONALE, requestId: 'bkd-pa-09', expected });
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    const replay = await acceptPartial(w, { rationale: RATIONALE, requestId: 'bkd-pa-09', expected });
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    expect(replay['value']).toEqual(first['value']);
    expect(await acceptPartial(w, { rationale: `${RATIONALE}!`, requestId: 'bkd-pa-09', expected }))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });
// Mutation: the codec drops `partialAcceptance`, or the decoder refuses ACCEPTED_PARTIAL (the read is unavailable).
it('PA-10 (SQLite only: the Host restart) the accepted record survives a reopen', async () => {
  const w = await openBKDWorld('sqlite');
  worlds.push(w);
  await satisfiedTA(w);
  expect(await acceptPartial(w, { rationale: RATIONALE, requestId: 'bkd-pa-10' }))
    .toMatchObject({ status: 'committed' });
  await w.world.reopen();
  expect(await bkdDisplay(w)).toMatchObject({ phase: 'ACCEPTED_PARTIAL', row: 'GOAL-19' });
  const graph = await bkdGraph(w);
  expect(graph.completion).toMatchObject({ status: 'recorded', selectedPlanMatches: true,
    snapshot: { phase: 'ACCEPTED_PARTIAL', partialAcceptance: { rationale: RATIONALE } } });
});
// Mutation: `intervention.ts` keeps checking only `COMPLETED`, so the person's words enter the ended Goal again.
it('PA-12 a person speaking to the ended Goal opens a new request instead', async () => {
  const w = await openBKD();
  await satisfiedTA(w);
  expect(await acceptPartial(w, { rationale: RATIONALE, requestId: 'bkd-pa-12' }))
    .toMatchObject({ status: 'committed' });
  const line = await bkdLine(w, 't-a');
  const before = await w.world.scripted.requests(line);
  const sent = await bkdPost(w.world, 'messages/send', graphWrite(S6A_SCOPE,
    { recipient: line.ref, text: 'BK-D this is new work', entry: 'person_intervention',
      goalRef: w.goal, taskRef: w.task('t-a') }, 'bkd-pa-12-send'));
  expect(sent).toMatchObject({ status: 'committed' });
  const handled = await interveneS7B(w.world, (sent['value'] as { ref: SessionMessage['ref'] }).ref, s7bVWorkProfile());
  expect(handled).toMatchObject({ status: 'requested', branch: 'goal_completed',
    requestRef: { aggregateType: 'QueryJob', projectId: w.goal.projectId } });
  expect(await w.world.scripted.requests(line)).toEqual(before);
});
// Mutation: `goalStateOf` no longer reads a partial acceptance as `for_active`.
it('PA-11 a partially accepted Goal can neither pause nor cancel', async () => {
  const w = await openBKD();
  await satisfiedTA(w);
  expect(await acceptPartial(w, { rationale: RATIONALE, requestId: 'bkd-pa-11' }))
    .toMatchObject({ status: 'committed' });
  expect(await bkdControl(w, 'pause', 'bkd-pa-11-pause')).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(await bkdControl(w, 'cancel', 'bkd-pa-11-cancel')).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(await bkdDisplay(w)).toMatchObject({ phase: 'ACCEPTED_PARTIAL' });
});
