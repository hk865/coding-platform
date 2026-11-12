/**
 * KLS-2c-1b1 recovery items under the reconcile (kls-design §2.2.5 steps 6 and 9; [2C1-12], [2C1-13], [2C1-15]; the
 * split ruling's §7 `unconfirmed`; errata 2c1#8; the result's `reverted` is the round's new items). A person edits,
 * reverts and deletes knowledge files and the platform reconciles: a different content kept while the clock stands
 * still still gets its own snapshot, so its revert is a second notice; a path deleted after its revert notice, whose
 * recovery is the same snapshot, adds no item and counts none; a module file with a write recovery item that the
 * person deletes adds no revert item. The world is `openKLS2AWorld` (a real platform over a real git root); the
 * reconcile is the published `platform.knowledge.reconcile(ctx, workspaceId, 'idle')`, the notices are the decision
 * queue's. Memory only: business rules (S3); the snapshot store is one implementation on both backends.
 */
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { ReconcileResult } from '../../src/contracts/knowledge.js';
import type { NoteAnchorV1 } from '../../src/contracts/note.js';
import { openKLS2AWorld, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';
import { noteFileText } from '../helpers/KLS2C-knowledge-host.js';
import { gitIn } from '../scenarios/support/git-workspace.js';

const CORE: NoteAnchorV1 = { kind: 'module', moduleId: 'core' };
const NOTE_ID = '1a2b3c4d5e6f708192a3b4c5d6e7f809';
/** An injected clock that never moves. */
const STILL_AT = '2026-11-12T00:00:00.000Z';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function recoveryWorld(now?: () => string): Promise<KLS2AWorld> {
  const world = await openKLS2AWorld({ storage: 'memory', ...(now === undefined ? {} : { platform: { now } }) });
  closers.push(() => world.close());
  return world;
}

async function recoveryAdoptCore(world: KLS2AWorld): Promise<void> {
  const adopted = await world.platform.architecture.adoptInitialArchitecture(world.ctx(), {
    meta: { requestId: 'kls2c1b1-adopt', expected: await world.scopePins() },
    input: { baselineId: 'kls2c1b1-baseline', description: 'd', constraints: [], catalog: { requireDag: true, dependencies: [],
      modules: [{ ref: { projectId: world.projectId, moduleId: 'core' }, name: 'core', responsibility: 'own core',
        paths: ['src/core'], interfaces: [] }] } } });
  expect(adopted, JSON.stringify(adopted)).toMatchObject({ status: 'committed' });
}

/** The workspace's idle reconcile; anything but `ready` fails the row with its body. */
async function reconciledOnce(world: KLS2AWorld): Promise<ReconcileResult> {
  const answer = await world.platform.knowledge.reconcile(world.ctx(), world.workspaceId, 'idle');
  if (answer.status !== 'ready') throw new Error(`the reconcile is not ready: ${JSON.stringify(answer)}`);
  return answer.value;
}

/** The summaries of the decision queue's project notices. */
async function noticeSummaries(world: KLS2AWorld): Promise<string[]> {
  const read = await world.platform.decisions.queryDecisionQueue(world.ctx(), {
    workspace: { projectId: world.projectId, workspaceId: world.workspaceId }, sections: ['notices'],
    categories: ['project_notice'], page: { limit: 50 } });
  if (read.status !== 'ready') throw new Error(`decision queue: ${JSON.stringify(read)}`);
  return read.value.notices.map(notice => notice.summary);
}

/** A teammate's note file on `module:core` whose conclusion is `conclusion`. */
const teammateNote = (conclusion: string): string => noteFileText({ kind: 'convention', topic: 'b1 撤回',
  conclusion, body: 'b1 正文', anchor: CORE, source: { kind: 'user', principalId: 'teammate' } });

/** The note file committed as HEAD's `v0` and taken in by one reconcile; its root-relative path. */
async function committedNoteV0(world: KLS2AWorld): Promise<string> {
  const path = `.workbench/notes/${world.workspaceId}/${NOTE_ID}.md`;
  mkdirSync(join(world.root, '.workbench/notes', world.workspaceId), { recursive: true });
  world.edit(path, teammateNote('v0'));
  gitIn(world.root, 'add', '--', path);
  gitIn(world.root, 'commit', '-q', '-m', 'b1 note v0');
  await reconciledOnce(world);
  return path;
}

it('a clock that stands still: B is kept beside A, so reverting B is a second revert notice', async () => {
  const world = await recoveryWorld(() => STILL_AT);
  await recoveryAdoptCore(world);
  const path = await committedNoteV0(world);
  world.edit(path, teammateNote('A'));
  await reconciledOnce(world);
  gitIn(world.root, 'checkout', '--', path);
  await reconciledOnce(world);
  expect(await noticeSummaries(world)).toEqual(['架构图和注记被撤回了 1 处']);

  world.edit(path, teammateNote('B'));
  await reconciledOnce(world);
  gitIn(world.root, 'checkout', '--', path);
  const second = await reconciledOnce(world);
  expect(await noticeSummaries(world)).toEqual(['架构图和注记被撤回了 1 处', '架构图和注记被撤回了 1 处']);
  expect(second.reverted).toBe(1);
});

it('a file deleted after its revert notice, whose recovery is the same snapshot: no new item, reverted 0, one notice', async () => {
  const world = await recoveryWorld();
  await recoveryAdoptCore(world);
  const path = await committedNoteV0(world);
  world.edit(path, teammateNote('v1'));
  await reconciledOnce(world);
  gitIn(world.root, 'checkout', '--', path);
  expect((await reconciledOnce(world)).reverted).toBe(1);

  rmSync(join(world.root, path));
  const after = await reconciledOnce(world);
  expect(after.reverted).toBe(0);
  expect(await noticeSummaries(world)).toEqual(['架构图和注记被撤回了 1 处']);
});

it('a module file with a write recovery item that the person deletes: no revert item, no revert notice', async () => {
  const world = await recoveryWorld();
  await recoveryAdoptCore(world);
  const modules = join(world.root, '.workbench/modules');
  const [moduleFile] = world.files('.workbench/modules');
  if (moduleFile === undefined) throw new Error('the adoption wrote no module file');
  await reconciledOnce(world);
  const current = await world.platform.architecture.readArchitectureRevision(world.ctx(), { selection: { kind: 'current' } });
  if (current.status !== 'ready') throw new Error(`the current architecture read is not ready: ${JSON.stringify(current)}`);
  chmodSync(modules, 0o555);
  try {
    await world.platform.architecture.reviseArchitectureCatalog(world.ctx(), {
      meta: { requestId: 'kls2c1b1-revise', expected: await world.scopePins() },
      input: { expected: { catalogRef: current.value.catalog.ref,
        baseline: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest } },
      ops: [{ op: 'set_responsibility', moduleId: 'core', text: 'own core, revised' }], responsibilityMoves: [],
      reason: 'b1 revise' } });
  } finally {
    chmodSync(modules, 0o755);
  }
  expect((await reconciledOnce(world)).unconfirmed).toBe(1);
  expect(await noticeSummaries(world)).toEqual(['平台有 1 次写没确认落盘']);

  rmSync(join(modules, moduleFile));
  const after = await reconciledOnce(world);
  // [2C1-17] (KLS-2c-1b2): `architecture.json` still names `core`, whose file is gone, so the graph does not read: one
  // `knowledge_conflict` notice on `architecture.json`, which is not a revert.
  expect(await noticeSummaries(world)).toEqual(['平台有 1 次写没确认落盘', '知识文件有 1 处问题：.workbench/architecture.json']);
  expect(after.reverted).toBe(0);
});
