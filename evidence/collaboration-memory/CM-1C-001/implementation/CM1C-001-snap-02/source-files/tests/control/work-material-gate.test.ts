/**
 * RW-15／RW-17：角色必读材料的 gate 与**真实通道**（普通 develop 运行能不能开始）。
 *
 * 走的都是生产实现：InMemoryHarness（真实 ControlEngine／真实账本／真实 ArtifactVault）
 * + 真实 LeasedWorkerRuntime（DispatchEngine 的运行时适配器）+ WorkMaterialDrive +
 * WorkRunMaterialCompiler + 真实 LedgerRoleSpecRead（判据来自 ControlEngine 自己的策略）
 * + 真实 WorkspaceSourceIndexReader（内核工作区读取）+ 内核 CodingAgentRuntime（本地内存模型客户端）。
 *
 * RW-15 时这里断言的是"必读材料没有供应通道 → 模型调用之前 fail-closed、模型请求数为 0"。
 * RW-17 把 contract／code／evidence／decision 四类接上真实通道之后，同一个场景变成**运行真正开始**：
 *   - 治理入口安装并激活 executor 规格 + 含 roles 的矩阵（与产品入口同一批命令）；
 *   - claim 守卫按矩阵受理该绑定（RW-14 口径），派发收口建立工作身份；
 *   - 取材在模型调用之前完成，四类材料分别进入既有 rules／roleMaterials／evidenceRefs 通道，
 *     每条都带 selectedBecause 与含版本的 sourceRefs；
 *   - 因此模型**真的被调用**（模型请求数 1），不再是"可证明未启动"的失败。
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodingAgentRuntime, type RunSpec } from '../../src/execution/worker-runtime/coding-agent-runtime.js';
import type { ModelClientPort, ModelEvent, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { createInMemoryHarness, type InMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { LeasedWorkerRuntime } from '../../src/control/dispatch-engine/leased-worker-runtime.js';
import { WorkMaterialDrive } from '../../src/control/dispatch-engine/work-material-drive.js';
import { LedgerRoleSpecRead } from '../../src/control/dispatch-engine/role-spec-read.js';
import { WorkRunMaterialCompiler } from '../../src/data/context-compiler/work-run-materials.js';
import { WorkspaceSourceIndexReader } from '../../src/data/workspace-reader/role-source-reader.js';
import {
  ROLE_SOURCE_EXECUTOR,
  buildCoordinationPolicyContentWithRolesV1,
  buildRoleSpecActivateCommandFor,
  buildRoleSpecInstallCommandFor,
  roleMatrixPolicyDigest,
} from '../../src/fixtures/role-spec-fixtures.js';
import { buildCoordinationPolicyActivateCommand, buildCoordinationPolicyInstallCommand } from '../../src/contracts/commands/governance.js';
import { P15_COORDINATION_POLICY_REVISION } from '../../src/contracts/human-role-collaboration.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { buildCreateGoalCommand } from '../contract-support/fixtures/goal-fixtures.js';
import { COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1, buildInstallCommand, buildActivateCommand } from '../../src/fixtures/governance-fixtures.js';
import { completionPolicyPinFor, architectureBaselinePinFor } from '../../src/contracts/governance.js';
import { DISPATCH_PLAN_REVISION_FIXTURE_V1, DISPATCH_ELIGIBLE_TASK_ID, buildDispatchClaimCommand } from '../../src/fixtures/dispatch-fixtures.js';
import { buildApplyPlanCommand } from '../../src/fixtures/plan-fixtures.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const scope = { projectId: 'rw17-project', workspaceId: 'rw17-workspace', goalId: 'rw17-goal' };
const at = '2026-09-10T09:00:00.000Z';
const deps = (id: string) => ({ projectId: scope.projectId, commandId: id, correlationId: id, idempotencyKey: id, submittedAt: at, actor: { kind: 'human' as const, id: 'user-1' } });

it('装 executor 规格 + 含 roles 的矩阵之后，普通 develop 运行真正开始（模型被调用），四类材料各有来源', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rw17-materials-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'source');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'README.md'), 'local source\n');
  await writeFile(join(root, 'src', 'hello.ts'), 'export const hello = (): string => "rw17";\n');

  const requests: ModelRequest[] = [];
  const client: ModelClientPort = {
    async *stream(request): AsyncIterable<ModelEvent> {
      requests.push(structuredClone(request));
      const common = { schemaVersion: 1 as const, requestId: request.requestId };
      yield { ...common, sequence: 1, type: 'text_delta', delta: '已读到当前源码索引，未修改任何文件。' };
      yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
    },
  };
  const runtime = new CodingAgentRuntime(join(dir, 'runs'), async () => ({
    configuration: { revision: 'local', provider: 'deepseek', model: 'local-memory-client', baseUrl: 'http://127.0.0.1' }, client,
  }));
  await runtime.init(); cleanup.push(() => runtime.close());

  let h: InMemoryHarness;
  h = createInMemoryHarness({
    deps: { clock: () => at },
    runtime: {
      capabilities: () => runtime.capabilities(),
      start: async envelope => new LeasedWorkerRuntime({
        runtime, lease: () => h.workspaceLease, vault: () => h.vault, now: () => at,
        materials: (spec, current) => new WorkMaterialDrive({
          ledger: h.ledger,
          control: h.control,
          compiler: new WorkRunMaterialCompiler({
            ledger: h.ledger, vault: h.vault, workContext: h.workContext, completedWork: h.completedWork,
            roleSpec: new LedgerRoleSpecRead({ ledger: h.ledger }),
            // 真实的工作区索引通道（与产品组合根注入的是同一个实现）。
            sourceIndex: new WorkspaceSourceIndexReader({ rootFor: () => root }),
          }),
        }).assembleRun(spec, current),
      }).start(envelope),
    },
  });

  expect((await h.bootstrap(buildBootstrapCommand({ schemaVersion: 1, entries: [scope] }, deps('boot')))).status).toBe('committed');
  for (const [i, definition] of [COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1].entries()) {
    const installed = buildInstallCommand(definition, deps('install-' + i));
    expect((await h.install(installed)).status).toBe('committed');
    const pin = installed.commandType === 'InstallCompletionPolicyRevision' ? completionPolicyPinFor(installed) : architectureBaselinePinFor(installed);
    expect((await h.activate(buildActivateCommand(pin, { ...deps('activate-' + i), expectedRevision: 1 }))).status).toBe('committed');
  }
  // RW-11／RW-14：角色规格与含 roles 的矩阵都经**真实治理命令**安装并激活（与产品入口同一批路径）。
  expect((await h.control.installRoleSpec(buildRoleSpecInstallCommandFor(ROLE_SOURCE_EXECUTOR, deps('role-install')))).status).toBe('committed');
  expect((await h.control.activateRoleSpec(buildRoleSpecActivateCommandFor(ROLE_SOURCE_EXECUTOR, { ...deps('role-activate'), expectedRevision: 1 }))).status).toBe('committed');
  const policyContent = buildCoordinationPolicyContentWithRolesV1(scope.projectId, [ROLE_SOURCE_EXECUTOR]);
  const policyDeps = { policyId: 'rw17-policy', content: policyContent };
  const contentDigest = roleMatrixPolicyDigest(policyContent, policyDeps.policyId);
  expect((await h.installCoordinationPolicy(buildCoordinationPolicyInstallCommand(policyDeps, deps('policy-install')))).status).toBe('committed');
  expect((await h.activateCoordinationPolicy(buildCoordinationPolicyActivateCommand(
    { ref: { aggregateType: 'CoordinationPolicyRevision', projectId: scope.projectId, policyId: policyDeps.policyId, revision: P15_COORDINATION_POLICY_REVISION }, digest: contentDigest },
    { ...deps('policy-activate'), expectedRevision: 1 },
  ))).status).toBe('committed');

  expect((await h.control.submit(buildCreateGoalCommand({ ...scope, objective: '验证角色必读材料的真实通道', actor: { kind: 'human', id: 'local-test' } }, deps('goal')))).status).toBe('committed');
  const plan = structuredClone(DISPATCH_PLAN_REVISION_FIXTURE_V1);
  plan.goalId = scope.goalId; plan.planId = 'rw17-plan';
  // 任务作用域声明模块路径前缀 src：正文取材据此选出该前缀下的有界文件。
  plan.tasks = plan.tasks.map(task => task.taskId === DISPATCH_ELIGIBLE_TASK_ID
    ? { ...task, scope: { kind: 'module' as const, stageId: plan.stages[0]!.stageId, moduleRef: 'src' } }
    : task);
  expect((await h.applyPlan(buildApplyPlanCommand(plan, { ...deps('plan'), expectedRevision: 1 }))).status).toBe('committed');

  const runId = 'real-rw17-run';
  const spec: RunSpec = { ...scope, runId, taskId: DISPATCH_ELIGIBLE_TASK_ID, root, instruction: 'RW17_INSTRUCTION', budget: { contextWindowTokens: 1000000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 32768 } };
  await runtime.prepare(spec);
  expect((await h.claimTask(buildDispatchClaimCommand({
    ...deps('claim'), goalId: scope.goalId, taskId: spec.taskId, runId, attemptId: 'rw17-attempt',
    roleBinding: { schemaVersion: 1, bindingId: 'rw17-binding', templateId: ROLE_SOURCE_EXECUTOR, templateRevision: '1', bindingVersion: 1, policyRevision: 'human-implementation-v1' },
    declaredPermissions: { tools: ['read', 'write', 'shell'], writeScope: ['*'] },
    budget: { tokenBudget: 1000000, deadline: null },
  }))).status).toBe('committed');

  await h.advanceProjection();
  const drive = await h.drive({ reason: 'rw17-material-channels', maxIntents: 1 });
  expect(drive.failures, JSON.stringify(drive.failures)).toEqual([]);
  expect(drive.started).toBe(1);

  // 1) 这次运行**真的开始了**：模型被调用了一次（RW-15 时这里是 0，运行以"可证明未启动"结束）。
  expect(requests, runtime.all()[0]?.error ?? '模型请求缺失').toHaveLength(1);
  const record = runtime.all()[0]!;
  expect(record.status).toBe('completed');

  // 2) 四类材料各自进入既有通道，并在 manifest 里带理由与来源（含版本）。
  const manifest = record.context!.manifest;
  const kinds = manifest.selected.map(entry => entry.kind);
  expect(kinds).toContain('role-material:code');
  expect(kinds).toContain('role-material:evidence');
  const contract = manifest.selected.find(entry => entry.kind === 'rule')!;
  expect(contract.selectedBecause).toContain('contract');
  expect(contract.sourceRefs.some(ref => ref.kind === 'plan-revision' && ref.revision.length > 0)).toBe(true);
  for (const entry of manifest.selected) {
    expect(entry.selectedBecause.length, entry.kind).toBeGreaterThan(0);
    expect(entry.sourceRefs.every(ref => ref.refId.length > 0 && ref.revision.length > 0), entry.kind).toBe(true);
  }
  // 3) 角色规格条目逐类回答了"供给了什么、来自哪里"。
  const roleSpecEntry = manifest.selected.find(entry => entry.kind === 'role-spec')!;
  expect(roleSpecEntry).toBeDefined();
  expect(roleSpecEntry.id).toBe(ROLE_SOURCE_EXECUTOR);
  const input = requests[0]!.messages.find(message => message.role === 'user')!.content;
  expect(input).toContain('## 角色规格（要求，不是授权）');
  // 逐类都写了供给结果与来源；三类必读（contract／code／evidence）都不是"未核对"。
  for (const kind of ['contract', 'code', 'evidence']) {
    expect(input, kind).toContain('"kind":"' + kind + '"');
  }
  expect(input).toContain('"supplied":true');
  expect(input).not.toContain('"supplied":null');
  expect(manifest.gaps.every(gap => typeof gap === 'string')).toBe(true);

  // 4) 当前源码索引真的进了本次运行：文件路径与正文都在（有界）。
  const codeEntry = manifest.selected.find(entry => entry.kind === 'role-material:code')!;
  expect(codeEntry.sourceRefs.some(ref => ref.kind === 'workspace' && ref.revision === '1')).toBe(true);
  expect(codeEntry.sourceRefs.some(ref => ref.refId === 'source-file:src/hello.ts')).toBe(true);
  expect(input).toContain('src/hello.ts');
  expect(input).toContain('export const hello');
  // 5) 材料不改变权限：信封上的权限原样出现在实际输入里。
  expect(input).toContain(JSON.stringify(record.context!.manifest.permissions).replaceAll('"', '"'));
}, 120000);
