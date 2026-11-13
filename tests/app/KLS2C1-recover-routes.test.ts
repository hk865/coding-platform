/**
 * KLS-2c-1c recovery through a real Host (K01, K13–K16, K37, K08r; [2C1-11], [2C1-13]–[2C1-15], [2C1-17]–[2C1-20],
 * [2C1-23]; errata 2c1#2, #5, #6, #8; rulings G4, G9; split ruling §3, §8; b1 ruling F-10; b2 ruling F-9). A person
 * deletes or reverts an uncommitted knowledge file under a running Host. The idle reconcile tells the person once in the
 * decision queue (`knowledge_reverted`, the count only); `knowledge/recovery-items` lists that notice's items in its own
 * project, and only `knowledge/recover` writes a file back: against the file the notice saw, from the snapshot an item
 * keeps, indexed as the platform's own write, then one more reconcile that (KC-1) opens the `knowledge_conflict`
 * follow-up round when the recovered files are a path-only conflict, like any other reconcile. The
 * world is `KLS2C-knowledge-host.ts` (idle threshold 0 unless a row says otherwise); notes come from `notes/list`,
 * blobs from real `git hash-object`.
 *
 * KC-2 U1–U4 (121-106 ④, rulings 4-12/4-13, `kc2-start-rulings-draft.md` §3): a bad file's "恢复" source. Today every
 * one of U1–U4 is red at the problem row (`knowledge/problems` has no `recovery`) and at `knowledge/recovery-items`
 * (`not_found` for a bad file); U5 is red at its `unreadable` entry (`listRefs` after `deletePath`). After the package
 * lands they are green because the notice's rows are written with the source (`withRecoverySources`, snapshot → HEAD →
 * record), each sourced row gets an `unreadable` recovery item, and `knowledge/recover` writes that source back.
 */
import { appendFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain, startLinesEnded } from '../helpers/AG2b-collaboration-fixture.js';
import {
  kls2cAdopt, kls2cBlobSha, kls2cEditModule, kls2cListedNote, kls2cModuleFile, kls2cNoticesAtLeast, kls2cProblems,
  kls2cRecover, kls2cRecoveryItems, kls2cReviseResponsibility, kls2cWrittenNote, KLS2C_NEVER_IDLE_MS, openKLS2CHost,
  type KLS2CHost, type KLS2CNoticeKind, type KLS2COpenOptions, type KLS2CProblem,
} from '../helpers/KLS2C-knowledge-host.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';

type SessionRef = { projectId: string; sessionId: string };
const K37_B: CoreScope = { projectId: 'kls2c1-k37-b', workspaceId: 'kls2c1-k37-b-ws' };

const worlds: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.close();
  await cleanupRestart();
});

async function hostWorld(opts: KLS2COpenOptions): Promise<KLS2CHost> {
  const world = await openKLS2CHost(opts);
  worlds.push(world);
  return world;
}

/** The one notice of `kind` within 20 idle heartbeats; its id. */
async function oneNotice(world: KLS2CHost, kind: KLS2CNoticeKind): Promise<string> {
  const found = await world.noticesWithin(kind);
  expect(found, kind).toHaveLength(1);
  return found[0]?.noticeId ?? '';
}

/** A snapshot's time as the reconcile's `now` writes it (`new Date().toISOString()`); the exact value is not the row's. */
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/** `core` adopted and committed by the person (HEAD's v0), revised through the route (v1), and one idle round on v1. */
async function committedThenRevised(world: KLS2CHost, requestId: string): Promise<{ file: string; v1: Buffer | null }> {
  await kls2cAdopt(world, ['core']);
  world.git(['add', '--', '.workbench/architecture.json', '.workbench/modules']);
  world.git(['commit', '-q', '-m', 'kls2c1 architecture v0']);
  const file = kls2cModuleFile(world, 'core');
  const v0 = world.read(file);
  await kls2cReviseResponsibility(world, 'core', `${requestId} v1`, requestId);
  const v1 = world.read(file);
  if (v1 === null || v0 === null || v1.equals(v0)) throw new Error('the revision did not change the module file');
  await world.idle();
  return { file, v1 };
}

