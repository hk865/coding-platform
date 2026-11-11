/**
 * E3-UI read-side fields (UI 读口补字段): a Goal conflict card lists the files the two Goals really share.
 *
 * The rows read the frozen public entries only: `goals/conflicts` and the module entry
 * `createGoalConflictAssembler(...).queryGoalConflicts`. The expected file list is the existing
 * `goalConflictFacts.filePaths` (the sorted, order-independent intersection of both footprints' planned and
 * executed files), never a rule recomputed here. `digest` stays null because this package reads no file.
 *
 * C1/C3/C4 share `openS7C1World` and the public `plans/propose` + `plans/apply` steps of
 * `tests/work-graph/E38-goal-conflict-files.test.ts:68–:78`; C2 reuses the accepted world of
 * `tests/work-graph/S2B-34-executed-files.test.ts:223–:268`; C5 reuses
 * `tests/work-graph/S2B-r2-conflict-catalog.test.ts:45–:110`. All worlds are memory (S3).
 *
 * §9b (lead 11-07 20:4x) overrides the earlier C3: a conflict card's `openedAt` is null; the overlapping files
 * are what the card adds. C3 and C5 are green before the production change (the old card had no objects and no
 * time); their named mutations are what prove the rows can fail.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, RuntimeTask } from '../../src/contracts/plan.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { DecisionCardV1, GoalConflictReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import { createRunActivityService } from '../../src/core/work-graph/tasks/run-activity-service.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { ag2bPlanDraft, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { countedFacts } from '../helpers/S2B-activity-fixture.js';
import { openS2BTrackFixture, type S2BTrackFixture } from '../helpers/S2B-track-fixture.js';
import { openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { knowledgeLinesFor } from '../helpers/KLS2-knowledge-lines.js';
import { S6A_AT, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7C1World, S7C1_CREATE_ROLE, type S7C1World } from '../helpers/S7C-member-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';

const worlds: S7C1World[] = [];
const tracks: S2BTrackFixture[] = [];
const decisions: S5DecisionFixture[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(target => target.close()));
  for (const fixture of tracks.splice(0)) await fixture.close();
  for (const fixture of decisions.splice(0)) await fixture.close();
});

async function openWorld(): Promise<S7C1World> {
  const target = await openS7C1World({ adviser: false });
  worlds.push(target);
  return target;
}

/** One work task (goal scope) plus `ag2bPlanDraft`'s gate and obligation; only the work task gets the files. */
function oneTaskDraft(goal: GoalRef, taskId: string, plannedFiles: readonly string[]): PlanRevisionDraft {
  const draft = ag2bPlanDraft([taskId]);
  return {
    ...draft, planId: `${goal.goalId}-plan`, goalId: goal.goalId,
    tasks: draft.tasks.map((task): RuntimeTask => task.taskKind !== 'work' ? task : {
      ...task, plannedFiles: [...plannedFiles],
    }),
    assignments: (draft.assignments ?? []).map(assignment => ({ ...assignment,
      role: S7C1_CREATE_ROLE.templateId, instruction: `E3UI ${assignment.taskId}` })),
  };
}

/** `main.createGoal` and the Goal's first Plan through the real `plans/propose` + `plans/apply`. */
async function goalWithPlan(target: S7C1World, goalId: string, plannedFiles: readonly string[]): Promise<GoalRef> {
  const goal = (await target.main.createGoal(goalId, `E3UI conflict goal ${goalId}`)).ref;
  const proposed = valueOf<{ ref: unknown; revision: number }>(await target.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft: oneTaskDraft(goal, `${goalId}-work`, plannedFiles),
    reason: { text: `E3UI ${goalId} plan`, sources: [] },
  }, `${goalId}-propose`)), 'committed', `the ${goalId} Plan proposal`);
  valueOf(await target.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, `${goalId}-apply`)), 'committed', `the ${goalId} Plan adoption`);
  return goal;
}

async function conflictsOf(target: S7C1World): Promise<GoalConflictReadV1> {
  return valueOf<GoalConflictReadV1>(await target.main.route('goals/conflicts', { workspace: S6A_SCOPE }),
    'ready', 'goals/conflicts');
}

