/**
 * KLS-2c-1c recovery through a real Host (K01, K13–K16, K37, K08r; [2C1-11], [2C1-13]–[2C1-15], [2C1-17]–[2C1-20],
 * [2C1-23]; errata 2c1#2, #5, #6, #8; rulings G4, G9; split ruling §3, §8; b1 ruling F-10; b2 ruling F-9). A person
 * deletes or reverts an uncommitted knowledge file under a running Host. The idle reconcile tells the person once in the
 * decision queue (`knowledge_reverted`, the count only); `knowledge/recovery-items` lists that notice's items in its own
 * project, and only `knowledge/recover` writes a file back: against the file the notice saw, from the snapshot an item
 * keeps, indexed as the platform's own write, then one more reconcile that asks the region adviser like any other. The
 * world is `KLS2C-knowledge-host.ts` (idle threshold 0 unless a row says otherwise); notes come from `notes/list`,
 * blobs from real `git hash-object`.
 */
import { appendFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain, startLinesEnded } from '../helpers/AG2b-collaboration-fixture.js';
import {
  kls2cAdopt, kls2cBlobSha, kls2cEditModule, kls2cListedNote, kls2cModuleFile, kls2cNoticesAtLeast, kls2cRecover,
  kls2cRecoveryItems, kls2cReviseResponsibility, kls2cWrittenNote, KLS2C_NEVER_IDLE_MS, openKLS2CHost,
  type KLS2CHost, type KLS2CNoticeKind, type KLS2COpenOptions,
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
  // B 的平台和快照库。说明书的改坏「按 noticeId 全局找」在 Host 上造不出来：每个项目一个平台，memory 快照库每个平台一份
  // （create-platform.ts:1220），SQLite 的在项目库目录里（project-store-paths.ts:31），没有两个项目共用的库可找。
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

it('K08r a recovery whose file makes two module files conflict: the recovery round asks the region adviser (F-9)', async () => {
  const first = await hostWorld({ storage: 'sqlite', git: true, kernelStore: true });
  const { database, root } = first;
  await kls2cAdopt(first, ['core', 'other']);
  await startLinesEnded(async () => await first.call('role-lines/operations', plain(first.scope, { workspace: first.scope })));
  const opened = await first.call<{ status: string; value?: { session: SessionRef | null } }>('role-lines/open',
    graphWrite(first.scope, { duty: 'adviser', scope: [{ kind: 'region',
      moduleRef: { projectId: first.scope.projectId, moduleId: 'core' } }] }, 'kls2c1-k08r-adviser'));
  const adviser = opened.value?.session;
  if (opened.status !== 'committed' || !adviser) throw new Error(`role-lines/open: ${JSON.stringify(opened)}`);
  await first.idle();
  const file = kls2cModuleFile(first, 'core');
  const bytes = first.read(file)?.toString('utf8') ?? '';
  await worlds.pop()?.close();
  // 没有 Host 时人删掉 core 的模块文件；新 Host 的启动对账出撤回通知（只开启动对账，之后不再有空闲对账）。
  rmSync(join(root, file));
  const world = await hostWorld({ storage: 'sqlite', git: true, kernelStore: true, database, root,
    idleMs: KLS2C_NEVER_IDLE_MS });
  const [reverted, ...others] = await world.notices('knowledge_reverted');
  expect(others).toEqual([]);
  // 通知之后人把同样的内容放到另一个文件名下：恢复原文件后两个模块文件都写 "id":"core"。
  const moved = '.workbench/modules/0123456789abcdef0123456789abcdef.json';
  world.edit(moved, bytes);
  expect(await actionRequests(world, adviser)).toEqual([]);
  expect(await kls2cRecover(world, reverted?.noticeId ?? '', 1)).toMatchObject({ status: 'committed', value: { path: file } });
  // 恢复之后那一轮对账见到两个文件同 id（冲突通知本身是 b2 的 K07）。b2 裁定 F-9：具名改坏「恢复后的对账直接调底层 reconcileKnowledgeLine、不经 ops 的 reconcile」→ 红在这一句（0 条）。
  expect(await actionRequests(world, adviser)).toHaveLength(1);
}, 180_000);
