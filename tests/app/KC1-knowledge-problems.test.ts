/**
 * KC-1 G3 (121-106 ②; 4-2 A, 4-4, 4-5, 4-6, 4-10; draft §3 V7–V17): every place a line's knowledge files go wrong is one
 * row of the `knowledge_conflict` notice, read back through `knowledge/problems {noticeId}` (a plain route, the
 * recovery-items read's shape). The rows are the draft's V7–V17: a duplicate module id next to a module the index names
 * without a file (V7), one path claimed by two modules (V8), a dangling reference (V9), a dependency cycle (V10), two
 * modules the index names without files (V11), the graph validator's fallback row (V12), a project-level merge failure
 * in the second workspace (V13), the same rows after closing and reopening the same SQLite store (V14), a bad note file
 * (V15), the notice item's `noticeKind` (V16), and the route's refused input (V17).
 *
 * The world is `KLS2C-knowledge-host.ts` (`openKLS2CHost`, `kls2cAdopt`, `kls2cConflict`, `kls2cModuleFile`,
 * `kls2cEditModule`, `kls2cProblems`, `world.notices`, `world.idle`); V13 is the two-workspace `XWS2P-world.ts`, its
 * second root edited as a person would. Only `knowledge/problems` and the public edits are used; no store is read.
 *
 * **Today (base `7dkc1t-base`) every row is red at the read**: the route is unpublished, so the Host answers
 * `{status:'rejected', code:'not_found', reason:'unpublished core route knowledge/problems'}` and V7–V16 stop on
 * `expect(answer.status).toBe('ready')` (V13 on "no notice yet", since the project merge failure has no notice today;
 * V14 on the `before` read; V15 on the same read as V7–V12; V16 on the missing `noticeKind`; V17's `not_found` row on the
 * unpublished route's rejected `not_found`, which is not the route's own read result). V17's `invalid` row is red too
 * (the missing route's `not_found` is not `invalid`). After the package lands every row is green by the draft's §2.3 rules: the reconcile
 * writes the places into the new `knowledge_problem` table before the notice, the route reads them back, and the notice
 * item carries `noticeKind`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain, startLinesEnded } from '../helpers/AG2b-collaboration-fixture.js';
import {
  kls2cAdopt, kls2cConflict, kls2cEditModule, kls2cModuleFile, kls2cProblems, KLS2C_NEVER_IDLE_MS, openKLS2CHost,
  type KLS2CHost, type KLS2CProblem,
} from '../helpers/KLS2C-knowledge-host.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';
import { addXWS2PSecondModule, openXWS2PWorld, type XWS2PWorld } from '../helpers/XWS2P-world.js';

type SessionRef = { projectId: string; sessionId: string };

const worlds: KLS2CHost[] = [];
const xwsWorlds: XWS2PWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.close();
  for (const world of xwsWorlds.splice(0).reverse()) await world.close();
  await cleanupRestart();
});

/** A Host world with `core` and `other` adopted through `architecture/adopt-initial`. */
async function adoptedWorld(storage: 'memory' | 'sqlite' = 'memory', kernelStore?: true): Promise<KLS2CHost> {
  const world = await openKLS2CHost({ storage, git: true, ...(kernelStore === undefined ? {} : { kernelStore }) });
  worlds.push(world);
  await kls2cAdopt(world, ['core', 'other']);
  return world;
}

/** The one `knowledge_conflict` notice after one idle round. */
async function oneNotice(world: KLS2CHost): Promise<{ noticeId: string; summary: string }> {
  await world.idle();
  const notices = await world.notices('knowledge_conflict');
  expect(notices).toHaveLength(1);
  return notices[0]!;
}

/** `knowledge/problems {noticeId}` after one idle round, or the answer's own refusal named. */
async function problemsOf(world: KLS2CHost, noticeId: string): Promise<KLS2CProblem[]> {
  const answer = await kls2cProblems(world, noticeId);
  expect(answer.status).toBe('ready');
  return answer.value?.problems ?? [];
}

