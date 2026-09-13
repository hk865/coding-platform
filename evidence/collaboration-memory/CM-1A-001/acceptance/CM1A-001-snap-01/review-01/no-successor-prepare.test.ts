/**
 * CM-1A-001 第 3 工作段：**目标 Delivery 的精确版本进入捕获的实际 ModelRequest**（A06 的输入面）。
 *
 * 走的都是生产实现：真实持久 SQLite harness（SqliteStateLedger + 真实 ControlEngineImpl）、
 * 真实 DispatchEngineImpl（协作驱动挂在唯一 drive 收口之内）、真实 LeasedWorkerRuntime +
 * 内核 CodingAgentRuntime（**真实产品 Runtime/内核接入**，模型客户端是确定性的捕获替身）、
 * WorkMaterialDrive + WorkRunMaterialCompiler + 新增的 DeliveryMaterialCompiler。
 *
 * 断言链（A06）：
 *   (a) 目标 Delivery 的正文出现在**捕获的 user message** 里；
 *   (b) `record.context.manifest.selected` 含该 Delivery 的条目，带 selectedBecause 与含版本的 sourceRefs；
 *   (c) 正文里只存在于该 Delivery 版本的 nonce 不出现在任何别的材料/请求里
 *       （前驱 Run 的输入没有它 → 目标材料不是预埋在原任务里的）；
 *   (d) 撤权 / 来源更新之后，同一个 Delivery **不允许**进入新的输入：材料组装在模型调用之前失败，
 *       本次运行**没有任何新的模型请求**（拒绝而不是静默复用）。
 *
 * 来源能力说明：`SourceApplicabilityPort` 是**宿主注入的受信任来源身份能力**
 * （产品实现见 data/workspace-reader/source-applicability.ts）。本测试注入一个确定性的宿主替身，
 * 由它精确控制"来源仍当前 / 来源被更新 / 读取授权被撤回"三种宿主事实 —— 这正是
 * ArtifactVault 与 MaterialAccessGrant 复核 currentness 时使用的同一个端口。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPersistentSqliteHarness } from "/mnt/d/1.project/Software/agent_platform/src/harness/persistent-harness.js";
import { CodingAgentRuntime, type RunSpec } from "/mnt/d/1.project/Software/agent_platform/src/execution/worker-runtime/coding-agent-runtime.js";
import { LeasedWorkerRuntime } from "/mnt/d/1.project/Software/agent_platform/src/control/dispatch-engine/leased-worker-runtime.js";
import { WorkMaterialDrive } from "/mnt/d/1.project/Software/agent_platform/src/control/dispatch-engine/work-material-drive.js";
import { LedgerRoleSpecRead } from "/mnt/d/1.project/Software/agent_platform/src/control/dispatch-engine/role-spec-read.js";
import { WorkRunMaterialCompiler } from "/mnt/d/1.project/Software/agent_platform/src/data/context-compiler/work-run-materials.js";
import { DeliveryMaterialCompiler } from "/mnt/d/1.project/Software/agent_platform/src/data/context-compiler/delivery-materials.js";
import type { ModelClientPort, ModelEvent, ModelRequest } from "/mnt/d/1.project/Software/agent_platform/vendor/coding-agent/dist/public-api.js";
import type { SourceApplicabilityPort } from "/mnt/d/1.project/Software/agent_platform/src/contracts/material-access.js";
import { sha256Hex } from "/mnt/d/1.project/Software/agent_platform/src/contracts/fingerprint.js";
import { buildBootstrapCommand } from "/mnt/d/1.project/Software/agent_platform/src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "/mnt/d/1.project/Software/agent_platform/tests/contract-support/fixtures/bootstrap-fixture-v1.js";
import { prepareP103Project, type P1_03TestHarness } from "/mnt/d/1.project/Software/agent_platform/tests/contract-suite/p1-03-harness.js";
import { buildDispatchClaimCommand } from "/mnt/d/1.project/Software/agent_platform/src/fixtures/dispatch-fixtures.js";
import { runRefFor } from "/mnt/d/1.project/Software/agent_platform/src/contracts/dispatch.js";
import { buildRunFactCommand } from "/mnt/d/1.project/Software/agent_platform/src/contracts/commands/dispatch.js";
import { DISPATCH_ELIGIBLE_TASK_ID, ROLE_BINDING_FIXTURE_V1 } from "/mnt/d/1.project/Software/agent_platform/src/fixtures/dispatch-fixtures.js";
import { workContextRefFor } from "/mnt/d/1.project/Software/agent_platform/src/contracts/context-continuity.js";
import type { WorkContextRef } from "/mnt/d/1.project/Software/agent_platform/src/contracts/context-continuity.js";
import type { RunRef } from "/mnt/d/1.project/Software/agent_platform/src/contracts/dispatch.js";
import {
  successorAttemptIdFor,
  successorRunIdFor,
  subscriptionRefFor,
  workParticipationRefFor,
  deliveryRefFor,
} from "/mnt/d/1.project/Software/agent_platform/src/contracts/coordination.js";
import { subscriptionDeliveryIdFor } from "/mnt/d/1.project/Software/agent_platform/src/control/dispatch-engine/coordination-drive.js";
import type {
  AgentPrincipalRefV1,
  RegisterWaitCommand,
  SendDirectedRequestCommand,
  StartWorkParticipationCommand,
  SubscribeCommand,
  WorkParticipationRef,
} from "/mnt/d/1.project/Software/agent_platform/src/contracts/coordination.js";

const AT = "2026-09-05T12:00:00.000Z";
const PROJECT = "proj-alpha";
const WORKSPACE = "ws-shared";
const GOAL = "goal-1";
const AGENT = "agent-c";
const WORK_C = "work-c";
const WORK_A = "work-a";
const TASK = DISPATCH_ELIGIBLE_TASK_ID;
const PLAN_REF = { aggregateType: "PlanRevision", projectId: PROJECT, planId: "plan-dispatch-mvp" } as const;
/** 只存在于该 Delivery 版本的版本标识：它出现在 Delivery 正文里，别处都没有。 */
const DELIVERY_NONCE = "DELIVERY-VERSION-NONCE-7d19c2";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

