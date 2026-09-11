/**
 * RW-12 真实 Run 的材料投递（派发时编译 → 既有 ContextBundle → 实际模型首请求）。
 *
 * 走的都是生产实现：InMemoryHarness（真实 ControlEngine／ContextCompilerImpl／ArtifactVault）
 * + 真实 LeasedWorkerRuntime（DispatchEngine 的运行时适配器）+ WorkMaterialDrive +
 * WorkRunMaterialCompiler + 内核 CodingAgentRuntime（本地内存模型客户端）。
 *
 * 证明：
 *   - 派发收口建立的工作身份与既有留痕真的进了这次运行的 ContextBundle（正文 + manifest 选入条目）；
 *   - 选入条目带 selectedBecause 与 sourceRefs（含版本），缺口进 gaps；
 *   - 历史材料只有"历史解释"资格，不改变权限；
 *   - 重复派发不会产生第二个工作身份（账本里只有一条 WorkContextBound）。
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
import { workIdFor } from '../../src/control/dispatch-engine/work-identity.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { buildCreateGoalCommand } from '../contract-support/fixtures/goal-fixtures.js';
import { COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1, buildInstallCommand, buildActivateCommand } from '../../src/fixtures/governance-fixtures.js';
import { completionPolicyPinFor, architectureBaselinePinFor } from '../../src/contracts/governance.js';
import { DISPATCH_PLAN_REVISION_FIXTURE_V1, DISPATCH_ELIGIBLE_TASK_ID, buildDispatchClaimCommand } from '../../src/fixtures/dispatch-fixtures.js';
import { buildApplyPlanCommand } from '../../src/fixtures/plan-fixtures.js';
import { buildBindWorkContextCommand, buildExecutionNoteV1, buildRecordExecutionNoteCommand } from '../contract-support/fixtures/context-fixtures.js';
import { workContextRefFor, type WorkContextBindingSnapshot } from '../../src/contracts/context-continuity.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const scope = { projectId: 'rw12-project', workspaceId: 'rw12-workspace', goalId: 'rw12-goal' };
const at = '2026-09-10T08:00:00.000Z';
const deps = (id: string) => ({ projectId: scope.projectId, commandId: id, correlationId: id, idempotencyKey: id, submittedAt: at });
const NOTE_SENTINEL = 'RW12_NOTE_REASON_SENTINEL';

it('真实 Run 的 bundle 里能看到工作身份与选中的历史材料（含理由与来源），且不改变权限', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rw12-material-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'source'); await mkdir(root);
  await writeFile(join(root, 'README.md'), 'local source\n');

  const requests: ModelRequest[] = [];
  const client: ModelClientPort = {
    async *stream(request): AsyncIterable<ModelEvent> {
      requests.push(structuredClone(request));
      const common = { schemaVersion: 1 as const, requestId: request.requestId };
      yield { ...common, sequence: 1, type: 'text_delta', delta: '已收到上下文，未修改任何文件。' };
      yield { ...common, sequence: 2, type: 'usage_snapshot', usage: { inputTokens: 500, outputTokens: 20, cachedInputTokens: 0, costUsdMicros: null } };
      yield { ...common, sequence: 3, type: 'completed', reason: 'final_answer' };
    },
  };
  const runtime = new CodingAgentRuntime(join(dir, 'runs'), async () => ({
    configuration: { revision: 'local', provider: 'deepseek', model: 'local-memory-client', baseUrl: 'http://127.0.0.1' }, client,
  }));
  await runtime.init(); cleanup.push(() => runtime.close());

  let h: InMemoryHarness;
  h = createInMemoryHarness({
    runtime: {
      capabilities: () => runtime.capabilities(),
      start: async envelope => new LeasedWorkerRuntime({
        runtime, lease: () => h.workspaceLease, vault: () => h.vault, now: () => at,
        materials: (spec, current) => new WorkMaterialDrive({
          ledger: h.ledger,
          // RW-13：身份来自 ControlEngine 的权威解析面（与派发面是同一份答案）。
          control: h.control,
          compiler: new WorkRunMaterialCompiler({
            ledger: h.ledger, vault: h.vault, workContext: h.workContext, completedWork: h.completedWork,
            roleSpec: new LedgerRoleSpecRead({ ledger: h.ledger }),
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
  expect((await h.control.submit(buildCreateGoalCommand({ ...scope, objective: '验证工作身份与历史材料进入真实运行', actor: { kind: 'human', id: 'local-test' } }, deps('goal')))).status).toBe('committed');
  const plan = structuredClone(DISPATCH_PLAN_REVISION_FIXTURE_V1);
  plan.goalId = scope.goalId; plan.planId = 'rw12-plan';
  expect((await h.applyPlan(buildApplyPlanCommand(plan, { ...deps('plan'), expectedRevision: 1 }))).status).toBe('committed');

  const runId = 'real-rw12-run';
  const spec: RunSpec = { ...scope, runId, taskId: DISPATCH_ELIGIBLE_TASK_ID, root, instruction: 'RW12_INSTRUCTION_SENTINEL', budget: { contextWindowTokens: 1000000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 32768 } };
  await runtime.prepare(spec);
  expect((await h.claimTask(buildDispatchClaimCommand({
    ...deps('claim'), goalId: scope.goalId, taskId: spec.taskId, runId, attemptId: 'rw12-attempt',
    declaredPermissions: { tools: ['read', 'write', 'shell'], writeScope: ['*'] },
    budget: { tokenBudget: 1000000, deadline: null },
  }))).status).toBe('committed');

  // 这一次派发之前，同一段工作已经有持久留痕（例如上一个 Run 记录的关键取舍）。
  const workId = workIdFor(scope, DISPATCH_ELIGIBLE_TASK_ID);
  const runRef = { aggregateType: 'Run' as const, projectId: scope.projectId, goalId: scope.goalId, runId };
  expect((await h.bindWorkContext(buildBindWorkContextCommand({
    commandId: 'rw12-bind', projectId: scope.projectId, workId, workspaceId: scope.workspaceId,
    goalId: scope.goalId, taskId: DISPATCH_ELIGIBLE_TASK_ID, planRef: { aggregateType: 'PlanRevision', projectId: scope.projectId, planId: plan.planId },
    planRevision: 1, initialRunRef: runRef, idempotencyKey: 'rw12-bind-idem', correlationId: 'rw12-bind-corr', submittedAt: at,
  }))).status).toBe('committed');
  const note = buildExecutionNoteV1({ noteId: 'rw12-note-1', workId, projectId: scope.projectId, workspaceId: scope.workspaceId, runRef, kind: 'key_choice', summary: 'RW12_NOTE_SUMMARY', reason: NOTE_SENTINEL, createdAt: at });
  expect((await h.recordExecutionNote(buildRecordExecutionNoteCommand({ commandId: 'rw12-note', projectId: scope.projectId, note, idempotencyKey: 'rw12-note-idem', correlationId: 'rw12-note-corr', submittedAt: at }))).status).toBe('committed');

  // 工作留痕是已提交事实，投影推进后 WorkContext 才可组装（与生产路径一致）。
  await h.advanceProjection();
  const drive = await h.drive({ reason: 'rw12-material', maxIntents: 1 });
  expect(drive.failures, JSON.stringify(drive.failures)).toEqual([]);
  expect(requests, runtime.all()[0]?.error ?? 'model request missing').toHaveLength(1);

  const record = runtime.all()[0]!;
  const manifest = record.context!.manifest;
  const input = requests[0]!.messages.find(message => message.role === 'user')!.content;
  // 1) 工作身份进了正文与 manifest。
  expect(input).toContain(workId);
  const identity = manifest.selected.find(entry => entry.kind === 'work-identity')!;
  expect(identity).toBeDefined();
  expect(identity.selectedBecause).toContain('工作身份');
  expect(identity.sourceRefs.length).toBeGreaterThan(0);
  expect(identity.sourceRefs.every(ref => ref.revision.length > 0)).toBe(true);
  expect(identity.applicability).toBe('historical_explanation');
  // 2) 选中的历史材料带理由与来源，且只有"历史解释"资格。
  expect(input).toContain(NOTE_SENTINEL);
  const noteEntry = manifest.selected.find(entry => entry.kind === 'work-note')!;
  expect(noteEntry.id).toBe('rw12-note-1');
  expect(noteEntry.selectedBecause).toContain(workId);
  expect(noteEntry.applicability).toBe('historical_explanation');
  expect(noteEntry.sourceRefs.some(ref => ref.kind === 'artifact' && ref.revision === '1')).toBe(true);
  expect(manifest.selected.every(entry => entry.applicability === undefined || entry.applicability === 'historical_explanation')).toBe(true);
  // 3) 缺口如实写出（RW-18：本 Run 有写入范围，已完成工作选材按"对那段历史的访问权限"判定；
  //    这里没有可继承的已完成工作，于是如实记缺口，而不是用"只读"当准入条件）。
  const gaps = manifest.gaps.join('\n');
  expect(gaps).toContain('相关已完成工作未被选入');
  expect(gaps).toContain('[role-materials]');
  expect(gaps).not.toContain('只读');
  // 同一缺口不重复出现两次（正文与 manifest 是同一份事实）。
  expect(manifest.gaps.length).toBe(new Set(manifest.gaps).size);
  // 4) 权限没有被历史材料改写。
  expect(input).toContain(canonicalJson(record.context!.manifest.permissions as never));
  // 5) 身份没有被这次派发重建。
  const binding = await h.ledger.load(workContextRefFor(scope.projectId, scope.workspaceId, workId));
  if (binding.status !== 'found') throw Error('work binding missing');
  expect((binding.snapshot as WorkContextBindingSnapshot).revision).toBe(1);
  const events = await h.ledger.events({ afterCursor: null, limit: 256 });
  expect(events.events.filter(page => page.event.eventType === 'WorkContextBound')).toHaveLength(1);
}, 60000);