/** A person edits `architecture.json`: parse it, change one thing, write the whole file back. */
function editArchitecture(world: KLS2CHost, change: (file: Record<string, unknown>) => void): void {
  const path = '.workbench/architecture.json';
  const file = JSON.parse(world.read(path)?.toString('utf8') ?? '{}') as Record<string, unknown>;
  change(file);
  world.edit(path, `${JSON.stringify(file, null, 2)}\n`);
}

/** The notice rows of `decisions/queue` as the Decide page reads them (the notice item's optional `noticeKind`). */
const noticeItems = async (world: KLS2CHost): Promise<{ summary: string; noticeKind?: string }[]> =>
  readyValue<{ notices: { summary: string; noticeKind?: string }[] }>(await world.call('decisions/queue',
    plain(world.scope, { workspace: world.scope, sections: ['notices'], categories: ['project_notice'],
      page: { limit: 100 } })), 'decisions/queue').notices;

it('V7 a duplicate module id (two files write "core") is one place, and the module the index names without a file is '
  + 'another: each file\'s source is the projection\'s (ruling 4-2 A)', async () => {
  const world = await adoptedWorld();
  const [core, other] = kls2cConflict(world, 'same_id');
  const notice = await oneNotice(world);
  const problems = await problemsOf(world, notice.noticeId);
  // 具名改坏（落地后）：来源只看 git 状态、不比记录里的投影 → core 的文件变 "uncommitted"，红在第一行的 files。
  // 今天红在 `problemsOf`：`knowledge/problems` 还没发布（Host 回 unpublished core route 的 not_found）。
  const duplicateFiles = [{ path: core, source: 'platform' }, { path: other, source: 'uncommitted' }]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  expect(problems).toEqual([
    { itemNo: 1, kind: 'duplicate_module_id', moduleIds: ['core'], files: duplicateFiles,
      reason: '2 个模块文件都写了模块号 core：一个模块号只能有一个文件，删掉或改掉多余的' },
    { itemNo: 2, kind: 'module_without_file', moduleIds: ['other'],
      files: [{ path: '.workbench/architecture.json', source: 'platform' }],
      reason: 'architecture.json 点名了模块 other，但没有它的模块文件：补上文件，或从 architecture.json 去掉' },
  ]);
}, 120_000);

it('V8 one path claimed by two modules is one place (the same id set merges), and the notice summary is unchanged',
  async () => {
    const world = await adoptedWorld();
    const [core, other] = kls2cConflict(world, 'same_path');
    const notice = await oneNotice(world);
    // 具名改坏：每个模块号各出一行 → 红在 problems 的长度（2 行）。今天红在 `problemsOf`（路由未发布）。
    const problems = await problemsOf(world, notice.noticeId);
    const files = [{ path: core, source: 'platform' }, { path: other, source: 'uncommitted' }]
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    expect(problems).toEqual([{ itemNo: 1, kind: 'path_claimed_by_two_modules', moduleIds: ['core', 'other'], files,
      reason: '模块 core、other 都认领了 src/core：一个路径只能归一个模块，从其余模块的 paths 里去掉' }]);
    // 护栏（121-106 ② 之前的行为，不能变）：通知号仍由条目算，摘要仍列两个文件。
    expect([notice.summary.includes(core), notice.summary.includes(other)]).toEqual([true, true]);
  }, 120_000);

it('V9 a module that depends on a missing one is one dangling place naming both (ruling 4-6)', async () => {
  const world = await adoptedWorld();
  const core = kls2cModuleFile(world, 'core');
  kls2cEditModule(world, core, { dependsOn: [{ to: 'ghost', reason: 'k' }] });
  const notice = await oneNotice(world);
  // 具名改坏：moduleIds 只写缺的目标 T（ghost）→ 红在 moduleIds。今天红在 `problemsOf`（路由未发布）。
  expect(await problemsOf(world, notice.noticeId)).toEqual([{
    itemNo: 1, kind: 'dangling_reference', moduleIds: ['core', 'ghost'],
    files: [{ path: core, source: 'uncommitted' }],
    reason: '模块 core 引用了不存在的模块 ghost：改 core 的 contains 或 dependsOn，或补上 ghost 的模块文件',
  }]);
}, 120_000);

