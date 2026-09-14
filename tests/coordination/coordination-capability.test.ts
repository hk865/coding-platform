/**
 * CM-1A-001 协议约束 **2.3**：协调工具需要**独立的能力声明**。
 *
 * 断言三件事：
 *   1. 宿主在执行前给出的判定是**独立的协调能力**（`capability: 'coordination'`），
 *      依据是账本里已经存在的 canonical 事实（参与关系 / 接续受理），不是 workspace 读、
 *      也不是文件写入或 shell 权限；
 *   2. **未授予的 Run**：判定给出可读原因、运行里**不出现**协调工具（模型试图调用会拿到可读拒绝
 *      `unknown_tool`），且**平台状态没有被改动**（没有请求、没有正文进 Vault）；
 *   3. **授予的 Run**：判定 granted（带依据），工具在本次请求里可用，调用被正式受理，
 *      并且授予**随运行记录持久化**（可审计：谁在什么依据下被授予）。
 *
 * 走的是生产实现：真实持久 SQLite harness、真实 ControlEngine/DispatchEngine、真实
 * LeasedWorkerRuntime + 内核 CodingAgentRuntime（模型客户端是确定性替身）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { createPersistentPlatform, type PersistentPlatform } from "../../src/composition/persistent-platform.js";
import { CodingAgentRuntime, type RunSpec } from "../../src/execution/worker-runtime/coding-agent-runtime.js";
import { LeasedWorkerRuntime } from "../../src/control/dispatch-engine/leased-worker-runtime.js";
import { WorkMaterialDrive } from "../../src/control/dispatch-engine/work-material-drive.js";
import { LedgerRoleSpecRead } from "../../src/control/dispatch-engine/role-spec-read.js";
import { WorkRunMaterialCompiler } from "../../src/data/context-compiler/work-run-materials.js";
import { DeliveryMaterialCompiler } from "../../src/data/context-compiler/delivery-materials.js";
import { COORDINATION_TOOL_NAMES, createCoordinationTools } from "../../src/execution/worker-runtime/coordination-tools.js";
import { coordinationRuntimeGrant, resolveCoordinationCapability } from "../../src/control/dispatch-engine/coordination-capability.js";
import { directedRequestRefFor } from "../../src/contracts/coordination.js";
import type { ModelClientPort, ModelEvent, ModelRequest } from "../../vendor/coding-agent/dist/public-api.js";
import type { SourceApplicabilityPort } from "../../src/contracts/material-access.js";
import { sha256Hex } from "../../src/contracts/fingerprint.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { prepareP103Project, type P1_03TestHarness } from "../contract-suite/p1-03-harness.js";
import { buildDispatchClaimCommand, DISPATCH_ELIGIBLE_TASK_ID, ROLE_BINDING_FIXTURE_V1 } from "../../src/fixtures/dispatch-fixtures.js";
import { runRefFor, taskLeaseRefFor, type RunRef, type TaskLeaseSnapshot } from "../../src/contracts/dispatch.js";

import { workContextRefFor, type WorkContextRef } from "../../src/contracts/context-continuity.js";
import type { AgentPrincipalRefV1, StartWorkParticipationCommand, WorkParticipationRef } from "../../src/contracts/coordination.js";

const AT = "2026-09-05T12:00:00.000Z";
const PROJECT = "proj-alpha";
const WORKSPACE = "ws-shared";
const GOAL = "goal-1";
const AGENT = "agent-c";
const WORK_C = "work-c";
const TASK = DISPATCH_ELIGIBLE_TASK_ID;
const PLAN_REF = { aggregateType: "PlanRevision", projectId: PROJECT, planId: "plan-dispatch-mvp" } as const;
const INSTRUCTION = "CM1A-CAPABILITY-INSTRUCTION";
const REQUEST_KEY = "cap-req-1";
const BODY_NONCE = "CAPABILITY-BODY-NONCE-1a2b3c";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function agentActor(runRef: RunRef) {
  return { kind: "agent" as const, id: AGENT, runRef: { ...runRef } };
}

function principalFor(runRef: RunRef, workContextRef: WorkContextRef, participationRef: WorkParticipationRef): AgentPrincipalRefV1 {
  return {
    schemaVersion: 1, agentInstanceId: AGENT, workContextRef: { ...workContextRef },
    participationRef: { ...participationRef }, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 }, runRef: { ...runRef },
  };
}

type ToolOutcome = { status: string; error?: { code: string; message: string }; output?: { kind: string; value?: unknown }[] };

/** 模型替身：第一次请求就调用协调工具（**无论它是否被提供给本次运行**），之后给出最终回答。 */
function makeClient(log: ModelRequest[]): ModelClientPort {
  return {
    async *stream(request): AsyncIterable<ModelEvent> {
      log.push(structuredClone(request));
      const common = { schemaVersion: 1 as const, requestId: request.requestId };
      const offered = new Set(request.tools.map((tool) => tool.name));
      toolsOffered.push([...offered].filter((name) => (COORDINATION_TOOL_NAMES as readonly string[]).includes(name)));
      // 工具结果按 callId 收集（同一条结果会在后续请求的历史里重复出现，这里做去重）。
      for (const message of request.messages) {
        if (message.role !== "tool") continue;
        const result = message.result as unknown as ToolOutcome & { callId?: string };
        toolResultsByCall.set(String(result.callId ?? "unknown"), {
          status: String(result.status),
          ...(result.error === undefined ? {} : { error: result.error }),
          ...(result.output === undefined ? {} : { output: result.output }),
        });
      }
      if (log.length === 1) {
        const callId = "cap-call-1";
        yield { ...common, sequence: 1, type: "tool_call_started", callId, name: "coordination_request", ordinal: 0 };
        yield { ...common, sequence: 2, type: "tool_arguments_delta", callId, delta: JSON.stringify({ toWorkId: WORK_C, statement: "请产出报告", body: JSON.stringify({ nonce: BODY_NONCE }), key: REQUEST_KEY }) };
        yield { ...common, sequence: 3, type: "completed", reason: "tool_calls" };
        return;
      }
      yield { ...common, sequence: 1, type: "text_delta", delta: "已完成。" };
      yield { ...common, sequence: 2, type: "completed", reason: "final_answer" };
    },
  };
}

