/**
 * Slice 4B G2 — M-15 anchor status. Catalog revisions go through the real
 * `platform.architecture.reviseArchitectureCatalog`; symbol anchors are written
 * through the real 4A writer (which builds a real capture) and re-read after the
 * real workspace file changes. Assertions go only through the public reads and
 * the real `checkNotes`.
 */
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CatalogRepairOpV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { NoteScribeTodosV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';
import { bindCatalogRevision, catalogRevisionModule } from '../helpers/S8C-catalog-world.js';
const catalogMock = vi.hoisted(() => ({ actual: null as null | Record<string, unknown>,
  revision: null as null | Record<string, unknown> }));
vi.mock('../../src/core/work-graph/architecture/catalog-service.js', async importOriginal => {
  const actual = await importOriginal() as Record<string, unknown>;
  catalogMock.actual = actual;
  return { ...actual, createArchitectureCatalogService: (stores: unknown) => {
    if (catalogMock.revision === null) throw new Error('the catalog revision factory is not bound');
    return (catalogMock.revision['createArchitectureCatalogService'] as (stores: unknown) => unknown)(stores);
  } };
});
beforeAll(async () => { catalogMock.revision = await catalogRevisionModule(async () => catalogMock.actual!); });

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'anchors', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeNote(f: S4BNoteCheckFixture, note: NoteDraftV1, goalId: string | null = null): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, goalId);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

async function reviseCatalog(f: S4BNoteCheckFixture, ops: CatalogRepairOpV1[]): Promise<number> {
  const ctx = f.ctx();
  const current = await f.inner.platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
  if (current.status !== 'ready' || current.value.catalog === null) throw new Error('catalog read failed');
  const revised = await f.inner.platform.architecture.reviseArchitectureCatalog(ctx, {
    meta: { requestId: 's4b-m15-catalog-revise', expected: [{ ref: f.inner.projectRef, revision: 1 }, { ref: f.inner.workspaceRef, revision: 1 }] },
    input: {
      expected: { catalogRef: current.value.catalog.ref,
        baseline: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest } },
      ops, responsibilityMoves: [], reason: 's4b M-15 catalog revision' } });
  if (revised.status !== 'committed') throw new Error(`revise failed: ${JSON.stringify(revised)}`);
  return revised.value.catalog.ref.revision;
}

/** The package's §2 member read through a local intersection; absent today, so the rows fail on `undefined`. */
type RemovedTodo = { identity: string; anchorKey: string; noteId: string; version: number };
type TodosWithRemoved = NoteScribeTodosV1 & { moduleRemoved: readonly RemovedTodo[] };
async function removedTodos(f: S4BNoteCheckFixture): Promise<readonly RemovedTodo[]> {
  const read = await f.inner.platform.notes.readScribeTodos(f.ctx(), { goalIds: [f.inner.goalRef.goalId] });
  if (read.status !== 'ready') throw new Error(`readScribeTodos: ${JSON.stringify(read)}`);
  return (read.value.find(entry => entry.goalId === f.inner.goalRef.goalId)! as TodosWithRemoved).moduleRemoved;
}
const writers = new WeakMap<S4BNoteCheckFixture, ReturnType<S4BNoteCheckFixture['inner']['workCtx']>>();
let mdnRuns = 0;
async function agentWriter(f: S4BNoteCheckFixture) {
  const known = writers.get(f);
  if (known !== undefined) return known;
  const writer = f.inner.workCtx(await f.inner.claimRun(`mdn-${++mdnRuns}`));
  writers.set(f, writer);
  return writer;
}
async function writeAsAgent(f: S4BNoteCheckFixture, note: NoteDraftV1, goalId: string | null = null) {
  const written = await f.inner.write(await agentWriter(f), note, goalId);
  if (written.status !== 'accepted') throw new Error(`write: ${JSON.stringify(written)}`);
  return { noteId: written.noteId, version: written.version };
}
/** A person deletes the module file; `consistent` also drops it from `architecture.json`. */
async function deleteModule(f: S4BNoteCheckFixture, moduleId: string, consistent: boolean): Promise<void> {
  const directory = join(f.root, '.workbench/modules');
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    if ((JSON.parse(await readFile(path, 'utf8')) as { id?: string }).id === moduleId) await rm(path);
  }
  if (!consistent) return;
  const index = join(f.root, '.workbench/architecture.json');
  const file = JSON.parse(await readFile(index, 'utf8')) as { modules: string[] };
  await writeFile(index, `${JSON.stringify({ ...file, modules: file.modules.filter(id => id !== moduleId) }, null, 2)}\n`);
}