it('V10 a dependency cycle is one place and is not hidden behind the fallback row', async () => {
  const world = await adoptedWorld();
  const core = kls2cModuleFile(world, 'core');
  const other = kls2cModuleFile(world, 'other');
  kls2cEditModule(world, core, { dependsOn: [{ to: 'other', reason: 'k' }] });
  kls2cEditModule(world, other, { dependsOn: [{ to: 'core', reason: 'k' }] });
  const notice = await oneNotice(world);
  // 具名改坏：不判环 → 只剩兜底的 `other` 行，红在 kinds。今天红在 `problemsOf`（路由未发布）。
  const problems = await problemsOf(world, notice.noticeId);
  expect(problems.map(problem => [problem.kind, problem.moduleIds]))
    .toEqual([['cycle', ['core', 'other']]]);
  expect(problems[0]?.reason).toBe('模块 core、other 的依赖成环：去掉环上的一条 dependsOn');
}, 120_000);

it('V11 two modules the index names without files are two places, not only the first', async () => {
  const world = await adoptedWorld();
  editArchitecture(world, file => { file['modules'] = ['core', 'ghost1', 'ghost2', 'other']; });
  const notice = await oneNotice(world);
  // 具名改坏：只报第一个（今天 `architectureOfFiles` 的行为）→ 红在 problems 的长度（1 行）。今天红在 `problemsOf`。
  expect((await problemsOf(world, notice.noticeId)).map(problem => [problem.kind, problem.moduleIds, problem.reason]))
    .toEqual([
      ['module_without_file', ['ghost1'],
        'architecture.json 点名了模块 ghost1，但没有它的模块文件：补上文件，或从 architecture.json 去掉'],
      ['module_without_file', ['ghost2'],
        'architecture.json 点名了模块 ghost2，但没有它的模块文件：补上文件，或从 architecture.json 去掉'],
    ]);
}, 120_000);

it('V12 a graph the records cannot read (a duplicate interface id) is one fallback place on architecture.json',
  async () => {
    const world = await adoptedWorld();
    const core = kls2cModuleFile(world, 'core');
    kls2cEditModule(world, core, { interfaces: [
      { id: 'same', description: 'a', paths: ['src/core'] },
      { id: 'same', description: 'b', paths: ['src/core'] },
    ] });
    const notice = await oneNotice(world);
    // 具名改坏：去掉兜底 `other` → 读回 not_found，红在 status。今天红在 `problemsOf`（路由未发布）。
    const problems = await problemsOf(world, notice.noticeId);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ itemNo: 1, kind: 'other', moduleIds: [],
      files: [{ path: '.workbench/architecture.json', source: 'platform' }] });
    expect(problems[0]?.reason.startsWith('架构图读不出：')).toBe(true);
    expect(problems[0]?.reason).toContain('duplicate interface id');
  }, 120_000);

