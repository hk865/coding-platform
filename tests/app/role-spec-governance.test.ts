/**
 * RW-14 真实 HTTP：第五个治理种类 RoleSpecRevision 的产品入口（ADR 0003 D4）与 M3 阻断项。
 *
 * 全部经真实 HTTP + 真实 SQLite 账本 + 真实内核适配器；只有模型端点是本地桩，它只负责让
 * preflight 的 bind 成功并立即结束一次调用（本票断言都在 claim／角色校验这一侧，与模型输出无关）。
 *
 *   1. 治理视图给出第五个种类：逐角色的安装事实、内容 revision 与摘要、生效引用、安装者与时间，
 *      以及「当前生效的协调策略到底含不含角色矩阵」；重开后逐字一致。
 *   2. 没有矩阵（没有生效策略）时，人工真实运行照常派发——既有放行语义不被静默改变。
 *   3. 含 roles 的矩阵生效后：矩阵 pin 还没有已激活规格时确实会被拒（视图提前把这件事说出来），
 *      把规格装齐激活之后，**同一条产品入口**照常派发（M3 验收）。
 *   4. 矩阵 pin 的是只读规格时，写入入口的越权声明被拒且**零写**（该目标下没有新增任何派发快照）。
 *   5. 只读探索入口在矩阵启用后照常派发（M3 探索侧）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createGuiServer } from '../../src/app/server.js';
import type { GovernanceActivateResultV1, GovernanceInstallResultV1, GovernanceViewV1, RoleSpecEntryViewV1 } from '../../src/contracts/governance-view.js';
import { ROLE_SPEC_SOURCES_V1, ROLE_SOURCE_EXECUTOR, ROLE_SOURCE_INVESTIGATOR, roleSpecSourceFor } from '../../src/fixtures/role-spec-fixtures.js';
import { ROLE_SPEC_REVISION, roleSpecContentDigest, type RoleSpecContentV1 } from '../../src/contracts/role-spec.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

/** 模型端点桩：一次调用就返回结束消息，真实运行随即走到终态，不把工作区锁留在测试目录里。 */
async function startModelStub() {
  const provider = createServer(async (req, res) => {
    for await (const _chunk of req) { /* 读完请求体 */ }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(ready => provider.listen(0, '127.0.0.1', ready));
  const address = provider.address();
  if (!address || typeof address === 'string') throw Error('模型桩没有地址');
  cleanup.push(async () => { provider.closeAllConnections(); await new Promise<void>(done => provider.close(() => done())); });
  return 'http://127.0.0.1:' + address.port;
}

type Scope = { projectId: string; workspaceId: string };

async function start() {
  const directory = await mkdtemp(join(tmpdir(), 'rw14-role-spec-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const modelBaseUrl = await startModelStub();
  const data = join(directory, 'data');
  const options = { modelSettings: { directory: join(directory, 'credentials') }, explorationContextOnlyRoots: [] as string[] };
  let app = await createGuiServer(data, options);
  let closed = false;
  let base = '';
  let token = '';
  async function listen() {
    await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw Error('No application address');
    base = 'http://127.0.0.1:' + address.port;
    token = ((await (await fetch(base + '/api/meta')).json()) as { workspaceToken: string }).workspaceToken;
  }
  const close = async () => { if (!closed) { closed = true; await app.close(); } };
  // 先关服务（它会等待已派发的后台运行收口），再由 afterEach 删目录：否则运行还在写 real-runs
  // 时目录删不干净（ENOTEMPTY），把「清理没做完」误报成产品缺陷。
  cleanup.push(close);
  await listen();
  const post = async <T = Record<string, unknown>>(path: string, body: unknown) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as T };
  };
  const settings = await post('/api/model-settings', { provider: 'deepseek', model: 'rw14-stub', baseUrl: modelBaseUrl, apiKey: 'synthetic-local-key' });
  expect(settings.status).toBe(200);

  /** 每个场景用自己的项目目录：互不共享 checkout，也就不存在互相抢工作区租约的时序问题。 */
  const addProject = async (name: string): Promise<Scope> => {
    const root = join(directory, name);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'README.md'), '# ' + name + '\nRW-14 场景目录\n');
    const project = (await post<{ projectId: string; workspaceId: string }>('/api/projects/add', { path: root })).body;
    return { projectId: project.projectId, workspaceId: project.workspaceId };
  };
  const createGoal = async (scope: Scope, goalId: string) => {
    const created = await post('/api/goals', { ...scope, requestId: goalId, objective: 'RW-14 角色规格与矩阵' });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
  };
  const view = async (scope: Scope) => {
    const result = await post<GovernanceViewV1>('/api/real/governance/view', scope);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body;
  };
  const install = (scope: Scope, input: Record<string, unknown>) =>
    post<GovernanceInstallResultV1>('/api/real/governance/install', { ...scope, ...input });
  const activate = (scope: Scope, input: Record<string, unknown>) =>
    post<GovernanceActivateResultV1>('/api/real/governance/activate', { ...scope, ...input });
  /**
   * **派发事实**的快照条数：lease／attempt／run／outbox 四类聚合。
   *
   * 只读打开真实账本文件——这是「零写」在真实产品链上可直接核对的证据。这里刻意排除
   * 规划事实（PlanRevision／Task）：入口在校验 claim **之前**会先确保该目标已有人工计划，
   * 那一步的写入不是本次 claim 的产物，把它们算进来会把「零写」说成假命题。
   */
  const dispatchSnapshots = (scope: Scope): number => {
    const db = new DatabaseSync(join(data, 'projects', encodeURIComponent(scope.projectId), 'ledger.sqlite'), { readOnly: true });
    try {
      return (db.prepare(
        "SELECT COUNT(*) AS n FROM snapshots WHERE ref_key LIKE '{\"aggregateType\":\"TaskLease\"%' OR ref_key LIKE '{\"aggregateType\":\"TaskAttempt\"%' OR ref_key LIKE '{\"aggregateType\":\"Run\"%' OR ref_key LIKE '{\"aggregateType\":\"DispatchOutboxEntry\"%'",
      ).get() as { n: number }).n;
    } finally { db.close(); }
  };
  return {
    directory, data, post, addProject, createGoal, view, install, activate, dispatchSnapshots,
    close,
    restart: async () => { await close(); closed = false; app = await createGuiServer(data, options); await listen(); },
  };
}
type Fixture = Awaited<ReturnType<typeof start>>;

