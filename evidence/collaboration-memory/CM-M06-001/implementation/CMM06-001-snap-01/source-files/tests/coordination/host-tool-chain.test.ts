/**
 * CM-1A-001 第 3 工作段：**经真实 Host 工具的完整正常链**
 * 「请求 → 报告 → 订阅 → all-wait → 唯一后继 → 实际模型输入」，并且**重启后仍成立**。
 *
 * ── 这条链回答的缺陷（独立验收 SPEC-01 / SPEC-03）──────────────────────────────
 *   · SPEC-03：协调 Host 工具此前**没有生产者接线**（全 src 只有 Control 自己的委派）。
 *     本用例里模型**通过工具**发起请求/订阅/报告/等待：工具由组合根（persistent harness）按
 *     当前 Run 的 exact principal 装配后注入真实内核，模型参数里没有也不允许出现身份字段。
 *   · SPEC-01：后继 outbox 此前没有任何生产 RunSpec prepare，只有测试手工
 *     `await runtime.prepare(specFor(root, successorRunId))` 补线。本用例**删掉了那一步**：
 *     后继 RunSpec 由 Dispatch 在启动前从**持久事实**重建并经既有 RuntimePreparationPort
 *     完成 `preflight`+`prepare`。
 *
 * ── 走的都是生产实现 ────────────────────────────────────────────────────────
 * 真实持久 SQLite harness（SqliteStateLedger + 真实 ControlEngineImpl + 真实 DispatchEngineImpl）、
 * 真实 LeasedWorkerRuntime + 内核 CodingAgentRuntime（真实产品 Runtime/内核接入，
 * 模型客户端是确定性的捕获替身）、WorkMaterialDrive + DeliveryMaterialCompiler。
 *
 * ── 断言（对应 A02 / A05 / A06 / A09）───────────────────────────────────────
 *   A02：请求与报告**先存 Vault**，Control 有正式受理回执；模型只看得到 accepted 的工具结果。
 *   A05：条件满足 ∧ 前驱公开结束 → **恰好一个**后继（TaskAttempt/Run/唯一 outbox）。
 *   A06：后继 Run 的**实际 ModelRequest** 含目标 Delivery 的正文与精确版本；前驱输入没有它。
 *   A09：`close()` 后**重建宿主**（harness reopen + 新的 CodingAgentRuntime 实例读同一份持久
 *        journal）仍能继续这条链；已经跑完的 Run 不会被重新准备/重新启动。
 *
 * ── 同时按协议约束逐条对账（CM-1A-001-PROTOCOL-CONSTRAINTS.md）────────────────
 *   1.2 Admission 输入绑定：Context/Dispatch 只消费受理固定的那一份（Work / participation /
 *       RoleBinding / 前驱与后继 Run / 必需 Delivery 的精确引用），缺字段的旧记录**不可恢复**；
 *   1.3 后继准备：以 exact RunRef + 准备内容判断重放（相同→不重复写；不同→拒绝且不覆盖），
 *       workspace 路径由受信宿主解析（不是模型给的、也不是快照里的自由文本）；
 *   2.1 原子事务：wait satisfied + admission + Attempt + Run + 唯一 outbox 一次提交；
 *   2.3 能力声明：协调工具是**非只读**扩展，必须由宿主显式授权才被放行（不靠自报只读）。
 *
 * ── 如实记录的边界（见文件末尾「未覆盖」）──────────────────────────────────────
 * 请求的目标 Work 就是本 Work（定向请求 → 本 Work 的参与关系回应）。跨两个 Work 的 A/B 链需要
 * 第二个可认领的工作身份/Run，属于第 2 步 Work 统一之后的场景，本工作段不假装已覆盖。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { CodingAgentRuntime, type RunSpec } from "../../src/execution/worker-runtime/coding-agent-runtime.js";
import { LeasedWorkerRuntime } from "../../src/control/dispatch-engine/leased-worker-runtime.js";
import { WorkMaterialDrive } from "../../src/control/dispatch-engine/work-material-drive.js";
import { LedgerRoleSpecRead } from "../../src/control/dispatch-engine/role-spec-read.js";
import { WorkRunMaterialCompiler } from "../../src/data/context-compiler/work-run-materials.js";
import { DeliveryMaterialCompiler } from "../../src/data/context-compiler/delivery-materials.js";
import { readAdmittedSuccessor } from "../../src/control/dispatch-engine/coordination-admission-read.js";
import { prepareAdmittedSuccessor } from "../../src/control/dispatch-engine/successor-run-preparation.js";
import { admissionBindingIssues } from "../../src/control/dispatch-engine/coordination-admission-read.js";
import type { ModelClientPort, ModelEvent, ModelRequest } from "../../vendor/coding-agent/dist/public-api.js";
import type { SourceApplicabilityPort } from "../../src/contracts/material-access.js";
import type { RuntimePreparationPort } from "../../src/contracts/runtime-preparation.js";
import { sha256Hex } from "../../src/contracts/fingerprint.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { prepareP103Project, type P1_03TestHarness } from "../contract-suite/p1-03-harness.js";
import { buildDispatchClaimCommand, DISPATCH_ELIGIBLE_TASK_ID, ROLE_BINDING_FIXTURE_V1 } from "../../src/fixtures/dispatch-fixtures.js";
import {
  dispatchOutboxRefFor,
  runRefFor,
  taskAttemptRefFor,
  taskLeaseRefFor,
  type DispatchOutboxEntrySnapshot,
  type RunRef,
  type RunSnapshot,
  type TaskAttemptSnapshot,
  type TaskLeaseSnapshot,
} from "../../src/contracts/dispatch.js";
import type { PositionedEvent } from "../../src/contracts/ledger.js";
import { workContextRefFor, type WorkContextRef } from "../../src/contracts/context-continuity.js";
import {
  communicationAdmissionRefFor,
  directedRequestRefFor,
  waitConditionRefFor,
  type CommunicationAdmissionSnapshot,
  type DeliverySnapshot,
  type DirectedRequestSnapshot,
  type WaitConditionSnapshot,
  type WorkParticipationRef,
} from "../../src/contracts/coordination.js";
import { successorRunIdFor } from "../../src/contracts/coordination.js";
import type { AgentPrincipalRefV1, StartWorkParticipationCommand } from "../../src/contracts/coordination.js";

const AT = "2026-09-05T12:00:00.000Z";
const PROJECT = "proj-alpha";
const WORKSPACE = "ws-shared";
const GOAL = "goal-1";
const AGENT = "agent-c";
const WORK_C = "work-c";
const TASK = DISPATCH_ELIGIBLE_TASK_ID;
const PLAN_REF = { aggregateType: "PlanRevision", projectId: PROJECT, planId: "plan-dispatch-mvp" } as const;
const INSTRUCTION = "CM1A-STEP3-INSTRUCTION";
const REQUEST_KEY = "req-1";
const SUBSCRIPTION_KEY = "sub-1";
const RESPONSE_KEY = "rep-1";
const WAIT_KEY = "wait-1";
/** 只存在于**报告正文**里的版本标识：它只能经"报告 → 订阅路由"进入后继 Run 的输入。 */
const REPORT_NONCE = "REPORT-VERSION-NONCE-3f91ab";
const REQUEST_BODY = JSON.stringify({ request: "请产出只读调查报告 A", requestedVersion: "v1" });
const REPORT_BODY = JSON.stringify({ report: "A", version: "v3", nonce: REPORT_NONCE });

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