it('V13 a project-level merge failure is a knowledge_conflict in the workspace whose own graph reads (ruling 4-4)',
  async () => {
    const xws = await openXWS2PWorld({ extraHostOptions: { linkBatchIdleMs: 0, scribeReminderPeriodMs: 25 } });
    xwsWorlds.push(xws);
    // The second workspace's own module and architecture file first (a person's `architecture/revise` there).
    expect(await addXWS2PSecondModule(xws, { moduleId: 'second-mod', name: 'second-mod', summary: 'own second-mod' }))
      .toMatchObject({ status: 'committed' });
    const architecture = join(xws.second.root, '.workbench/architecture.json');
    const file = JSON.parse(await readFile(architecture, 'utf8')) as Record<string, unknown>;
    const cross = file['crossWorkspace'] as { dependsOn: unknown[]; contains: unknown[] };
    // The second line reads by itself: only the project merge misses the main workspace's ghost module.
    cross.dependsOn = [{ from: 'second-mod', to: 'ghost-module', reason: 'V13' }];
    await writeFile(architecture, `${JSON.stringify(file, null, 2)}\n`);
    // 具名改坏：不做项目级核对 → 第二工作区没有通知，红在 notices 的长度。今天红在这里（今天没有项目级核对）。
    let noticeId: string | null = null;
    for (let round = 0; round < 20 && noticeId === null; round += 1) {
      // The S6A world's clock is frozen: register the barrier, clear the period, then wait for the real pass.
      const settled = xws.world.consumeBarrier();
      xws.world.clock.advance(25);
      await settled;
      const page = await xws.world.post('decisions/queue', plain(xws.second.scope, { workspace: xws.second.scope,
        sections: ['notices'], categories: ['project_notice'], page: { limit: 100 } }));
      const notices = readyValue<{ notices: { itemKey: string; summary: string }[] }>(page.body, 'decisions/queue')
        .notices.filter(item => item.summary.includes('知识文件有'));
      noticeId = notices[0]?.itemKey.slice('project_notice:'.length) ?? null;
    }
    expect(noticeId).not.toBeNull();
    const answer = await xws.world.post('knowledge/problems', plain(xws.second.scope, { noticeId }));
    const problems = readyValue<{ problems: KLS2CProblem[] }>(answer.body, 'knowledge/problems').problems;
    expect(problems.some(problem => problem.kind === 'project_merge'
      && problem.reason.startsWith('几个工作区的架构图合不起来：'))).toBe(true);
  }, 180_000);

it('V14 (storage row, SQLite only) the same places are read after closing and reopening the same store', async () => {
  const first = await adoptedWorld('sqlite');
  kls2cConflict(first, 'same_path');
  const notice = await oneNotice(first);
  const before = await problemsOf(first, notice.noticeId);
  const { database, root } = first;
  await worlds.pop()?.close();
  const world = await openKLS2CHost({ storage: 'sqlite', git: true, database, root, idleMs: KLS2C_NEVER_IDLE_MS });
  worlds.push(world);
  // 具名改坏：行只放内存 → 重开后路由回 not_found，红在 `problemsOf` 的 status。今天两端都红（路由未发布）。
  expect(await problemsOf(world, notice.noticeId)).toEqual(before);
}, 180_000);

it('V15 a note file that is not a knowledge note is one bad-file place (ruling 4-6)', async () => {
  const world = await adoptedWorld();
  const path = `.workbench/notes/${world.scope.workspaceId}/not-a-note.md`;
  world.edit(path, 'this is not a knowledge note\n');
  const notice = await oneNotice(world);
  // 具名改坏：只出图的行、丢掉第 7 步的 fileIssues → 读回 not_found，红在 status。今天红在 `problemsOf`。
  const problems = await problemsOf(world, notice.noticeId);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatchObject({ itemNo: 1, kind: 'bad_file', moduleIds: [],
    files: [{ path, source: 'uncommitted' }] });
  expect(problems[0]?.reason.startsWith('文件读不出：')).toBe(true);
}, 120_000);