const kindOf = (view: GovernanceViewV1, kind: string) => view.kinds.find(entry => entry.kind === kind)!;
const roleOf = (view: GovernanceViewV1, roleId: string): RoleSpecEntryViewV1 =>
  kindOf(view, 'RoleSpecRevision').roleSpecs!.find(entry => entry.roleId === roleId)!;
/** 界面构建矩阵 pin 用的就是视图给出的这一个 pin（不是界面自己算的摘要）。 */
function pinOf(view: GovernanceViewV1, roleId: string) {
  const pin = roleOf(view, roleId).pin;
  expect(pin, roleId + ' 没有可用的 pin').not.toBeNull();
  return pin!;
}

function matrixContent(pins: Record<string, { ref: unknown; digest: string }>, coordinator: string) {
  return {
    schemaVersion: 1 as const,
    budget: { maxAutonomousReworks: 2, maxClarifications: 3 },
    allowed: { inScopeRework: true, inScopeTesting: true as const },
    scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] as ['requirement', 'acceptance', 'baseline'] },
    upgrade: { path: 'manual-decision' as const, note: '策略升级需人工决定' },
    roles: { catalog: pins, coordinator: { roleId: coordinator, note: '跨工作包议题由该角色收敛' } },
  };
}

/** 没有角色矩阵的协调策略正文（用于验证「不含矩阵 ⇒ claim 不做角色校验」）。 */
function policyWithoutMatrix() {
  return {
    schemaVersion: 1 as const,
    budget: { maxAutonomousReworks: 2, maxClarifications: 3 },
    allowed: { inScopeRework: true, inScopeTesting: true as const },
    scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] as ['requirement', 'acceptance', 'baseline'] },
    upgrade: { path: 'manual-decision' as const, note: '策略升级需人工决定' },
  };
}

