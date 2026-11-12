/**
 * KLS-2c-1c recovery of a knowledge write whose Host died between its records and its files (K18–K21, K20b;
 * [2C1-02], [2C1-03], [2C1-12], [2C1-14], [2C1-19]; split ruling §3). A real Host sets things up and closes; a child
 * Host from `dist/` on the same project store and root takes one public write and is killed at `committed` (`crashAt`:
 * the records committed, no file landed); a new Host starts on them (idle threshold 0). Its startup reconcile leaves
 * the files as they are and tells the person once (`knowledge_write_unconfirmed`, one notice a round, one item a
 * file); only `knowledge/recover` writes a file, only while the file is what the notice saw, rebuilt from the event
 * that carried that file (a note on top of its current file). SQLite only; `npm run build` first (the child runs `dist/`).
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  crashAt, kls2cAdopt, kls2cAdoptBody, kls2cBlobSha, kls2cEditModule, kls2cListedNote, kls2cModuleFile, kls2cNoteWrite,
  kls2cRecover, kls2cRecoveryItems, kls2cReviseBody, kls2cWrittenNote, KLS2C_SCOPE, noteFileText, openKLS2CHost,
  type KLS2CHost,
} from '../helpers/KLS2C-knowledge-host.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';

const CORE = { kind: 'module', moduleId: 'core' } as const;
/** A note file of the workspace; the group is the note id (a UUID). */
const NOTE_FILE = /^\.workbench\/notes\/kls2c-ws\/([0-9a-f-]+)\.md$/;
type Item = { itemNo: number; kind: string; path: string };

const worlds: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.close();
  await cleanupRestart();
});

/**
 * `setup` runs on a first Host and answers the one write (route, body) the crash child takes; the child dies at
 * `committed`; `whileDown` is the person's edit before a new Host starts on the same store and root.
 */
async function afterCrash(setup: (world: KLS2CHost) => Promise<[string, unknown]>,
  whileDown?: (world: KLS2CHost) => void): Promise<KLS2CHost> {
  const first = await openKLS2CHost({ storage: 'sqlite', git: true });
  const [suffix, body] = await setup(first).finally(() => first.close());
  await crashAt({ point: 'committed', database: first.database, root: first.root, write: call => { void call(suffix, body); } });
  whileDown?.(first);
  const world = await openKLS2CHost({ storage: 'sqlite', git: true, database: first.database, root: first.root });
  worlds.push(world);
  return world;
}

/** The one unconfirmed-write notice of the startup reconcile ([2C1-14]) and its items by `knowledge/recovery-items`. */
async function unconfirmed(world: KLS2CHost): Promise<{ noticeId: string; items: Item[] }> {
  const notices = await world.notices('knowledge_write_unconfirmed');
  expect(notices).toHaveLength(1);
  const noticeId = notices[0]?.noticeId ?? '';
  return { noticeId, items: readyValue<{ items: Item[] }>(await kls2cRecoveryItems(world, noticeId), 'recovery items').items };
}

/** A person's note on `module:core` killed at `committed`: the new Host, the notice, and the one item's path. */
async function crashedNote(commandId: string): Promise<{ world: KLS2CHost; noticeId: string; path: string }> {
  const world = await afterCrash(async first => {
    await kls2cAdopt(first, ['core']);
    return ['notes/write', kls2cNoteWrite(KLS2C_SCOPE, commandId, { topic: `${commandId} 崩溃时的写`, anchor: CORE })];
  });
  const { noticeId, items } = await unconfirmed(world);
  expect(items).toEqual([{ itemNo: 1, kind: 'write_unconfirmed', path: expect.stringMatching(NOTE_FILE) }]);
  return { world, noticeId, path: items[0]?.path ?? '' };
}

/** The records' position now, by a public read: `goals/list`'s `sourceCursor` is its lookup's `readThrough`. */
async function recordsHead(world: KLS2CHost): Promise<string> {
  return readyValue<{ sourceCursor: string }>(await world.call('goals/list', plain(world.scope, { workspace: world.scope })),
    'goals/list').sourceCursor;
}