type Captured = { mode?: 'all' | 'any'; requests: Map<string, ModelRequest[]>; toolCalls: { runId: string; name: string }[] };

type World = {
  dir: string;
  root: string;
  captured: Captured;
  runtime: { current: CodingAgentRuntime };
  h: PersistentSqliteHarness;
  runRef: RunRef;
  workC: WorkContextRef;
  partC: WorkParticipationRef;
};

function agentActor(runRef: RunRef) {
  return { kind: "agent" as const, id: AGENT, runRef: { ...runRef } };
}

function principalFor(runRef: RunRef, workContextRef: WorkContextRef, participationRef: WorkParticipationRef): AgentPrincipalRefV1 {
  return {
    schemaVersion: 1,
    agentInstanceId: AGENT,
    workContextRef: { ...workContextRef },
    participationRef: { ...participationRef },
    roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
    runRef: { ...runRef },
  };
}

/** 从本 Run 的持久目录建一个真实内核运行时（重启时对同一目录再建一个实例）。 */
async function createRuntime(directory: string, captured: Captured) {
  const runtime = new CodingAgentRuntime(directory, async (runId: string) => {
    let log = captured.requests.get(runId);
    if (log === undefined) { log = []; captured.requests.set(runId, log); }
    return {
      configuration: { revision: "local", provider: "deepseek", model: "local-capture-client", baseUrl: "http://127.0.0.1" },
      client: makeClient(runId, log, captured.toolCalls, captured.mode),
    };
  });
  await runtime.init();
  return runtime;
}

/** 模型工具结果的读取面（确定性替身"读工具结果"的方式，与真实模型读 tool 消息一致）。 */
type ToolResult = { operation?: string; accepted?: boolean; references?: { kind: string; id: string }[]; code?: string; issues?: string[] };

function toolResultsOf(request: ModelRequest): ToolResult[] {
  const out: ToolResult[] = [];
  for (const message of request.messages) {
    if (message.role !== "tool") continue;
    const result = message.result as unknown as { output?: { kind: string; value?: unknown }[] };
    for (const item of output0(result)) {
      if (item.kind === "json" && item.value !== null && typeof item.value === "object") out.push(item.value as ToolResult);
    }
  }
  return out;
}

function output0(result: { output?: { kind: string; value?: unknown }[] }): { kind: string; value?: unknown }[] {
  return Array.isArray(result.output) ? result.output : [];
}

/** 取某次操作产生的精确引用 id（模型据此在后续调用里引用同一对象）。 */
function referenceId(results: ToolResult[], operation: string, kind: string): string | null {
  for (const result of results) {
    if (result.operation !== operation || result.accepted !== true) continue;
    const hit = (result.references ?? []).find((ref) => ref.kind === kind);
    if (hit !== undefined) return hit.id;
  }
  return null;
}

/**
 * 确定性模型替身：按"这次运行里第几次模型请求"决定下一步动作。
 *
 *   · 输入里已经带着**报告正文的 nonce** → 直接给出最终回答（这正是后继 Run 的证据：
 *     目标 Delivery 的精确版本真的进了这次实际请求）；
 *   · 否则按顺序调用四个协调工具（请求 → 订阅 → 报告 → all-wait），然后结束。
 */