/** 经产品入口安装并激活一份协调策略（安装 CAS@0、激活用当前 Project revision 做 CAS）。 */
async function installPolicy(fixture: Fixture, scope: Scope, policyId: string, content: unknown) {
  const install = await fixture.install(scope, { kind: 'CoordinationPolicy', source: { policyId, content } });
  expect(install.body, JSON.stringify(install.body)).toMatchObject({ status: 'committed' });
  const activated = await fixture.activate(scope, { kind: 'CoordinationPolicy', pin: { ref: install.body.revisionRef, digest: install.body.contentDigest } });
  expect(activated.body, JSON.stringify(activated.body)).toMatchObject({ status: 'committed' });
}

/** 经产品入口安装并激活角色规格（界面的「安装并激活」就是这两步）。 */
async function installRole(fixture: Fixture, scope: Scope, roleId: string, source?: unknown) {
  const install = await fixture.install(scope, source === undefined ? { kind: 'RoleSpecRevision', roleId } : { kind: 'RoleSpecRevision', source });
  expect(install.body, JSON.stringify(install.body)).toMatchObject({ status: 'committed' });
  const pin = { ref: install.body.revisionRef, digest: install.body.contentDigest };
  const activated = await fixture.activate(scope, { kind: 'RoleSpecRevision', pin });
  expect(activated.body, JSON.stringify(activated.body)).toMatchObject({ status: 'committed' });
  return pin;
}