describe.each(['memory', 'sqlite'] as const)('%s', storage => {
  it('K01 a knowledge file git ignores through info/exclude is still reconciled: its deletion is that file\'s revert', async () => {
    const world = await hostWorld({ storage, git: true });
    await kls2cAdopt(world, ['core']);
    appendFileSync(join(resolve(world.root, world.git(['rev-parse', '--git-common-dir']).trim()), 'info', 'exclude'),
      '.workbench/\n');
    const { path } = await kls2cWrittenNote(world, 'kls2c1-k01', 'k01');
    expect(world.git(['check-ignore', '--', path]).trim()).toBe(path);
    await world.idle();
    world.remove(path);
    // 具名改坏 [2C1-11]「枚举换成 git ls-files --cached --others --exclude-standard 的结果」→ 红在 oneNotice 里的“一条”（0 条）。
    const noticeId = await oneNotice(world, 'knowledge_reverted');
    expect(readyValue<{ items: { path: string }[] }>(await kls2cRecoveryItems(world, noticeId), 'recovery items')
      .items.map(item => item.path)).toEqual([path]);
  }, 120_000);

  it('K13 a deleted uncommitted note: one revert notice, its item by noticeId, written back only by recover', async () => {
    const world = await hostWorld({ storage, git: true });
    await kls2cAdopt(world, ['core']);
    const { noteId, path } = await kls2cWrittenNote(world, 'kls2c1-k13', 'k13');
    await world.idle();
    world.remove(path);
    // The notice's summary ([2C1-14]) is b1's (KLS2C1B1-recovery-items).
    const noticeId = await oneNotice(world, 'knowledge_reverted');
    expect(await kls2cRecoveryItems(world, noticeId))
      .toEqual({ status: 'ready', value: { items: [{ itemNo: 1, kind: 'reverted', path }] } });
    await world.idle();
    expect(world.read(path)).toBeNull();
    const recovered = await kls2cRecover(world, noticeId, 1);
    expect(recovered).toMatchObject({ status: 'committed', value: { path, blobSha: kls2cBlobSha(world, path) } });
    const note = await kls2cListedNote(world, noteId);
    expect(note.topic).toBe('k13');
    // G4：平台自己写回的内容不算人改的。具名改坏「恢复后不更新索引」→ 红在这一句（external_edit）。
    expect(note.verify).toBeNull();
    // errata 2c1#5、[2C1-23]（读路由的 not_found 是 ReadResult 自己的）：具名改坏 [2C1-20]「恢复成功后不删恢复项」→ 红在这一句（读出 1 项）。
    expect(await kls2cRecoveryItems(world, noticeId)).toEqual({ status: 'not_found' });
  }, 120_000);

  // A person's new edit is no revert: b1's K11 and K12 (KLS2C1-idle-reconcile).
  it('K14 back at HEAD and unlike last round is a revert; a clean round after it keeps the snapshot its item names', async () => {
    const world = await hostWorld({ storage, git: true });
    const { file, v1 } = await committedThenRevised(world, 'kls2c1-k14');
    world.git(['checkout', '--', file]);
    // 具名改坏 [2C1-13]/[2C1-18]「干净、已跟踪、等于 HEAD 先判成提交（不看上一轮）」→ 红在 oneNotice 里的“一条”（0 条）。
    const noticeId = await oneNotice(world, 'knowledge_reverted');
    await world.idle();   // 文件已干净、已跟踪、和上一轮相同
    // 具名改坏 [2C1-18]「清快照不跳过恢复项引用的」→ 红在这一句（unavailable 或写回的不是 v1）。
    expect(await kls2cRecover(world, noticeId, 1)).toMatchObject({ status: 'committed', value: { path: file } });
    expect(world.read(file)).toEqual(v1);
    // errata 2c1#6、切包定稿第八节：具名改坏「恢复后不更新索引」→ 恢复后那轮对账把写回的 v1 又记成同一项，红在这一句。
    expect(await kls2cRecoveryItems(world, noticeId)).toEqual({ status: 'not_found' });
  }, 120_000);

  it('K15 recover does not overwrite what the person did after the notice: revision_conflict, the file stays deleted', async () => {
    const world = await hostWorld({ storage, git: true });
    const { file } = await committedThenRevised(world, 'kls2c1-k15');
    world.git(['checkout', '--', file]);
    const noticeId = await oneNotice(world, 'knowledge_reverted');
    world.remove(file);
    await world.idle();   // errata 2c1#8、G9：删了之后的一轮不改这一项
    // 具名改坏 [2C1-19]/[2C1-20]「当前文件不在就放行」→ 红在这一句（committed）。
    expect(await kls2cRecover(world, noticeId, 1)).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(world.read(file)).toBeNull();
  }, 120_000);

  // c 的 Astra 审查（lead 收）：只留注入的时钟不动这一项，它走的流程和走动时钟的一样，还多覆盖 b1 裁定 F-10。
  it('K16 two reverts to the same HEAD with different snapshots are two notices; the second restores B, with the '
    + 'injected clock standing still (b1 ruling F-10)', async () => {
    const world = await hostWorld({ storage, git: true, now: () => '2026-11-12T00:00:00.000Z' });
    const { file } = await committedThenRevised(world, 'kls2c1-k16');
    world.git(['checkout', '--', file]);
    const first = await oneNotice(world, 'knowledge_reverted');
    const v2 = kls2cEditModule(world, file, { responsibility: 'k16 人改的 v2' });
    await world.idle();
    world.git(['checkout', '--', file]);
    // 具名改坏 [2C1-15]「撤回通知的身份只用 {path, expectedBlob}」→ 第二次撤回和第一条同身份，红在这一句（仍一条）。
    const both = await kls2cNoticesAtLeast(world, 'knowledge_reverted', 2);
    expect(both).toHaveLength(2);
    const second = both.find(notice => notice.noticeId !== first)?.noticeId ?? '';
    expect(await kls2cRecover(world, second, 1)).toMatchObject({ status: 'committed', value: { path: file } });
    // F-10：第二次撤回的恢复材料是 B（v2），时钟不动也是。
    expect(world.read(file)?.toString('utf8')).toBe(v2);
  }, 120_000);
});

