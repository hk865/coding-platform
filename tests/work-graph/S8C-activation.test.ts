/**
 * 8C G3 R1/R3/R4/R9 — the real repair activation owner.
 *
 * Every state comes from the real Host world (S8C-repair-world): a scripted
 * Work Run writes a repair through the real `record_note` tool and the real
 * Workflow finalizes the check round. G5 has not wired the activation trigger,
 * so each row calls the G3 owner itself. The commit count is an A3 wrapper
 * around the real observed `records.commit`; the catalog and note reads are
 * the public reads.
 */
import { afterAll, afterEach, beforeEach, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import {
  openS8COtherGoalReaders, openS8CRepairWorld, repairCommits,
  type S8CRepairWorld, type S8CStagedRepair,
} from '../helpers/S8C-repair-world.js';

const worlds: S8CRepairWorld[] = [];
let shared: S8CRepairWorld | null = null;
beforeEach(() => repairCommits.reset());
afterEach(async () => {
  for (const world of worlds.splice(0)) if (world !== shared) await world.close();
});
afterAll(async () => {
  const held = shared;
  shared = null;
  if (held !== null) await held.close();
});

async function world(options: { label: string; tasks?: readonly string[];
  backend?: 'memory' | 'sqlite' }): Promise<S8CRepairWorld> {
  const opened = await openS8CRepairWorld(options);
  worlds.push(opened);
  return opened;
}

const small = [{ op: 'set_responsibility' as const, moduleId: 's6a-core', text: 'S8C repaired core' }];

async function listedNote(world: S8CRepairWorld, noteId: string): Promise<Record<string, unknown>> {
  const answer = await world.world.post('notes/list', { scope: S6A_SCOPE,
    input: { anchor: { kind: 'module', moduleId: 's6a-core' }, limit: 100, cursor: null } }) as
    { body?: { status?: string; value?: { items?: Record<string, unknown>[] } } };
  const body = answer.body ?? answer as unknown as { status?: string; value?: { items?: Record<string, unknown>[] } };
  const item = body.value?.items?.find(candidate => candidate['noteId'] === noteId);
  if (body.status !== 'ready' || item === undefined) throw new Error(`notes/list: ${JSON.stringify(body)}`);
  return item;
}

function activate(world: S8CRepairWorld, staged: { noteId: string; version: number }, commandId?: string) {
  return world.owner.activateRepair(world.world.humanContext(), {
    commandId: commandId ?? `activate:${staged.noteId}:${staged.version}`,
    noteId: staged.noteId, expectedVersion: staged.version,
  });
}

describe('S8C G3 R1/R9 activation and post-state', () => {
  let w: S8CRepairWorld;
  let staged: S8CStagedRepair;
  let passed: Awaited<ReturnType<S8CRepairWorld['pass']>>;
  let stagedRevision: number;
  let activated: Awaited<ReturnType<typeof activate>>;
  let activationCommits: number;

  // R1 and R9 read the ONE success world; R9 adds only the review and the
  // other Goal's real Work Run reads.
  beforeAll(async () => {
    w = await world({ label: 'r1' });
    shared = w;
    staged = await w.writeRepair({ ops: small });
    passed = await w.pass(staged);
    stagedRevision = await w.readCatalog();
    repairCommits.reset();
    activated = await activate(w, staged);
    activationCommits = repairCommits.count();
  });

  it('R1: one commit accepts the note and revises the catalog once', async () => {
    expect(staged.version).toBe(1);
    expect(passed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    expect(activated, JSON.stringify(activated)).toMatchObject({ status: 'activated', noteId: staged.noteId, version: 2 });
    expect(activationCommits).toBe(1);
    expect(await w.readCatalog()).toBe(stagedRevision + 1);

    const note = await w.readNote(staged.noteId);
    expect(note).toMatchObject({ version: 2, storedState: 'accepted', confirmedByUser: false });
    expect(await listedNote(w, staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted',
      confirmedByUser: false });
    // The public history read carries the N+1 version's own change kind.
    const history = await w.world.platform.notes.memoryHistory(w.world.humanContext(),
      { v: 1, op: 'history', noteId: staged.noteId, limit: 10, cursor: null });
    expect(history.status).toBe('ready');
    if (history.status !== 'ready') return;
    expect(history.value.items.find(item => item.version === 2)?.change)
      .toMatchObject({ kind: 'activate', by: { kind: 'platform' } });
  });

  it('R9: the note is accepted for its own Goal, the scribe review makes it cross-goal, and the catalog is readable',
    async () => {
    const other = await openS8COtherGoalReaders(w);
    const readOtherGoal = (ctx: Awaited<ReturnType<typeof other.workCtx>>) =>
      w.world.platform.notes.memoryLookup(ctx, { v: 1, op: 'lookup',
        anchor: { kind: 'module', moduleId: 's6a-core' }, limit: 100, cursor: null });

    const note = await w.readNote(staged.noteId);
    expect(note).toMatchObject({ version: 2, storedState: 'accepted', confirmedByUser: false });
    expect(note['goalId']).toBe(w.goal.goalId);
    // Another Goal's real Work Run cannot see an accepted note that is neither
    // reviewed nor confirmed.
    const before = await readOtherGoal(await other.workCtx('t1'));
    expect(before.status).toBe('ready');
    if (before.status !== 'ready') return;
    expect(before.value.items.map(item => item.noteId)).not.toContain(staged.noteId);

    const review = await w.world.platform.notes.reviewNote(await other.scribeCtx(), {
      commandId: `s8c-r9-review-${staged.noteId}`, noteId: staged.noteId, expectedVersion: 2,
      expectedPointerRevision: null, verdict: 'review', reason: null });
    expect(review.status).toBe('done');
    expect((await w.readNote(staged.noteId))['storedState']).toBe('reviewed');

    // A second real Work Run of the other Goal now sees the reviewed note.
    const after = await readOtherGoal(await other.workCtx('t2'));
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') return;
    expect(after.value.items.find(item => item.noteId === staged.noteId)).toMatchObject({ crossGoal: true });

    const read = await w.world.platform.architecture.readArchitectureRevision(w.world.humanContext(),
      { selection: { kind: 'current' } });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.catalog.catalog.modules.map(module => module.ref.moduleId)).toContain('s6a-core');
  });

  it('R1: a failed current-Plan read rejects unchanged and writes nothing', async () => {
    const w = await world({ label: 'r1-plan-read-failure' });
    const staged = await w.writeRepair({ ops: small });
    await w.pass(staged);
    // The adopted Plan after the cancellation differs from the Run's Plan, so
    // the owner must read the Goal's current Plan; that one read fails.
    await w.endTask(staged.task.taskId, 'cancelled');
    const current = await w.main.activePlan(w.goal);
    if (current === null) throw new Error('R1: the Goal has no current adopted Plan');
    const currentPlanKey = canonicalJson(current.ref as unknown as JsonValue);
    const realReadMany = w.records.readMany.bind(w.records);
    const owner = w.createFaultOwner({
      records: { ...w.records, readMany: async (keys) => keys.length === 1 && keys[0] === currentPlanKey
        ? { status: 'rejected', code: 'invalid', reason: 'injected current Plan read failure' }
        : realReadMany(keys) },
    });

    repairCommits.reset();
    const result = await owner.activateRepair(w.world.humanContext(),
      { commandId: `activate:${staged.noteId}:${staged.version}`, noteId: staged.noteId,
        expectedVersion: staged.version });
    expect(result).toEqual({ status: 'rejected', code: 'invalid',
      reason: 'injected current Plan read failure' });
    expect(await w.readNote(staged.noteId)).toMatchObject({ version: 1, storedState: 'staged' });
    expect(repairCommits.count()).toBe(0);
  });
});

describe('S8C G3 R2/R5 owner approval', () => {
  it('R2/R5: a repair that needs a card with no answer is approval_pending', async () => {
    const w = await world({ label: 'r2-approval' });
    const core = { projectId: S6A_SCOPE.projectId, moduleId: 's6a-core' };
    const ui = { projectId: S6A_SCOPE.projectId, moduleId: 's6a-ui' };
    const staged = await w.writeRepair({ ops: [{ op: 'add_dependency', from: core, to: ui, reason: 'R2 card' }] });
    expect(staged.version).toBe(1);
    const passed = await w.pass(staged);
    expect(passed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });

    repairCommits.reset();
    expect(await activate(w, staged)).toEqual({ status: 'not_ready', reason: 'approval_pending' });
    expect(await w.readNote(staged.noteId)).toMatchObject({ version: 1, storedState: 'staged' });
    expect(repairCommits.count()).toBe(0);
  });
});