function makeClient(runId: string, log: ModelRequest[], toolCalls: { runId: string; name: string }[], mode: 'all' | 'any' = 'all'): ModelClientPort {
  return {
    async *stream(request): AsyncIterable<ModelEvent> {
      log.push(structuredClone(request));
      const common = { schemaVersion: 1 as const, requestId: request.requestId };
      const index = log.length - 1;
      // 只看**输入**（user 消息）：助手自己的工具调用参数里也会出现报告正文，
      // 把它算进来会让"材料到齐"的判定变成自证。
      const rendered = request.messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
      const available = new Set(request.tools.map((tool) => tool.name));
      const call = (name: string, params: Record<string, unknown>): ModelEvent[] => {
        if (!available.has(name)) throw new Error("本次请求没有启用协调工具：" + name);
        const callId = runId + "-call-" + String(index + 1);
        toolCalls.push({ runId, name });
        return [
          { ...common, sequence: 1, type: "tool_call_started", callId, name, ordinal: 0 },
          { ...common, sequence: 2, type: "tool_arguments_delta", callId, delta: JSON.stringify(params) },
          { ...common, sequence: 3, type: "completed", reason: "tool_calls" },
        ];
      };
      if (rendered.includes(REPORT_NONCE)) {
        yield { ...common, sequence: 1, type: "text_delta", delta: "已读到本次正式报告的精确版本，未修改任何文件。" };
        yield { ...common, sequence: 2, type: "completed", reason: "final_answer" };
        return;
      }
      const results = toolResultsOf(request);
      const requestId = referenceId(results, "request", "DirectedRequest");
      if (index === 0) { for (const event of call("coordination_request", { toWorkId: WORK_C, statement: "请产出只读调查报告 A", body: REQUEST_BODY, key: REQUEST_KEY })) yield event; return; }
      if (index === 1) { for (const event of call("coordination_subscribe", { topics: ["DirectedRequestResponded"], key: SUBSCRIPTION_KEY })) yield event; return; }
      if (index === 2) {
        if (requestId === null) throw new Error("模型看不到定向请求的精确 id");
        for (const event of call("coordination_respond", { requestId, body: REPORT_BODY, key: RESPONSE_KEY })) yield event;
        return;
      }
      if (index === 3) {
        if (requestId === null) throw new Error("模型看不到定向请求的精确 id");
        for (const event of call("coordination_wait", { ...(mode === 'any' ? { mode, requestIds: [requestId, 'optional-pending'] } : { requestIds: [requestId] }), key: WAIT_KEY })) yield event;
        return;
      }
      yield { ...common, sequence: 1, type: "text_delta", delta: "协调请求已正式受理。" };
      yield { ...common, sequence: 2, type: "completed", reason: "final_answer" };
    },
  };
}

function specFor(root: string, runId: string): RunSpec {
  return {
    projectId: PROJECT, workspaceId: WORKSPACE, goalId: GOAL, runId, taskId: TASK, root,
    instruction: INSTRUCTION,
    budget: { contextWindowTokens: 1_000_000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 32768 },
  };
}

