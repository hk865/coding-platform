/**
 * SP (decision 66, S2.1 / S2.3 / S2.4 / S2.5) — the scoped read model and the
 * injected check agree on the shared per-item derivations.
 *
 * Every value goes through the real `platform.notes` holder: writes through the
 * real 4A writer, reads through `f.memory`, checks through `f.check.checkNotes`.
 * Plans/catalogs are revised only through the real public services. No database
 * or record store is inspected; every expected value is a literal.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture } from '../../src/contracts/architecture-catalog.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, currentVersion, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';
import { createS4BMultiScope } from '../helpers/S4B-note-multi-scope-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'sp-topic', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function write(f: S4BNoteCheckFixture, note: NoteDraftV1, goalId: string | null = null):
Promise<string> {
  const result = await f.inner.write(f.ctx(), note, goalId);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

async function writeAgent(f: S4BNoteCheckFixture, run: RunRef,
  note: NoteDraftV1, goalId: string | null = null): Promise<string> {
  const result = await f.inner.write(f.inner.workCtx(run), note, goalId);
  if (result.status === 'rejected') throw new Error(`agent write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

async function review(f: S4BNoteCheckFixture, noteId: string, expectedVersion: number,
  verdict: 'review' | 'accept' | 'reject', reason: string | null, commandId: string): Promise<void> {
  const result = await f.inner.platform.notes.reviewNote(f.ctx(), { commandId, noteId, expectedVersion,
    expectedPointerRevision: null, verdict, reason });
  if (result.status !== 'done') throw new Error(`review failed: ${JSON.stringify(result)}`);
}

async function reviseCatalog(f: S4BNoteCheckFixture,
  mutate: (catalog: AdoptedArchitecture) => AdoptedArchitecture): Promise<void> {
  const ctx = f.ctx();
  const current = await f.inner.platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
  if (current.status !== 'ready' || current.value.catalog === null) throw new Error('catalog read failed');
  const revised = await f.inner.platform.architecture.reviseArchitectureCatalog(ctx, {
    meta: { requestId: 'sp-catalog-revise', expected: [{ ref: f.inner.projectRef, revision: 1 },
      { ref: f.inner.workspaceRef, revision: 1 }] },
    input: { basedOn: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest },
      catalog: mutate(current.value.catalog.catalog), reason: 'sp catalog revision' } });
  if (revised.status !== 'committed') throw new Error(`revise failed: ${JSON.stringify(revised)}`);
}

describe('SP-1 scoped anchor derivations (one anchor, anchorQuota 2)', () => {
  // ~8 notes on the project anchor: a same-topic pair (a is an agent note that is
  // accepted later, so the write guard sees it as not-current at b's write),
  // a mutual contradicts pair, a superseded note, and over-quota extras.
  it.each(['memory', 'sqlite'] as const)(
    'SP-1 %s: lookup and one checkNotes call agree per item on conflicting/overQuota', async kind => {
      const f = await createS4BNoteCheckFixture(kind, { anchorQuota: 2 });
      try {
        const run = await f.inner.claimRun('sp1');
        // C3.4: a general structural note is accepted directly now. The pending
        // agent note `a` is made by replacing the user's own (seed) note (C3.3);
        // `a` is accepted later, so `b`'s write guard sees it as not current.
        const seedA = await write(f, draft({ topic: 'seed-a' }));
        const a = await writeAgent(f, run, draft({ topic: 'shared-topic', replaces: [seedA] }));
        const b = await write(f, draft({ topic: 'shared-topic' }));
        const c = await write(f, draft({ topic: 'contra-a' }));
        const d = await write(f, draft({ topic: 'contra-b', contradicts: [c] }));
        const e = await write(f, draft({ topic: 'old-topic' }));
        const g = await write(f, draft({ topic: 'g-topic' }));
        const h = await write(f, draft({ topic: 'h-topic' }));
        const replacing = await write(f, draft({ topic: 'new-topic', replaces: [e] }));
        // a becomes current only after b is already written: the same-topic pair
        // is inferred by the read (neither declares the other).
        await review(f, a, 1, 'accept', 'sp-1 accept', 'sp-1-accept-a');

        const lookup = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup',
          anchor: { kind: 'project' }, limit: 20, cursor: null });
        expect(lookup.status).toBe('ready');
        if (lookup.status !== 'ready') return;
        const byId = new Map(lookup.value.items.map(item => [item.noteId, item]));
        // The superseded note is not listed by lookup; the other seven are.
        expect([...byId.keys()].sort()).toEqual([a, b, c, d, replacing, g, h].sort());
        expect(byId.get(a)!.conflicting).toBe(true);
        expect(byId.get(b)!.conflicting).toBe(true);
        expect(byId.get(c)!.conflicting).toBe(true);
        expect(byId.get(d)!.conflicting).toBe(true);
        expect(byId.get(replacing)!.conflicting).toBe(false);
        expect(byId.get(g)!.conflicting).toBe(false);
        expect(byId.get(h)!.conflicting).toBe(false);
        for (const id of [a, b, c, d, replacing, g, h]) {
          expect(byId.get(id)!.overQuota).toBe(true);
        }

        const ids = [a, b, c, d, e, replacing, g, h];
        const versions = new Map<string, number>();
        for (const id of ids) versions.set(id, await currentVersion(f, id));
        const items = ids.map(id => ({ noteId: id, version: versions.get(id)! }));
        const oneCall = await f.check.checkNotes(f.ctx(), { items });
        expect(oneCall.status).toBe('ready');
        if (oneCall.status !== 'ready') return;
        const separate: typeof oneCall.value = [];
        for (const item of items) {
          const single = await f.check.checkNotes(f.ctx(), { items: [item] });
          expect(single.status).toBe('ready');
          if (single.status !== 'ready') return;
          separate.push(single.value[0]!);
        }
        expect(oneCall.value).toEqual(separate);
        const checked = new Map(oneCall.value.map(item => [item.noteId, item]));
        for (const id of [a, b, c, d, replacing, g, h]) {
          expect(checked.get(id)!.conflicting).toBe([a, b, c, d].includes(id));
          expect(checked.get(id)!.overQuota).toBe(true);
        }
        // The superseded note is neither conflicting nor over quota.
        expect(checked.get(e)!.conflicting).toBe(false);
        expect(checked.get(e)!.overQuota).toBe(false);
      } finally { await f.close(); }
    });
});

describe('SP-2 stale by goal with a small goalQuota', () => {
  it.each(['memory', 'sqlite'] as const)(
    'SP-2 %s: memoryStale by goal reports overQuota for the counted goal heads', async kind => {
      const f = await createS4BNoteCheckFixture(kind, { goalQuota: 2 });
      try {
        const ids = [
          await write(f, draft({ topic: 'stale-one', basisFiles: ['src/a/x.ts'] }), 's4a-goal'),
          await write(f, draft({ topic: 'stale-two', basisFiles: ['src/a/x.ts'] }), 's4a-goal'),
          await write(f, draft({ topic: 'stale-three', basisFiles: ['src/a/x.ts'] }), 's4a-goal'),
        ];
        // Change the observed file after all three writes so every note is stale.
        await writeFile(join(f.root, 'src/a/x.ts'), 'export const a = 9;\n');
        const read = await f.memory.memoryStale(f.ctx(), { v: 1, op: 'stale', goalId: 's4a-goal',
          limit: 20, cursor: null });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect([...read.value.items.map(item => item.noteId)].sort()).toEqual([...ids].sort());
        for (const item of read.value.items) {
          expect(item.freshness).toBe('stale');
          expect(item.staleReasons).toContain('file_changed');
          // goalQuota 2 with three counted heads: every head is over quota.
          expect(item.overQuota).toBe(true);
        }
      } finally { await f.close(); }
    });
});

describe('SP-3 module definition changed between two notes', () => {
  it.each(['memory', 'sqlite'] as const)(
    'SP-3 %s: only the note written before the catalog revision is module_definition_changed', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const older = await write(f, draft({ topic: 'module-old', anchor: { kind: 'module', moduleId: 'A1' } }));
        await reviseCatalog(f, catalog => ({ ...catalog,
          modules: catalog.modules.map(module => module.ref.moduleId === 'A1'
            ? { ...module, responsibility: 'area A1 changed' } : module) }));
        const newer = await write(f, draft({ topic: 'module-new', anchor: { kind: 'module', moduleId: 'A1' } }));
        const checks = await f.check.checkNotes(f.ctx(), { items: [
          { noteId: older, version: 1 }, { noteId: newer, version: 1 }] });
        expect(checks.status).toBe('ready');
        if (checks.status !== 'ready') return;
        expect(checks.value[0]!.freshness).toBe('stale');
        expect(checks.value[0]!.staleReasons).toContain('module_definition_changed');
        expect(checks.value[1]!.freshness).toBe('fresh');
        expect(checks.value[1]!.staleReasons).not.toContain('module_definition_changed');
      } finally { await f.close(); }
    });
});

describe('SP-4 two agent files, two module scopes', () => {
  it.each(['memory', 'sqlite'] as const)(
    'SP-4 %s: only the note outside its Run task scope gets file_module_mismatch', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      const multi = await createS4BMultiScope(f);
      try {
        const revised = await multi.revisePlan(f.inner.goalRef, ({ stages, tasks }) => ({ stages,
          tasks: tasks.map(task => task.taskId === 't1'
            ? { ...task, scope: { kind: 'module' as const, stageId: 's1', moduleRef: 'A' } }
            : task.taskId === 't2'
              ? { ...task, scope: { kind: 'module' as const, stageId: 's1', moduleRef: 'B' } }
              : task) }));
        const runA = await multi.claimRunFor({ suffix: 'sp4-a', taskId: 't1',
          goalRef: f.inner.goalRef, planRef: revised.ref });
        const runB = await multi.claimRunFor({ suffix: 'sp4-b', taskId: 't2',
          goalRef: f.inner.goalRef, planRef: revised.ref });
        const inside = await writeAgent(f, runA, draft({ topic: 'in-scope',
          anchor: { kind: 'file', path: 'src/a/x.ts' } }), 's4a-goal');
        const outside = await writeAgent(f, runB, draft({ topic: 'out-scope',
          anchor: { kind: 'file', path: 'src/a/x.ts' } }), 's4a-goal');
        const checks = await f.check.checkNotes(f.ctx(), { items: [
          { noteId: inside, version: 1 }, { noteId: outside, version: 1 }] });
        expect(checks.status).toBe('ready');
        if (checks.status !== 'ready') return;
        expect(checks.value[0]!.hints).toEqual([]);
        expect(checks.value[1]!.hints).toEqual(['file_module_mismatch']);
      } finally { await multi.close(); }
    });
});

describe('SP-5 stage removed in one goal only', () => {
  it.each(['memory', 'sqlite'] as const)(
    'SP-5 %s: only the removed-stage note is stage_not_in_current_plan', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      const multi = await createS4BMultiScope(f);
      try {
        const onGoal1 = await f.inner.write(f.ctx(),
          draft({ topic: 'stage-g1', anchor: { kind: 'stage', goalId: 's4a-goal', stageId: 's1' } }), 's4a-goal');
        const onGoal2 = await f.inner.write(f.ctx(),
          draft({ topic: 'stage-g2', anchor: { kind: 'stage', goalId: 's4b-goal-2', stageId: 's2' } }), 's4b-goal-2');
        if (onGoal1.status === 'rejected') throw new Error(JSON.stringify(onGoal1));
        if (onGoal2.status === 'rejected') throw new Error(JSON.stringify(onGoal2));
        // Goal 1 loses s1; goal 2 keeps s2.
        await multi.revisePlan(f.inner.goalRef, ({ tasks }) => ({
          stages: [{ stageId: 's2', title: 'Stage two' }],
          tasks: tasks.map(task => task.taskKind === 'work' ? { ...task, stageId: 's2' } : task) }));
        const checks = await f.check.checkNotes(f.ctx(), { items: [
          { noteId: onGoal1.noteId, version: 1 }, { noteId: onGoal2.noteId, version: 1 }] });
        expect(checks.status).toBe('ready');
        if (checks.status !== 'ready') return;
        expect(checks.value[0]!.anchorStatus).toBe('retired');
        expect(checks.value[0]!.anchorRetiredReasons).toEqual(['stage_not_in_current_plan']);
        expect(checks.value[1]!.anchorStatus).toBe('live');
        expect(checks.value[1]!.anchorRetiredReasons).toEqual([]);
      } finally { await multi.close(); }
    });
});
