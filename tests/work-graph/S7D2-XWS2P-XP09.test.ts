/**
 * XWS2P XP-09 — the round-three path fixes: a stored path is resolved to its
 * own workspace before any comparison, a request path is qualified first, and
 * attribution is computed on one workspace's projection.
 *
 * Each row is one item of `RVs5.out.md`'s "P" section; the named mutation in
 * each header restores the mixed form and must make that row red.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdoptedArchitecture } from '../../src/contracts/architecture-catalog.js';
import type { CatalogRepairOpV1, LinkDraftV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { RunActivitySnapshot } from '../../src/contracts/run-activity.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import { footprintProblem } from '../../src/core/work-graph/notes/activate-repair.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';
import {
  addXWS2PSecondModule, openXWS2PWorld, readXWS2PCatalog, readXWS2PNote, writeXWS2PNote, xws2pProjectPath,
  type XWS2PWorld,
} from '../helpers/XWS2P-world.js';

const WORLDS: XWS2PWorld[] = [];
afterEach(async () => { await Promise.allSettled(WORLDS.splice(0).map(world => world.close())); });

const P = 's8c-footprint';
const ref = (moduleId: string) => ({ projectId: P, moduleId });

/** The W-A catalog, projected to the Run's workspace: one module owning `src`. */
function runCatalog(): AdoptedArchitecture {
  return { requireDag: true, dependencies: [], modules: [{ ref: ref('M'), name: 'M', responsibility: 'M',
    paths: ['src'], interfaces: [] }] };
}

/** A counted activity whose definite changed files are the Run workspace's relative paths. */
function counted(definite: string[]): RunActivitySnapshot {
  return { ref: { aggregateType: 'RunActivity', projectId: P, goalId: 'g', runId: 'r' }, revision: 1, schemaVersion: 1,
    runRef: { aggregateType: 'Run', projectId: P, goalId: 'g', runId: 'r' }, taskId: 't1', workspaceId: 'ws/2',
    sessionRef: null, runEndedAt: 'T', recordedBy: 'run_end', recordedAt: 'T',
    facts: { status: 'counted', ruleVersion: 1,
      window: { kernelRunId: 'k', kernelTurnId: 'u', fromPosition: 1, throughPosition: 2, bound: 'end_position',
        turnTerminal: true, unresolvedCalls: 0, turnStartedAt: 'T', lastRecordAt: 'T' },
      quarters: [], overflow: null, totals: { steps: 0, edits: 0, editsUnknown: 0 },
      changedFiles: { definite, possible: [], definiteOmitted: 0, possibleOmitted: 0,
        possiblyIncomplete: false, incompleteBecause: [] },
      changedLines: { added: 0, deleted: 0, complete: true },
      usage: { requests: [], omitted: 0, totals: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, complete: true } },
    span: { firstAt: null, lastAt: 'T', basis: 'run_times' } };
}

const setM: CatalogRepairOpV1 = { op: 'set_responsibility', moduleId: 'M', text: 'repair' };

const linkDraft = (topic: string, path: string): LinkDraftV1 => ({
  kind: 'link', topic, conclusion: `${topic} conclusion`, body: '',
  anchor: { kind: 'file', path }, extraAnchors: [{ kind: 'module', moduleId: 'second-mod' }],
  facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
  link: { relation: 'spawns', key: { kind: 'literal', text: 'a' },
    evidence: [{ role: 'launch', at: { path } }, { role: 'entry', at: { path } }] },
});