/** A note file's text split at its JSON header (between the version line and the `---` line). */
function noteHeader(text: string): { head: string; header: Record<string, unknown>; tail: string } {
  const start = text.indexOf('\n') + 1;
  const end = text.indexOf('\n---\n', start);
  return { head: text.slice(0, start), header: JSON.parse(text.slice(start, end)) as Record<string, unknown>, tail: text.slice(end) };
}

it('K18 a note write killed before its file landed: one notice of one item, the file left missing until recover', async () => {
  const { world, noticeId, path } = await crashedNote('kls2c1-k18');
  // 具名改坏 [2C1-12]「启动对账自动补写 pending」→ 红在这一句（文件已在）。
  expect(world.read(path)).toBeNull();
  // That an idle reconcile leaves it too is b1's (KLS2C1B1-unconfirmed-write).
  const before = await recordsHead(world);
  const recovered = await kls2cRecover(world, noticeId, 1);
  expect(recovered).toMatchObject({ status: 'committed', value: { path, blobSha: kls2cBlobSha(world, path) } });
  // c 具名改坏之后第 10 条：回的 cursor 是恢复之后记录的位置；补完成写日志是一次提交，所以比恢复前前进。
  // 具名改坏「recover.ts 回的 cursor 写成常量」→ 红在这一句。
  const cursor = (recovered as { cursor?: string }).cursor ?? '';
  expect([cursor, cursor > before]).toEqual([await recordsHead(world), true]);
  expect((await kls2cListedNote(world, NOTE_FILE.exec(path)?.[1] ?? '')).topic).toBe('kls2c1-k18 崩溃时的写');
}, 180_000);

it('K21 a file the person put at the path after the notice: recover refuses with revision_conflict and leaves it', async () => {
  const { world, noticeId, path } = await crashedNote('kls2c1-k21');
  const z = noteFileText({ kind: 'convention', topic: 'k21 人放的 Z', conclusion: 'Z 结论', body: 'Z 正文', anchor: CORE,
    source: { kind: 'user', principalId: 'kls2c-operator' } });
  world.edit(path, z);
  // 具名改坏 [2C1-19]「恢复不核对当前 blob」→ 红在这一句（committed）。
  expect(await kls2cRecover(world, noticeId, 1)).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(world.read(path)?.toString('utf8')).toBe(z);
}, 180_000);

it('K19 one adoption killed before its files landed: one notice of three items, recovered one by one', async () => {
  const world = await afterCrash(async first => ['architecture/adopt-initial', await kls2cAdoptBody(first, ['core', 'other'])]);
  // 具名改坏 [2C1-14]「每条 pending 各发一条通知」→ 红在 unconfirmed 里的“一条”（3 条）。
  const { noticeId, items } = await unconfirmed(world);
  expect(items.map(item => item.itemNo)).toEqual([1, 2, 3]);
  expect(items.map(item => item.path)).toContain('.workbench/architecture.json');
  for (const item of items) {
    expect(await kls2cRecover(world, noticeId, item.itemNo)).toMatchObject({ status: 'committed', value: { path: item.path } });
  }
  const current = readyValue<{ catalog: { catalog: { modules: { ref: { moduleId: string } }[] } } }>(
    await world.call('architecture/read', plain(world.scope, { selection: { kind: 'current' } })), 'architecture/read');
  expect(current.catalog.catalog.modules.map(module => module.ref.moduleId).sort()).toEqual(['core', 'other']);
}, 180_000);