async function revisePlan(f: S4BNoteCheckFixture, mutate: (tasks: PlanRevisionDraft['tasks']) => PlanRevisionDraft['tasks']): Promise<void> {
  const ctx = f.ctx();
  const source = f.inner.plan;
  const before = await f.inner.platform.plans.queryGoal(ctx, f.inner.goalRef);
  if (before.status !== 'ready') throw new Error('goal read failed');
  const draftV2: PlanRevisionDraft = {
    schemaVersion: 2, planId: 's4a-plan-2', planRevision: source.planRevision + 1,
    goalId: source.goalRef.goalId, stages: structuredClone(source.stages), tasks: structuredClone(mutate(source.tasks)),
    assignments: structuredClone(source.assignments ?? []), obligations: structuredClone(source.obligations),
    taskHierarchy: structuredClone(source.taskHierarchy), executionDag: structuredClone(source.executionDag),
    taskRelations: [], inputRequirements: [],
  };
  const proposed = await f.inner.platform.plans.proposePlan(ctx, {
    meta: { requestId: `s4b-m15-revise-${source.planRevision}`, expected: [{ ref: f.inner.goalRef, revision: before.value.goal.revision }] },
    input: { goalRef: f.inner.goalRef, basedOn: source.ref, reason: { text: 's4b M-15 revise', sources: [] }, draft: draftV2 } });
  if (proposed.status !== 'committed') throw new Error(`propose failed: ${JSON.stringify(proposed)}`);
  const after = await f.inner.platform.plans.queryGoal(ctx, f.inner.goalRef);
  if (after.status !== 'ready') throw new Error('goal re-read failed');
  const applied = await f.inner.platform.plans.applyPlanChange(ctx, {
    meta: { requestId: `s4b-m15-apply-${source.planRevision}`, expected: [{ ref: f.inner.goalRef, revision: after.value.goal.revision }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`apply failed: ${JSON.stringify(applied)}`);
}

describe('S4B M-15 anchor status', () => {
  it.each(['memory', 'sqlite'] as const)('M-15 %s: a module removed from the current catalog retires the note', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'module', moduleId: 'B' } }));
      await reviseCatalog(f, [{ op: 'remove_module', moduleId: 'B' }]);
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('retired');
      expect(read.value.anchorRetiredReasons).toEqual(['module_removed']);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: an interface removed from the current catalog retires the note', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'interface', moduleId: 'A', interfaceId: 'I1' } }));
      await reviseCatalog(f, [{ op: 'remove_interface', moduleId: 'A', interfaceId: 'I1' }]);
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('retired');
      expect(read.value.anchorRetiredReasons).toEqual(['interface_removed']);
      expect(read.value.currentEligible).toBe(false);
      // L23: history is still readable.
      const historical = await f.notes.readNote(f.ctx(), { noteId, version: 1 });
      expect(historical.status).toBe('ready');
      if (historical.status !== 'ready') return;
      expect(historical.value.storedState).toBe('accepted');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: a retired extra anchor is listed while the live main anchor keeps the note live', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'module', moduleId: 'A' },
        extraAnchors: [{ kind: 'interface', moduleId: 'A', interfaceId: 'I1' }] }));
      await reviseCatalog(f, [{ op: 'remove_interface', moduleId: 'A', interfaceId: 'I1' }]);
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('live');
      expect(read.value.retiredExtraAnchors).toEqual(['interface:A/I1']);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: a task cancelled by an adopted plan revision retires the note for task_ended', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'task', goalId: 's4a-goal', taskId: 't1' } }), 's4a-goal');
      await revisePlan(f, tasks => tasks.map(task => task.taskId === 't1'
        ? { ...task, disposition: 'cancelled' } : task));
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorRetiredReasons).toEqual(['task_ended']);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: a symbol that no longer resolves retires the note for symbol_missing', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'file', path: 'src/a/x.ts',
        symbolRequest: { language: 'typescript', name: 'a' } } }));
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const renamed = 1;\n');
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('retired');
      expect(read.value.anchorRetiredReasons).toContain('symbol_missing');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: a spent single-file parse budget (files) leaves the later item unchecked', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { check: { symbolRecheckMax: 1 } });
    try {
      const first = await writeNote(f, draft({ topic: 's1', anchor: { kind: 'file', path: 'src/a/x.ts',
        symbolRequest: { language: 'typescript', name: 'a' } } }));
      const second = await writeNote(f, draft({ topic: 's2', anchor: { kind: 'file', path: 'src/a/one/x.ts',
        symbolRequest: { language: 'typescript', name: 'one' } } }));
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const renamed = 1;\n');
      await writeFile(join(f.root, 'src/a/one/x.ts'), 'export const renamedOne = 1;\n');
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId: first, version: 1 }, { noteId: second, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[1]!.freshness).toBe('unchecked');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: a target symbol after 20 other symbols still resolves (no false symbol_missing)', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const declarations = Array.from({ length: 30 }, (_, index) => `export const s${index} = ${index};`);
      const path = join(f.root, 'src/a/many.ts');
      await writeFile(path, `${declarations.join('\n')}\n`);
      const noteId = await writeNote(f, draft({ anchor: { kind: 'file', path: 'src/a/many.ts',
        symbolRequest: { language: 'typescript', name: 's25' } } }));
      // R4: a line inserted above the target shifts its stored line range; the
      // recheck matches by name only, so the unchanged symbol stays live.
      await writeFile(path, `// shifted\nexport const s0 = 100;\n${declarations.slice(1).join('\n')}\n`);
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorRetiredReasons).toEqual([]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: a symbol recheck consumes the distinct-file read budget', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { check: { symbolRecheckMax: 20, readFilesMax: 1 } });
    try {
      const first = await writeNote(f, draft({ topic: 'budget1', anchor: { kind: 'file', path: 'src/a/x.ts',
        symbolRequest: { language: 'typescript', name: 'a' } } }));
      const second = await writeNote(f, draft({ topic: 'budget2', anchor: { kind: 'file', path: 'src/a/one/x.ts',
        symbolRequest: { language: 'typescript', name: 'one' } } }));
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const renamed = 1;\n');
      await writeFile(join(f.root, 'src/a/one/x.ts'), 'export const renamedOne = 1;\n');
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId: first, version: 1 }, { noteId: second, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[1]!.freshness).toBe('unchecked');
    } finally { await f.close(); }
  });
});