/** A main-workspace root module `"."`: the path that must not swallow a second-workspace file. */
async function addMainRootModule(world: XWS2PWorld): Promise<void> {
  const current = readyValue<ArchitectureRevision>(await world.world.dispatch('architecture/read', world.main.ctx,
    plain(world.main.scope, { selection: { kind: 'current' } })), 'the current architecture');
  const registration = readyValue<{ project: { revision: number }; workspace: { revision: number } }>(
    await world.world.dispatch('workspaces/registration', world.main.ctx,
      plain(world.main.scope, world.main.scope)), 'the main workspace registration');
  const committed = await world.world.dispatch('architecture/revise', world.main.ctx,
    graphWrite(world.main.scope, {
      expected: { catalogRef: current.catalog.ref,
        baseline: { ref: current.baseline.ref, digest: current.baseline.contentDigest } },
      ops: [{ op: 'add_module', module: {
        ref: { projectId: world.main.scope.projectId, moduleId: 'root-mod' },
        name: 'root-mod', responsibility: 'the main workspace root', paths: ['.'], interfaces: [],
      } }],
      responsibilityMoves: [], reason: 'XP-09 main root module',
    }, 'xp09-main-root', [
      { ref: { aggregateType: 'Project', projectId: world.main.scope.projectId }, revision: registration.project.revision },
      { ref: { aggregateType: 'Workspace', ...world.main.scope }, revision: registration.workspace.revision },
    ]));
  expect(committed).toMatchObject({ status: 'committed' });
}