/** 组装完整世界：真实持久 harness + 真实内核运行时 + 真实 Host 工具装配。 */
async function buildWorld(workKind: "task" | "coordination" = "task", mode: 'all' | 'any' = 'all'): Promise<World> {
  const captured: Captured = { mode, requests: new Map(), toolCalls: [] };
  const dir = await mkdtemp(join(tmpdir(), "cm1a-host-tool-"));
  cleanup.push(async () => { await rm(dir, { recursive: true, force: true }); });
  const root = join(dir, "source");
  await mkdir(root, { recursive: true });
  const runsDir = join(dir, "runs");
  const runtime = { current: await createRuntime(runsDir, captured) };
  cleanup.push(async () => { await runtime.current.close().catch(() => undefined); });

  // 宿主来源能力（与既有 A06 用例同一手法）：它只描述"来源仍当前"这一宿主事实。
  const sourcePort: SourceApplicabilityPort = {
    capture: async (query) => ({
      status: "sourced",
      pin: {
        schemaVersion: 1,
        projectId: query.projectId,
        workspaceId: query.workspaceId,
        sourceSet: structuredClone(query.sourceSet),
        identity: { workspace: WORKSPACE, commit: null },
        manifestDigest: sha256Hex("host-tool-chain-source-v1"),
      },
    }),
  };
  // 准备面必须**按当前实例**解引用：重启时 harness 会重建，但 options 里的对象不变。
  const preparation: RuntimePreparationPort = {
    all: () => runtime.current.all(),
    preflight: (spec) => runtime.current.preflight(spec),
    prepare: (spec) => runtime.current.prepare(spec),
  };

  let h: PersistentSqliteHarness;
  const world: World = { dir, root, captured, runtime, h: undefined as never, runRef: undefined as never, workC: workContextRefFor(PROJECT, WORKSPACE, WORK_C), partC: undefined as never };
  h = await createPersistentSqliteHarness({
    dir,
    deps: { clock: () => AT },
    sourceApplicability: sourcePort,
    runtimePreparation: preparation,
    workspaceRootFor: () => root,
    runtime: {
      capabilities: () => runtime.current.capabilities(),
      // 一律经 `world.h` 解引用：重启（reopen）之后这里的每一次调用都必须落到**新**宿主实例上，
      // 而不是被闭包钉在已经 close 掉的旧连接上。
      start: async (envelope, access) => new LeasedWorkerRuntime({
        runtime: runtime.current,
        lease: () => world.h.workspaceLease,
        vault: () => world.h.vault,
        materials: (spec, current) => new WorkMaterialDrive({
          ledger: world.h.ledger,
          control: {
            resolveTaskWorkIdentity: (query) => world.h.control.resolveTaskWorkIdentity(query),
            grantMaterialAccess: async (command) => {
              const receipt = await world.h.control.grantMaterialAccess(command);
              if (receipt.status === "committed") await world.h.advanceProjection();
              return receipt;
            },
          },
          compiler: new WorkRunMaterialCompiler({
            ledger: world.h.ledger, vault: world.h.vault, workContext: world.h.workContext, completedWork: world.h.completedWork,
            roleSpec: new LedgerRoleSpecRead({ ledger: world.h.ledger }),
          }),
          // 必需材料只按 admission 固定的集合取材（第 3 工作段收窄）。
          deliveries: new DeliveryMaterialCompiler({ admitted: world.h.admittedDeliveryRead, vault: world.h.vault, source: sourcePort }),
        }).assembleRun(spec, current),
        // 协调 Host 工具：组合根按 exact Run 装配（身份由宿主绑定，模型看不到 principal）。
        coordination: (spec) => world.h.coordinationGrant(runRefFor(spec.projectId, spec.goalId, spec.runId)),
        now: () => AT,
      }).start(envelope, access),
    },
  });
  world.h = h;
  cleanup.push(async () => { await h.cleanup().catch(() => undefined); });

  const adapter: P1_03TestHarness = {
    ledger: h.ledger, readModel: h.readModel, runtime: h.runtime,
    bootstrap: h.bootstrap, submit: (command) => h.control.submit(command),
    install: h.install, activate: h.activate, applyPlan: h.applyPlan,
    dispatchReadiness: h.dispatchReadiness, claimTask: h.claimTask, startRun: h.startRun,
    runFact: h.runFact, drive: h.drive, advanceProjection: h.advanceProjection,
    observedCursor: h.observedCursor, planGraph: h.planGraph, taskDetail: h.taskDetail, activeAgent: h.activeAgent,
  };
  expect((await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-ht-boot", correlationId: "corr-ht-boot", submittedAt: AT,
  }))).status).toBe("committed");
  await prepareP103Project(adapter, PROJECT, "a");

  const claim = await h.claimTask(buildDispatchClaimCommand({
    commandId: "cmd-ht-claim", correlationId: "corr-ht-claim", submittedAt: AT, projectId: PROJECT,
    goalId: GOAL, taskId: TASK, attemptId: "att-pred", runId: "run-pred", idempotencyKey: "ht-claim",
    declaredPermissions: { tools: ["read"], writeScope: [] },
    budget: { tokenBudget: 1_000_000, deadline: null },
  }));
  expect(claim.status, JSON.stringify(claim)).toBe("committed");
  const runRef = runRefFor(PROJECT, GOAL, "run-pred");
  const workC = workContextRefFor(PROJECT, WORKSPACE, WORK_C);
  expect((await h.bindWorkContext({
    commandId: "cmd-ht-bind", commandType: "BindWorkContext", schemaVersion: 1, aggregateId: WORK_C,
    expectedRevision: 0, correlationId: "corr-ht-bind", submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "ht-bind" },
    payload: {
      workspaceId: WORKSPACE, workKind, goalId: GOAL, taskId: workKind === "task" ? TASK : null,
      planRef: { ...PLAN_REF }, planRevision: 1, roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 }, initialRunRef: { ...runRef },
    },
  })).status).toBe("committed");
  expect((await h.control.registerAgentInstance({
    commandId: "cmd-ht-agent", commandType: "RegisterAgentInstance", schemaVersion: 1, aggregateId: AGENT,
    expectedRevision: 0, correlationId: "corr-ht-agent", submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "ht-agent" },
    payload: { workspaceId: WORKSPACE, templateId: "template-runner", templateRevision: "1" },
  })).status).toBe("committed");

  // 参与关系必须在 Run **开始执行之前**建立：模型在这一段参与里通过工具发命令，
  // 工具的身份是从 canonical 事实派生出来的（派生不到就不装配工具，而不是给个假身份）。
  const partC = { aggregateType: "WorkParticipation", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK_C, participationId: "part-c" } as const;
  const participation: StartWorkParticipationCommand = {
    commandId: "cmd-ht-part-c", commandType: "StartWorkParticipation", schemaVersion: 1, aggregateId: "part-c",
    expectedRevision: 0, correlationId: "corr-ht-part-c", submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "ht-part-c", agentPrincipal: principalFor(runRef, workC, partC) },
    payload: { workspaceId: WORKSPACE, workContextRef: { ...workC }, agentInstanceId: AGENT, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 }, runRef: { ...runRef } },
  };
  expect((await h.control.startWorkParticipation(participation)).status, "参与关系必须被受理").toBe("committed");
  if (mode === 'any') {
    const stored = await h.vault.put({ contentType: 'text/plain', body: 'second optional report remains pending', ownerRef: runRef,
      sourceRefs: [{ kind: 'workspace', refId: WORKSPACE, revision: '1' }], requestedAt: AT });
    if (stored.status !== 'stored') throw Error('optional request body unavailable');
    const request = await h.control.sendDirectedRequest({ commandId: 'optional-pending', commandType: 'SendDirectedRequest', schemaVersion: 1,
      aggregateId: 'optional-pending', expectedRevision: 0, correlationId: 'optional-pending', submittedAt: AT,
      identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: 'optional-pending', agentPrincipal: principalFor(runRef, workC, partC) },
      payload: { workspaceId: WORKSPACE, fromParticipationRef: partC, fromRunRef: runRef, toWorkContextRef: workC,
        expectedParticipationRef: partC, statement: 'another optional report', statementBodyRef: stored.ref, roleBinding: ROLE_BINDING_FIXTURE_V1 } });
    expect(request.status, JSON.stringify(request)).toBe('committed');
  }

  // 前驱 Run 的 RunSpec 由宿主登记（普通任务运行的既有准备路径），后继 Run 的准备则必须由
  // **产品路径**完成——本用例不再手工 prepare 后继。
  await runtime.current.prepare(specFor(root, "run-pred"));
  world.runRef = runRef;
  world.partC = partC;
  return world;
}

/**
 * 某个 Run 的**输入**（user 消息）。刻意不看助手/工具消息：助手自己写的报告正文会出现在
 * 它的工具调用参数里，把它算进来会让"材料是否到齐"变成自证。
 */
function userInputOf(requests: ModelRequest[] | undefined): string {
  return (requests ?? []).map((request) => request.messages.filter((message) => message.role === "user").map((message) => message.content).join("\n")).join("\n");
}

/** drive 前驱运行：模型在这条真实链里经 Host 工具发请求/订阅/报告/等待。 */
async function runPredecessor(w: World): Promise<void> {
  const drive = await w.h.drive({ reason: "ht-predecessor", maxIntents: 2 });
  expect(drive.failures, JSON.stringify(drive.failures)).toEqual([]);
  expect(drive.started, JSON.stringify(drive)).toBe(1);
}

/** 事件扫描的页大小与页数上界（超过即**失败**，绝不静默截断）。 */
const SCAN_PAGE_SIZE = 1000;
const SCAN_MAX_PAGES = 500;