type Mode = "normal" | "revoked" | "source_updated";

type World = {
  requests: ModelRequest[];
  runtime: CodingAgentRuntime;
  mode: { current: Mode };
  captures: { count: number };
  flipAt: { count: number };
  h: Awaited<ReturnType<typeof createPersistentSqliteHarness>>;
  runRef: RunRef;
  workC: WorkContextRef;
  workA: WorkContextRef;
  partC: WorkParticipationRef;
  successorRunId: string;
  successorRunRef: RunRef;
  deliveryRef: ReturnType<typeof deliveryRefFor>;
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

/**
 * 组装一个完整世界：真实持久 harness + 真实内核运行时 + 只在运行入口注入的 Delivery 材料端口。
 * `mode` 控制宿主来源能力：normal（来源仍当前）/ revoked（读取授权被撤回）/ source_updated
 * （本次运行期间来源被更新，pin 不再一致）。
 */
async function buildWorld(requestedMode: Mode): Promise<World> {
  const requests: ModelRequest[] = [];
  const client: ModelClientPort = {
    async *stream(request): AsyncIterable<ModelEvent> {
      requests.push(structuredClone(request));
      const common = { schemaVersion: 1 as const, requestId: request.requestId };
      yield { ...common, sequence: 1, type: "text_delta", delta: "已读到本次材料，未修改任何文件。" };
      yield { ...common, sequence: 2, type: "completed", reason: "final_answer" };
    },
  };
  // 世界总是以"来源正常"建立起来：撤权/来源更新是**后继运行之前**才发生的宿主事实，
  // 由测试在最后一次 drive 之前切换（被测的正是"这次新输入不许再用这份 Delivery"）。
  const modeRef = { current: "normal" as Mode };
  void requestedMode;
  // 宿主来源能力：capture 返回"当前来源 pin"。source_updated 模式下**第二次** capture
  // 会看到不同的 manifestDigest（来源在本次运行期间被更新），revoked 模式下不可用。
  const captures = { count: 0 };
  // source_updated：测试显式指定"第几次 capture 起看到的是被更新后的来源"，
  // 从而精确地把变化放在本次运行的 select 与 vault.open 之间（那是真实存在的竞态窗口）。
  const flipAt = { count: Number.POSITIVE_INFINITY };
  const sourcePort: SourceApplicabilityPort = {
    capture: async (query) => {
      captures.count += 1;
      if (modeRef.current === "revoked") return { status: "unavailable", issues: ["宿主已撤回该来源的读取授权"] };
      const version = captures.count >= flipAt.count ? 2 : 1;
      return {
        status: "sourced",
        pin: {
          schemaVersion: 1,
          projectId: query.projectId,
          workspaceId: query.workspaceId,
          sourceSet: structuredClone(query.sourceSet),
          identity: { workspace: WORKSPACE, commit: null },
          manifestDigest: sha256Hex("delivery-source-v" + String(version)),
        },
      };
    },
  };

  const dir = await mkdtemp(join(tmpdir(), "cm1a-delivery-"));
  cleanup.push(async () => { await rm(dir, { recursive: true, force: true }); });
  const root = join(dir, "source");
  await mkdir(root, { recursive: true });
  const runtime = new CodingAgentRuntime(join(dir, "runs"), async () => ({
    configuration: { revision: "local", provider: "deepseek", model: "local-capture-client", baseUrl: "http://127.0.0.1" },
    client,
  }));
  await runtime.init();
  cleanup.push(() => runtime.close());

  let h: Awaited<ReturnType<typeof createPersistentSqliteHarness>>;
  h = await createPersistentSqliteHarness({
    deps: { clock: () => AT },
    sourceApplicability: sourcePort,
    runtime: {
      capabilities: () => runtime.capabilities(),
      start: async (envelope) => new LeasedWorkerRuntime({
        runtime, lease: () => h.workspaceLease, vault: () => h.vault, now: () => AT,
        materials: (spec, current) => new WorkMaterialDrive({
          ledger: h.ledger,
          // 授权入口用**组合根合成的那一个**（和 harness 自己的 grantMaterialAccess 一样：
          // Control 提交之后推进投影，vault 才能在同一进程内解析到这条 grant）。
          control: {
            resolveTaskWorkIdentity: (query) => h.control.resolveTaskWorkIdentity(query),
            grantMaterialAccess: async (command) => {
              const receipt = await h.control.grantMaterialAccess(command);
              if (receipt.status === "committed") await h.advanceProjection();
              return receipt;
            },
          },
          compiler: new WorkRunMaterialCompiler({
            ledger: h.ledger, vault: h.vault, workContext: h.workContext, completedWork: h.completedWork,
            roleSpec: new LedgerRoleSpecRead({ ledger: h.ledger }),
          }),
          // 本票新增的可选端口：目标 Delivery → 实际模型输入。
          deliveries: new DeliveryMaterialCompiler({
            deliveries: {
              deliveriesForWork: async (query) => {
                const view = await h.control.mailboxView(workContextRefFor(query.projectId, query.workspaceId, query.workId));
                return view.status === "ready"
                  ? { status: "ready", deliveries: view.view.deliveries }
                  : { status: "unavailable", reason: view.reason };
              },
            },
            vault: h.vault,
            source: sourcePort,
          }),
        }).assembleRun(spec, current),
      }).start(envelope),
    },
  });
  cleanup.push(async () => { await h.cleanup(); });

  const adapter: P1_03TestHarness = {
    ledger: h.ledger, readModel: h.readModel, runtime: h.runtime,
    bootstrap: h.bootstrap, submit: (command) => h.control.submit(command),
    install: h.install, activate: h.activate, applyPlan: h.applyPlan,
    dispatchReadiness: h.dispatchReadiness, claimTask: h.claimTask, startRun: h.startRun,
    runFact: h.runFact, drive: h.drive, advanceProjection: h.advanceProjection,
    observedCursor: h.observedCursor, planGraph: h.planGraph, taskDetail: h.taskDetail, activeAgent: h.activeAgent,
  };
  expect((await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-dl-boot", correlationId: "corr-dl-boot", submittedAt: AT,
  }))).status).toBe("committed");
  await prepareP103Project(adapter, PROJECT, "a");

  const claim = await h.claimTask(buildDispatchClaimCommand({
    commandId: "cmd-dl-claim", correlationId: "corr-dl-claim", submittedAt: AT, projectId: PROJECT,
    goalId: GOAL, taskId: TASK, attemptId: "att-pred", runId: "run-pred", idempotencyKey: "dl-claim",
    // 只读运行：本用例要证明的是"材料进入实际模型输入"，而工作区写租约需要显式的写范围声明
    // （scope_not_declared 是既有越权守卫）。只读运行让这条链不被无关的租约范围问题干扰。
    declaredPermissions: { tools: ["read"], writeScope: [] },
    // 上下文窗口必须容得下本次组装（与 spec.budget.contextWindowTokens 一致）。
    budget: { tokenBudget: 1_000_000, deadline: null },
  }));
  expect(claim.status, JSON.stringify(claim)).toBe("committed");
  const runRef = runRefFor(PROJECT, GOAL, "run-pred");
  const workC = workContextRefFor(PROJECT, WORKSPACE, WORK_C);
  const workA = workContextRefFor(PROJECT, WORKSPACE, WORK_A);
  expect((await h.bindWorkContext({
    commandId: "cmd-dl-bind", commandType: "BindWorkContext", schemaVersion: 1, aggregateId: WORK_C,
    expectedRevision: 0, correlationId: "corr-dl-bind", submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "dl-bind" },
    payload: {
      // workKind=task：本 Work 就是该任务的**工作身份**（Control 的任务身份槽由它占用），
      // 因此派发收口解析出的 workId 与等待/投递所属的 Work 是同一个。
      workspaceId: WORKSPACE, workKind: "task", goalId: GOAL, taskId: TASK,
      planRef: { ...PLAN_REF }, planRevision: 1, roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 }, initialRunRef: { ...runRef },
    },
  })).status).toBe("committed");
  expect((await h.bindWorkContext({
    commandId: "cmd-dl-bind-a", commandType: "BindWorkContext", schemaVersion: 1, aggregateId: WORK_A,
    expectedRevision: 0, correlationId: "corr-dl-bind-a", submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "dl-bind-a" },
    payload: {
      workspaceId: WORKSPACE, workKind: "coordination", goalId: GOAL, taskId: null,
      planRef: null, planRevision: null, roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 }, initialRunRef: { ...runRef },
    },
  })).status).toBe("committed");
  expect((await h.control.registerAgentInstance({
    commandId: "cmd-dl-agent", commandType: "RegisterAgentInstance", schemaVersion: 1, aggregateId: AGENT,
    expectedRevision: 0, correlationId: "corr-dl-agent", submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "dl-agent" },
    payload: { workspaceId: WORKSPACE, templateId: "template-runner", templateRevision: "1" },
  })).status).toBe("committed");

  // 前驱 Run：真实内核 + 真实 Runtime 路径，在这次输入里**没有**任何 Delivery（nonce 因此不可能预埋）。
  await runtime.prepare(specFor(root, "run-pred"));
  const first = await h.drive({ reason: "dl-predecessor", maxIntents: 1 });
  expect(first.failures, JSON.stringify(first.failures)).toEqual([]);
  expect(first.started).toBe(1);
  expect(requests, JSON.stringify(runtime.all().map((row) => ({ runId: row.spec.runId, status: row.status, error: row.error })))).toHaveLength(1);
  expect(JSON.stringify(requests[0])).not.toContain(DELIVERY_NONCE);

  const partC = workParticipationRefFor(PROJECT, WORKSPACE, WORK_C, "part-c");
  const participation: StartWorkParticipationCommand = {
    commandId: "cmd-dl-part-c", commandType: "StartWorkParticipation", schemaVersion: 1, aggregateId: "part-c",
    expectedRevision: 0, correlationId: "corr-dl-part-c", submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "dl-part-c", agentPrincipal: principalFor(runRef, workC, partC) },
    payload: { workspaceId: WORKSPACE, workContextRef: { ...workC }, agentInstanceId: AGENT, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 }, runRef: { ...runRef } },
  };
  expect((await h.control.startWorkParticipation(participation)).status).toBe("committed");

  // 目标 Delivery：一条定向请求（正文 body-first 真进 vault，正文里带版本 nonce）。
  const body = JSON.stringify({ report: "A", version: "v7", nonce: DELIVERY_NONCE });
  const stored = await h.vault.put({
    contentType: "application/json", body, ownerRef: { ...runRef },
    sourceRefs: [{ kind: "workspace", refId: WORKSPACE, revision: "1" }], requestedAt: AT,
  });
  if (stored.status !== "stored") throw new Error("vault put failed");
  const request: SendDirectedRequestCommand = {
    commandId: "cmd-dl-req", commandType: "SendDirectedRequest", schemaVersion: 1, aggregateId: "req-1",
    expectedRevision: 0, correlationId: "corr-dl-req", submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "dl-req", agentPrincipal: principalFor(runRef, workC, partC) },
    payload: {
      workspaceId: WORKSPACE, fromParticipationRef: { ...partC }, fromRunRef: { ...runRef },
      toWorkContextRef: { ...workA }, expectedParticipationRef: null,
      statement: "请只读调查报告 A", statementBodyRef: stored.ref, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
    },
  };
  expect((await h.control.sendDirectedRequest(request)).status, "定向请求必须被受理").toBe("committed");

  // 订阅 + 路由页：把该正文**正式投递**给 work-c（这是唯一一条进入后继输入的 Delivery）。
  const origin = (await h.ledger.events({ afterCursor: null, limit: 1 })).events[0]!.cursor;
  const subscribe: SubscribeCommand = {
    commandId: "cmd-dl-sub", commandType: "CreateSubscription", schemaVersion: 1, aggregateId: "sub-1",
    expectedRevision: 0, correlationId: "corr-dl-sub", submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "dl-sub", agentPrincipal: principalFor(runRef, workC, partC) },
    payload: { workspaceId: WORKSPACE, ownerWorkContextRef: { ...workC }, ownerParticipationRef: { ...partC }, topics: ["DirectedRequestSent"], startCursor: origin },
  };
  expect((await h.control.createSubscription(subscribe)).status).toBe("committed");
  const routed = await h.drive({ reason: "dl-route", maxIntents: 6 });
  expect(routed.coordination?.deliveries, JSON.stringify(routed.coordination?.failures)).toBe(1);
  let requestCursor = null as null | string;
  {
    let cursor: string | null = null;
    for (;;) {
      const page = await h.ledger.events({ afterCursor: cursor as never, limit: 1000 });
      const hit = page.events.find((p) => p.event.eventType === "DirectedRequestSent");
      if (hit) { requestCursor = hit.cursor; break; }
      if (!page.hasMore || page.throughCursor === null || page.throughCursor === cursor) throw new Error("request event missing");
      cursor = page.throughCursor;
    }
  }
  const deliveryRef = deliveryRefFor(PROJECT, WORKSPACE, subscriptionDeliveryIdFor({
    subscriptionRef: subscriptionRefFor(PROJECT, WORKSPACE, "sub-1"),
    topic: "DirectedRequestSent",
    cursor: requestCursor as never,
    targetWorkContextRef: workC,
  }));
  expect((await h.ledger.load(deliveryRef)).status, "订阅路由必须产生目标 Delivery").toBe("found");

  // 等待：条件 = 该 Delivery 存在；前驱 = run-pred（已经公开结束）。
  const wait: RegisterWaitCommand = {
    commandId: "cmd-dl-wait", commandType: "RegisterWait", schemaVersion: 1, aggregateId: "wait-dl",
    expectedRevision: 0, correlationId: "corr-dl-wait", submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "dl-wait", agentPrincipal: principalFor(runRef, workC, partC) },
    payload: {
      workspaceId: WORKSPACE, ownerWorkContextRef: { ...workC }, ownerParticipationRef: { ...partC },
      predecessorRunRef: { ...runRef }, conditions: [{ kind: "delivery_present", deliveryRef }], deadlineAt: null,
    },
  };
  expect((await h.control.registerWait(wait)).status).toBe("committed");

  const attemptId = successorAttemptIdFor(WORK_C, "wait-dl", 2);
  const successorRunId = successorRunIdFor(attemptId);
  // Independent acceptance: no test-owned successor RunSpec preparation.
  return {
    requests, runtime, mode: modeRef, captures, flipAt, h, runRef, workC, workA, partC,
    successorRunId, successorRunRef: runRefFor(PROJECT, GOAL, successorRunId), deliveryRef,
  };
}

