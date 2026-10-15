/**
 * Slice 2B BE5 row 2B-34: the real `GoalExecutedFilesPort` behind the public
 * conflict read.
 *
 * Data is built by `S2B-track-fixture.ts` (real Runs, real public `RunActivity`
 * writes, the real `ActivityRecording`). The reader is called directly and also
 * through the public `createGoalConflictAssembler` (the implementation behind
 * `decisions.queryGoalConflicts`); the HTTP route seam belongs to Group W.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunActivityFactsV1 } from '../../src/contracts/run-activity.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createGoalConflictAssembler, readGoalFootprint } from '../../src/core/work-graph/views/goal-conflicts.js';
import { goalConflictFacts } from '../../src/core/work-graph/state/goal-settings-machine.js';
import { openS2BTrackFixture, type S2BTrackFixture } from '../helpers/S2B-track-fixture.js';
import { countedFacts } from '../helpers/S2B-activity-fixture.js';

const opened: S2BTrackFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

async function open(kind: 'memory' | 'sqlite'): Promise<S2BTrackFixture> {
  const fixture = await openS2BTrackFixture(kind);
  opened.push(fixture);
  return fixture;
}

const unknownFacts: RunActivityFactsV1 = {
  status: 'unknown', ruleVersion: 1, reason: 'history_read_failed', detail: 'the S2B fixture read failed',
};

describe.each(['memory', 'sqlite'] as const)('S2B executed files (%s)', (kind) => {
  it('2B-34 a counted Run yields its definite and possible files, ordered, and is not incomplete', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const run1 = await f.runAndEnd('work-1', f.computeSessionRef(),
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    const run2 = await f.runAndEnd('work-2', f.computeSessionRef(),
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    await f.writeActivity(run1, countedFacts({
      turnStartedAt: '2026-10-14T09:00:00.000Z', lastRecordAt: '2026-10-14T09:10:00.000Z',
      changedFiles: { definite: ['a.ts', 'b.ts'], possible: ['c.ts'] },
    }));
    await f.writeActivity(run2, countedFacts({
      turnStartedAt: '2026-10-14T10:00:00.000Z', lastRecordAt: '2026-10-14T10:10:00.000Z',
      changedFiles: { definite: ['d.ts'] },
    }));

    const result = await f.goalExecutedFiles().readGoalExecutedFiles(f.ctx, { goalRef: f.goalRef });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value.availability).toBe('available');
    expect(result.value.possiblyIncomplete).toBe(false);
    expect(result.value.guards).toEqual([]);
    expect(result.value.sourceCursor).not.toBeNull();

    const byRun = (ref: { runId: string }) => result.value.files
      .filter((file) => file.runRef.runId === ref.runId)
      .map((file) => [file.certainty, file.path]);
    expect(byRun(run1)).toEqual([['definite', 'a.ts'], ['definite', 'b.ts'], ['possible', 'c.ts']]);
    expect(byRun(run2)).toEqual([['definite', 'd.ts']]);
    expect(result.value.files).toHaveLength(4);
  });

  it('2B-34 a RUN-09 not-entered execution adds no files and does not make the Goal incomplete', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const counted = await f.runAndEnd('work-1', f.computeSessionRef(),
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    await f.writeActivity(counted, countedFacts({
      turnStartedAt: '2026-10-14T09:00:00.000Z', lastRecordAt: '2026-10-14T09:10:00.000Z',
      changedFiles: { definite: ['a.ts'] },
    }));
    const notEntered = await f.claimThenCancel('work-2', f.computeSessionRef(), '2026-10-14T09:40:00.000Z');

    const result = await f.goalExecutedFiles().readGoalExecutedFiles(f.ctx, { goalRef: f.goalRef });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value.possiblyIncomplete).toBe(false);
    expect(result.value.files.map((file) => file.path)).toEqual(['a.ts']);
    expect(result.value.files.some((file) => file.runRef.runId === notEntered.runId)).toBe(false);
  });

  it('2B-34 an unknown execution makes the Goal incomplete', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const run = await f.runAndEnd('work-1', f.computeSessionRef(),
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    await f.writeActivity(run, unknownFacts);

    const result = await f.goalExecutedFiles().readGoalExecutedFiles(f.ctx, { goalRef: f.goalRef });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value.possiblyIncomplete).toBe(true);
    expect(result.value.files).toEqual([]);
  });

  it('2B-34 an execution that ended before the recording epoch (not_backfilled) makes the Goal incomplete', async () => {
    const f = await open(kind);
    // No RunActivity record is written: this is the missing-record `not_backfilled`
    // case (L7) because the recording epoch starts after the Run ended.
    await f.runAndEnd('work-1', f.computeSessionRef(),
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    await f.ensureRecording('2026-10-14T11:00:00.000Z');

    const result = await f.goalExecutedFiles().readGoalExecutedFiles(f.ctx, { goalRef: f.goalRef });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value.possiblyIncomplete).toBe(true);
    expect(result.value.files).toEqual([]);
  });

  it('2B-34 no ActivityRecording at all is not a complete answer', async () => {
    const f = await open(kind);
    await f.runAndEnd('work-1', f.computeSessionRef(),
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');

    const result = await f.goalExecutedFiles().readGoalExecutedFiles(f.ctx, { goalRef: f.goalRef });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value.possiblyIncomplete).toBe(true);
    expect(result.value.files).toEqual([]);
  });

  it('2B-34 many storage reads (12 Runs and records) stay available: L13 has no read cap', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const runIds: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const run = await f.runAndEnd(`work-${String(index + 1)}`, f.computeSessionRef(),
        `2026-10-14T0${String(index % 9)}:00:00.000Z`, `2026-10-14T0${String(index % 9)}:30:00.000Z`);
      runIds.push(run.runId);
      await f.writeActivity(run, countedFacts({
        turnStartedAt: `2026-10-14T0${String(index % 9)}:00:00.000Z`,
        lastRecordAt: `2026-10-14T0${String(index % 9)}:10:00.000Z`,
        changedFiles: { definite: [`f${String(index)}.ts`] },
      }));
    }

    const result = await f.goalExecutedFiles().readGoalExecutedFiles(f.ctx, { goalRef: f.goalRef });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value.availability).toBe('available');
    expect(result.value.possiblyIncomplete).toBe(false);
    expect(result.value.files).toHaveLength(12);
    expect(new Set(result.value.files.map((file) => file.runRef.runId)).size).toBe(12);
    expect(runIds).toHaveLength(12);
  });

  it('2B-34 a read-counting store proxy past a small budget stays available: L13 never trips a read cap', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    // A budget far below `ACTIVITY_READ_RECORD_CAP` (20,000): a reader that
    // applied that cap semantics here would already be over it.
    const SMALL_READ_BUDGET = 10;
    let reads = 0;
    const base = f.records;
    const counting = {
      ...base,
      async readMany(refKeys: readonly string[]) {
        const result = await base.readMany(refKeys);
        if (result.status === 'ready') reads += Math.max(1, result.value.records.length);
        return result;
      },
      async lookup(request: Parameters<typeof base.lookup>[0]) {
        const result = await base.lookup(request);
        if (result.status === 'ready') reads += result.value.records.length;
        return result;
      },
      async lookupOrdered(request: Parameters<typeof base.lookupOrdered>[0]) {
        const result = await base.lookupOrdered(request);
        if (result.status === 'ready') reads += result.value.records.length;
        return result;
      },
    } as unknown as S2BTrackFixture['records'];

    for (let index = 0; index < 12; index += 1) {
      const run = await f.runAndEnd(`work-${String(index + 1)}`, f.computeSessionRef(),
        `2026-10-14T0${String(index % 9)}:00:00.000Z`, `2026-10-14T0${String(index % 9)}:30:00.000Z`);
      await f.writeActivity(run, countedFacts({
        turnStartedAt: `2026-10-14T0${String(index % 9)}:00:00.000Z`,
        lastRecordAt: `2026-10-14T0${String(index % 9)}:10:00.000Z`,
        changedFiles: { definite: [`f${String(index)}.ts`] },
      }));
    }

    const result = await f.goalExecutedFiles(counting).readGoalExecutedFiles(f.ctx, { goalRef: f.goalRef });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value.availability).toBe('available');
    expect(result.value.possiblyIncomplete).toBe(false);
    expect(reads).toBeGreaterThan(SMALL_READ_BUDGET);
  });

  it('2B-34 the conflict read exposes the real changed file as available and unmapped (no catalog adopted)', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const run = await f.runAndEnd('work-1', f.computeSessionRef(),
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    await f.writeActivity(run, countedFacts({
      turnStartedAt: '2026-10-14T09:00:00.000Z', lastRecordAt: '2026-10-14T09:10:00.000Z',
      changedFiles: { definite: ['src/module-m/f.ts'] },
    }));

    const assembler = createGoalConflictAssembler({
      records: f.records,
      catalog: createArchitectureCatalogService({ records: f.records }),
      executedFiles: f.goalExecutedFiles(),
    });
    const result = await assembler.queryGoalConflicts(f.ctx, { workspace: f.b2.base.scope });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const completeness = result.value.footprintCompleteness.find((entry) => entry.goalRef.goalId === f.goalRef.goalId);
    expect(completeness).toBeDefined();
    expect(completeness).toMatchObject({ executedFiles: 'available', possiblyIncomplete: true });
    expect(completeness?.unmappedFiles).toContain('src/module-m/f.ts');
  });

  it('2B-34 a two-Goal conflict card carries the shared changed file and both footprint completeness entries', async () => {
    const f = await open(kind);
    await f.ensureRecording('2026-10-14T00:00:00.000Z');
    const goalB = await f.createGoalWithPlan('s2b-track-goal-b', ['b-work-1']);
    const sessionB = await f.newSession('s2b-34-goal-b-session');
    const runA = await f.runAndEndOn(f.goalRef, 'work-1', f.computeSessionRef(),
      '2026-10-14T09:00:00.000Z', '2026-10-14T09:30:00.000Z');
    await f.writeActivity(runA, countedFacts({
      turnStartedAt: '2026-10-14T09:00:00.000Z', lastRecordAt: '2026-10-14T09:10:00.000Z',
      changedFiles: { definite: ['src/module-m/f.ts'] },
    }));
    const runB = await f.runAndEndOn(goalB, 'b-work-1', sessionB,
      '2026-10-14T10:00:00.000Z', '2026-10-14T10:30:00.000Z');
    await f.writeActivity(runB, countedFacts({
      turnStartedAt: '2026-10-14T10:00:00.000Z', lastRecordAt: '2026-10-14T10:10:00.000Z',
      changedFiles: { definite: ['src/module-m/f.ts'] },
    }));

    const catalog = createArchitectureCatalogService({ records: f.records });
    const executedFiles = f.goalExecutedFiles();
    const assembler = createGoalConflictAssembler({ records: f.records, catalog, executedFiles });
    const result = await assembler.queryGoalConflicts(f.ctx, { workspace: f.b2.base.scope });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;

    const card = result.value.cards.find((candidate) => candidate.source.kind === 'goal_conflict'
      && (candidate.source.goalBases ?? []).some((basis) => basis.goalRef.goalId === f.goalRef.goalId)
      && (candidate.source.goalBases ?? []).some((basis) => basis.goalRef.goalId === goalB.goalId));
    expect(card).toBeDefined();
    expect(card).toMatchObject({ state: 'waiting_answer' });

    const completenessA = result.value.footprintCompleteness.find((entry) => entry.goalRef.goalId === f.goalRef.goalId);
    const completenessB = result.value.footprintCompleteness.find((entry) => entry.goalRef.goalId === goalB.goalId);
    expect(completenessA).toMatchObject({
      executedFiles: 'available', possiblyIncomplete: true, unmappedFiles: ['src/module-m/f.ts'],
    });
    expect(completenessB).toMatchObject({
      executedFiles: 'available', possiblyIncomplete: true, unmappedFiles: ['src/module-m/f.ts'],
    });

    const dependencies = { records: f.records, catalog, executedFiles };
    const footprintA = await readGoalFootprint(dependencies, f.ctx, { goalRef: f.goalRef });
    const footprintB = await readGoalFootprint(dependencies, f.ctx, { goalRef: goalB });
    if (footprintA.status !== 'ready' || footprintB.status !== 'ready') {
      throw new Error(`S2B footprint read failed: ${JSON.stringify([footprintA, footprintB])}`);
    }
    const facts = goalConflictFacts(footprintA.value, footprintB.value);
    expect(facts.overlaps).toBe(true);
    expect(facts.filePaths).toEqual(['src/module-m/f.ts']);
  });
});