describe('XP-09 round-three path fixes', () => {
  it('XP-09a a repair footprint resolves a stored op in its own workspace', () => {
    // Named mutation (`activate-repair.ts` `repairPathProblem`): compare the raw
    // `normalizePath(op.path)` with the Run-relative changed files -> outside.
    const result = footprintProblem({ activity: counted(['src/a.ts']), catalog: runCatalog(), declared: [ref('M')],
      observation: new Set(['src/a.ts']),
      ops: [{ op: 'add_path', moduleId: 'M', path: '/@ws:ws%2F2/src/a.ts' }],
      workspaceId: 'ws/2', mainWorkspaceId: 'ws1', approval: null });
    expect(result).toBeNull();
  });

  it('XP-09b a flow compares its request anchors after the same qualification as its links', async () => {
    // Named mutation (`note-service.ts` flow check): compare `draft.anchor` /
    // `draft.extraAnchors` unqualified -> flow_anchor_mismatch.
    const world = await openXWS2PWorld();
    WORLDS.push(world);
    expect(await addXWS2PSecondModule(world, { moduleId: 'second-mod', name: 'second-mod', summary: 'second' }))
      .toMatchObject({ status: 'committed' });
    const first = await writeXWS2PNote(world, world.second, linkDraft('xp09-flow-a', 'src/a.ts'), 'xp09-flow-a');
    const second = await writeXWS2PNote(world, world.second, linkDraft('xp09-flow-b', 'src/a.ts'), 'xp09-flow-b');
    expect(first.write).toMatchObject({ status: 'accepted' });
    expect(second.write).toMatchObject({ status: 'accepted' });
    if (first.write.status === 'rejected' || second.write.status === 'rejected') return;
    const flow: NoteDraftV1 = {
      kind: 'flow', topic: 'xp09-flow', conclusion: 'the two links form a flow', body: '',
      anchor: { kind: 'file', path: 'src/a.ts' },
      extraAnchors: [{ kind: 'module', moduleId: 'second-mod' }],
      facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
      flow: { steps: [{ link: first.write.noteId }, { link: second.write.noteId }] },
    };
    const written = await writeXWS2PNote(world, world.second, flow, 'xp09-flow');
    expect(written.write).toMatchObject({ status: 'accepted' });
  });

  it('XP-09c a symbol key keeps the key anchor own workspace, not the first endpoint', async () => {
    // Named mutation (`link-evidence.ts` key branches): `qualifyProjectPath(linkWorkspaceId, path, main)`
    // re-qualifies the ws/2 key with the ws1 first endpoint -> the stored key is bare `src/a.ts`.
    const world = await openXWS2PWorld();
    WORLDS.push(world);
    expect(await addXWS2PSecondModule(world, { moduleId: 'second-mod', name: 'second-mod', summary: 'second' }))
      .toMatchObject({ status: 'committed' });
    const keyPath = xws2pProjectPath(world.second.scope.workspaceId, 'src/a.ts');
    const draft: LinkDraftV1 = {
      kind: 'link', topic: 'xp09-key', conclusion: 'the key is a second-workspace symbol', body: '',
      anchor: { kind: 'file', path: 'src/a.ts' },
      extraAnchors: [{ kind: 'file', path: keyPath, symbolRequest: { language: 'typescript', name: 'a' } }],
      facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
      link: { relation: 'calls',
        key: { kind: 'symbol', anchor: { kind: 'file', path: keyPath,
          symbolRequest: { language: 'typescript', name: 'a' } } },
        evidence: [{ role: 'register', at: { path: 'src/a.ts' } },
          { role: 'use', at: { path: 'src/a.ts' } }] },
    };
    const written = await writeXWS2PNote(world, world.main, draft, 'xp09-key');
    expect(written.write).toMatchObject({ status: 'accepted' });
    if (written.write.status === 'rejected') return;
    const read = await readXWS2PNote(world, world.main, written.write.noteId);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.kind).toBe('link');
    expect(read.value.link?.key).toMatchObject({ kind: 'symbol', path: keyPath });
  });

  it('XP-09d the analyzer gets the stored path own workspace, never the caller and a prefix', async () => {
    // Named mutation (`note-views.ts` `sendNativeLookups`): call `lookup(ctx, {path: located.path})`
    // -> the ws/2 prefix is analysed in the ws1 root, the recheck is unchecked.
    const world = await openXWS2PWorld();
    WORLDS.push(world);
    await mkdir(join(world.second.root, 'tools'), { recursive: true });
    const file = join(world.second.root, 'tools/run.py');
    await writeFile(file, 'def main():\n    return 1\n', 'utf8');
    const note: NoteDraftV1 = {
      kind: 'convention', topic: 'xp09-native', conclusion: 'the python symbol is in ws/2', body: '',
      anchor: { kind: 'file', path: 'tools/run.py',
        symbolRequest: { language: 'python', name: 'main' } },
      extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
    };
    const written = await writeXWS2PNote(world, world.second, note, 'xp09-native');
    expect(written.write).toMatchObject({ status: 'accepted' });
    if (written.write.status === 'rejected') return;
    // Change the body, not the signature: the symbol is still `main`.
    await writeFile(file, 'def main():\n    return 2\n', 'utf8');
    const read = await readXWS2PNote(world, world.main, written.write.noteId);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.freshness).toBe('fresh');
    expect(read.value.anchorStatus).toBe('live');
    expect(read.value.observedFiles[0]?.outcome).toBe('changed');
  });

  it('XP-09e class-five attribution projects the anchor own workspace, so a root module cannot swallow it', async () => {
    // Named mutation (`note-views.ts` `classFiveHints`): attribute both anchors and
    // the basis file on the whole project catalog -> the ws/2 `other/b.ts` becomes
    // the main root's, and `basis_outside_anchor` disappears.
    const world = await openXWS2PWorld();
    WORLDS.push(world);
    expect(await addXWS2PSecondModule(world, { moduleId: 'second-mod', name: 'second-mod', summary: 'second' }))
      .toMatchObject({ status: 'committed' });
    await addMainRootModule(world);
    await mkdir(join(world.second.root, 'other'), { recursive: true });
    await writeFile(join(world.second.root, 'other/b.ts'), 'export const b = 2;\n', 'utf8');
    const note: NoteDraftV1 = {
      kind: 'convention', topic: 'xp09-hints', conclusion: 'the basis file is unowned here', body: '',
      anchor: { kind: 'file', path: 'src/a.ts' },
      extraAnchors: [{ kind: 'file', path: 'other/b.ts' }],
      facts: [], basisFiles: ['other/b.ts'], structural: false, replaces: [], contradicts: [], coexistWith: [],
    };
    const written = await writeXWS2PNote(world, world.second, note, 'xp09-hints');
    expect(written.write).toMatchObject({ status: 'accepted' });
    if (written.write.status === 'rejected') return;
    const read = await readXWS2PNote(world, world.main, written.write.noteId);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.hints).toContain('basis_outside_anchor');
  });

  it('XP-09f graph/look refuses an explicit main-workspace prefix', async () => {
    // Named mutation (`graph-context-reader.ts` `lookPathModules`): split the raw
    // path -> the main prefix is accepted and matches `s6a-core`.
    const world = await openXWS2PWorld();
    WORLDS.push(world);
    const mainPath = xws2pProjectPath(world.main.scope.workspaceId, 'src');
    const result = await world.world.dispatch('graph/look', world.main.ctx, plain(world.main.scope, {
      goalRef: null, target: { kind: 'path', path: mainPath }, relation: 'card',
      page: { afterCursor: null, limit: 100 },
    }));
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('XP-09g architecture find unions original-catalog names with the path workspace projection', async () => {
    // Named mutation (`architecture-service.ts` find + search index): project the
    // whole candidate set to the caller and strip the prefix -> `src` matches the
    // main workspace's `s6a-core`, not the requested ws/2's `second-mod`.
    const world = await openXWS2PWorld();
    WORLDS.push(world);
    expect(await addXWS2PSecondModule(world, { moduleId: 'second-mod', name: 'second-mod', summary: 'second' }))
      .toMatchObject({ status: 'committed' });
    const needle = xws2pProjectPath(world.second.scope.workspaceId, 'src');
    const raw = await world.world.dispatch('architecture/find', world.main.ctx,
      plain(world.main.scope, { needle, page: { afterCursor: null, limit: 100 } }));
    const result = raw as { status: string; value?: { items: { kind: string; nodeRef: { ref: { moduleId: string } } }[] } };
    expect(result.status).toBe('ready');
    if (result.status !== 'ready' || result.value === undefined) return;
    const modules = result.value.items
      .flatMap(item => item.kind === 'module' ? [item.nodeRef.ref.moduleId] : []);
    expect(modules).toEqual(['second-mod']);
  });

  it('XP-09h a repair footprint accepts the Run workspace root as a directory prefix', () => {
    // Named mutation (`activate-repair.ts` `repairPathProblem`): the round-three
    // `isSafeWorkspaceRelativePath(path)` gate rejects `.` before the directory
    // coverage check -> outside, although every observed file is definite.
    const result = footprintProblem({ activity: counted(['src/a.ts']), catalog: runCatalog(), declared: [ref('M')],
      observation: new Set(['src/a.ts']),
      ops: [{ op: 'add_path', moduleId: 'M', path: xws2pProjectPath('ws/2', '.') }],
      workspaceId: 'ws/2', mainWorkspaceId: 'ws1', approval: null });
    expect(result).toBeNull();
  });

  it('XP-09i architecture find attributes an observed file on its own workspace projection', async () => {
    // Named mutation (`architecture-service.ts` find + search index): pass the
    // original project catalog as the file candidates -> the ws/2 `src/a.ts` is
    // attributed to the main workspace's `src` module (`s6a-core`).
    const world = await openXWS2PWorld();
    WORLDS.push(world);
    expect(await addXWS2PSecondModule(world, { moduleId: 'second-mod', name: 'second-mod', summary: 'second' }))
      .toMatchObject({ status: 'committed' });
    const captured = await world.world.platform.architecture.captureSourceChanges(world.second.ctx, {
      input: { workspace: world.second.scope, mappings: [{ id: 'SRC', kind: 'module', paths: ['src'] }], previous: null },
      meta: { requestId: 'xp09-second-observation', expected: [] },
    });
    expect(captured).toMatchObject({ status: 'committed' });
    const raw = await world.world.dispatch('architecture/find', world.second.ctx,
      plain(world.second.scope, { needle: 'a.ts', page: { afterCursor: null, limit: 100 } }));
    const result = raw as { status: string; value?: {
      items: { kind: string; path?: string; module?: { ref: { moduleId: string } } }[] } };
    expect(result.status).toBe('ready');
    if (result.status !== 'ready' || result.value === undefined) return;
    const file = result.value.items.find(item => item.kind === 'file');
    expect(file).toMatchObject({ path: 'src/a.ts', module: { ref: { moduleId: 'second-mod' } } });
  });
});