function specFor(root: string, runId: string): RunSpec {
  return {
    projectId: PROJECT, workspaceId: WORKSPACE, goalId: GOAL, runId, taskId: TASK, root,
    instruction: "DL_INSTRUCTION",
    // 信封的 tokenBudget 与运行配置必须一致（RuntimeContext 的既有守卫）。
    budget: { contextWindowTokens: 1_000_000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 32768 },
  };
}

/** 前驱 Run 已经结束：等待的接续资格因此只剩"条件满足"，drive 会请 Control 直接受理唯一后继。 */
async function predecessorEnded(h: Awaited<ReturnType<typeof createPersistentSqliteHarness>>, runRef: RunRef): Promise<void> {
  const loaded = await h.ledger.load(runRef);
  if (loaded.status !== "found") throw new Error("predecessor run missing");
  const run = loaded.snapshot as { status?: string };
  if (run.status === "ended") return;
  const receipt = await h.runFact(buildRunFactCommand({
    actor: { kind: "human", id: "user-1" }, idempotencyKey: "dl-end-pred", commandId: "cmd-dl-end-pred",
    correlationId: "corr-dl-end-pred", submittedAt: AT, projectId: PROJECT, runId: runRef.runId,
    expectedRevision: loaded.snapshot.revision,
    fact: { kind: "runtime_event", event: { eventType: "run_completed", schemaVersion: 1, eventId: "rt-dl-end", runRef: { ...runRef }, sequence: 2, occurredAt: AT, payload: { kind: "completed", exitCode: 0 } } },
  }));
  expect(receipt.status, JSON.stringify(receipt)).toBe("committed");
}

