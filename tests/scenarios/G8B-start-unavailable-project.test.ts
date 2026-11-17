/**
 * G8B-1b 写测试方（`g8b-rulings.md` 的 B4；行 D8、D9；仅 SQLite：要停机再启动）。世界是 G8A 的 `openG8Project`（新项目 A，
 * S6A 项目是 B）；它只开内存，这里用模块 mock 把它调的 `openS6AHostWorld` 换成 SQLite（`G8-world.ts` 不在白名单里）。
 * A 里人采用带检查的计划，装上检查后按住采用的提交，`crash()` 起新 Host（C7d 的做法）。
 * D8：停机前挪走 A 的库（KLS1B-02）。旧 Host 还活着，会按原路径重建空库（探针：500 毫秒内多出 `kernel-stores/`，新 Host
 * 打开空库报“the target project is not registered”），所以挪走和把上一层设成只读是紧挨着的两个同步调用，挪回来也一样。
 * 新 Host 起得来，B 照常，A 回 `unavailable`，A 的记录还在；挪回来再重启，检查被收回、计划没采用（同 C7d）。今天红在
 * `crash()`：启动结清读不到 A 的候选，整个 Host 起不来；B4 跳过不可用项目的记录后转绿。
 * D9：设置目录只读（`blockSettingsSave` 的做法），A 的记录结不清 → 启动失败，错误带候选 id。今天绿（守护行）。
 * 改坏演示（临时改启动结清那一行，恢复后 `git diff -- src` 为空）：可用项目也跳过 → D9 红；“读不到候选就跳过”的替身下
 * D8 绿，替身再删掉待恢复记录 → D8 红在“检查没被收回”。
 */
import { chmodSync, renameSync, statSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { g8Check, g8PlanDraft, g8SplitChecks, openG8Project } from '../helpers/G8-world.js';
import { hostProjectStoreDirectory } from '../helpers/KLS1B-host-store.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6AHostWorld, S6AHostWorldOptions } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed } from '../helpers/S7A-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
vi.mock('../helpers/S6A-host-fixture.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../helpers/S6A-host-fixture.js')>();
  return { ...real, openS6AHostWorld: (options: S6AHostWorldOptions) => real.openS6AHostWorld({ ...options, backend: 'sqlite' }) };
});

const cleanup: (() => Promise<void>)[] = [];
// 被丢下的旧 Host 的采用还按着；先放开，再关世界（同 C7）。
afterEach(async () => { commitBarrier.reset(); await Promise.allSettled(cleanup.splice(0).reverse().map(close => close())); });

/** 项目 A 里人采用一份带 `<tag>-check` 的计划；检查装上了、采用的提交被按住时返回。 */
async function heldAdoption(tag: string) {
  const project = await openG8Project(tag, [g8Check('g8-seed-check', ['g8-seed-work', 'g8-seed-gate'])]);
  cleanup.push(project.close);
  const goal = (await s6aCardsWorkspace(project.world, project.scope).createGoal(`${tag}-goal`)).ref;
  const { draft, checks } = g8SplitChecks(g8PlanDraft(goal, tag, 'local-workbench', [g8Check(`${tag}-check`, [`${tag}-work`])]));
  const proposal = committed<{ ref: { proposalId: string }; revision: number }>(await project.world.post('plans/propose',
    graphWrite(project.scope, { goalRef: goal, basedOn: null, draft, checks, reason: { text: tag, sources: [] } },
      `${tag}-propose`)), `${tag}: propose`);
  // 按住期间设置队列被这次采用占着、快照读不了，所以库的位置先读。
  const store = await hostProjectStoreDirectory(project.scope.projectId, (await project.settingsEntry()).root);
  // 先正常重启一次：S6A 的启动工作区第二次启动才进项目清单、写一次设置文件（V12），不然 D9 先挡在那一步。
  await project.world.reopen();
  const adoption = commitBarrier.hold(byIdentityPrefix('plan-apply:'), `${tag} adoption`);
  void project.world.post('plans/apply', graphWrite(project.scope, { proposalRef: proposal.ref,
    expectedProposalRevision: proposal.revision, decisionRefs: [] }, `${tag}-apply`)).catch(() => undefined);
  await adoption.reached;
  return { project, goal, proposalId: proposal.ref.proposalId, store };
}
const goalRead = async (world: S6AHostWorld, scope: WorkspaceScope, goal: GoalRef) =>
  (await world.post('goals/read', plain(scope, goal))).body;

describe('G8B-1b B4: a pending plan adoption at the Host start (SQLite only)', () => {
  it('D8: the project whose store is gone keeps its record; the Host starts; back, the record settles', async () => {
    const { project, goal, store } = await heldAdoption('g8b-d8');
    const b = (await s6aCardsWorkspace(project.world, S6A_SCOPE).createGoal('g8b-d8-b')).ref;
    const parent = dirname(store);
    const mode = statSync(parent).mode & 0o777;
    let away = true;
    const putBack = (): void => { if (away) { chmodSync(parent, mode); renameSync(`${store}-away`, store); away = false; } };
    cleanup.push(async () => putBack());
    renameSync(store, `${store}-away`);
    chmodSync(parent, 0o555);

    await project.world.crash();
    expect(await goalRead(project.world, S6A_SCOPE, b)).toMatchObject({ status: 'ready' });
    expect(await goalRead(project.world, project.scope, goal))
      .toEqual({ status: 'rejected', code: 'unavailable', reason: 'the project store is not available' });
    expect(JSON.stringify(await project.settingsEntry()), 'the pending record was dropped').toContain('g8b-d8-check');

    putBack();
    await project.world.reopen();
    expect(JSON.stringify(await project.settingsEntry()), 'the check was not taken back').not.toContain('g8b-d8-check');
    expect(await goalRead(project.world, project.scope, goal)).toMatchObject({ status: 'ready',
      value: { goal: { activePlanRevision: null } } });
  }, 240_000);

  it('D9: an open project\'s record that cannot settle stops the start, naming the candidate', async () => {
    const { project, proposalId } = await heldAdoption('g8b-d9');
    const settings = join(project.world.database, 'host-settings');
    await chmod(settings, 0o500);
    try {
      await expect(project.world.crash()).rejects.toThrow(proposalId);
    } finally {
      await chmod(settings, 0o700);
    }
  }, 240_000);
});