it('V16 the conflict notice item carries noticeKind (ruling 4-10); another kind of project notice does not',
  async () => {
  const world = await adoptedWorld('memory', true);
  // A non-knowledge project notice in the same page: a Goal is put on an adviser line through the person's
  // `goals/adviser-queue/assign`, which writes an `automatic_adjustment` project notice.
  await startLinesEnded(async () => await world.call('role-lines/operations', plain(world.scope, { workspace: world.scope })));
  const registration = await world.call<{ status: string; value: { project: { ref: unknown; revision: number };
    workspace: { ref: unknown; revision: number } } }>('workspaces/registration', plain(world.scope, world.scope));
  if (registration.status !== 'ready') throw new Error(`workspaces/registration: ${JSON.stringify(registration)}`);
  const goalId = 'kc1-v16-goal';
  const goal = await world.call<{ status: string }>('goals/create', graphWrite(world.scope,
    { goalId, workspace: { ...world.scope }, objective: 'KC-1 V16 notice kinds' }, 'kc1-v16-goal', [
      { ref: registration.value.project.ref, revision: registration.value.project.revision },
      { ref: registration.value.workspace.ref, revision: registration.value.workspace.revision },
    ]));
  if (goal.status !== 'committed') throw new Error(`goals/create: ${JSON.stringify(goal)}`);
  const opened = await world.call<{ status: string; value?: { session: SessionRef | null } }>('role-lines/open',
    graphWrite(world.scope, { duty: 'adviser', scope: [{ kind: 'region',
      moduleRef: { projectId: world.scope.projectId, moduleId: 'core' } }] }, 'kc1-v16-adviser'));
  if (opened.status !== 'committed' || !opened.value?.session) throw new Error(`role-lines/open: ${JSON.stringify(opened)}`);
  const queue = await world.call<{ status: string; value: { revision: number } }>('goals/adviser-queue',
    plain(world.scope, {}));
  if (queue.status !== 'ready') throw new Error(`goals/adviser-queue: ${JSON.stringify(queue)}`);
  const assigned = await world.call<{ status: string }>('goals/adviser-queue/assign',
    graphWrite(world.scope, { goalRef: { aggregateType: 'Goal', projectId: world.scope.projectId, goalId },
      adviser: opened.value.session, expectedRevision: queue.value.revision }, 'kc1-v16-assign'));
  if (assigned.status !== 'committed') throw new Error(`goals/adviser-queue/assign: ${JSON.stringify(assigned)}`);
  kls2cConflict(world, 'same_path');
  await world.idle();
  // 具名改坏：视图不写 `noticeKind` → 冲突那条没有这个键，红在第一句。
  // 具名改坏：视图给每条通知都写 `noticeKind` → 自动调整那条也有，红在最后一句。
  const items = await noticeItems(world);
  const conflicts = items.filter(item => item.summary.includes('知识文件有'));
  expect(conflicts.map(item => item.noticeKind)).toEqual(['knowledge_conflict']);
  const others = items.filter(item => !item.summary.includes('知识文件有'));
  expect(others.length).toBeGreaterThan(0);
  expect(others.every(item => item.noticeKind === undefined)).toBe(true);
}, 120_000);

describe('rejects: knowledge/problems input', () => {
  it('V17a an empty input is invalid', async () => {
    const world = await adoptedWorld();
    // 具名改坏：去掉输入核对 → 空输入不是 invalid（读成 not_found），红在这里。今天红（未发布的路由回 not_found）。
    expect(await world.call('knowledge/problems', plain(world.scope, {})))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  }, 120_000);
});

it('V17b an unknown notice id is not_found (a notice of another project is not read either)', async () => {
  const world = await adoptedWorld();
  kls2cConflict(world, 'same_path');
  // 具名改坏：去掉读取口的项目比较/项目范围的快照库 → 别的项目读出 A 的行，红在第二句。
  const mine = await oneNotice(world);
  expect((await problemsOf(world, mine.noticeId)).length).toBeGreaterThan(0);
  expect(await kls2cProblems(world, 'nope')).toEqual({ status: 'not_found' });
}, 120_000);

it('V17b (two projects, one Host) another project\'s context cannot read this project\'s notice places',
  async () => {
  const other: CoreScope = { projectId: 'kc1-v17b-b', workspaceId: 'kc1-v17b-b-ws' };
  const world = await openKLS2CHost({ storage: 'memory', git: true, alsoServe: other });
  worlds.push(world);
  await kls2cAdopt(world, ['core', 'other']);
  kls2cConflict(world, 'same_path');
  const notice = await oneNotice(world);
  // A's own read is ready; B's context opens only B's platform and snapshot store, so A's notice id is not found.
  // 具名改坏：把每个项目的快照库改成进程级一份（去掉项目键）→ B 读到 A 的行，红在这个 `ready` 上。
  expect((await problemsOf(world, notice.noticeId)).length).toBeGreaterThan(0);
  expect(await kls2cProblems(world, notice.noticeId, other)).toEqual({ status: 'not_found' });
}, 120_000);