const toolsOffered: string[][] = [];
const toolResultsByCall = new Map<string, ToolOutcome>();

function specFor(root: string, runId: string): RunSpec {
  return {
    projectId: PROJECT, workspaceId: WORKSPACE, goalId: GOAL, runId, taskId: TASK, root,
    instruction: INSTRUCTION,
    budget: { contextWindowTokens: 1_000_000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 32768 },
  };
}

/**
 * 组装一个世界。`withParticipation` 决定执行前该 Run 是否**已经**被授予协调能力：
 * true = 先经正式入口建立参与关系（账本依据存在）；false = 不建立（判定必须给出可读原因）。
 */
async function buildWorld(withParticipation: boolean,mode?:'explore'): Promise<{ dir: string; root: string; h: PersistentPlatform; runtime: CodingAgentRuntime; runRef: RunRef }> {
  const log: ModelRequest[] = [];
  const dir = await mkdtemp(join(tmpdir(), "cm1a-capability-"));
  cleanup.push(async () => { await rm(dir, { recursive: true, force: true }); });
  const root = join(dir, "source");
  await mkdir(root, { recursive: true });
  const runtime = new CodingAgentRuntime(join(dir, "runs"), async () => ({
    configuration: { revision: "local", provider: "deepseek", model: "local-capture-client", baseUrl: "http://127.0.0.1" },
    client: makeClient(log),
  }));
  await runtime.init();
  cleanup.push(() => runtime.close());

  const sourcePort: SourceApplicabilityPort = {
    capture: async (query) => ({
      status: "sourced",
      pin: {
        schemaVersion: 1, projectId: query.projectId, workspaceId: query.workspaceId,
        sourceSet: structuredClone(query.sourceSet), identity: { workspace: WORKSPACE, commit: null },
        manifestDigest: sha256Hex("capability-source-v1"),
      },
    }),
  };
  let h: PersistentPlatform;
  const holder = { h: undefined as unknown as PersistentPlatform };
  h = await createPersistentPlatform({
    dir,
    deps: { clock: () => AT },
    sourceApplicability: sourcePort,
    runtimePreparation: runtime,
    workspaceRootFor: () => root,
    runtime: {
      capabilities: () => runtime.capabilities(),
      start: async (envelope) => new LeasedWorkerRuntime({
        runtime, lease: () => holder.h.workspaceLease, vault: () => holder.h.vault,
        // This fixture isolates the lease mode barrier; production exploration material flow is covered in explorations.test.ts.
        materials: (spec, current) => spec.mode === "explore" ? Promise.resolve(undefined) : new WorkMaterialDrive({
          ledger: holder.h.ledger,
          control: {
            resolveTaskWorkIdentity: (query) => holder.h.control.resolveTaskWorkIdentity(query),
            grantMaterialAccess: async (command) => {
              const receipt = await holder.h.control.grantMaterialAccess(command);
              if (receipt.status === "committed") await holder.h.advanceProjection();
              return receipt;
            },
          },
          compiler: new WorkRunMaterialCompiler({
            ledger: holder.h.ledger, vault: holder.h.vault, workContext: holder.h.workContext,
            completedWork: holder.h.completedWork, roleSpec: new LedgerRoleSpecRead({ ledger: holder.h.ledger }),
          }),
          deliveries: new DeliveryMaterialCompiler({ admitted: holder.h.admittedDeliveryRead, vault: holder.h.vault, source: sourcePort }),
        }).assembleRun(spec, current),
        // 宿主在这里做**执行前准入**：未授予 → not_granted（不注入工具）。
        coordination: (spec) => holder.h.coordinationGrant(runRefFor(spec.projectId, spec.goalId, spec.runId)),
        now: () => AT,
      }).start(envelope),
    },
  });
  holder.h = h;
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
    commandId: "cmd-cap-boot", correlationId: "corr-cap-boot", submittedAt: AT,
  }))).status).toBe("committed");
  await prepareP103Project(adapter, PROJECT, "a");
  expect((await h.claimTask(buildDispatchClaimCommand({
    commandId: "cmd-cap-claim", correlationId: "corr-cap-claim", submittedAt: AT, projectId: PROJECT,
    goalId: GOAL, taskId: TASK, attemptId: "att-pred", runId: "run-pred", idempotencyKey: "cap-claim",
    declaredPermissions: { tools: ["read"], writeScope: [] },
    budget: { tokenBudget: 1_000_000, deadline: null },
  }))).status).toBe("committed");
  const runRef = runRefFor(PROJECT, GOAL, "run-pred");
  const workC = workContextRefFor(PROJECT, WORKSPACE, WORK_C);
  expect((await h.bindWorkContext({
    commandId: "cmd-cap-bind", commandType: "BindWorkContext", schemaVersion: 1, aggregateId: WORK_C,
    expectedRevision: 0, correlationId: "corr-cap-bind", submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "cap-bind" },
    payload: {
      workspaceId: WORKSPACE, workKind: "task", goalId: GOAL, taskId: TASK,
      planRef: { ...PLAN_REF }, planRevision: 1, roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 }, initialRunRef: { ...runRef },
    },
  })).status).toBe("committed");
  expect((await h.control.registerAgentInstance({
    commandId: "cmd-cap-agent", commandType: "RegisterAgentInstance", schemaVersion: 1, aggregateId: AGENT,
    expectedRevision: 0, correlationId: "corr-cap-agent", submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "cap-agent" },
    payload: { workspaceId: WORKSPACE, templateId: "template-runner", templateRevision: "1" },
  })).status).toBe("committed");

  if (withParticipation) {
    const partC = { aggregateType: "WorkParticipation", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK_C, participationId: "part-c" } as const;
    const participation: StartWorkParticipationCommand = {
      commandId: "cmd-cap-part", commandType: "StartWorkParticipation", schemaVersion: 1, aggregateId: "part-c",
      expectedRevision: 0, correlationId: "corr-cap-part", submittedAt: AT,
      identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "cap-part", agentPrincipal: principalFor(runRef, workC, partC) },
      payload: { workspaceId: WORKSPACE, workContextRef: { ...workC }, agentInstanceId: AGENT, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 }, runRef: { ...runRef } },
    };
    expect((await h.control.startWorkParticipation(participation)).status, "参与关系必须被受理").toBe("committed");
  }
  await runtime.prepare({...specFor(root, "run-pred"),...(mode?{mode}:{})});
  return { dir, root, h, runtime, runRef };
}

