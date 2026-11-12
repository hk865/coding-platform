/**
 * KLS-2c-1 reconcile into the knowledge index, platform level (K02, K04, K05; [2C1-11], [2C1-16]). A person puts down,
 * deletes or edits a knowledge file; after the idle reconcile the notes read as the files say. These rows read a note
 * by noteId, the notes on an anchor (a note with no record included) and the notes on a path prefix; no Host route
 * reads those (the note routes are `notes/list`, which lists record heads, `write`, `withdraw` and `review`), so the
 * world is `openKLS2AWorld` (a real platform over a real git root, as the KLS-2b rows) and the reads are the public
 * owners `notes.readNote`, `notes.listByAnchor`, `notes.memoryFind`. The idle reconcile is the platform port the Host
 * calls, `platform.knowledge.reconcile(ctx, workspaceId, 'idle')` ([2C1-23]). Index rows: memory and SQLite. K08s
 * (stk16 ruling 2) is a person's edit landing while a round is in flight, read back from the decision queue's notices.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import { openKLS2AWorld, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';
import { noteFileText } from '../helpers/KLS2C-knowledge-host.js';
import { gitIn } from '../scenarios/support/git-workspace.js';

/**
 * K08s: a step a row arms runs once right after a round's step 1 has listed and read the line's files
 * (`readKnowledgeFiles`), as a person's edit that lands while that round is in flight. The result comes back
 * unchanged; unarmed, the line is the real one.
 */
const roundGate = vi.hoisted(() => ({ afterFilesRead: null as null | (() => void) }));
vi.mock('../../src/core/work-graph/knowledge/reconcile.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/work-graph/knowledge/reconcile.js')>();
  return { ...actual,
    reconcileKnowledgeLine: (...[write, line, trigger]: Parameters<typeof actual.reconcileKnowledgeLine>) =>
      actual.reconcileKnowledgeLine(write, { ...line, async readKnowledgeFiles() {
        const read = await line.readKnowledgeFiles();
        const step = roundGate.afterFilesRead;
        roundGate.afterFilesRead = null;
        step?.();
        return read;
      } }, trigger) };
});

const CORE: NoteAnchorV1 = { kind: 'module', moduleId: 'core' };
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  roundGate.afterFilesRead = null;
  for (const close of closers.splice(0).reverse()) await close();
});

async function reconcileWorld(storage: 'memory' | 'sqlite'): Promise<KLS2AWorld> {
  const world = await openKLS2AWorld({ storage });
  closers.push(() => world.close());
  return world;
}

const notePathIn = (world: KLS2AWorld, noteId: string): string => `.workbench/notes/${world.workspaceId}/${noteId}.md`;

async function adoptCore(world: KLS2AWorld): Promise<void> {
  const adopted = await world.platform.architecture.adoptInitialArchitecture(world.ctx(), {
    meta: { requestId: 'kls2c1-adopt', expected: await world.scopePins() },
    input: { baselineId: 'kls2c1-baseline', description: 'd', constraints: [], catalog: { requireDag: true, dependencies: [],
      modules: [{ ref: { projectId: world.projectId, moduleId: 'core' }, name: 'core', responsibility: 'own core',
        paths: ['src/core'], interfaces: [] }] } } });
  expect(adopted, JSON.stringify(adopted)).toMatchObject({ status: 'committed' });
}

/** A person's convention note through the public owner; any refusal fails the row with its body. */
async function noteWritten(world: KLS2AWorld, commandId: string, topic: string, anchor: NoteAnchorV1): Promise<string> {
  const note = { kind: 'convention', topic, conclusion: `${topic} 结论`, body: `${topic} 正文`, anchor, extraAnchors: [],
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [] } as NoteDraftV1;
  const written = await world.platform.notes.writeNote(world.ctx(), { commandId, note, expectedPointerRevision: null, goalId: null });
  if (written.status === 'rejected') throw new Error(`the note write was refused: ${JSON.stringify(written)}`);
  return written.noteId;
}

/** The idle reconcile of the world's workspace, as the Host's idle heartbeat calls it. */
async function reconcileIdle(world: KLS2AWorld): Promise<void> {
  const answer = await world.platform.knowledge.reconcile(world.ctx(), world.workspaceId, 'idle');
  expect(answer, JSON.stringify(answer)).toMatchObject({ status: 'ready' });
}

async function idsUnder(world: KLS2AWorld, pathPrefix: string): Promise<string[]> {
  const read = await world.platform.notes.memoryFind(world.ctx(), { v: 1, op: 'find', pathPrefix, limit: 20, cursor: null });
  if (read.status !== 'ready') throw new Error(`the find under ${pathPrefix} is not ready: ${JSON.stringify(read)}`);
  return read.value.items.map(item => item.noteId);
}