/**
 * 读**全部**账本事件——确定性收敛，不靠窗口启发式。
 *
 * 为什么必须这样（缺陷修复）：早先的写法是"页游标不推进就收尾"，那是一条**静默截断**：
 * 在 300+ 文件并发、机器负载高时扫描会提前结束，依赖窗口的断言就会随机变红且极难复现。
 * 现在：
 *   · 只有 `hasMore === false` 才认为读完（真正的收敛判据）；
 *   · 页游标不推进却声称还有更多 → **抛错**（读不完整必须可见）；
 *   · 页数超过显式上界 → **抛错**（不用截断的窗口做断言）。
 */
async function readAllEvents(h: PersistentSqliteHarness): Promise<PositionedEvent[]> {
  const out: PositionedEvent[] = [];
  let cursor: string | null = null;
  for (let pages = 0; ; pages += 1) {
    if (pages > SCAN_MAX_PAGES) {
      throw new Error("账本事件扫描超过显式上界 " + String(SCAN_MAX_PAGES) + " 页：读不完整，不用截断的窗口做断言");
    }
    const page = await h.ledger.events({ afterCursor: cursor as never, limit: SCAN_PAGE_SIZE });
    out.push(...page.events);
    if (!page.hasMore) return out; // 唯一收敛判据
    if (page.throughCursor === null || page.throughCursor === cursor) {
      throw new Error("账本事件页游标没有推进但 hasMore=true：读不完整，不用截断的窗口做断言");
    }
    cursor = page.throughCursor;
  }
}

/**
 * 2.1 原子事务的可观察证据（两条，都不依赖扫描窗口的"大致完整"）：
 *
 *  (a) **按 ref 读快照**：后继接续的六个 canonical 记录（TaskLease/TaskAttempt/Run/
 *      DispatchOutboxEntry/WaitCondition/CommunicationAdmission）必须互相一致——Run↔Attempt↔
 *      outbox.intent↔lease 的持有者，以及 wait.satisfiedRevision ↔ admission.satisfiedRevision。
 *      Control 这些记录是在**同一次提交**里写的，账本侧由
 *      `validateCommunicationSuccessorClaimCommit` 强制整批形状；因此一致性本身就是原子性证据。
 *  (b) 事件侧：**完整读完**账本后，最后一个 TaskClaimed 之后紧邻的两个事件恰好是
 *      WaitConditionSatisfied 与 CommunicationAdmissionRecorded（同批事件在游标序里连续）。
 */
async function successorClaimSequence(h: PersistentSqliteHarness): Promise<string[]> {
  const events = await readAllEvents(h);
  let window: string[] = [];
  let lastClaimWindow: string[] = [];
  for (const positioned of events) {
    const type = positioned.event.eventType;
    // 每个 TaskClaimed 开启一个新的窗口；只保留**最后一个**完整的 3 事件窗口
    // （这条链里有两次 claim：夹具的前驱一次，后继接续一次）。
    if (type === "TaskClaimed") { window = [type]; continue; }
    if (window.length === 0 || window.length >= 3) continue;
    window.push(type);
    if (window.length === 3) lastClaimWindow = [...window];
  }
  return lastClaimWindow;
}

/** (a) 按 ref 读回后继接续的全部 canonical 记录。 */
async function successorBundle(h: PersistentSqliteHarness, attemptId: string, waitId: string) {
  const attempt = await h.ledger.load(taskAttemptRefFor(PROJECT, GOAL, TASK, attemptId));
  const run = await h.ledger.load(runRefFor(PROJECT, GOAL, successorRunIdFor(attemptId)));
  const outbox = await h.ledger.load(dispatchOutboxRefFor(PROJECT, GOAL, TASK, attemptId));
  const lease = await h.ledger.load(taskLeaseRefFor(PROJECT, GOAL, TASK));
  const wait = await h.ledger.load(waitConditionRefFor(PROJECT, WORKSPACE, waitId));
  const admission = await h.ledger.load(communicationAdmissionRefFor(PROJECT, WORKSPACE, waitId));
  for (const [name, loaded] of [["TaskAttempt", attempt], ["Run", run], ["DispatchOutboxEntry", outbox], ["TaskLease", lease], ["WaitCondition", wait], ["CommunicationAdmission", admission]] as const) {
    if (loaded.status !== "found") throw new Error("后继接续记录缺失：" + name);
  }
  return {
    attempt: attempt.status === "found" ? (attempt.snapshot as TaskAttemptSnapshot) : null,
    run: run.status === "found" ? (run.snapshot as RunSnapshot) : null,
    outbox: outbox.status === "found" ? (outbox.snapshot as DispatchOutboxEntrySnapshot) : null,
    lease: lease.status === "found" ? (lease.snapshot as TaskLeaseSnapshot) : null,
    wait: wait.status === "found" ? (wait.snapshot as WaitConditionSnapshot) : null,
    admission: admission.status === "found" ? (admission.snapshot as CommunicationAdmissionSnapshot) : null,
  };
}

/** 账本里全部 WaitCondition 快照（用例只读复核，不参与判定）。 */
async function loadWaits(h: PersistentSqliteHarness): Promise<WaitConditionSnapshot[]> {
  const refs = new Map<string, ReturnType<typeof waitConditionRefFor>>();
  for (const positioned of await readAllEvents(h)) {
    const event = positioned.event as { eventType?: string; workspaceId?: string; payload?: { wait?: { waitId: string } } };
    if (event.eventType !== "WaitConditionRegistered" || event.payload?.wait === undefined) continue;
    const ref = waitConditionRefFor(PROJECT, String(event.workspaceId), event.payload.wait.waitId);
    refs.set(ref.waitId, ref);
  }
  const out: WaitConditionSnapshot[] = [];
  for (const ref of refs.values()) {
    const loaded = await h.ledger.load(ref);
    if (loaded.status === "found" && loaded.snapshot.ref.aggregateType === "WaitCondition") out.push(loaded.snapshot as WaitConditionSnapshot);
  }
  return out;
}