/** 跑一次前驱 Run（模型会试图调用协调工具）。 */
async function runOnce(h: PersistentPlatform): Promise<void> {
  const drive = await h.drive({ reason: "cap-run", maxIntents: 2 });
  expect(drive.failures, JSON.stringify(drive.failures)).toEqual([]);
  expect(drive.started).toBe(1);
}

/**
 * 给同一个 Run 再加**第二段** active 参与关系（另一个 AgentInstance、另一个 Work）。
 *
 * 用途：验证"一个 Run 精确对应多段参与关系时**拒绝而不是挑一段**"这条边界。
 * 账本的参与身份槽是 (project, workspace, agentInstanceId)，因此第二段必须换一个 AgentInstance。
 */
async function addSecondParticipation(h: PersistentPlatform, runRef: RunRef): Promise<void> {
  const workD = workContextRefFor(PROJECT, WORKSPACE, "work-d");
  expect((await h.bindWorkContext({
    commandId: "cmd-cap-bind-d", commandType: "BindWorkContext", schemaVersion: 1, aggregateId: "work-d",
    expectedRevision: 0, correlationId: "corr-cap-bind-d", submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "cap-bind-d" },
    payload: {
      workspaceId: WORKSPACE, workKind: "coordination", goalId: GOAL, taskId: null,
      planRef: null, planRevision: null, roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 }, initialRunRef: { ...runRef },
    },
  })).status).toBe("committed");
  const second = "agent-d";
  expect((await h.control.registerAgentInstance({
    commandId: "cmd-cap-agent-d", commandType: "RegisterAgentInstance", schemaVersion: 1, aggregateId: second,
    expectedRevision: 0, correlationId: "corr-cap-agent-d", submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "agent", id: second, runRef: { ...runRef } }, idempotencyKey: "cap-agent-d" },
    payload: { workspaceId: WORKSPACE, templateId: "template-runner", templateRevision: "1" },
  })).status).toBe("committed");
  const partD = { aggregateType: "WorkParticipation", projectId: PROJECT, workspaceId: WORKSPACE, workId: "work-d", participationId: "part-d" } as const;
  expect((await h.control.startWorkParticipation({
    commandId: "cmd-cap-part-d", commandType: "StartWorkParticipation", schemaVersion: 1, aggregateId: "part-d",
    expectedRevision: 0, correlationId: "corr-cap-part-d", submittedAt: AT,
    identity: {
      projectId: PROJECT, actor: { kind: "agent", id: second, runRef: { ...runRef } }, idempotencyKey: "cap-part-d",
      agentPrincipal: {
        schemaVersion: 1, agentInstanceId: second, workContextRef: { ...workD },
        participationRef: { ...partD }, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 }, runRef: { ...runRef },
      },
    },
    payload: { workspaceId: WORKSPACE, workContextRef: { ...workD }, agentInstanceId: second, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 }, runRef: { ...runRef } },
  })).status).toBe("committed");
}