it('K37 a notice\'s recovery items are found only in its own project', async () => {
  const world = await hostWorld({ storage: 'memory', git: true, alsoServe: K37_B });
  await kls2cAdopt(world, ['core']);
  const { path } = await kls2cWrittenNote(world, 'kls2c1-k37', 'k37');
  await world.idle();
  world.remove(path);
  const noticeId = await oneNotice(world, 'knowledge_reverted');
  // [2C1-23] 读路由回 ReadResult 自己的 not_found，[2C1-19] 写路由回 code 为 not_found 的拒绝。这一行守的是 B 的 scope 只到
  // B 的平台和快照库：抓进程级全局查找（按 noticeId 跨进程里各项目的快照库找，c 的具名改坏实打红在下一句）；单个平台内部的
  // 全局查找造不出来：每个项目一个平台，memory 快照库每个平台一份（create-platform.ts:1224），SQLite 的在项目库目录里
  // （project-store-paths.ts:31），一个平台里没有两个项目共用的库可找。
  expect(await kls2cRecoveryItems(world, noticeId, K37_B)).toEqual({ status: 'not_found' });
  expect(await kls2cRecover(world, noticeId, 1, K37_B)).toMatchObject({ status: 'rejected', code: 'not_found' });
  expect(world.read(path)).toBeNull();
  expect(await kls2cRecover(world, noticeId, 1)).toMatchObject({ status: 'committed', value: { path } });
  expect(world.read(path)).not.toBeNull();
}, 120_000);