describe('S8C G3 R3 binding and withdrawal', () => {
  it('R3: FAIL leaves the note staged and the same Run successor PASS wins', async () => {
    const w = await world({ label: 'r3-reverify' });
    const staged = await w.writeRepair({ ops: small });
    const failed = await w.fail(staged);
    expect(failed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'FAIL' } });
    expect((await w.readNote(staged.noteId))['storedState']).toBe('staged');
    // The finalized FAIL round binds the staged repair, so the PASS gate is the
    // only thing standing between this call and activation.
    repairCommits.reset();
    expect(await activate(w, staged)).toEqual({ status: 'not_ready', reason: 'check_not_passed' });
    expect((await w.readNote(staged.noteId))['version']).toBe(1);
    expect(repairCommits.count()).toBe(0);

    await w.reverify(failed);
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(w.world.ag2b, selectRepairWork(w, 'r3-successor'), { stopBefore: 'complete_task', receipts });
    const finalize = receipts.find(receipt => receipt.kind === 'finalize_checks');
    if (finalize === undefined || finalize.kind !== 'finalize_checks' || finalize.result.status !== 'committed') {
      throw new Error(`R3: the successor round did not finalize: ${JSON.stringify(receipts.at(-1))}`);
    }
    expect(finalize.result.value, JSON.stringify(receipts.map(receipt => ({ kind: receipt.kind,
      status: receipt.result.status, receipt }))))
      .toMatchObject({ outcome: 'PASS' });
    expect(finalize.result.value.snapshot.stagedRepairs).toEqual([
      expect.objectContaining({ noteId: staged.noteId, version: staged.version })]);
    expect((await activate(w, staged))).toMatchObject({ status: 'activated', version: 2 });
    expect((await w.readNote(staged.noteId))['storedState']).toBe('accepted');
  });

  it('R3: a real rework writes a new repair and the next round PASS activates it', async () => {
    const w = await world({ label: 'r3-rework' });
    const first = await w.writeRepair({ ops: small });
    const failed = await w.fail(first);
    expect(failed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'FAIL' } });
    if (failed.next === null) throw new Error('R3: the FAIL round left no automatic requeue');
    // The Workflow's own requeue, then a new Run claims the same task and writes
    // a new repair through the real `record_note` tool.
    await driveWorkflow(w.world.ag2b, failed.next, { stopBefore: 'claim_task' });
    const reworked = await w.writeRepair({ ops: [{ op: 'set_responsibility', moduleId: 's6a-core',
      text: 'S8C reworked core' }] });
    expect(reworked.noteId).not.toBe(first.noteId);
    const passed = await w.pass(reworked);
    expect(passed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    expect(passed.finalize.result.status === 'committed'
      ? passed.finalize.result.value.snapshot.stagedRepairs : []).toEqual(expect.arrayContaining([
      expect.objectContaining({ noteId: reworked.noteId, version: reworked.version })]));
    expect(await activate(w, reworked)).toMatchObject({ status: 'activated', version: 2 });
    expect((await w.readNote(reworked.noteId))['storedState']).toBe('accepted');
    expect((await w.readNote(first.noteId))['storedState']).toBe('staged');
  });

  it('R3: a cancelled task after the round opened withdraws once and writes no second version', async () => {
    const w = await world({ label: 'r3-withdraw' });
    const staged = await w.writeRepair({ ops: small });
    await w.pass(staged);
    await w.endTask(staged.task.taskId, 'cancelled');

    repairCommits.reset();
    expect(await activate(w, staged)).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'withdrawn' });
    const note = await w.readNote(staged.noteId);
    expect(note).toMatchObject({ version: 2, storedState: 'withdrawn' });
    const commits = repairCommits.count();
    expect(await activate(w, staged, `activate:${staged.noteId}:${staged.version}`))
      .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'withdrawn' });
    expect(repairCommits.count()).toBe(commits);
    expect((await w.readNote(staged.noteId))['version']).toBe(2);
    expect(await w.readCatalog()).not.toBe(undefined);
  });
});