describe('RW-14 第五个治理种类：角色规格', () => {
  it('视图给出逐角色事实与「本策略含不含角色矩阵」，安装/激活/重启后仍可读', async () => {
    const fixture = await start();
    const scope = await fixture.addProject('spec-view');
    await fixture.createGoal(scope, 'rw14-goal-view');

    // 1) 默认：第五个种类在治理视图里，八个内置角色都还没有规格；没有生效策略 = 没有矩阵。
    const initial = await fixture.view(scope);
    expect(initial.kinds.map(entry => entry.kind)).toEqual([
      'CompletionPolicy', 'ArchitectureBaseline', 'CoordinationPolicy', 'ArchitectureEvolutionPolicy', 'RoleSpecRevision',
    ]);
    const roleSpecKind = kindOf(initial, 'RoleSpecRevision');
    expect(roleSpecKind.roleSpecs!.map(entry => entry.roleId)).toEqual([...ROLE_SPEC_SOURCES_V1.map(source => source.roleId)].sort());
    expect(roleSpecKind.roleSpecs!.every(entry => entry.installed.length === 0 && entry.active === null)).toBe(true);
    expect(roleSpecKind.roleSpecs!.every(entry => entry.readiness.status === 'spec_not_installed')).toBe(true);
    // 视图必须把「没有矩阵 ⇒ claim 不做角色校验」写出来，而不是让人从“安装成功”推断已经校验过。
    expect(initial.roleMatrix).toMatchObject({ present: null, pins: [], missingEntryRoles: [] });
    expect(initial.roleMatrix.note).toContain('没有角色矩阵');
    expect(initial.roleMatrix.note).toContain('claim 不做角色校验');
    expect(initial.roleMatrix.entryRoles.map(entry => entry.roleId)).toEqual([ROLE_SOURCE_EXECUTOR, ROLE_SOURCE_INVESTIGATOR]);
    // 内置 source 的 pin 就是安装后会落账的那一份（revision 与摘要都来自契约口径）。
    const builtIn = roleOf(initial, ROLE_SOURCE_EXECUTOR);
    expect(builtIn.pin!.ref).toEqual({ aggregateType: 'RoleSpecRevision', projectId: scope.projectId, roleId: ROLE_SOURCE_EXECUTOR, revision: ROLE_SPEC_REVISION });
    expect(builtIn.pin!.digest).toBe(roleSpecContentDigest(roleSpecSourceFor(ROLE_SOURCE_EXECUTOR).content, ROLE_SOURCE_EXECUTOR, ROLE_SPEC_REVISION));
    expect(builtIn.label).toBe('执行者');
    expect(builtIn.builtInSource).toMatchObject({ roleId: ROLE_SOURCE_EXECUTOR, contentRevision: ROLE_SPEC_REVISION });

    // 2) 安装：CAS@0，不自动激活；同一份 source 重放不产生第二个 revision。
    const first = await fixture.install(scope, { kind: 'RoleSpecRevision', roleId: ROLE_SOURCE_EXECUTOR });
    expect(first.body, JSON.stringify(first.body)).toMatchObject({ status: 'committed', replayed: false, sourceOrigin: 'built-in-local-fixture' });
    expect(first.body.revisionRef).toMatchObject({ aggregateType: 'RoleSpecRevision', roleId: ROLE_SOURCE_EXECUTOR, revision: ROLE_SPEC_REVISION });
    const replay = await fixture.install(scope, { kind: 'RoleSpecRevision', roleId: ROLE_SOURCE_EXECUTOR });
    expect(replay.body).toMatchObject({ status: 'committed', replayed: true });
    expect(replay.body.revisionRef).toEqual(first.body.revisionRef);

    const afterInstall = await fixture.view(scope);
    const installedEntry = roleOf(afterInstall, ROLE_SOURCE_EXECUTOR);
    expect(installedEntry.active).toBeNull();
    expect(installedEntry.readiness.status).toBe('spec_not_activated');
    expect(installedEntry.installed).toHaveLength(1);
    expect(installedEntry.installed[0]!.contentDigest).toBe(first.body.contentDigest);
    // 安装者与时间来自已提交事件，不是请求里自报的字段。
    expect(installedEntry.installed[0]!.installedBy).toEqual({ kind: 'human', id: 'user-1' });
    expect(Number.isFinite(Date.parse(installedEntry.installed[0]!.installedAt!))).toBe(true);
    // 一份规格一个角色：其他角色没有被顺带安装。
    expect(roleOf(afterInstall, ROLE_SOURCE_INVESTIGATOR).installed).toHaveLength(0);

    // 3) 过期 CAS 窗口被拒且零写（生效引用不动）。
    const stale = await fixture.activate(scope, { kind: 'RoleSpecRevision', pin: pinOf(afterInstall, ROLE_SOURCE_EXECUTOR), expectedRevision: 0 });
    expect(stale.body).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect((await fixture.view(scope)).kinds).toEqual(afterInstall.kinds);

    // 4) 激活：生效引用是**该角色自己的**聚合。
    const activated = await fixture.activate(scope, { kind: 'RoleSpecRevision', pin: pinOf(afterInstall, ROLE_SOURCE_EXECUTOR) });
    expect(activated.body, JSON.stringify(activated.body)).toMatchObject({ status: 'committed', replayed: false });
    expect(activated.body.activatedRevision).toMatchObject({ aggregateType: 'RoleSpecRevision', roleId: ROLE_SOURCE_EXECUTOR });
    const afterActivate = await fixture.view(scope);
    const activeEntry = roleOf(afterActivate, ROLE_SOURCE_EXECUTOR);
    expect(activeEntry.active!.ref).toEqual(activated.body.activatedRevision);
    expect(activeEntry.active!.digest).toBe(first.body.contentDigest);
    expect(activeEntry.active!.activeAggregateRevision).toBe(1);
    expect(activeEntry.active!.activatedBy).toEqual({ kind: 'human', id: 'user-1' });
    expect(typeof activeEntry.active!.activatedAt).toBe('string');
    // 就绪判据复用 claim 守卫：装齐并激活之后这个 pin 就是 ready。
    expect(activeEntry.readiness.status).toBe('ready');
    // 第五个种类的项目级 active 恒为 null：生效引用是逐角色的，不是“没有生效规格”。
    expect(kindOf(afterActivate, 'RoleSpecRevision').active).toBeNull();

    // 5) 重启：规格内容、digest、生效引用与安装者都是持久事实。
    await fixture.restart();
    const reopened = await fixture.view(scope);
    expect(reopened.kinds).toEqual(afterActivate.kinds);
    expect(reopened.roleMatrix).toEqual(afterActivate.roleMatrix);
  }, 120000);

  it('M3：没有矩阵时既有入口照常派发；含 roles 的矩阵生效后，规格装齐同一个入口仍然派发', async () => {
    const fixture = await start();

    // A) 完全没装协调策略的项目：既有放行语义不变。
    const plain = await fixture.addProject('plain');
    await fixture.createGoal(plain, 'rw14-goal-plain');
    const plainRun = await fixture.post('/api/real/tasks', { ...plain, goalId: 'rw14-goal-plain', requestId: 'rw14-plain', instruction: '读 README 并报告', allowWrite: true });
    expect(plainRun.status, JSON.stringify(plainRun.body)).toBe(200);
    expect(plainRun.body).toMatchObject({ status: 'accepted' });

    // B) 含矩阵的项目：先装规格（不激活），再装一份**不含 roles** 的策略 → 视图明确说“不做角色校验”。
    const scoped = await fixture.addProject('matrix');
    await fixture.createGoal(scoped, 'rw14-goal-matrix');
    for (const source of ROLE_SPEC_SOURCES_V1) {
      const install = await fixture.install(scoped, { kind: 'RoleSpecRevision', roleId: source.roleId });
      expect(install.body, source.roleId).toMatchObject({ status: 'committed' });
    }
    await installPolicy(fixture, scoped, 'rw14-no-matrix', policyWithoutMatrix());
    const withoutMatrix = await fixture.view(scoped);
    expect(withoutMatrix.roleMatrix).toMatchObject({ present: false, policyId: 'rw14-no-matrix', pins: [] });
    expect(withoutMatrix.roleMatrix.note).toContain('不含');
    expect(withoutMatrix.roleMatrix.note).toContain('claim 不做角色校验');

    // C) 换成含矩阵的策略：八条 pin 全部只有已安装、没有已激活规格。
    const pins = Object.fromEntries(ROLE_SPEC_SOURCES_V1.map(source => [source.roleId, pinOf(withoutMatrix, source.roleId)]));
    await installPolicy(fixture, scoped, 'rw14-matrix', matrixContent(pins, ROLE_SOURCE_EXECUTOR));
    const withMatrix = await fixture.view(scoped);
    expect(withMatrix.roleMatrix).toMatchObject({ present: true, policyId: 'rw14-matrix', policyRevision: 1 });
    expect(withMatrix.roleMatrix.note).toContain('含角色矩阵');
    expect(withMatrix.roleMatrix.note).toContain('拒绝且零写入');
    expect(withMatrix.roleMatrix.pins).toHaveLength(ROLE_SPEC_SOURCES_V1.length);
    expect(withMatrix.roleMatrix.pins.every(pin => pin.readiness.status === 'spec_not_activated')).toBe(true);
    // 视图把“哪些 pin 还没有对应的已激活规格”点了出来——这就是人判断“这次安装会不会打断派发”的依据。
    expect(withMatrix.roleMatrix.note).toContain(ROLE_SOURCE_EXECUTOR);
    expect(withMatrix.roleMatrix.note).toContain('还没有可用的已激活规格');
    expect(withMatrix.roleMatrix.missingEntryRoles).toEqual([]);

    // 视图说的就是真的：这时入口确实被拒（这是守卫的职责，不是缺陷）。
    const blocked = await fixture.post('/api/real/tasks', { ...scoped, goalId: 'rw14-goal-matrix', requestId: 'rw14-blocked', instruction: '读 README 并报告', allowWrite: true });
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(blocked.body)).toContain('role_spec_stale');

    // D) 把规格装齐并激活：pin 变 ready，**同一条产品入口**照常派发（M3 验收）。
    for (const source of ROLE_SPEC_SOURCES_V1) await installRole(fixture, scoped, source.roleId);
    const ready = await fixture.view(scoped);
    expect(ready.roleMatrix.pins.every(pin => pin.readiness.status === 'ready')).toBe(true);
    expect(ready.roleMatrix.note).toContain('矩阵里的 pin 全部有可用的已激活规格');

    const accepted = await fixture.post('/api/real/tasks', { ...scoped, goalId: 'rw14-goal-matrix', requestId: 'rw14-accepted', instruction: '读 README 并报告', allowWrite: true });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body).toMatchObject({ runId: 'real-rw14-accepted', status: 'accepted' });

    // E) 引用未安装规格的 pin 不会被静默忽略：视图给出 spec_not_installed 与原因。
    const unknownPins = { ...pins, 'unregistered-role': { ref: { aggregateType: 'RoleSpecRevision', projectId: scoped.projectId, roleId: 'unregistered-role', revision: ROLE_SPEC_REVISION }, digest: 'a'.repeat(64) } };
    await installPolicy(fixture, scoped, 'rw14-matrix-unknown', matrixContent(unknownPins, ROLE_SOURCE_EXECUTOR));
    const unknown = await fixture.view(scoped);
    const unknownPin = unknown.roleMatrix.pins.find(entry => entry.roleId === 'unregistered-role')!;
    expect(unknownPin.readiness.status).toBe('spec_not_installed');
    expect(unknownPin.readiness.message).toContain('没有落账');
  }, 180000);

  it('越权声明被拒且零写：矩阵 pin 的是只读规格时，写入入口的 claim 不落账', async () => {
    const fixture = await start();
    const scope = await fixture.addProject('readonly');
    await fixture.createGoal(scope, 'rw14-goal-readonly');

    // 调用方提交一份**只读**的 executor 规格（同一 roleId 只有一份安装 revision，内容不同即摘要不同）。
    const readOnly: RoleSpecContentV1 = {
      ...roleSpecSourceFor(ROLE_SOURCE_EXECUTOR).content,
      permissions: { tools: ['read'], writeScope: 'none' },
    };
    await installRole(fixture, scope, ROLE_SOURCE_EXECUTOR, { roleId: ROLE_SOURCE_EXECUTOR, content: readOnly });
    const current = await fixture.view(scope);
    const entry = roleOf(current, ROLE_SOURCE_EXECUTOR);
    expect(entry.readiness.status).toBe('ready');
    expect(entry.contentDigest).toBe(roleSpecContentDigest(readOnly, ROLE_SOURCE_EXECUTOR, ROLE_SPEC_REVISION));
    expect(entry.installed[0]!.content).toMatchObject({ permissions: { tools: ['read'], writeScope: 'none' } });
    expect(entry.active!.digest).toBe(entry.contentDigest);

    await installPolicy(fixture, scope, 'rw14-readonly-matrix', matrixContent({ [ROLE_SOURCE_EXECUTOR]: pinOf(current, ROLE_SOURCE_EXECUTOR) }, ROLE_SOURCE_EXECUTOR));
    const before = fixture.dispatchSnapshots(scope);

    // 写入入口声明 read/write/shell + 写范围，超出只读规格的授权上界 → 拒绝。
    const rejected = await fixture.post('/api/real/tasks', { ...scope, goalId: 'rw14-goal-readonly', requestId: 'rw14-overreach', instruction: '写一个文件', allowWrite: true });
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.body)).toContain('permissions_exceed_spec');
    // 零写：没有新增任何派发事实（lease／attempt／run／outbox 一条都没有）。
    expect(fixture.dispatchSnapshots(scope)).toBe(before);
  }, 120000);

  it('M3（探索侧）：只读探索入口在矩阵启用后照常派发（绑定只读角色 investigator）', async () => {
    const fixture = await start();
    const scope = await fixture.addProject('explore');
    await fixture.createGoal(scope, 'rw14-goal-explore');

    const plan = { ...scope, goalId: 'rw14-goal-explore', requestId: 'rw14-explore-plan', tasks: [
      { taskId: 'inventory', title: 'Inventory', instruction: '读 README 并列出入口', dependsOn: [] },
      { taskId: 'synthesis', title: 'Synthesis', instruction: '核对并汇总清单', dependsOn: ['inventory'] },
    ] };
    const planned = await fixture.post('/api/real/explorations/plan', plan);
    expect(planned.status, JSON.stringify(planned.body)).toBe(200);

    await installRole(fixture, scope, ROLE_SOURCE_INVESTIGATOR);
    const installed = await fixture.view(scope);
    await installPolicy(fixture, scope, 'rw14-explore-matrix', matrixContent({ [ROLE_SOURCE_INVESTIGATOR]: pinOf(installed, ROLE_SOURCE_INVESTIGATOR) }, ROLE_SOURCE_INVESTIGATOR));
    const ready = await fixture.view(scope);
    expect(ready.roleMatrix.present).toBe(true);
    expect(ready.roleMatrix.pins.every(pin => pin.readiness.status === 'ready')).toBe(true);
    expect(ready.roleMatrix.note).toContain('矩阵里的 pin 全部有可用的已激活规格');

    const run = await fixture.post('/api/real/explorations/run', { ...scope, goalId: 'rw14-goal-explore', requestId: 'rw14-explore-run', taskId: 'inventory' });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body).toMatchObject({ status: 'accepted' });
  }, 120000);
});