/** The `action_request` messages in one Session's inbox. */
async function actionRequests(world: KLS2CHost, recipient: SessionRef): Promise<unknown[]> {
  const page = readyValue<{ items: { intent?: string }[] }>(await world.call('messages/inbox',
    plain(world.scope, { recipient, page: { limit: 100 } })), 'messages/inbox');
  return page.items.filter(item => item.intent === 'action_request');
}

it('V6 a recovery whose file makes two module files claim one path: the recovery round opens the knowledge_conflict '
  + 'follow-up and asks the region adviser (b2 F-9; 121-106 ①)', async () => {
  const first = await hostWorld({ storage: 'sqlite', git: true, kernelStore: true });
  const { database, root } = first;
  await kls2cAdopt(first, ['core', 'other']);
  await startLinesEnded(async () => await first.call('role-lines/operations', plain(first.scope, { workspace: first.scope })));
  const opened = await first.call<{ status: string; value?: { session: SessionRef | null } }>('role-lines/open',
    graphWrite(first.scope, { duty: 'adviser', scope: [{ kind: 'region',
      moduleRef: { projectId: first.scope.projectId, moduleId: 'core' } }] }, 'kls2c1-v6-adviser'));
  const adviser = opened.value?.session;
  if (opened.status !== 'committed' || !adviser) throw new Error(`role-lines/open: ${JSON.stringify(opened)}`);
  await first.idle();
  const file = kls2cModuleFile(first, 'core');
  const other = kls2cModuleFile(first, 'other');
  await worlds.pop()?.close();
  // 没有 Host 时人删掉 core 的模块文件；新 Host 的启动对账出撤回通知（只开启动对账，之后不再有空闲对账）。
  rmSync(join(root, file));
  const world = await hostWorld({ storage: 'sqlite', git: true, kernelStore: true, database, root,
    idleMs: KLS2C_NEVER_IDLE_MS });
  const [reverted, ...others] = await world.notices('knowledge_reverted');
  expect(others).toEqual([]);
  // 恢复之前人把 other 的 paths 改成 src/core：只有 one file 认领它，还没有冲突，这一轮什么都不开。
  kls2cEditModule(world, other, { paths: ['src/core'] });
  expect(await actionRequests(world, adviser)).toEqual([]);
  expect(await kls2cRecover(world, reverted?.noticeId ?? '', 1)).toMatchObject({ status: 'committed', value: { path: file } });
  // 恢复之后那一轮对账见到两个模块文件都认领 src/core：打开 knowledge_conflict 续轮，参谋收到那一轮的请求。
  // 续轮是 `begin` 写下的操作，Host 在另一趟才驱动它开轮、发请求（同 V1/V4）；等那一趟再读。
  // 具名改坏：恢复后的对账直接调底层 reconcileKnowledgeLine、不经 ops 的 reconcile → 红在这里（0 条）。
  // 今天红在续轮：旧树在恢复后的对账里直接发“请提修订”的信，没有 knowledge_conflict 续轮。
  await world.idle();
  expect(await actionRequests(world, adviser)).toHaveLength(1);
  const rows = readyValue<{ action: string; followUp?: unknown }[]>(await world.call('role-lines/operations',
    plain(world.scope, { workspace: world.scope })), 'role-lines/operations');
  expect(rows.filter(row => row.action === 'role_line' && row.followUp !== undefined && row.followUp !== null))
    .toHaveLength(1);
}, 180_000);