describe("协议约束 2.3：协调能力必须由宿主显式授予", () => {
  it("未授予的 Run：判定给出可读原因、不提供协调工具、调用被拒且平台状态零改动", async () => {
    toolsOffered.length = 0; toolResultsByCall.clear();
    const w = await buildWorld(false);

    // 执行前准入：独立能力 + 可读原因（依据来自账本事实：此刻没有参与关系）。
    const decision = await resolveCoordinationCapability({ ledger: w.h.ledger }, w.runRef);
    expect(decision.status, JSON.stringify(decision)).toBe("not_granted");
    expect(decision.capability).toBe("coordination");
    if (decision.status !== "not_granted") throw new Error("expected not_granted");
    expect(decision.reason).toContain("未被授予协调能力");
    expect(decision.reason, "可读原因必须说明是显式规则里的哪一条不成立").toContain("既没有发起过参与关系");

    await runOnce(w.h);
    // **装配层**拒绝：未授予 ⇒ 运行入口根本不把这些工具放进本次 run 的工具集，
    // 因此本次模型请求的 enabled 工具清单里一个 `coordination_*` 都没有（不是"给了工具再拒绝"）。
    expect(toolsOffered[0], "装配层：未授予 ⇒ 本次请求的工具清单里不含 coordination_*（" + JSON.stringify(toolsOffered) + "）").toEqual([]);
    // 模型仍然试图调用它 → 内核给出可读拒绝（工具未注册）。
    const rejected = [...toolResultsByCall.values()].find((result) => result.status === "error");
    expect(rejected, JSON.stringify([...toolResultsByCall.values()])).toBeDefined();
    expect(rejected!.error!.code).toBe("unknown_tool");
    expect(rejected!.error!.message.length).toBeGreaterThan(0);
    // 平台状态零改动：没有请求落账，也没有正文进 Vault。
    const requestRef = directedRequestRefFor(PROJECT, WORKSPACE, "creq-" + sha256Hex(JSON.stringify(["coordination-tool-v1", "req", "run-pred", REQUEST_KEY])).slice(0, 24));
    expect((await w.h.ledger.load(requestRef)).status).toBe("not_found");
    expect(w.runtime.all().every((record) => record.coordinationCapability === undefined), "未授予的运行不应记录任何协调能力").toBe(true);
  });

  it("授予的 Run：能力依据来自账本事实、工具可用、调用被受理，并随运行记录持久化", async () => {
    toolsOffered.length = 0; toolResultsByCall.clear();
    const w = await buildWorld(true);

    const decision = await resolveCoordinationCapability({ ledger: w.h.ledger }, w.runRef);
    expect(decision.status, JSON.stringify(decision)).toBe("granted");
    if (decision.status !== "granted") throw new Error("expected granted");
    expect(decision.capability).toBe("coordination");
    // 依据是**该 Work 的当前参与关系**（显式规则），不再是"唯一一段 active 参与关系"这种过程式判据。
    expect(decision.grant.basis.kind).toBe("work_current_participation");
    expect(decision.grant.basis.kind === "work_current_participation" ? decision.grant.basis.workContextRef.workId : "").toBe(WORK_C);
    expect(decision.grant.participationRef.participationId).toBe("part-c");
    expect(decision.grant.workContextRef.workId).toBe(WORK_C);

    // 工具声明如实：非只读、不申请任何沙箱能力（协调能力 ≠ 文件写/shell 权限），
    // 并带平台自己的"改平台状态"标记（内核 effectClass 词表没有这一档，见工具文件说明）。
    const definitions = createCoordinationTools({} as never, async () => undefined);
    expect(definitions.map((tool) => tool.effectClass)).toEqual(COORDINATION_TOOL_NAMES.map(() => "workspace_write"));
    expect(definitions.every((tool) => tool.requiredCapabilities.length === 0 && !tool.independentReadOnly)).toBe(true);
    expect(definitions.every((tool) => (tool as { platformEffect?: string }).platformEffect === "coordination_state")).toBe(true);

    await runOnce(w.h);
    expect(toolsOffered[0], JSON.stringify(toolsOffered)).toContain("coordination_request");
    const accepted = [...toolResultsByCall.values()].find((result) => result.status === "success");
    expect(accepted, JSON.stringify([...toolResultsByCall.values()])).toBeDefined();
    expect(JSON.stringify(accepted!.output)).toContain("accepted");
    // 授予随运行记录持久化（可审计：这是哪一条账本事实授予的）。
    const record = w.runtime.all().find((row) => row.spec.runId === "run-pred")!;
    expect(record.coordinationCapability, JSON.stringify(record.coordinationCapability)).toBeDefined();
    expect(record.coordinationCapability!.capability).toBe("coordination");
    expect(record.coordinationCapability!.basis.kind).toBe("work_current_participation");
  });

  it("同一个 Run 在两个 Work 上都满足授予条件时：拒绝授予（可读原因），不替它挑一个身份", async () => {
    const w = await buildWorld(true);
    await addSecondParticipation(w.h, w.runRef);

    const decision = await resolveCoordinationCapability({ ledger: w.h.ledger }, w.runRef);
    expect(decision.status, JSON.stringify(decision)).toBe("not_granted");
    if (decision.status !== "not_granted") throw new Error("expected not_granted");
    expect(decision.reason).toContain("未被授予协调能力");
    expect(decision.reason).toContain("同时在多个 Work 上满足授予条件");
    expect(decision.reason).toContain("不替它挑一个身份");
    // 宿主入口同样给不出访问面（拒绝而不是猜一个身份）。
    const runtimeGrant = await w.h.coordinationGrant(w.runRef);
    expect(runtimeGrant.status).toBe("not_granted");
    expect(runtimeGrant.status === "granted" ? "granted" : runtimeGrant.reason).toContain("同时在多个 Work 上满足授予条件");
  });

  it("不存在第二条拿到协调工具的路径：唯一注入点是运行入口，且它只在 granted 时发生", async () => {
    // 结构性证据（A01/A02 可核对）：协调工具**只能**由运行入口在拿到 granted 授予时注入。
    // 任何新增的注入点、或"绕过授予直接注入"的写法，都会让这条断言失败。
    const root = join(process.cwd(), "src");
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "public") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { await walk(full); continue; }
        if (full.endsWith(".ts") || full.endsWith(".tsx")) files.push(full);
      }
    };
    await walk(root);
    const relative = (file: string) => file.slice(process.cwd().length + 1).split(sep).join("/");
    const bodies = new Map<string, string>();
    for (const file of files) bodies.set(relative(file), await readFile(file, "utf8"));

    // (1) 构造协调工具的地方只有两处：工具定义本身，和运行入口的注入。
    const constructors = [...bodies].filter(([, body]) => body.includes("createCoordinationTools(")).map(([file]) => file).sort();
    expect(constructors).toEqual([
      "src/execution/worker-runtime/coding-agent-runtime.ts",
      "src/execution/worker-runtime/coordination-tools.ts",
    ]);
    // (2) 只有运行入口会把它们作为本次 run 的工具集交出去，而且只在 context.coordination 存在时。
    const optionSites = [...bodies].filter(([, body]) => /coordinationTools:\s*\{/.test(body)).map(([file]) => file).sort();
    expect(optionSites).toEqual(["src/execution/worker-runtime/coding-agent-runtime.ts"]);
    const injection = bodies.get("src/execution/worker-runtime/coding-agent-runtime.ts")!;
    expect(injection).toContain("context?.coordination");
    expect(injection).toMatch(/coordination === undefined \? \{\} : \{/);
    // (3) 访问面只能由 granted 的授予构造（构造点唯一，且必须有授权名单）。
    const accessSites = [...bodies].filter(([, body]) => body.includes("new CoordinationToolAccess(")).map(([file]) => file).sort();
    expect(accessSites).toEqual([
      "src/control/dispatch-engine/coordination-capability.ts",
      "src/control/dispatch-engine/coordination-tool-access.ts",
    ]);
  });

  it("换手之后：旧 Run 不再被授予，新参与段的 Run 被授予（显式规则可直接核对）", async () => {
    const w = await buildWorld(true);
    const workC = workContextRefFor(PROJECT, WORKSPACE, WORK_C);
    const partC = { aggregateType: "WorkParticipation", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK_C, participationId: "part-c" } as const;
    const oldRun = w.runRef;
    expect((await resolveCoordinationCapability({ ledger: w.h.ledger }, oldRun)).status, "换手前：旧 Run 被授予").toBe("granted");

    // (1) 前驱 Run 先真实跑完（Run 公开结束）：新 Run 的产生走产品路径——接续受理创建唯一后继。
    await runOnce(w.h);
    // (2) 在该参与段仍然有效时把"请求 → 报告 → 等待"做完（这些命令要求发起参与 active）。
    const requestBody = JSON.stringify({ request: "换手用例的请求" });
    const stored = await w.h.vault.put({
      contentType: "application/json", body: requestBody, ownerRef: { ...oldRun },
      sourceRefs: [{ kind: "artifact", refId: "run:" + oldRun.runId, revision: "1" }], requestedAt: AT,
    });
    if (stored.status !== "stored") throw new Error("vault put failed");
    const requestId = "ho-request-1";
    expect((await w.h.control.sendDirectedRequest({
      commandId: "cmd-cap-ho-req", commandType: "SendDirectedRequest", schemaVersion: 1, aggregateId: requestId, expectedRevision: 0,
      correlationId: "corr-cap-ho-req", submittedAt: AT,
      identity: { projectId: PROJECT, actor: agentActor(oldRun), idempotencyKey: "cap-ho-req", agentPrincipal: principalFor(oldRun, workC, partC) },
      payload: {
        workspaceId: WORKSPACE, fromParticipationRef: { ...partC }, fromRunRef: { ...oldRun }, toWorkContextRef: { ...workC },
        expectedParticipationRef: null, statement: "请产出报告", statementBodyRef: stored.ref, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
      },
    })).status).toBe("committed");
    expect((await w.h.control.respondDirectedRequest({
      commandId: "cmd-cap-ho-res", commandType: "RespondDirectedRequest", schemaVersion: 1, aggregateId: requestId, expectedRevision: 1,
      correlationId: "corr-cap-ho-res", submittedAt: AT,
      identity: { projectId: PROJECT, actor: agentActor(oldRun), idempotencyKey: "cap-ho-res", agentPrincipal: principalFor(oldRun, workC, partC) },
      payload: {
        workspaceId: WORKSPACE, respondingParticipationRef: { ...partC }, respondingRunRef: { ...oldRun },
        response: { bodyRef: stored.ref, sourceRefs: [{ kind: "artifact", refId: "run:" + oldRun.runId, revision: "1" }], authorRunRef: { ...oldRun } },
      },
    })).status).toBe("committed");
    expect((await w.h.control.registerWait({
      commandId: "cmd-cap-ho-wait", commandType: "RegisterWait", schemaVersion: 1, aggregateId: "wait-ho", expectedRevision: 0,
      correlationId: "corr-cap-ho-wait", submittedAt: AT,
      identity: { projectId: PROJECT, actor: agentActor(oldRun), idempotencyKey: "cap-ho-wait", agentPrincipal: principalFor(oldRun, workC, partC) },
      payload: {
        workspaceId: WORKSPACE, ownerWorkContextRef: { ...workC }, ownerParticipationRef: { ...partC }, predecessorRunRef: { ...oldRun },
        conditions: [{ kind: "request_responded", requestRef: directedRequestRefFor(PROJECT, WORKSPACE, requestId) }], deadlineAt: null,
      },
    })).status).toBe("committed");
    // (3) 前驱已公开结束、条件已满足 → drive 受理**唯一后继**（这就是"新 Run"）。
    const drive = await w.h.drive({ reason: "cap-handover", maxIntents: 8 });
    expect(drive.failures, JSON.stringify(drive.failures)).toEqual([]);
    // 只看**可观察的产物**：真实 Runtime 里除前驱之外的那一条准备/运行记录就是这次唯一后继。
    // （drive 的 coordination 报告在"本次完全没有 intent 事实"时会按既有约定省略，因此不依赖它。）
    const successorRunId = w.runtime.all().map((row) => row.spec.runId).filter((id) => id !== oldRun.runId)[0] ?? "";
    expect(successorRunId.length, "必须产生一个后继 Run（新参与段的发起 Run）").toBeGreaterThan(0);
    const lease = await w.h.ledger.load(taskLeaseRefFor(PROJECT, GOAL, TASK));
    expect(lease.status, "同一提交里租约已转给后继 Run").toBe("found");
    if (lease.status !== "found") throw new Error("lease missing");
    expect((lease.snapshot as TaskLeaseSnapshot).holderRunId).toBe(successorRunId);
    const newRun = runRefFor(PROJECT, GOAL, successorRunId);

    // (4) **现在换手**：结束旧参与段，再由**新 Run** 发起新参与段（成为该 Work 的当前参与关系）。
    const partC2 = { aggregateType: "WorkParticipation", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK_C, participationId: "part-c2" } as const;
    const participation = await w.h.ledger.load(partC);
    if (participation.status !== "found") throw new Error("participation missing");
    const ended = await w.h.control.endWorkParticipation({
      commandId: "cmd-cap-ho-end", commandType: "EndWorkParticipation", schemaVersion: 1, aggregateId: "part-c",
      expectedRevision: participation.snapshot.revision, correlationId: "corr-cap-ho-end", submittedAt: AT,
      identity: { projectId: PROJECT, actor: agentActor(oldRun), idempotencyKey: "cap-ho-end", agentPrincipal: principalFor(oldRun, workC, partC) },
      payload: { workspaceId: WORKSPACE, workContextRef: { ...workC }, runRef: { ...oldRun }, reason: "换手" },
    });
    expect(ended.status, JSON.stringify(ended)).toBe("committed");
    const started2 = await w.h.control.startWorkParticipation({
      commandId: "cmd-cap-ho-part2", commandType: "StartWorkParticipation", schemaVersion: 1, aggregateId: "part-c2", expectedRevision: 0,
      correlationId: "corr-cap-ho-part2", submittedAt: AT,
      identity: { projectId: PROJECT, actor: agentActor(newRun), idempotencyKey: "cap-ho-part2", agentPrincipal: principalFor(newRun, workC, partC2) },
      payload: { workspaceId: WORKSPACE, workContextRef: { ...workC }, agentInstanceId: AGENT, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 }, runRef: { ...newRun } },
    });
    expect(started2.status, JSON.stringify(started2)).toBe("committed");

    // (5) 显式规则的结果：旧 Run 仍然不被授予；新 Run 被授予（依据 = 该 Work 的当前参与关系）。
    const oldAfter = await resolveCoordinationCapability({ ledger: w.h.ledger }, oldRun);
    expect(oldAfter.status, JSON.stringify(oldAfter)).toBe("not_granted");
    const newAfter = await resolveCoordinationCapability({ ledger: w.h.ledger }, newRun);
    expect(newAfter.status, JSON.stringify(newAfter)).toBe("granted");
    if (newAfter.status !== "granted") throw new Error("expected granted");
    expect(newAfter.grant.participationRef.participationId).toBe("part-c2");
    expect(newAfter.grant.basis.kind).toBe("work_current_participation");
    // Work 权威状态上的当前参与指针就是它（换手的直接证据）。
    const binding = await w.h.ledger.load(workC);
    if (binding.status !== "found") throw new Error("work binding missing");
    expect((binding.snapshot as { binding: { currentParticipationRef: { participationId: string } | null } }).binding.currentParticipationRef!.participationId).toBe("part-c2");
  });

  it("内核策略层：工具被注入但未获宿主授权时，内核按未授权的未知操作拒绝，handler 不执行", async () => {
    // 情形 B：直接走**内核公共入口**（runCodingAgent），把真实的协调工具**注入并启用**，
    // 但**不**放进 hostAuthorizedTools。这一层与"装配层不注入"是两件不同的事，必须分别可核对。
    const kernel = await import("../../vendor/coding-agent/dist/public-api.js");
    const dir = await mkdtemp(join(tmpdir(), "cm1a-capability-kernel-"));
    cleanup.push(async () => { await rm(dir, { recursive: true, force: true }); });
    const root = join(dir, "workspace");
    await mkdir(root, { recursive: true });
    const handlerCalls: string[] = [];
    const access = {
      principal: { schemaVersion: 1, agentInstanceId: AGENT, workContextRef: workContextRefFor(PROJECT, WORKSPACE, WORK_C), participationRef: { aggregateType: "WorkParticipation", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK_C, participationId: "part-c" }, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 }, runRef: runRefFor(PROJECT, GOAL, "run-pred") },
      mailbox: async () => ({ status: "ready" as const, mailbox: { workContextRef: workContextRefFor(PROJECT, WORKSPACE, WORK_C), requests: [], deliveries: [], subscriptions: [], waits: [] } }),
      request: async () => { handlerCalls.push("request"); return { status: "accepted" as const, operation: "request" as const, replayed: false, references: [], summary: "should-never-run" }; },
      respond: async () => { handlerCalls.push("respond"); return { status: "accepted" as const, operation: "respond" as const, replayed: false, references: [], summary: "should-never-run" }; },
      subscribe: async () => { handlerCalls.push("subscribe"); return { status: "accepted" as const, operation: "subscribe" as const, replayed: false, references: [], summary: "should-never-run" }; },
      wait: async () => { handlerCalls.push("wait"); return { status: "accepted" as const, operation: "wait" as const, replayed: false, references: [], summary: "should-never-run" }; },
      cancel: async () => { handlerCalls.push("cancel"); return { status: "accepted" as const, operation: "cancel" as const, replayed: false, references: [], summary: "should-never-run" }; },
    };
    const tools = createCoordinationTools(access as never, async () => undefined);
    const toolResults: string[] = [];
    const provider = kernel.createBuiltinProviderRegistry().get("deepseek");
    let requests = 0;
    const client = {
      async *stream(request: { requestId: string }): AsyncIterable<never> {
        requests += 1;
        const common = { schemaVersion: 1 as const, requestId: request.requestId };
        if (requests === 1) {
          yield { ...common, sequence: 1, type: "tool_call_started", callId: "kernel-cap-call", name: "coordination_request", ordinal: 0 } as never;
          yield { ...common, sequence: 2, type: "tool_arguments_delta", callId: "kernel-cap-call", delta: JSON.stringify({ toWorkId: WORK_C, statement: "请产出报告", body: "{}", key: "kernel-cap" }) } as never;
          yield { ...common, sequence: 3, type: "completed", reason: "tool_calls" } as never;
          return;
        }
        yield { ...common, sequence: 1, type: "text_delta", delta: "done" } as never;
        yield { ...common, sequence: 2, type: "completed", reason: "final_answer" } as never;
      },
    };
    const base = await kernel.loadAppConfig({ cwd: root, environment: {} });
    const result = await kernel.runCodingAgent({
      config: {
        ...base,
        model: { ...base.model, provider: provider.id, model: "capability-stub", baseUrl: "http://127.0.0.1", maxOutputTokens: 4096 },
        runtime: { ...base.runtime, maxModelRequests: 4, maxToolCalls: 4 },
        // 工具被**注册并启用**（模型看得见、调得到），但宿主没有授权它们。
        tools: { enabledNames: ["read", ...COORDINATION_TOOL_NAMES] },
        storage: { databasePath: join(dir, "kernel.sqlite") },
        skills: { resourceRoot: join(process.cwd(), "vendor/coding-agent/resources/skills"), enabledIds: ["coding-safety"] },
      },
      additionalTools: () => tools,
      hostAuthorizedTools: [],
      workspaceRoot: root, input: "try to use the coordination tool", sessionId: "capability-kernel-session",
      signal: new AbortController().signal, secretSource: { get: () => "stub-key" },
      providerRegistry: new kernel.ProviderRegistry().register({ ...provider, create: () => client as never }),
      approvalRequester: new kernel.StaticApprovalRequester({ decision: "allow_once", reason: "capability-test" }),
      observerEventSinks: [{ sinkId: "capability-test", delivery: "best_effort", publish: async (event: { type: string; payload: unknown }) => {
        if (event.type === "tool.failed" || event.type === "tool.completed") toolResults.push(JSON.stringify(event.payload));
      } }],
    });
    expect(result.state.status).toBe("completed");
    // 与层 1 的对照：这次工具**确实**被注入并启用（所以拒绝不可能来自装配层）。
    expect(result.enabledTools, "层 3 的前提：工具已被注入并启用").toContain("coordination_request");
    // 内核策略层拒绝：未授权的未知操作 → permission_denied，且 handler 一次都没有执行。
    expect(toolResults, JSON.stringify(toolResults)).toHaveLength(1);
    // 拒绝是**内核策略层**给出的（未授权的未知操作），并且是可读的失败结果，不是静默忽略。
    expect(toolResults[0]).toContain('"code":"permission_denied"');
    expect(toolResults[0]).toContain('"status":"error"');
    expect(toolResults[0]).toContain('"retryable":false');
    expect(handlerCalls, "被拒绝的调用不得触达 Adapter（零平台状态变更）").toEqual([]);
  });

  it("每个写操作在动 Vault/Control 之前校验能力：授予失效后拒绝，且零平台状态变更", async () => {
    const w = await buildWorld(true);
    const workC = workContextRefFor(PROJECT, WORKSPACE, WORK_C);
    // 计数用的 Vault 包装：用来证明"拒绝发生在 vault.put 之前"。
    let puts = 0;
    const countingVault = {
      put: async (record: Parameters<typeof w.h.vault.put>[0]) => { puts += 1; return w.h.vault.put(record); },
      open: (ref: Parameters<typeof w.h.vault.open>[0], query: Parameters<typeof w.h.vault.open>[1]) => w.h.vault.open(ref, query),
    };
    const granted = await coordinationRuntimeGrant(
      { ledger: w.h.ledger, control: w.h.control, vault: countingVault, now: () => AT }, w.runRef);
    expect(granted.status, JSON.stringify({ status: granted.status })).toBe("granted");
    if (granted.status !== "granted") throw new Error("expected granted");

    // 运行期间这一段参与关系被结束：能力授予在**调用时刻**必须仍然成立。
    const participation = await w.h.ledger.load(granted.grant.participationRef);
    if (participation.status !== "found") throw new Error("participation missing");
    const partC = { aggregateType: "WorkParticipation", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK_C, participationId: "part-c" } as const;
    const ended = await w.h.control.endWorkParticipation({
      commandId: "cmd-cap-end", commandType: "EndWorkParticipation", schemaVersion: 1, aggregateId: "part-c",
      expectedRevision: participation.snapshot.revision, correlationId: "corr-cap-end", submittedAt: AT,
      identity: {
        projectId: PROJECT, actor: agentActor(w.runRef), idempotencyKey: "cap-end",
        agentPrincipal: principalFor(w.runRef, workC, partC),
      },
      payload: { workspaceId: WORKSPACE, workContextRef: { ...workC }, runRef: { ...w.runRef }, reason: "本轮工作结束" },
    });
    expect(ended.status, JSON.stringify(ended)).toBe("committed");

    const rejected = await granted.access.request({ toWorkId: WORK_C, statement: "请产出报告", body: JSON.stringify({ nonce: BODY_NONCE }), key: "cap-after-end" });
    expect(rejected.status, JSON.stringify(rejected)).toBe("rejected");
    if (rejected.status !== "rejected") throw new Error("expected rejected");
    expect(rejected.code).toBe("not_granted");
    expect(rejected.issues.join(" | ")).toContain("协调能力");
    expect(rejected.issues.join(" | ")).toContain("拒绝");
    // 零平台状态变更：正文**没有**进 Vault，请求**没有**落账。
    expect(puts, "拒绝必须发生在 vault.put 之前").toBe(0);
    const requestRef = directedRequestRefFor(PROJECT, WORKSPACE, "creq-" + sha256Hex(JSON.stringify(["coordination-tool-v1", "req", "run-pred", "cap-after-end"])).slice(0, 24));
    expect((await w.h.ledger.load(requestRef)).status).toBe("not_found");
  });
});

it('exploration with existing participation still receives no coordination write tools',async()=>{
  toolsOffered.length=0;toolResultsByCall.clear();const w=await buildWorld(true,'explore');
  expect((await w.h.coordinationGrant(w.runRef)).status).toBe('granted');
  await runOnce(w.h);expect(toolsOffered[0],JSON.stringify(w.runtime.all().map(r=>({status:r.status,error:r.error})))).toEqual([]);expect(w.runtime.all()[0]!.coordinationCapability).toBeUndefined();
  expect([...toolResultsByCall.values()].some(r=>r.error?.code==='unknown_tool')).toBe(true);
});
