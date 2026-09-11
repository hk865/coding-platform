/**
 * RW-17 真实 HTTP 产品链：装着 executor 规格 + 含 roles 的矩阵时，**普通 develop 运行真的能开始**。
 *
 * 走的都是产品入口：真实 HTTP 服务、真实 SQLite 账本与 Vault、真实治理入口（人经
 * /api/real/governance/{install,activate} 装第五个种类 RoleSpecRevision 与含 roles 的协调策略）、
 * 真实内核适配器（只有外部模型是本地桩）。组合根注入的源码索引通道就是产品的那一份
 * （WorkspaceSourceIndexReader ← 登记项目的真实检出根）。
 *
 * RW-15 时这条链在材料组装处返回 needs_material、以"可证明未启动"结束（模型请求数 0）；
 * RW-17 之后同一个场景必须以 run completed 收口，且模型真的被调用过。
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createGuiServer } from '../../src/app/server.js';
import type { GovernanceActivateResultV1, GovernanceInstallResultV1, GovernanceViewV1, RoleSpecEntryViewV1 } from '../../src/contracts/governance-view.js';
import { ROLE_SOURCE_EXECUTOR, ROLE_SPEC_SOURCES_V1 } from '../../src/fixtures/role-spec-fixtures.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function start() {
  const directory = await mkdtemp(join(tmpdir(), 'rw17-product-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let modelRequests = 0;
  const modelInputs: string[] = [];
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body) as { messages: Array<{role:string;content:unknown}> };
    for (const message of request.messages) if(message.role==='user' && typeof message.content==='string') modelInputs.push(message.content);
    modelRequests++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '已读到当前源码索引，未修改任何文件。' }, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(ready => provider.listen(0, '127.0.0.1', ready));
  cleanup.push(async () => { provider.closeAllConnections(); await new Promise<void>(done => provider.close(() => done())); });
  const address = provider.address();
  if (!address || typeof address === 'string') throw Error('模型桩没有地址');
  const app = await createGuiServer(join(directory, 'data'), { modelSettings: { directory: join(directory, 'credentials') }, explorationContextOnlyRoots: [] });
  cleanup.push(async () => { await app.close(); });
  await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
  const serverAddress = app.server.address();
  if (!serverAddress || typeof serverAddress === 'string') throw Error('应用没有地址');
  const base = 'http://127.0.0.1:' + serverAddress.port;
  const token = ((await (await fetch(base + '/api/meta')).json()) as { workspaceToken: string }).workspaceToken;
  const get = async <T = Record<string, unknown>>(path: string, query: Record<string, string>) => {
    const response = await fetch(base + path + '?' + new URLSearchParams(query));
    return { status: response.status, body: await response.json() as T };
  };
  const post = async <T = Record<string, unknown>>(path: string, body: unknown) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as T };
  };
  expect((await post('/api/model-settings', { provider: 'deepseek', model: 'rw17-stub', baseUrl: 'http://127.0.0.1:' + address.port, apiKey: 'synthetic-local-key' })).status).toBe(200);
  const root = join(directory, 'checkout');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# RW-17 产品链场景\n');
  await writeFile(join(root, 'src', 'hello.ts'), 'export const hello = (): string => "rw17-product";\n');
  const project = (await post<{ projectId: string; workspaceId: string }>('/api/projects/add', { path: root })).body;
  const scope = { projectId: project.projectId, workspaceId: project.workspaceId };
  const goalId = 'rw17-product-goal';
  expect((await post('/api/goals', { ...scope, requestId: goalId, objective: '产品链：装 executor 规格后普通运行能开始' })).status).toBe(200);
  return { get, post, scope, goalId, modelRequests: () => modelRequests, modelInputs };
}

type Fixture = Awaited<ReturnType<typeof start>>;
const roleOf = (view: GovernanceViewV1, roleId: string): RoleSpecEntryViewV1 =>
  view.kinds.find(entry => entry.kind === 'RoleSpecRevision')!.roleSpecs!.find(entry => entry.roleId === roleId)!;

it('装了 executor 规格 + 含 roles 的矩阵之后，/api/real/tasks 的普通运行真的开始（模型被调用）', async () => {
  const fixture = await start();
  const { scope } = fixture;

  // 1) 治理入口：装齐八个规格并激活（与界面「安装并激活」同一条产品路径），其中 executor 是 develop 入口绑定的角色。
  for (const source of ROLE_SPEC_SOURCES_V1) {
    const install = await fixture.post<GovernanceInstallResultV1>('/api/real/governance/install', { ...scope, kind: 'RoleSpecRevision', roleId: source.roleId });
    expect(install.body, source.roleId).toMatchObject({ status: 'committed' });
    const activate = await fixture.post<GovernanceActivateResultV1>('/api/real/governance/activate', { ...scope, kind: 'RoleSpecRevision', pin: { ref: install.body.revisionRef, digest: install.body.contentDigest } });
    expect(activate.body, source.roleId).toMatchObject({ status: 'committed' });
  }
  const view = (await fixture.post<GovernanceViewV1>('/api/real/governance/view', scope)).body;
  const pins = Object.fromEntries(ROLE_SPEC_SOURCES_V1.map(source => [source.roleId, roleOf(view, source.roleId).pin!]));
  expect(roleOf(view, ROLE_SOURCE_EXECUTOR).readiness.status).toBe('ready');

  // 2) 含 roles 的矩阵（pin 就是视图给出的那一份，不是测试自己算的摘要）。
  const policy = {
    policyId: 'rw17-product-policy',
    content: {
      schemaVersion: 1, budget: { maxAutonomousReworks: 2, maxClarifications: 3 },
      allowed: { inScopeRework: true, inScopeTesting: true },
      scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] },
      upgrade: { path: 'manual-decision', note: '策略升级需人工决定' },
      roles: { catalog: pins, coordinator: { roleId: ROLE_SOURCE_EXECUTOR, note: '跨工作包议题由该角色收敛' } },
    },
  };
  const policyInstall = await fixture.post<GovernanceInstallResultV1>('/api/real/governance/install', { ...scope, kind: 'CoordinationPolicy', source: policy });
  expect(policyInstall.body, JSON.stringify(policyInstall.body)).toMatchObject({ status: 'committed' });
  const policyActivate = await fixture.post<GovernanceActivateResultV1>('/api/real/governance/activate', { ...scope, kind: 'CoordinationPolicy', pin: { ref: policyInstall.body.revisionRef, digest: policyInstall.body.contentDigest } });
  expect(policyActivate.body, JSON.stringify(policyActivate.body)).toMatchObject({ status: 'committed' });
  expect((await fixture.post<GovernanceViewV1>('/api/real/governance/view', scope)).body.roleMatrix).toMatchObject({ present: true });

  // 3) 普通 develop 运行：RW-15 时这里会在材料组装处 needs_material、以"可证明未启动"结束。
  const submitted = await fixture.post<{ status: string; runId: string }>('/api/real/tasks', { ...scope, goalId: fixture.goalId, requestId: 'rw17-product-run', instruction: '读当前源码索引并报告结论，不要修改文件', allowWrite: true });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  expect(submitted.body).toMatchObject({ status: 'accepted' });
  expect(submitted.body.runId.startsWith('real-')).toBe(true);

  // 4) 等到这次运行在真实账本里以 completed 收口（不是"可证明未启动"的失败），并确认模型真的被调用过。
  const deadline = Date.now() + 90000;
  let observed: { displayState: string } | null = null;
  let deliveredInput = '';
  for (;;) {
    const state = await fixture.get<{
      liveRuns?: Array<{ spec: { runId: string }; status: string; error?: string | null; context?: {input:string} }>;
      agents: { status: string; agents: { rows: Array<{ runRef: { runId: string }; displayState: string }> } };
    }>('/api/state', { ...scope, goalId: fixture.goalId });
    const run = state.body.liveRuns?.find(entry => entry.spec.runId === submitted.body.runId) ?? null;
    const row = state.body.agents?.agents?.rows.find(entry => entry.runRef.runId === submitted.body.runId) ?? null;
    observed = row;
    deliveredInput = run?.context?.input ?? '';
    // 已收口的真实运行：账本里 Run 是 completed，读模型把这次运行标成 completed_run。
    if (run?.status === 'completed' || row?.displayState === 'completed_run') break;
    if (Date.now() >= deadline) {
      throw Error('普通运行没有开始或没有收口：' + JSON.stringify({ run, row, modelRequests: fixture.modelRequests() }));
    }
    await new Promise(done => setTimeout(done, 50));
  }
  expect(observed).not.toBeNull();
  // 模型真的被调用过：RW-15 时这里恒为 0（材料缺口在模型调用之前终止了运行）。
  expect(fixture.modelRequests()).toBeGreaterThan(0);
  // 完整角色材料和反馈协议可超过辅助memory query的16KiB，模型输入不能因此被截断。
  expect(Buffer.byteLength(deliveredInput,'utf8')).toBeGreaterThan(16*1024);
  expect(fixture.modelInputs).toContain(deliveredInput);
}, 180000);