it('K20 recover checks the file the notice saw and rebuilds the module file from the revision\'s own event', async () => {
  let file = '';
  const world = await afterCrash(async first => {
    await kls2cAdopt(first, ['core']);
    file = kls2cModuleFile(first, 'core');
    return ['architecture/revise', await kls2cReviseBody(first, 'core', '修订后', 'kls2c1-k20')];
  }, down => { kls2cEditModule(down, file, { responsibility: 'k20 Host 停着时人改的 Y' }); });
  const { noticeId, items } = await unconfirmed(world);
  // 具名改坏 [2C1-19]「expectedBlob 取日志的 beforeBlob（B）」→ 红在这一句（revision_conflict）。
  expect(await kls2cRecover(world, noticeId, items.find(item => item.path === file)?.itemNo ?? 0))
    .toMatchObject({ status: 'committed', value: { path: file } });
  const current = readyValue<{ catalog: { catalog: { modules: { ref: { moduleId: string }; responsibility: string }[] } } }>(
    await world.call('architecture/read', plain(world.scope, { selection: { kind: 'current' } })), 'architecture/read');
  expect(current.catalog.catalog.modules.find(module => module.ref.moduleId === 'core')?.responsibility).toBe('修订后');
}, 180_000);

it('K20b a note commit replacing A: A\'s item is rebuilt from A\'s own event on A\'s file as the notice saw it, B\'s '
  + 'from B\'s own (the commit\'s second)', async () => {
  let a = { noteId: '', path: '' };
  const world = await afterCrash(async first => {
    await kls2cAdopt(first, ['core']);
    a = await kls2cWrittenNote(first, 'kls2c1-k20b-a', 'k20b A');
    // 人把 A 的文件头换成 4 格缩进，并在 basisFiles 里加一条记录里没有 digest 的路径（切包定稿第三节）。
    const { head, header, tail } = noteHeader(first.read(a.path)?.toString('utf8') ?? '');
    first.edit(a.path, `${head}${JSON.stringify({ ...header,
      basisFiles: [...header['basisFiles'] as string[], 'src/extra.ts'] }, null, 4)}${tail}`);
    // 同一作者写 B，取代 A：这次提交里 A 的处置事件在前、B 的 NoteWritten 在后，A、B 两个文件都要改。
    return ['notes/write', kls2cNoteWrite(KLS2C_SCOPE, 'kls2c1-k20b-b', { topic: 'k20b B', anchor: CORE, replaces: [a.noteId] })];
  });
  const { noticeId, items } = await unconfirmed(world);
  expect(items).toHaveLength(2);
  // 具名改坏 [2C1-02]/[2C1-03]「每个文件的日志都绑这次提交的最后一个事件」→ 按 B 的 head 重建 A，对不上 afterBlob，红在这一句（unavailable）。
  // 具名改坏（切包定稿第三节）「注记重建不以当前文件为底」→ 少了 src/extra.ts，对不上 afterBlob，也红在这一句。
  expect(await kls2cRecover(world, noticeId, items.find(item => item.path === a.path)?.itemNo ?? 0))
    .toMatchObject({ status: 'committed', value: { path: a.path, blobSha: kls2cBlobSha(world, a.path) } });
  const { header } = noteHeader(world.read(a.path)?.toString('utf8') ?? '');
  expect(header['topic']).toBe('k20b A');
  expect(header['basisFiles']).toContain('src/extra.ts');
  // c 具名改坏之后第 11 条：B 的携带事件是这次提交的第 1 个（A 的处置事件在前），B 也按它自己的事件重建。
  // 具名改坏 [2C1-02]「carrierEventIndex 恒为 0」（改完 src 先 npm run build：子进程跑 dist）→ 按 A 的处置事件重建 B，
  // 对不上 afterBlob，红在这一句（unavailable）。
  const b = items.find(item => item.path !== a.path);
  expect(await kls2cRecover(world, noticeId, b?.itemNo ?? 0))
    .toMatchObject({ status: 'committed', value: { path: b?.path, blobSha: kls2cBlobSha(world, b?.path ?? '') } });
  expect(noteHeader(world.read(b?.path ?? '')?.toString('utf8') ?? '').header['topic']).toBe('k20b B');
}, 180_000);