// KC-2 U1: the newest snapshot that reads as this file is the source; the bad bytes' own copies never are.
// 具名改坏「取最新一份、不过滤能不能读」→ 写回 `{"id":"core"}`；「跳过快照」→ 来源是 record，写回采用时的字节；
// 「恢复项写成 reverted」→ 恢复项的 kind 红。
it('U1 (KC-2) a bad file with a readable snapshot is offered that snapshot, and recover writes it back', async () => {
  const world = await hostWorld({ storage: 'memory', git: true });
  await kls2cAdopt(world, ['core']);
  const file = kls2cModuleFile(world, 'core');
  const S = kls2cEditModule(world, file, { responsibility: 'kc2 人改过' });
  await world.idle();
  world.edit(file, '{"id":"core"}');
  await world.idle();
  const first = (await world.notices('knowledge_conflict'))[0]?.noticeId ?? '';
  world.edit(file, '{');
  await world.idle();
  const notices = await world.notices('knowledge_conflict');
  expect(notices).toHaveLength(2);
  const noticeId = notices.find(notice => notice.noticeId !== first)?.noticeId ?? '';
  const rows = readyValue<{ problems: KLS2CProblem[] }>(await kls2cProblems(world, noticeId), 'knowledge/problems').problems;
  // The bad module file is row 1; architecture.json's `module_without_file` (it names a module whose file does not read)
  // follows and gets no recovery item.
  expect(rows[0]?.kind).toBe('bad_file');
  expect(rows[0]?.reason.startsWith('文件读不出：')).toBe(true);
  expect(rows[0]?.reason.endsWith('。上次提交里没有能用的版本')).toBe(true);
  expect(rows[0]?.recovery).toEqual({ source: 'snapshot', takenAt: expect.stringMatching(ISO_TIME) });
  expect(await kls2cRecoveryItems(world, noticeId)).toEqual({ status: 'ready',
    value: { items: [{ itemNo: 1, kind: 'unreadable', path: file }] } });
  expect(await kls2cRecover(world, noticeId, 1)).toMatchObject({ status: 'committed',
    value: { path: file, blobSha: kls2cBlobSha(world, file) } });
  expect(world.read(file)?.toString('utf8')).toBe(S);
});

// KC-2 U2: no snapshot is left after the person committed; HEAD's version and its last commit time are the source.
// 具名改坏「跳过 HEAD」→ 来源是 record；「提示的条件反了」→ reason；「takenAt 给 null」→ recovery。
it('U2 (KC-2) a bad file with a usable HEAD version is offered that version and its last commit time', async () => {
  const world = await hostWorld({ storage: 'memory', git: true });
  await kls2cAdopt(world, ['core']);
  const file = kls2cModuleFile(world, 'core');
  const C = kls2cEditModule(world, file, { responsibility: 'kc2 提交过' });
  world.git(['add', '--', '.workbench']);
  world.git(['commit', '-q', '-m', 'kc2 committed module']);
  const committedAt = world.git(['log', '-1', '--format=%cI', 'HEAD', '--', file]).trim();
  const headBlob = world.git(['rev-parse', `HEAD:${file}`]).trim();
  await world.idle();
  await world.idle();
  world.edit(file, '{');
  await world.idle();
  const noticeId = (await world.notices('knowledge_conflict'))[0]?.noticeId ?? '';
  const [row] = readyValue<{ problems: KLS2CProblem[] }>(await kls2cProblems(world, noticeId), 'knowledge/problems').problems;
  expect(row?.kind).toBe('bad_file');
  expect(row?.reason.endsWith(`。上次提交里有这个文件能用的版本，也可以在工作区根目录用 git restore ${file} 恢复`))
    .toBe(true);
  expect(row?.recovery).toEqual({ source: 'head', takenAt: committedAt, headBlob });
  expect(await kls2cRecoveryItems(world, noticeId)).toEqual({ status: 'ready',
    value: { items: [{ itemNo: 1, kind: 'unreadable', path: file }] } });
  expect(await kls2cRecover(world, noticeId, 1)).toMatchObject({ status: 'committed',
    value: { path: file, blobSha: kls2cBlobSha(world, file) } });
  expect(world.read(file)?.toString('utf8')).toBe(C);
});

