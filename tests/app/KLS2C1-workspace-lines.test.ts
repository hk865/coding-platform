/**
 * KLS-2c-1c lines other than one git checkout (split ruling §3; [2C1-02], [2C1-04], [2C1-05], [2C1-19]). K20w: in the
 * two-workspace XWS2P world (memory, roots that are not git), a revision of the second workspace's module whose file
 * never landed (the person's modules folder there is read-only while it runs: its records commit, its file does not)
 * is one unconfirmed-write notice and is recovered in that workspace, rebuilt from the revision's event for the module
 * the write log names in the project view; a system caller of `knowledge/recover` is refused first (c ruling F-8).
 * K22n: on a checkout that is not a git repository the knowledge lease sits under `.workbench/local/leases/`, and while
 * one Host holds it another Host's write is refused (K22's rule, two SQLite Hosts, two projects, one root). Every state
 * comes from a public route or a person's file change.
 */
import { chmodSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createHostCoreCallContext } from '../../src/app/core-call-context.js';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { holdGate, kls2cNoteWrite, KLS2C_NEVER_IDLE_MS, openKLS2CHost } from '../helpers/KLS2C-knowledge-host.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';
import {
  addXWS2PSecondModule, openXWS2PWorld, readXWS2PCatalog, reviseXWS2PFromSecond, xws2pModuleId, type XWS2PWorld,
} from '../helpers/XWS2P-world.js';

const A: CoreScope = { projectId: 'kls2c1-k22n-a', workspaceId: 'kls2c1-k22n-a-ws' };
const B: CoreScope = { projectId: 'kls2c1-k22n-b', workspaceId: 'kls2c1-k22n-b-ws' };
type NoteWriteAnswer = { write: { status: string; code?: string; reason?: string; noteId?: string } };

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  await cleanupRestart();
});

/** At most 20 heartbeats (three consume rounds each, the faked clock one period on) until an unconfirmed-write notice. */
async function unconfirmedNotice(world: XWS2PWorld): Promise<string> {
  for (let round = 0; round < 20; round += 1) {
    for (let beat = 0; beat < 3; beat += 1) {
      const settled = world.world.consumeBarrier();
      world.world.clock.advance(30);
      await settled;
    }
    const queue = readyValue<{ notices: { itemKey: string; summary: string }[] }>(await world.world.dispatch('decisions/queue',
      world.second.ctx, plain(world.second.scope, { workspace: world.second.scope, sections: ['notices'],
        categories: ['project_notice'], page: { limit: 100 } })), 'the project notices');
    const found = queue.notices.filter(notice => notice.summary.includes('没确认落盘'));
    if (found.length > 0) {
      expect(found).toHaveLength(1);
      return found[0]?.itemKey.slice('project_notice:'.length) ?? '';
    }
  }
  throw new Error('no knowledge_write_unconfirmed notice within 20 heartbeats');
}

it('K20w a revision of the second workspace\'s module whose file never landed is recovered in that workspace', async () => {
  const world = await openXWS2PWorld({ extraHostOptions: { scribeReminderPeriodMs: 25, linkBatchIdleMs: 0 } });
  closers.push(() => world.close());
  expect(await addXWS2PSecondModule(world, { moduleId: 'm2', name: 'm2', summary: 'own m2' })).toMatchObject({ status: 'committed' });
  const modules = join(world.second.root, '.workbench/modules');
  const name = readdirSync(modules).find(file =>
    (JSON.parse(readFileSync(join(modules, file), 'utf8')) as { id?: string }).id === 'm2');
  chmodSync(modules, 0o555);
  closers.push(() => chmodSync(modules, 0o755));
  try {
    await reviseXWS2PFromSecond(world, [{ op: 'set_responsibility', moduleId: 'm2', text: 'k20w 修订后' }],
      'kls2c1-k20w', 'KLS2C1 K20w');
  } finally {
    chmodSync(modules, 0o755);
  }
  const noticeId = await unconfirmedNotice(world);
  const path = `.workbench/modules/${name}`;
  expect(await world.world.dispatch('knowledge/recovery-items', world.second.ctx, plain(world.second.scope, { noticeId })))
    .toEqual({ status: 'ready', value: { items: [{ itemNo: 1, kind: 'write_unconfirmed', path }] } });
  // c 裁定 F-8（kls-design §2.2.4「人点了才从事件正文恢复」）：非人的身份调 knowledge/recover 在 owner 之前被拒，文件不动。
  // 具名改坏「恢复路由不过人的守卫」→ 红在这一句（committed）。
  const before = readFileSync(join(world.second.root, path));
  const system = createHostCoreCallContext({ scope: world.second.scope, actor: { kind: 'system', id: 'kls2c1-f8' },
    signal: new AbortController().signal });
  expect(await world.world.dispatch('knowledge/recover', system, plain(world.second.scope, { noticeId, itemNo: 1 })))
    .toEqual({ status: 'rejected', code: 'forbidden', reason: 'only the person may call this route' });
  expect(readFileSync(join(world.second.root, path))).toEqual(before);
  // 具名改坏（切包定稿第三节、[2C1-02]）「模块文件按项目视图 id 直接找、不转成这条线的文件帧」→ 找不到、重建成删除，
  // 对不上 afterBlob，红在这一句（unavailable）。
  expect(await world.world.dispatch('knowledge/recover', world.second.ctx,
    plain(world.second.scope, { noticeId, itemNo: 1 }))).toMatchObject({ status: 'committed', value: { path } });
  const m2 = xws2pModuleId(world.second.scope.workspaceId, 'm2');
  expect((await readXWS2PCatalog(world)).catalog.catalog.modules.find(module => module.ref.moduleId === m2)?.responsibility)
    .toBe('k20w 修订后');
}, 300_000);

it('K22n a checkout that is not git: the lease is under .workbench/local/leases and a second Host is refused while it is held', async () => {
  const gate = holdGate('committed');
  const a = await openKLS2CHost({ storage: 'sqlite', git: false, scope: A, idleMs: KLS2C_NEVER_IDLE_MS, hold: gate.hold });
  closers.push(() => a.close());
  const b = await openKLS2CHost({ storage: 'sqlite', git: false, root: a.root, scope: B, idleMs: KLS2C_NEVER_IDLE_MS });
  closers.push(() => b.close(), () => gate.release());   // released first, then the Hosts close
  a.edit('src/module.ts', 'export const m = 1;\n');
  const anchor = { kind: 'file', path: 'src/module.ts' } as const;
  const aWrite = a.call<NoteWriteAnswer>('notes/write', kls2cNoteWrite(A, 'k22n-a', { topic: 'k22n-a', anchor }));
  aWrite.catch(() => undefined);
  // [2C1-04]：不是 git 的检出照常写，A 拿着租约停在 committed。
  expect(await Promise.race([gate.reached.then(() => 'held'), aWrite.then(() => 'answered')])).toBe('held');
  // 具名改坏 [2C1-05]「不是 git 的检出也照 git 仓的写法放租约（<repoKey>/workbench/leases/）」→ 红在这一句（目录不在，2c-1a 上实跑核过）。
  expect(readdirSync(join(a.root, '.workbench/local/leases'))).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/)]);
  const refused = await b.call<NoteWriteAnswer>('notes/write', kls2cNoteWrite(B, 'k22n-b-1', { topic: 'k22n-b', anchor }));
  // 具名改坏 [2C1-04]「不判 held_by_other」→ 红在这一句。
  expect(refused.write).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(refused.write.reason).toContain('另一个 Host');
  // B's file left unwritten and both writes after A lets go: K22 (KLS2C1-checkout-lease).
}, 120_000);