function selectRepairWork(w: S8CRepairWorld, flowId: string): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: w.goal, flowId, sessionHint: w.line.ref, kind: 'select_work' };
}

describe('S8C G3 R4 two repairs and replay', () => {
  it.each(['memory', 'sqlite'] as const)(
    'R4 %s: the earlier until activates first, the later is catalog-stale, and replay writes one revision', async backend => {
    const w = await world({ label: `r4-${backend}`, tasks: ['t1', 't2'], backend });
    const first = await w.writeRepair({ taskId: 't1', ops: small });
    const second = await w.writeRepair({ taskId: 't2', ops: small });
    // The larger noteId's round finalizes FIRST, so `until` order is the opposite of noteId order.
    const larger = second.noteId > first.noteId ? second : first;
    const smaller = larger === second ? first : second;
    await w.pass(larger);
    await w.pass(smaller);

    repairCommits.reset();
    const results = await w.owner.attemptRepairsForGoal(w.world.humanContext(), { goalRef: w.goal });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ status: 'activated', noteId: larger.noteId });
    expect(results[1]).toMatchObject({ status: 'source_stale', reason: 'catalog_changed' });
    expect(repairCommits.count()).toBe(1);
    expect((await w.readNote(smaller.noteId))['storedState']).toBe('staged');
    const revision = await w.readCatalog();

    repairCommits.reset();
    const replay = await w.owner.activateRepair(w.world.humanContext(),
      { commandId: `activate:${larger.noteId}:${larger.version}`, noteId: larger.noteId, expectedVersion: larger.version });
    expect(replay).toMatchObject({ status: 'activated', noteId: larger.noteId });
    expect(replay).toEqual(results[0]);
    expect(repairCommits.count()).toBe(0);
    expect(await w.readCatalog()).toBe(revision);
  });

  it('R7: one attempt reads the workspace observation once for two repairs', async () => {
    const w = await world({ label: 'obs-reuse', tasks: ['t1', 't2'] });
    const first = await w.writeRepair({ taskId: 't1', ops: small });
    const second = await w.writeRepair({ taskId: 't2', ops: small });
    await w.pass(first);
    await w.pass(second);
    const architecture = w.world.platform.architecture;
    let reads = 0;
    // A3: counts the observation reads and returns the platform's own reads.
    const owner = w.createFaultOwner({ observation: {
      observationState: async (ctx, input) => {
        reads += 1;
        return architecture.observationState(ctx, input);
      },
      listFiles: (ctx, input) => architecture.listFiles(ctx, input),
    } });
    const results = await owner.attemptRepairsForGoal(w.world.humanContext(), { goalRef: w.goal });
    expect(results).toHaveLength(2);
    expect(results.filter(result => result.status === 'activated')).toHaveLength(1);
    expect(reads).toBe(1);
  });
});