// DMDN (121-88, lead 11-13 §9): module-removed to-dos, all through `notes.*`/`readScribeTodos`;
// the note is written by a real executor Run, so `confirmedByUser` is false (§9 Q4).
async function mdnFixture(): Promise<S4BNoteCheckFixture> {
  const f = await createS4BNoteCheckFixture('memory'); bindCatalogRevision(f.inner.platform, f.inner.scope); return f;
}

// Today red at the last line (moduleRemoved is undefined); the withdraw/history half is green today; green after the package.
it('DMDN-3 a withdraw whose reason names the deleting revision leaves the module-removed list empty', async () => {
  const f = await mdnFixture();
  try {
    const original = await writeAsAgent(f, draft({ topic: 'dmdn-3', anchor: { kind: 'module', moduleId: 'B' } }));
    const revision = await reviseCatalog(f, [{ op: 'remove_module', moduleId: 'B' }]);
    expect(await f.inner.platform.notes.withdrawNote(f.ctx(), { commandId: 'dmdn-3', noteId: original.noteId,
      expectedVersion: original.version, reason: `撤下：修订 ${String(revision)} 删除了模块 B` }))
      .toMatchObject({ status: 'done', state: 'withdrawn', version: 2 });
    const history = await f.inner.platform.notes.memoryHistory(f.ctx(), { v: 1, op: 'history',
      noteId: original.noteId, limit: 10, cursor: null });
    expect(history.status).toBe('ready'); if (history.status !== 'ready') return;
    expect(history.value.items[0]!.storedState).toBe('withdrawn');
    expect(history.value.items[0]!.change.reason).toContain(String(revision));
    expect(await removedTodos(f)).toEqual([]);
  } finally { await f.close(); }
});

// Today green: the dead module refuses the write; stays green after the package.
it('DMDN-4 a note cannot be written on a module the current catalog no longer has', async () => {
  const f = await mdnFixture();
  try {
    await writeAsAgent(f, draft({ topic: 'dmdn-4', anchor: { kind: 'module', moduleId: 'B' } }));
    await reviseCatalog(f, [{ op: 'remove_module', moduleId: 'B' }]);
    expect(await f.inner.write(await agentWriter(f), draft({ topic: 'dmdn-4-again', anchor: { kind: 'module', moduleId: 'B' } }), null))
      .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'anchor_not_found' });
  } finally { await f.close(); }
});

