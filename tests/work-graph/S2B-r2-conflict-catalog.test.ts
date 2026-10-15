/**
 * Slice 2B round-2 R12 row 2B-34: the specified planned-versus-executed conflict
 * through the public BE5 read `decisions.queryGoalConflicts`.
 *
 * Flow: `S5R2-c-support.ts` builds a fresh project and adopts a formal
 * architecture catalog through the PUBLIC `adoptInitialArchitecture`
 * (`S5R2-c-support.ts:306`) so module M maps `src/m/`; Goal B's adopted Plan B1
 * carries the module-scoped task `b-work` in M; Goal A's `a-work` Run is claimed,
 * entered and ended through the real claim/entry services and its `RunActivity`
 * (file F under M) is written through the public `createRunActivityService`.
 * Assertions go through `createGoalConflictAssembler.queryGoalConflicts`.
 *
 * FINDING (row STOPPED). The frozen algorithm cannot express "the conflict lists
 * F" for a planned-versus-executed pair. `views/goal-conflicts.ts:316` builds the
 * card from `state/goal-settings-machine.ts:goalConflictFacts`, whose `filePaths`
 * (`goal-settings-machine.ts:286`) is the INTERSECTION of the two Goals' executed
 * files. Goal B planned M but executed no file, so `filePaths` is `[]`; the pair
 * overlaps only through `moduleRefs` (M). The public `GoalConflictReadV1`
 * (`model/decision-contracts.ts:288-297`) exposes `cards` (no file list) and
 * `footprintCompleteness.unmappedFiles`, which is empty because F is MAPPED, not
 * unmapped. `tests/state/S5-goal-settings.test.ts:284` pins `filePaths: []` for
 * exactly this planned-vs-executed case. Producing "lists F" would need a
 * `filePaths`/mapped-file field on the read and a different pure rule — both
 * frozen (§10 of the spec; decision 56) and outside this subagent's files.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createRunActivityService } from '../../src/core/work-graph/tasks/run-activity-service.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createGoalConflictAssembler, readGoalFootprint } from '../../src/core/work-graph/views/goal-conflicts.js';
import { goalConflictFacts } from '../../src/core/work-graph/state/goal-settings-machine.js';
import { openS5R2CompletionFixture } from '../helpers/S5R2-c-support.js';
import type { S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { countedFacts } from '../helpers/S2B-activity-fixture.js';

const fixtures: S5DecisionFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

async function open(kind: 'memory' | 'sqlite'): Promise<S5DecisionFixture> {
  const fixture = await openS5R2CompletionFixture(kind);
  fixtures.push(fixture);
  return fixture;
}

describe.each(['memory', 'sqlite'] as const)('S2B round-2 planned-vs-executed conflict (%s)', (kind) => {
  it('2B-34 (STOPPED: filePaths is the executed intersection) module M overlap is found, but F is not listed', async () => {
    const f = await open(kind);
    // Goal A: a real claim/enter/end on `a-work` plus the public RunActivity write
    // for F under module M (`src/m/` is the adopted catalog's prefix).
    const sessionA = await f.createS5Session('s2b-r2-34-session');
    const claimA = await f.claimRun({ requestId: 's2b-r2-34-claim-a', goalRef: f.goals.A.ref,
      planRef: f.plans.A1.ref, taskId: 'a-work', sessionRef: sessionA });
    await f.enterClaim(claimA);
    const endedA = await f.settleRun(claimA);
    let seq = 0;
    const activity = createRunActivityService({ records: f.records, now: f.now,
      eventId: () => `s2b-r2-34-event-${++seq}` });
    const recorded = await activity.ensureActivityRecording(f.ctx, {
      input: { workspace: f.base.scope }, meta: { requestId: 's2b-r2-34-epoch', expected: [] },
    });
    expect(recorded.status).toBe('committed');
    const wrote = await activity.recordRunActivity(f.ctx, {
      input: { runRef: endedA.ref, facts: countedFacts({
        turnStartedAt: endedA.startedAt ?? f.now(), lastRecordAt: endedA.endedAt ?? f.now(),
        changedFiles: { definite: ['src/m/f.ts'] },
      }) },
      meta: { requestId: 's2b-r2-34-activity', expected: [] },
    });
    expect(wrote).toMatchObject({ status: 'committed' });

    // The S5 observed wrapper does not forward the 2A ordered lookup, so the
    // conflict reads use the same underlying B2 store, which implements all
    // three record ports (`readMany`, `lookup`, `lookupOrdered`).
    const records = f.b2.base.records as unknown as Parameters<typeof createGoalExecutedFilesReader>[0]['records'];
    const catalog = createArchitectureCatalogService({ records: records as never });
    const executedFiles = createGoalExecutedFilesReader({ records });
    const assembler = createGoalConflictAssembler({ records: records as never, catalog, executedFiles });
    const result = await assembler.queryGoalConflicts(f.ctx, { workspace: f.base.scope });
    if (result.status !== 'ready') throw new Error(`S2B r2 conflict read: ${JSON.stringify(result)}`);
    expect(result.status).toBe('ready');

    // The module-M overlap really is found through the public conflict read.
    const card = result.value.cards.find((candidate) => candidate.source.kind === 'goal_conflict'
      && (candidate.source.goalBases ?? []).some((basis) => basis.goalRef.goalId === f.goals.A.ref.goalId)
      && (candidate.source.goalBases ?? []).some((basis) => basis.goalRef.goalId === f.goals.B.ref.goalId));
    expect(card).toBeDefined();
    expect(card).toMatchObject({ state: 'waiting_answer' });

    // Goal A executed F under M and is complete; F is mapped, so it is NOT in
    // `unmappedFiles` — which is the only file-path field the read offers.
    const completenessA = result.value.footprintCompleteness.find((entry) => entry.goalRef.goalId === f.goals.A.ref.goalId);
    expect(completenessA).toMatchObject({ executedFiles: 'available', possiblyIncomplete: false, unmappedFiles: [] });

    // The blocker, pinned through the same public footprint read and pure rule:
    // A executed F (mapped to M) while B only planned M, so `filePaths` is empty.
    const dependencies = { records, catalog, executedFiles };
    const footprintA = await readGoalFootprint(dependencies, f.ctx, { goalRef: f.goals.A.ref });
    const footprintB = await readGoalFootprint(dependencies, f.ctx, { goalRef: f.goals.B.ref });
    if (footprintA.status !== 'ready' || footprintB.status !== 'ready') {
      throw new Error(`S2B r2 footprint read failed: ${JSON.stringify([footprintA, footprintB])}`);
    }
    expect(footprintA.value.executedFiles).toContainEqual({
      path: 'src/m/f.ts', moduleRef: { projectId: f.ctx.projectId, moduleId: 'M' }, certainty: 'definite',
    });
    expect(footprintB.value.plannedModules).toContainEqual({ projectId: f.ctx.projectId, moduleId: 'M' });
    expect(footprintB.value.executedFiles).toEqual([]);
    const facts = goalConflictFacts(footprintA.value, footprintB.value);
    expect(facts.overlaps).toBe(true);
    expect(facts.moduleRefs).toContainEqual({ projectId: f.ctx.projectId, moduleId: 'M' });
    expect(facts.filePaths).toEqual([]);
  }, 120_000);
});