async function countEvents(h: PersistentSqliteHarness, eventType: string): Promise<number> {
  // 同样是"读到头才算数"：不做静默截断（见 readAllEvents 的说明）。
  return (await readAllEvents(h)).filter((positioned) => positioned.event.eventType === eventType).length;
}

describe("Host 工具链（A02/A05/A06/A09）：请求 → 报告 → 订阅 → all-wait → 唯一后继 → 实际输入", () => {
  it.each([
    { workKind: 'task' as const, mode: 'all' as const }, { workKind: 'coordination' as const, mode: 'all' as const },
    { workKind: 'coordination' as const, mode: 'any' as const },
  ])("模型经真实工具与重启形成精确输入；admission Work 类型=$workKind/$mode", async ({ workKind, mode }) => {
    const w = await buildWorld(workKind, mode);
    await runPredecessor(w);
    if (workKind === "coordination") {
      const events = await readAllEvents(w.h);
      const taskWorks = events.filter(p => p.event.eventType === "WorkContextBound" && p.event.payload.binding.workKind === "task");
      expect(taskWorks).toHaveLength(1);
      expect(taskWorks[0]!.event.aggregateId).not.toBe(WORK_C);
    }

    // ── A02：工具链真的发生了（模型调用记录 + 正文 body-first + Control 受理回执）──────
    const called = w.captured.toolCalls.map((call) => call.name);
    expect(called).toEqual([
      "coordination_request", "coordination_subscribe", "coordination_respond", "coordination_wait",
    ]);

    let request: DirectedRequestSnapshot | null = null;
    for (const positioned of await readAllEvents(w.h)) {
      if (positioned.event.eventType !== "DirectedRequestSent") continue;
      const ref = directedRequestRefFor(PROJECT, WORKSPACE, (positioned.event.payload as { request: { requestId: string } }).request.requestId);
      const loaded = await w.h.ledger.load(ref);
      if (loaded.status === "found") request = loaded.snapshot as DirectedRequestSnapshot;
    }
    expect(request, "定向请求必须在正式入口落账").not.toBeNull();
    expect(request!.request.status, "报告必须由 Control 正式登记为该请求的回应").toBe("responded");
    expect(request!.request.response!.bodyRef.digest, "报告正文必须与 Vault 里的正文摘要一致").toBe(
      sha256Hex(REPORT_BODY),
    );
    // 报告正文真的在 Vault 里，并且**只有**它带着这个版本 nonce。
    const opened = await w.h.vault.open(request!.request.response!.bodyRef, { requesterRunRef: w.runRef });
    expect(opened.status).toBe("ready");
    expect(opened.status === "ready" ? opened.record.body : "").toContain(REPORT_NONCE);

    // 前驱的模型**输入**里没有报告 nonce（目标材料不是预埋在原任务里的）。
    expect(userInputOf(w.captured.requests.get("run-pred"))).not.toContain(REPORT_NONCE);

    // ── A09：重启（close + 重建宿主 + 新 Runtime 实例读同一份持久 journal）────────────
    const predecessorInstruction = w.runtime.current.all().find((row) => row.spec.runId === "run-pred")!.spec.instruction;
    expect(predecessorInstruction).toBe(INSTRUCTION);
    await w.runtime.current.close();
    await w.h.close();
    const next = await createRuntime(join(w.dir, "runs"), w.captured);
    cleanup.push(async () => { await next.close().catch(() => undefined); });
    w.runtime.current = next;
    w.h = await w.h.reopen();
    // 重启后新实例只凭磁盘上的持久 journal 就重建出前驱 RunSpec（后继的指令来源）。
    expect(next.all().map((row) => row.spec.runId)).toContain("run-pred");

    // ── A05/A06：条件已满足 ∧ 前驱公开结束 → 唯一后继被受理、被准备、真的跑起来 ─────────
    const drive = await w.h.drive({ reason: "ht-successor", maxIntents: 8 });
    expect(drive.coordination?.failures, JSON.stringify(drive.coordination?.failures)).toEqual([]);
    expect(drive.coordination?.admissions, "恰好一个后继被受理").toBe(1);
    expect(drive.failures, JSON.stringify(drive.failures)).toEqual([]);
    expect(drive.started, "后继必须由生产路径准备并启动").toBe(1);

    // 唯一性：整条链只有两个 TaskAttempt/Run（前驱 + 后继），没有第二个后继。
    expect(await countEvents(w.h, "TaskClaimed")).toBe(2);
    expect(await countEvents(w.h, "RunStarted")).toBe(2);

    // admission 固定了**精确的**目标 Delivery 集合。
    const admission = await readAdmittedSuccessor(w.h.ledger, { projectId: PROJECT, workspaceId: WORKSPACE, runId: "run-pred" });
    expect(admission.status).toBe("absent");
    const successorIds = next.all().map((row) => row.spec.runId).filter((runId) => runId !== "run-pred");
    expect(successorIds, "重启后的 Runtime 里必须有这次准备出来的后继 Run").toHaveLength(1);
    const successorRunId = successorIds[0]!;
    const admitted = await readAdmittedSuccessor(w.h.ledger, { projectId: PROJECT, workspaceId: WORKSPACE, runId: successorRunId });
    expect(admitted.status, JSON.stringify(admitted)).toBe("found");
    if (admitted.status !== "found") throw new Error("successor admission missing");
    expect(admitted.facts.admission.admission.deliveryRefs.length, "admission 必须固定目标 Delivery 集合").toBe(1);
    const delivery = admitted.facts.deliveries[0]!;
    expect(delivery.delivery.targetWorkContextRef.workId).toBe(WORK_C);
    expect(delivery.delivery.bodyRef?.digest, "固定的 Delivery 必须携带报告正文").toBe(sha256Hex(REPORT_BODY));
    expect(delivery.delivery.origin.kind).toBe("subscription");

    // ── A06：后继 Run 的**实际 ModelRequest** 含目标 Delivery 的正文与精确版本 ─────────
    const successorRequests = w.captured.requests.get(successorRunId) ?? [];
    expect(successorRequests.length, '后继必须真的调用了模型: ' + JSON.stringify(next.all().find(row => row.spec.runId === successorRunId))).toBeGreaterThan(0);
    const withNonce = successorRequests.filter((request) => userInputOf([request]).includes(REPORT_NONCE));
    expect(withNonce, "目标 Delivery 的正文必须进入捕获的实际 ModelRequest").toHaveLength(1);
    const userMessage = withNonce[0]!.messages.find((message) => message.role === "user")!.content;
    expect(userMessage).toContain(REPORT_NONCE);
    expect(userMessage).toContain("deliveryVersion");
    expect(userInputOf(w.captured.requests.get("run-pred"))).not.toContain(REPORT_NONCE);

    const record = next.all().find((row) => row.spec.runId === successorRunId);
    expect(record, "后继 Run 必须在真实内核里运行过").toBeDefined();
    expect(record!.status).toBe("completed");
    expect(record!.spec.instruction, "后继 RunSpec 的指令来自持久事实（前驱已登记的 RunSpec）").toBe(INSTRUCTION);
    const version = delivery.delivery.origin.kind === "subscription"
      ? delivery.delivery.origin.sourceTopic + "@" + String(delivery.delivery.origin.sourceCursor)
      : "";
    const manifest = record!.context!.manifest;
    expect(manifest.scope.runId).toBe(successorRunId);
    const entry = manifest.selected.find((item) => item.kind === "rule" && item.selectedBecause.includes(delivery.ref.deliveryId));
    expect(entry, "manifest.selected 必须含该 Delivery 条目").toBeDefined();
    expect(entry!.sourceRefs.some((ref) => ref.revision === version && ref.refId.length > 0)).toBe(true);

    // ── A09 续：已经跑完的 Run 不会被重新准备/重新启动 ──────────────────────────────
    const again = await w.h.drive({ reason: "ht-no-restart", maxIntents: 8 });
    expect(again.started, "已经运行的后继不得被重新启动").toBe(0);
    expect(await countEvents(w.h, "TaskClaimed")).toBe(2);
    expect(await countEvents(w.h, "RunStarted")).toBe(2);
    // ── 2.1 原子事务：wait satisfied + admission + Attempt + Run + 唯一 outbox 同一提交 ────
    // (a) 按 ref 读回六个 canonical 记录并核对互相一致（不依赖任何扫描窗口）。
    const bundle = await successorBundle(w.h, admitted.facts.admission.admission.attemptRef.attemptId, admitted.facts.admission.admission.waitRef.waitId);
    // 只断言**身份与互相一致**（不被后续事实改变的原子性证据）；status/revision 会随后继 Run
    // 的启动与结束继续推进，因此这里只要求它是这三个取值之一。
    expect(["claimed", "started", "ended"]).toContain(bundle.attempt!.status);
    expect(bundle.attempt!.revision).toBeGreaterThanOrEqual(1);
    expect(bundle.attempt!.runId).toBe(successorRunId);
    expect(bundle.run!.attemptId).toBe(bundle.attempt!.ref.attemptId);
    expect(JSON.stringify(bundle.outbox!.intent.runRef)).toBe(JSON.stringify(bundle.run!.ref));
    expect(JSON.stringify(bundle.outbox!.intent.attemptRef)).toBe(JSON.stringify(bundle.attempt!.ref));
    expect(bundle.outbox!.intent.admittedWorkRef!.workId, "唯一调度记录固定了同一个 Work").toBe(WORK_C);
    expect(bundle.lease!.holderRunId, "同一提交里租约已转给后继 Run").toBe(successorRunId);
    expect(bundle.lease!.attemptId).toBe(bundle.attempt!.ref.attemptId);
    expect(bundle.wait!.wait.status).toBe("satisfied");
    expect(bundle.admission!.admission.satisfiedRevision, "wait 的 satisfiedRevision 与 admission 同一值").toBe(bundle.wait!.wait.satisfiedRevision);
    expect(JSON.stringify(bundle.admission!.admission.runRef)).toBe(JSON.stringify(bundle.run!.ref));
    // (b) 事件侧：完整读完账本后，最后一次 claim 的三条事件连续（同批事件在游标序里连续）。
    const oneCommit = await successorClaimSequence(w.h);
    expect(oneCommit, JSON.stringify(oneCommit)).toEqual(["TaskClaimed", "WaitConditionSatisfied", "CommunicationAdmissionRecorded"]);

    // ── 准备入口本身的行为（受持久的"来源可用性"约束，不猜输入）─────────────────────────
    const outbox = await w.h.ledger.load(dispatchOutboxRefFor(PROJECT, GOAL, TASK, admitted.facts.admission.admission.attemptRef.attemptId));
    expect(outbox.status, "后继的唯一调度记录必须可读").toBe("found");
    if (outbox.status !== "found") throw new Error("successor outbox missing");
    const successorIntent = (outbox.snapshot as DispatchOutboxEntrySnapshot).intent;
    // ── 1.2 输入绑定：受理记录必须带完整绑定，且 Dispatch 只用这一份（不重新猜测）────────
    expect(admissionBindingIssues(admitted.facts.admission.admission)).toEqual([]);
    const tampered = { ...admitted.facts.admission.admission } as Record<string, unknown>;
    delete tampered["deliveryRefs"];
    expect(admissionBindingIssues(tampered as never).join(" | "), "缺少必需 Delivery 引用的旧记录必须不可恢复").toContain("deliveryRefs");
    delete tampered["roleBinding"];
    expect(admissionBindingIssues(tampered as never).join(" | ")).toContain("roleBinding");
    // 受理固定的授权版本与唯一调度记录里的 RoleBinding 逐字段相同（Dispatch 不另选一份）。
    expect(JSON.stringify(admitted.facts.admission.admission.roleBinding)).toBe(JSON.stringify(successorIntent.roleBinding));
    expect(admitted.facts.admission.admission.workContextRef.workId, "受理固定的 Work 就是 intent 固定的 Work").toBe(successorIntent.admittedWorkRef!.workId);
    expect(admitted.facts.admission.admission.predecessorRunRef.runId, "受理固定的前驱 Run 是指令来源的锚点").toBe("run-pred");
    expect(admitted.facts.admission.admission.runRef.runId).toBe(successorRunId);
    // ── 1.3 Workspace 路径由受信宿主解析（不是模型给的、也不是快照里的自由文本）──────────
    expect(record!.spec.root, "后继 RunSpec 的 root 来自宿主的 workspaceRootFor").toBe(w.root);
    expect(JSON.stringify(successorIntent), "调度记录里没有工作区路径这种自由文本").not.toContain(w.root);
    const noRoot = await prepareAdmittedSuccessor({ ledger: w.h.ledger, runtime: next, workspaceRootFor: () => null }, successorIntent);
    expect(noRoot.status).toBe("unavailable");
    expect(noRoot.status === "unavailable" ? noRoot.code : "").toBe("workspace_root_unknown");
    // ── 1.2 权限集必须与受理固定的那一份一致（否则 fail-closed、不启动）────────────────
    expect(JSON.stringify(admitted.facts.admission.admission.declaredPermissions), "受理固定的权限集就是唯一调度记录里的那一份").toBe(JSON.stringify(successorIntent.declaredPermissions));
    const tamperedPermissions = { ...successorIntent, declaredPermissions: { tools: ["read", "write", "shell"], writeScope: ["*"] } };
    const permissionMismatch = await prepareAdmittedSuccessor({ ledger: w.h.ledger, runtime: next, workspaceRootFor: () => w.root }, tamperedPermissions);
    expect(permissionMismatch.status, JSON.stringify(permissionMismatch)).toBe("unavailable");
    expect(permissionMismatch.status === "unavailable" ? permissionMismatch.code : "").toBe("authorization_mismatch");
    expect(permissionMismatch.status === "unavailable" ? permissionMismatch.message : "").toContain("declaredPermissions 不一致");
    // 缺少权限集的旧受理记录同样不可恢复（不启动）。
    const withoutPermissions = { ...admitted.facts.admission.admission } as Record<string, unknown>;
    delete withoutPermissions["declaredPermissions"];
    expect(admissionBindingIssues(withoutPermissions as never).join(" | ")).toContain("declaredPermissions");

    // ── 1.3 同一 Run 不同内容必须拒绝（不覆盖已登记的准备）─────────────────────────────
    const tamperedIntent = { ...successorIntent, budget: { ...successorIntent.budget, tokenBudget: 999_999 } };
    const mismatch = await prepareAdmittedSuccessor({ ledger: w.h.ledger, runtime: next, workspaceRootFor: () => w.root }, tamperedIntent);
    expect(mismatch.status, JSON.stringify(mismatch)).toBe("unavailable");
    expect(mismatch.status === "unavailable" ? mismatch.code : "").toBe("preparation_content_mismatch");
    // 未被覆盖：已登记的准备记录内容仍是原来那一份。
    expect(next.all().find((row) => row.spec.runId === successorRunId)!.spec.budget.contextWindowTokens).toBe(1_000_000);
    // (a) 已经跑完的 Run 不重新准备、也不重新启动：准备入口只能给出 not_restartable。
    const restartable = await prepareAdmittedSuccessor({ ledger: w.h.ledger, runtime: next, workspaceRootFor: () => w.root }, successorIntent);
    expect(restartable, JSON.stringify(restartable)).toEqual({
      status: "not_restartable", runStatus: "completed",
      message: "后继 Run 已经运行或结果未知（status=completed）：不重新准备、也不重新启动",
    });
    // (b) 普通任务 Run（不是接续产生的）不被本入口介入。
    const predecessorIntent = (await w.h.ledger.load(dispatchOutboxRefFor(PROJECT, GOAL, TASK, "att-pred"))) as { status: string; snapshot: DispatchOutboxEntrySnapshot };
    expect(predecessorIntent.status).toBe("found");
    expect((await prepareAdmittedSuccessor({ ledger: w.h.ledger, runtime: next, workspaceRootFor: () => w.root }, predecessorIntent.snapshot.intent)).status).toBe("not_successor");
    // (c) 指令来源读不到时**拒绝准备**（fail-closed），而不是拿一份猜出来的输入启动。
    const emptyDir = join(w.dir, "empty-runs");
    const emptyRuntime = new CodingAgentRuntime(emptyDir, async () => ({
      configuration: { revision: "local", provider: "deepseek", model: "local-capture-client", baseUrl: "http://127.0.0.1" },
      client: { async *stream() { yield { schemaVersion: 1 as const, requestId: "unused", sequence: 1, type: "completed" as const, reason: "final_answer" as const }; } },
    }));
    await emptyRuntime.init();
    cleanup.push(async () => { await emptyRuntime.close().catch(() => undefined); });
    const missing = await prepareAdmittedSuccessor({ ledger: w.h.ledger, runtime: emptyRuntime, workspaceRootFor: () => w.root }, successorIntent);
    expect(missing.status).toBe("unavailable");
    expect(missing.status === "unavailable" ? missing.code : "").toBe("instruction_source_missing");

    const waits = await loadWaits(w.h);
    expect(waits, "all-wait 必须由工具正式登记").toHaveLength(1);
    expect(waits[0]!.wait.predecessorRunRef.runId, "等待归本次 Run（前驱）").toBe("run-pred");
    expect(waits[0]!.wait.ownerWorkContextRef.workId).toBe(WORK_C);
    expect(waits[0]!.wait.satisfiedRevision, "等待必须已经满足（同一事务里产生唯一后继）").not.toBeNull();
  });
});
