/**
 * KLS-2c-1 idle reconcile through a real Host (K03, K11, K12; [2C1-11]–[2C1-18], [2C1-24]). A person edits, writes
 * back or commits knowledge files under a running Host; the Host's idle heartbeat reconciles each registered
 * workspace (git or not), keeps a line's uncommitted file versions (the newest 20, cleared once the file is
 * committed), and tells a revert from an outside edit. The world is `KLS2C-knowledge-host.ts` (idle threshold 0, so
 * every heartbeat is idle); notes and architecture come from the public routes, notices from the decision queue,
 * a note's verification from `notes/list`. Waiting for a notice is at most 20 idle heartbeats, reading after each.
 * Snapshot and index rows: memory and SQLite.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  kls2cAdopt, kls2cModuleFile, kls2cNoteWrite, kls2cReviseResponsibility, openKLS2CHost, type KLS2CHost,
} from '../helpers/KLS2C-knowledge-host.js';

const BACKENDS = ['memory', 'sqlite'] as const;
const CORE = { kind: 'module', moduleId: 'core' } as const;

const worlds: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.close();
  await cleanupRestart();
});

async function idleWorld(storage: 'memory' | 'sqlite', git: boolean): Promise<KLS2CHost> {
  const world = await openKLS2CHost({ storage, git });
  worlds.push(world);
  return world;
}

/** A person's convention note on `module:core` through `notes/write`; its file path under the root. */
async function noteFileWritten(world: KLS2CHost, commandId: string, topic: string): Promise<{ noteId: string; path: string }> {
  const answer = await world.call<{ write: { status: string; noteId?: string } }>('notes/write',
    kls2cNoteWrite(world.scope, commandId, { topic, anchor: CORE }));
  if (answer.write.status !== 'accepted' || answer.write.noteId === undefined) {
    throw new Error(`notes/write was not accepted: ${JSON.stringify(answer)}`);
  }
  return { noteId: answer.write.noteId, path: `.workbench/notes/${world.scope.workspaceId}/${answer.write.noteId}.md` };
}

/** The note's item in `notes/list` on `module:core`. */
async function listedNote(world: KLS2CHost, noteId: string): Promise<{ conclusion: string; verify: unknown }> {
  const page = await world.call<{ status: string; value?: { items: { noteId: string; conclusion: string; verify: unknown }[] } }>(
    'notes/list', plain(world.scope, { anchor: CORE, limit: 100, cursor: null }));
  const item = page.value?.items.find(entry => entry.noteId === noteId);
  if (page.status !== 'ready' || item === undefined) throw new Error(`notes/list has no ${noteId}: ${JSON.stringify(page)}`);
  return item;
}

/** `text` with its one `from` replaced (the row fails if `from` is not there). */
function replacedIn(text: Buffer | null, from: string, to: string): string {
  const old = text?.toString('utf8') ?? '';
  if (!old.includes(from)) throw new Error(`the file has no ${from}`);
  return old.replace(from, to);
}

describe.each(BACKENDS)('%s', storage => {
  it('K03 the idle reconcile also runs on a workspace that is not a git repository', async () => {
    const world = await idleWorld(storage, false);
    await kls2cAdopt(world, ['core']);
    const { noteId, path } = await noteFileWritten(world, 'kls2c1-k03', 'k03');
    world.edit(path, replacedIn(world.read(path), '"conclusion": "k03 结论"', '"conclusion": "k03 人改的结论"'));
    await world.idle();
    const item = await listedNote(world, noteId);
    expect(item.conclusion).toBe('k03 人改的结论');
    expect(item.verify).toEqual({ state: 'needs_verification', reason: 'external_edit' });
  }, 120_000);

  it.each([
    ['① 写回第 2 版（还在最近 20 份里）：一条撤回通知', 2, 1],
    ['② 写回第 1 版（已不在最近 20 份里）：没有撤回通知，是外部改动', 1, 0],
  ] as const)('K11 a line keeps a file\'s newest 20 versions: %s', async (_, back, reverted) => {
    const world = await idleWorld(storage, true);
    await kls2cAdopt(world, ['core']);
    const { noteId, path } = await noteFileWritten(world, `kls2c1-k11-${back}`, 'k11');
    const written = world.read(path);
    const version = (n: number): string => replacedIn(written, '"conclusion": "k11 结论"', `"conclusion": "k11 第 ${n} 版"`);
    await world.idle();
    for (let n = 1; n <= 21; n += 1) {
      world.edit(path, version(n));
      await world.idle();
    }
    world.edit(path, version(back));
    expect(await world.noticesWithin('knowledge_reverted')).toHaveLength(reverted);
    if (reverted === 0) expect((await listedNote(world, noteId)).verify).toEqual({ state: 'needs_verification', reason: 'external_edit' });
  }, 180_000);

  it.each([
    ['人提交了模块文件：这个文件的快照清掉，写回旧字节不算撤回', true, 0],
    ['对照，没提交：写回旧字节是一处撤回', false, 1],
  ] as const)('K12 a committed file\'s snapshots are cleared: %s', async (_, commit, reverted) => {
    const world = await idleWorld(storage, true);
    await kls2cAdopt(world, ['core']);
    const file = kls2cModuleFile(world, 'core');
    const adopted = world.read(file);
    await world.idle();
    await kls2cReviseResponsibility(world, 'core', 'k12 修订后', 'kls2c1-k12-revise');
    expect(world.read(file)).not.toEqual(adopted);
    await world.idle();
    if (commit) {
      world.git(['add', '--', file]);
      world.git(['commit', '-q', '-m', 'k12 module file']);
      await world.idle();
    }
    world.edit(file, adopted?.toString('utf8') ?? '');
    expect(await world.noticesWithin('knowledge_reverted')).toHaveLength(reverted);
  }, 120_000);
});