describe("目标 Delivery 进入实际模型输入（A06）", () => {
  it("Delivery 正文、精确版本与选入理由都进入捕获的 ModelRequest 与 manifest.selected", async () => {
    const w = await buildWorld("normal");
    await predecessorEnded(w.h, w.runRef);
    const drive = await w.h.drive({ reason: "dl-successor", maxIntents: 6 });
    expect(drive.coordination?.failures, JSON.stringify(drive.coordination?.failures)).toEqual([]);
    expect(drive.coordination?.admissions).toBe(1);
    expect(drive.failures, JSON.stringify(drive.failures)).toEqual([]);

    // 本次唯一后继真的跑了模型：捕获到第二个请求（第一个是前驱的输入）。
    expect(w.requests, JSON.stringify(w.runtime.all().map((row) => ({ runId: row.spec.runId, status: row.status, error: row.error })))).toHaveLength(2);
    const successor = w.requests.filter((request) => JSON.stringify(request).includes(DELIVERY_NONCE));
    expect(successor, "目标 Delivery 的正文必须进入捕获的实际 ModelRequest").toHaveLength(1);
    const userMessage = successor[0]!.messages.find((message) => message.role === "user")!.content;
    expect(userMessage).toContain(DELIVERY_NONCE);
    expect(userMessage).toContain("deliveryVersion");

    // 只有该 Delivery 的材料带这个 nonce：前驱输入没有它（不是预埋在原任务里）。
    expect(JSON.stringify(w.requests[0])).not.toContain(DELIVERY_NONCE);

    // 运行记录：manifest.selected 含该 Delivery 的条目，带 selectedBecause 与含版本的 sourceRefs。
    const record = w.runtime.all().find((row) => row.spec.runId === w.successorRunId);
    expect(record, "后继 Run 必须在真实内核里运行过").toBeDefined();
    const manifest = record!.context!.manifest;
    expect(manifest.scope.runId).toBe(w.successorRunId);
    // Delivery 的精确版本 = topic@位置（订阅投递）——从账本里的 Delivery 事实取回，测试不自算。
    const storedDelivery = await w.h.ledger.load(w.deliveryRef);
    if (storedDelivery.status !== "found") throw new Error("delivery missing");
    const origin = (storedDelivery.snapshot as { delivery: { origin: { kind: string; sourceTopic?: string; sourceCursor?: string } } }).delivery.origin;
    if (origin.kind !== "subscription") throw new Error("expected a subscription delivery");
    const versions = [origin.sourceTopic + "@" + String(origin.sourceCursor)];
    const entry = manifest.selected.find((item) => item.kind === "rule" && item.selectedBecause.includes(w.deliveryRef.deliveryId));
    expect(entry, "manifest.selected 必须含该 Delivery 条目").toBeDefined();
    expect(entry!.selectedBecause.length).toBeGreaterThan(0);
    expect(entry!.sourceRefs.some((ref) => versions.includes(ref.revision) && ref.refId.length > 0)).toBe(true);
    for (const ref of entry!.sourceRefs) {
      expect(ref.refId.length).toBeGreaterThan(0);
      expect(ref.revision.length).toBeGreaterThan(0);
    }
    // 正文与摘要一致（manifest 的 digest 就是本次输入的规则摘要）。
    expect(entry!.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.inputDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("撤权之后：该 Delivery 不允许进入新的输入（材料组装在模型调用之前失败）", async () => {
    const w = await buildWorld("normal");
    await predecessorEnded(w.h, w.runRef);
    w.mode.current = "revoked";
    const drive = await w.h.drive({ reason: "dl-revoked", maxIntents: 6 });
    // 后继仍然被唯一受理（受理与取材是两件事），但取材失败：本次运行可证明未启动。
    expect(drive.coordination?.admissions).toBe(1);
    expect(w.requests, "撤权后不得再产生任何模型请求（拒绝而不是静默复用）").toHaveLength(1);
    const record = w.runtime.all().find((row) => row.spec.runId === w.successorRunId);
    expect(record?.status).not.toBe("completed");
    expect(String(record?.error ?? "")).toContain("Delivery 材料来源不可用");
  });

  it("来源在本次运行期间被更新：basis 不一致 → 精确授权失效 → 拒绝进入新输入", async () => {
    const w = await buildWorld("normal");
    await predecessorEnded(w.h, w.runRef);
    w.mode.current = "source_updated";
    // 变化点：**下一次** capture 之后（也就是后继 Run 在 select 里 capture 完之后、
    // vault 复核 currentBasis 之前）。
    w.flipAt.count = w.captures.count + 2;
    const drive = await w.h.drive({ reason: "dl-source-updated", maxIntents: 6 });
    expect(drive.coordination?.admissions).toBe(1);
    expect(w.requests, "来源更新后不得再产生任何模型请求").toHaveLength(1);
    const record = w.runtime.all().find((row) => row.spec.runId === w.successorRunId);
    expect(record?.status).not.toBe("completed");
    // 机制必须真的是"精确授权的当前性复核"：vault 以 stale 拒绝（basis 里的来源 pin 不再当前）。
    expect(String(record?.error ?? ""), "必须是 basis/stale 复核拒绝，而不是别的原因").toMatch(/rejected:stale/);
  });
});