/** A card's pair: the two goalIds of `source.goalBases`, sorted, joined. */
function pairOf(card: DecisionCardV1): string {
  return (card.source.goalBases ?? []).map(basis => basis.goalRef.goalId).sort().join(' + ');
}

function pairOfGoals(...goals: readonly GoalRef[]): string {
  return goals.map(goal => goal.goalId).sort().join(' + ');
}

function conflictCardOf(read: GoalConflictReadV1, pair: string): DecisionCardV1 {
  const card = read.cards.find(candidate => pairOf(candidate) === pair);
  if (card === undefined) throw new Error(`E3UI: no ${pair} card: ${JSON.stringify(read.cards.map(pairOf))}`);
  return card;
}

/** The field the production change adds; the cast keeps this test tree typechecking before it lands. */
const cardTaskRefOf = (card: DecisionCardV1): unknown => (card as { taskRef?: unknown }).taskRef;
const cardRunRefOf = (card: DecisionCardV1): unknown => (card as { runRef?: unknown }).runRef;

describe('E3UI conflict cards: the files and the time the two Goals share', () => {
  it('C1 goals/conflicts lists the two planned files the plan pair shares, sorted by path', async () => {
    /* Named mutation: `assembleGoalConflicts` passes `[]` to `conflictCard` instead of `facts.filePaths`; the
     * exact `objects` below goes empty. */
    const target = await openWorld();
    const left = await goalWithPlan(target, 'e3ui-c1-g1', ['src/core/b.ts', 'src/core/a.ts']);
    const right = await goalWithPlan(target, 'e3ui-c1-g2', ['src/core/a.ts', 'src/core/b.ts']);

    const read = await conflictsOf(target);
    const card = conflictCardOf(read, pairOfGoals(left, right));
    expect(card.objects).toEqual([
      { kind: 'file', workspace: S6A_SCOPE, path: 'src/core/a.ts', digest: null, label: 'src/core/a.ts' },
      { kind: 'file', workspace: S6A_SCOPE, path: 'src/core/b.ts', digest: null, label: 'src/core/b.ts' },
    ]);
  });

  it('C2 queryGoalConflicts lists the one executed file both real Runs wrote', async () => {
    /* Named mutation: `goal-settings-machine.ts:fileSet` keeps only `plannedFiles` and drops `executedFiles`;
     * the exact `objects` below goes empty. */
    const f = await openS2BTrackFixture('memory');
    tracks.push(f);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const goalB = await f.createGoalWithPlan('e3ui-c2-goal-b', ['e3ui-c2-b-work']);
    const sessionB = await f.newSession('e3ui-c2-session-b');
    const runA = await f.runAndEndOn(f.goalRef, 'work-1', f.computeSessionRef(),
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    await f.writeActivity(runA, countedFacts({
      turnStartedAt: '2026-10-14T09:00:00.000Z', lastRecordAt: '2026-10-14T09:10:00.000Z',
      changedFiles: { definite: ['src/module-m/f.ts'] },
    }));
    const runB = await f.runAndEndOn(goalB, 'e3ui-c2-b-work', sessionB,
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    await f.writeActivity(runB, countedFacts({
      turnStartedAt: '2026-10-14T10:00:00.000Z', lastRecordAt: '2026-10-14T10:10:00.000Z',
      changedFiles: { definite: ['src/module-m/f.ts'] },
    }));

    const assembler = createGoalConflictAssembler({
      records: f.records,
      catalog: createArchitectureCatalogService({ records: f.records, knowledge: knowledgeLinesFor({ root: f.b2.base.directory,
        ...f.b2.base.scope, records: f.records }) }),
      executedFiles: f.goalExecutedFiles(),
    });
    const result = await assembler.queryGoalConflicts(f.ctx, { workspace: f.b2.base.scope });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;

    const card = conflictCardOf(result.value, pairOfGoals(f.goalRef, goalB));
    expect(card.objects).toEqual([{ kind: 'file', workspace: f.b2.base.scope,
      path: 'src/module-m/f.ts', digest: null, label: 'src/module-m/f.ts' }]);
  });

  it('C3 a conflict card has no detection time of its own', async () => {
    /* Named mutation: `conflictCard` writes a non-null `openedAt` (the later-acceptedAt rule §9b removed); the
     * `toBeNull` below goes red. */
    const target = await openWorld();
    target.world.clock.set(S6A_AT);
    const left = await goalWithPlan(target, 'e3ui-c3-g1', ['src/core/c3.ts']);
    target.world.clock.set('2026-10-23T09:10:00.000Z');
    const right = await goalWithPlan(target, 'e3ui-c3-g2', ['src/core/c3.ts']);

    const read = await conflictsOf(target);
    const card = conflictCardOf(read, pairOfGoals(left, right));
    expect(card.openedAt).toBeNull();
  });

  it('C4 a conflict card has no Task or Run ref', async () => {
    /* Named mutation: `conflictCard.taskRef` becomes a hand-made triple; the `toBeNull` below goes red. The
     * hand-made `runRef` mutation fails the second assertion the same way. */
    const target = await openWorld();
    const left = await goalWithPlan(target, 'e3ui-c4-g1', ['src/core/a.ts', 'src/core/b.ts']);
    const right = await goalWithPlan(target, 'e3ui-c4-g2', ['src/core/a.ts', 'src/core/b.ts']);
    const listed = conflictCardOf(await conflictsOf(target), pairOfGoals(left, right));

    const card = valueOf<DecisionCardV1>(await target.main.route('decisions/card', { source: listed.source }),
      'ready', 'decisions/card');
    expect(cardTaskRefOf(card)).toBeNull();
    expect(cardRunRefOf(card)).toBeNull();
  });

  it('C5 a planned-versus-executed pair lists no file (the shared filePaths is empty)', async () => {
    /* Named mutation: `conflictCard.objects` becomes the union of both Goals' planned and executed files (a
     * second conflict rule); the `toEqual([])` below goes red. */
    const f = await openS5DecisionFixture('memory', { catalog: 'modules', requirementKind: 'static' });
    decisions.push(f);

    // Goal A: a real claim/enter/end on `a-work` plus the public RunActivity write for F under module M.
    const sessionA = await f.createS5Session('e3ui-c5-session');
    const claimA = await f.claimRun({ requestId: 'e3ui-c5-claim-a', goalRef: f.goals.A.ref,
      planRef: f.plans.A1.ref, taskId: 'a-work', sessionRef: sessionA });
    await f.enterClaim(claimA);
    const endedA = await f.settleRun(claimA);
    let seq = 0;
    const activity = createRunActivityService({ records: f.records, now: f.now,
      eventId: () => `e3ui-c5-event-${++seq}` });
    const recorded = await activity.ensureActivityRecording(f.ctx, {
      input: { workspace: f.base.scope }, meta: { requestId: 'e3ui-c5-epoch', expected: [] },
    });
    expect(recorded.status).toBe('committed');
    const wrote = await activity.recordRunActivity(f.ctx, {
      input: { runRef: endedA.ref, facts: countedFacts({
        turnStartedAt: endedA.startedAt ?? f.now(), lastRecordAt: endedA.endedAt ?? f.now(),
        changedFiles: { definite: ['src/m/f.ts'] },
      }) },
      meta: { requestId: 'e3ui-c5-activity', expected: [] },
    });
    expect(wrote).toMatchObject({ status: 'committed' });

    const records = f.b2.base.records as unknown as Parameters<typeof createGoalExecutedFilesReader>[0]['records'];
    const catalog = createArchitectureCatalogService({ records: records as never, knowledge: f.knowledge });
    const executedFiles = createGoalExecutedFilesReader({ records });
    const assembler = createGoalConflictAssembler({ records: records as never, catalog, executedFiles });
    const result = await assembler.queryGoalConflicts(f.ctx, { workspace: f.base.scope });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;

    // A executed F (mapped to M) while B only planned M: the module pair overlaps, the file intersection is empty.
    const card = conflictCardOf(result.value, pairOfGoals(f.goals.A.ref, f.goals.B.ref));
    expect(card.objects).toEqual([]);
  });
});