// KC-2 U3: no snapshot and no HEAD version; the records rebuild the two adopted files, the new bad file gets nothing.
// 具名改坏「模块号在第 7 步之后才读」→ 第 2 行没有 recovery；「架构文件不给记录来源」→ 第 1 行；
// 「没有来源也给一个」→ 第 3 行；「恢复时用行里的 moduleIds（空）」→ 第二次恢复。
it('U3 (KC-2, SQLite) a bad architecture and module file rebuilt from the platform records; a new file has no source',
  async () => {
    const first = await hostWorld({ storage: 'sqlite', git: true, idleMs: KLS2C_NEVER_IDLE_MS });
    await kls2cAdopt(first, ['core']);
    const architecture = '.workbench/architecture.json';
    const A0 = first.read(architecture)?.toString('utf8') ?? '';
    const file = kls2cModuleFile(first, 'core');
    const M0 = first.read(file)?.toString('utf8') ?? '';
    const { database, root } = first;
    await worlds.pop()?.close();
    first.edit(architecture, '{');
    first.edit(file, '{"id":"core"}');
    first.edit('.workbench/modules/zz.json', '{');
    const world = await hostWorld({ storage: 'sqlite', git: true, database, root, idleMs: KLS2C_NEVER_IDLE_MS });
    const noticeId = (await world.notices('knowledge_conflict'))[0]?.noticeId ?? '';
    const rows = readyValue<{ problems: KLS2CProblem[] }>(await kls2cProblems(world, noticeId), 'knowledge/problems').problems;
    expect(rows.map(row => row.files[0]?.path)).toEqual([architecture, file, '.workbench/modules/zz.json']);
    expect(rows[0]?.recovery).toEqual({ source: 'record', moduleId: null });
    expect(rows[1]?.recovery).toEqual({ source: 'record', moduleId: 'core' });
    expect(Object.hasOwn(rows[2] ?? {}, 'recovery')).toBe(false);
    expect(await kls2cRecoveryItems(world, noticeId)).toEqual({ status: 'ready', value: { items: [
      { itemNo: 1, kind: 'unreadable', path: architecture },
      { itemNo: 2, kind: 'unreadable', path: file }] } });
    expect(await kls2cRecover(world, noticeId, 1)).toMatchObject({ status: 'committed', value: { path: architecture } });
    expect(world.read(architecture)?.toString('utf8')).toBe(A0);
    expect(await kls2cRecover(world, noticeId, 2)).toMatchObject({ status: 'committed', value: { path: file } });
    expect(world.read(file)?.toString('utf8')).toBe(M0);
  });

// KC-2 U4: a note's record head rebuilds it with no file as a base (4-13); the bytes are the ones notes/write wrote.
// 具名改坏「用坏文件作底重建」→ 没有这一行或没有 recovery；「注记不给记录来源」→ 下一句。
it('U4 (KC-2, SQLite) a bad note rebuilt from its record head, with no file as a base', async () => {
  const first = await hostWorld({ storage: 'sqlite', git: true, idleMs: KLS2C_NEVER_IDLE_MS });
  await kls2cAdopt(first, ['core']);
  const { path } = await kls2cWrittenNote(first, 'kc2-u4', 'u4');
  const W = first.read(path)?.toString('utf8') ?? '';
  const { database, root } = first;
  await worlds.pop()?.close();
  first.edit(path, 'this is not a knowledge note\n');
  const world = await hostWorld({ storage: 'sqlite', git: true, database, root, idleMs: KLS2C_NEVER_IDLE_MS });
  const noticeId = (await world.notices('knowledge_conflict'))[0]?.noticeId ?? '';
  const rows = readyValue<{ problems: KLS2CProblem[] }>(await kls2cProblems(world, noticeId), 'knowledge/problems').problems;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.recovery).toEqual({ source: 'record', moduleId: null });
  expect(await kls2cRecoveryItems(world, noticeId)).toEqual({ status: 'ready',
    value: { items: [{ itemNo: 1, kind: 'unreadable', path }] } });
  expect(await kls2cRecover(world, noticeId, 1)).toMatchObject({ status: 'committed', value: { path } });
  expect(world.read(path)?.toString('utf8')).toBe(W);
});