// Today red at the last line (moduleRemoved is undefined); both new notes' anchors and bodies read green today.
it('DMDN-5 the two scribe routes write replacement and obsolete notes on live anchors and empty the to-do', async () => {
  const f = await mdnFixture();
  try {
    const original = await writeAsAgent(f, draft({ topic: 'dmdn-5-original', anchor: { kind: 'module', moduleId: 'B' } }));
    const revision = await reviseCatalog(f, [{ op: 'remove_module', moduleId: 'B' }]);
    const replacement = await writeAsAgent(f, draft({ topic: 'dmdn-5-replacement', body: `替代 ${original.noteId}`,
      anchor: { kind: 'module', moduleId: 'A' } }));
    await f.inner.platform.notes.withdrawNote(f.ctx(), { commandId: 'dmdn-5', noteId: original.noteId,
      expectedVersion: original.version, reason: `修订 ${String(revision)}：由 ${replacement.noteId} 替代` });
    const obsolete = await writeAsAgent(f, draft({ kind: 'decision', topic: 'dmdn-5-obsolete',
      body: `作废：修订 ${String(revision)}，原注记 ${original.noteId}`,
      anchor: { kind: 'goal', goalId: f.inner.goalRef.goalId } }), f.inner.goalRef.goalId);
    const bodyOf = async (anchor: { kind: 'module'; moduleId: string } | { kind: 'goal'; goalId: string }, noteId: string, version: number) => {
      const read = await f.inner.platform.notes.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor,
        body: { noteId, version, cursor: null }, limit: 10, cursor: null });
      expect(read.status).toBe('ready'); if (read.status !== 'ready') return '';
      return read.value.items.find(item => item.noteId === noteId)?.body?.text ?? '';
    };
    expect(await bodyOf({ kind: 'module', moduleId: 'A' }, replacement.noteId, replacement.version)).toContain(original.noteId);
    const obsoleteBody = await bodyOf({ kind: 'goal', goalId: f.inner.goalRef.goalId }, obsolete.noteId, obsolete.version);
    expect(obsoleteBody).toContain(String(revision));
    expect(obsoleteBody).toContain(original.noteId);
    expect(await removedTodos(f)).toEqual([]);
  } finally { await f.close(); }
});

// Today red on the consistent deletion (moduleRemoved is undefined); the half-delete notes/list half is green today.
it('DMDN-6 a consistent file deletion is a module removal; a half deletion is unavailable, never empty', async () => {
  const consistent = await mdnFixture();
  try {
    const original = await writeAsAgent(consistent, draft({ topic: 'dmdn-6', anchor: { kind: 'module', moduleId: 'B' } }));
    await deleteModule(consistent, 'B', true);
    expect(await removedTodos(consistent)).toEqual([{ identity: `${original.noteId}@1`, anchorKey: 'module:B',
      noteId: original.noteId, version: 1 }]);
  } finally { await consistent.close(); }
  const half = await mdnFixture();
  try {
    await writeAsAgent(half, draft({ topic: 'dmdn-6-half', anchor: { kind: 'module', moduleId: 'B' } }));
    await deleteModule(half, 'B', false);
    const todos = await half.inner.platform.notes.readScribeTodos(half.ctx(), { goalIds: [half.inner.goalRef.goalId] });
    expect(todos.status).toBe('rejected'); if (todos.status !== 'rejected') return;
    expect(todos.code).toBe('unavailable');
    const listed = await half.inner.platform.notes.listNotes(half.ctx(), { anchor: { kind: 'module', moduleId: 'B' },
      limit: 10, cursor: null });
    expect(listed.status).toBe('rejected'); if (listed.status !== 'rejected') return;
    expect(listed.code).toBe('unavailable');
  } finally { await half.close(); }
});

// Today red: moduleRemoved is undefined; green after the package joins interface_removed with the module gone.
// lead 11-13 (mdn §9 item 7): `interface_removed` with the module gone is the same class.
it('DMDN-7 an interface anchor whose module is removed joins the module-removed list', async () => {
  const f = await mdnFixture();
  try {
    const original = await writeAsAgent(f, draft({ topic: 'dmdn-7',
      anchor: { kind: 'interface', moduleId: 'A', interfaceId: 'I1' } }));
    await reviseCatalog(f, [{ op: 'remove_module', moduleId: 'A' }]);
    expect(await removedTodos(f)).toEqual([{ identity: `${original.noteId}@1`, anchorKey: 'interface:A/I1',
      noteId: original.noteId, version: 1 }]);
  } finally { await f.close(); }
});