describe.each(['memory', 'sqlite'] as const)('%s', storage => {
  it('K02 a note file a teammate put down, with no record in this project, reads after the idle reconcile and waits to be verified', async () => {
    const world = await reconcileWorld(storage);
    await adoptCore(world);
    const noteId = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
    mkdirSync(join(world.root, '.workbench/notes', world.workspaceId), { recursive: true });
    world.edit(notePathIn(world, noteId), noteFileText({ kind: 'convention', topic: '队友的约定', conclusion: '文件名用短横线',
      body: '队友写的正文', anchor: CORE, source: { kind: 'user', principalId: 'teammate' } }));
    await reconcileIdle(world);
    const read = await world.platform.notes.readNote(world.ctx(), { noteId });
    expect(read, JSON.stringify(read)).toMatchObject({ status: 'ready',
      value: { topic: '队友的约定', version: null, storedState: null, freshness: 'unchecked' } });
    expect(read.status === 'ready' ? read.value.verify : null).toEqual({ state: 'needs_verification', reason: 'external_edit' });
  });

  it('K04 a committed note file a person deleted and committed leaves no rows on its anchor after the idle reconcile', async () => {
    const world = await reconcileWorld(storage);
    await adoptCore(world);
    const noteId = await noteWritten(world, 'kls2c1-k04', 'k04', CORE);
    const path = notePathIn(world, noteId);
    gitIn(world.root, 'add', '--', path);
    gitIn(world.root, 'commit', '-q', '-m', 'k04 note');
    gitIn(world.root, 'rm', '-q', '--', path);
    gitIn(world.root, 'commit', '-q', '-m', 'k04 note removed');
    await reconcileIdle(world);
    const page = await world.platform.notes.listByAnchor(world.ctx(), { anchor: CORE, limit: 20, cursor: null });
    expect(page.status, JSON.stringify(page)).toBe('ready');
    expect(page.status === 'ready' ? page.value.items : null).toEqual([]);
  });

  it('K05 an anchor a person changed in the note file moves the note in the path index after the idle reconcile', async () => {
    const world = await reconcileWorld(storage);
    // The path find reads the current catalog (note-views `currentArchitecture`), so the project adopts one first.
    await adoptCore(world);
    const noteId = await noteWritten(world, 'kls2c1-k05', 'k05', { kind: 'file', path: 'src/a.ts' });
    const path = notePathIn(world, noteId);
    const text = world.file(path);
    if (text === null || !text.includes('"path": "src/a.ts"')) throw new Error(`the note file has no src/a.ts anchor: ${text}`);
    world.edit(path, text.replace('"path": "src/a.ts"', '"path": "src/dir/b.ts"'));
    await reconcileIdle(world);
    expect(await idsUnder(world, 'src/dir')).toContain(noteId);
    expect(await idsUnder(world, 'src/a.ts')).not.toContain(noteId);
  });
});

/** The `knowledge_conflict` notices' summaries ([2C1-17] “知识文件有 n 处问题：”) in the decision queue. */
async function conflictNotices(world: KLS2AWorld): Promise<string[]> {
  const read = await world.platform.decisions.queryDecisionQueue(world.ctx(), {
    workspace: { projectId: world.projectId, workspaceId: world.workspaceId }, sections: ['notices'], page: { limit: 100 } });
  if (read.status !== 'ready') throw new Error(`the decision queue is not ready: ${JSON.stringify(read)}`);
  return read.value.notices.map(item => item.summary).filter(summary => summary.startsWith('知识文件有'));
}

// stk16 裁定第 2 条：K08 原来 6/10 红的根。一轮对账在途时人改了文件：第 1 步读到的是旧文件，第 8 步若再读一次盘就读到新文件，
// 这一轮报出“只有 architecture.json 一处”，身份和下一轮完整的问题不同，多出一条通知。一轮只看第 1 步读到的那一份。
it('K08s a person breaks a module file while a round is in flight, after its file list: that round judges the files '
  + 'it listed, so the next round\'s one knowledge_conflict notice is the only one', async () => {
  const world = await reconcileWorld('memory');
  await adoptCore(world);
  const module = `.workbench/modules/${world.files('.workbench/modules')[0]!}`;
  roundGate.afterFilesRead = () => world.edit(module, '{ "id": "core", not json');
  await reconcileIdle(world);
  await reconcileIdle(world);
  // 具名改坏：第 8 步再读一次盘（`line.readArchitecture()`）→ 在途那一轮单报 architecture.json，红在这一句（2 条）。
  const notices = await conflictNotices(world);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain(module);
});
