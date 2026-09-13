/**
 * CM-1A-001 Control 受理面测试 —— 全部走**真实** InMemoryLedger + 真实 ControlEngineImpl
 * （组合根 src/harness/in-memory-harness.ts），不绕过 Control 直写账本。
 *
 * 结构（三层，避免一个前置失败污染全部断言）：
 *   1. 基础夹具：bootstrap → governance → goal → plan → claimTask（真实 Run）→
 *      bindWorkContext（两个 coordination Work）→ registerAgentInstance。
 *      这一层**不需要** participation，必须全绿。
 *   2. 「参与 + 通信全链」：startWorkParticipation → sendDirectedRequest →
 *      respondDirectedRequest → createSubscription → registerWait → cancel / claim / settle
 *      → mailboxView。
 *   3. 「零写入守卫」：与 2 无关的、commit 之前就该拒绝的守卫。
 *
 * participation-start 走 ledger-validation 的**专用**校验 validateParticipationStartCommit
 * （owner 裁决 D06）：恰好 [WorkParticipationStarted, WorkRunLinked] 两条事件、
 * [WorkParticipation@1, WorkContextBinding@(expected+1)] 两个快照、期望版本逐一对应、
 * link 的 Run 真在 linkedRunRefs 里、participation 与 binding 同属一个 Work。
 * WorkRunLinked 只是被登记进 COMMUNICATION_EVENT_TYPES，因此"任意两条事件的组合"不能冒充
 * 合法参与（下面有一条专门的用例证明这一点）。
 *
 * 当前参与唯一性由 Work.currentParticipationRef 与账本 active AgentInstance 身份槽共同保证；
 * 独立 SQLite 连接的冲突与结束后换手在 participation-uniqueness.test.ts 验证。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { buildPreparedClaim, prepareP103Project, type P1_03TestHarness } from "../contract-suite/p1-03-harness.js";
import { ROLE_BINDING_FIXTURE_V1 } from "../../src/fixtures/dispatch-fixtures.js";
import { runRefFor } from "../../src/contracts/dispatch.js";
import type { RunRef } from "../../src/contracts/dispatch.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { ArtifactRef } from "../../src/contracts/artifact.js";
import type { WorkContextRef } from "../../src/contracts/context-continuity.js";
import type {
  CommunicationClaimCommand,
  CommunicationSettleCommand,
  CommunicationWriteReceipt,
  DirectedRequestSnapshot,
  RegisterAgentInstanceCommand,
  RegisterWaitCommand,
  RespondDirectedRequestCommand,
  SendDirectedRequestCommand,
  StartWorkParticipationCommand,
  SubscribeCommand,
  CancelCommunicationCommand,
  AgentPrincipalRefV1,
  CommunicationIntentSnapshot,
  EndWorkParticipationCommand,
  SubscriptionSnapshot,
  WaitConditionSnapshot,
  WorkParticipationSnapshot,
  WorkParticipationRef,
  DirectedRequestRef,
  DeliveryRef,
  SubscriptionRef,
  WaitConditionRef,
} from "../../src/contracts/coordination.js";
import {
  agentInstanceRefFor,
  communicationIntentRefFor,
  deliveryRefFor,
  directedRequestRefFor,
  subscriptionRefFor,
  waitConditionRefFor,
  waitDeadlineIntentIdFor,
  startWorkParticipationFingerprint,
} from "../../src/contracts/coordination.js";
import { buildParticipationStartCommit } from "../../src/control/control-engine/records/coordination.js";
import { validateCommunicationCommit, validateParticipationStartCommit } from "../../src/data/state-ledger/ledger-validation.js";
import type { WorkContextBindingSnapshot } from "../../src/contracts/context-continuity.js";

const SCHEMA = "2026-09-05T12:00:00.000Z";
const PROJECT = "proj-alpha";
const WORKSPACE = "ws-shared";
const GOAL = "goal-1";
const AGENT = "agent-c";
const WORK_C = "work-c";
const WORK_A = "work-a";

const BODY_REF: ArtifactRef = {
  kind: "artifact",
  contentType: "application/json",
  digest: "a".repeat(64),
  sizeBytes: 256,
  source: { kind: "workspace", refId: WORKSPACE, revision: "1" },
};

type Base = {
  h: ReturnType<typeof createInMemoryHarness>;
  runRef: RunRef;
  workC: WorkContextRef;
  workA: WorkContextRef;
};

let base: Base;

/**
 * CM-1A-001 第 2 步：一个 AgentInstance 在同一 (project, workspace) 至多一段 active 参与。
 * 「同一个 AgentInstance 同时在两个 Work 上参与」因此不再是合法夹具形状：work-c 的发起者是
 * AGENT，work-a 的应答者是 AGENT_A —— 两个 AgentInstance，各自只有一段 active 参与。
 */
const AGENT_A = "agent-a";

function agentActor(runRef: RunRef, agentInstanceId: string = AGENT) {
  return { kind: "agent" as const, id: agentInstanceId, runRef: { ...runRef } };
}

function principalFor(input: {
  runRef: RunRef;
  workContextRef: WorkContextRef;
  participationRef: WorkParticipationRef;
  agentInstanceId?: string;
}): AgentPrincipalRefV1 {
  return {
    schemaVersion: 1,
    agentInstanceId: input.agentInstanceId ?? AGENT,
    workContextRef: { ...input.workContextRef },
    participationRef: { ...input.participationRef },
    roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
    runRef: { ...input.runRef },
  };
}

function agentInstanceCommand(
  commandId: string,
  runRef: RunRef,
  idempotencyKey: string,
  templateRevision = "2026-09-05",
  agentInstanceId: string = AGENT,
): RegisterAgentInstanceCommand {
  return {
    commandId,
    commandType: "RegisterAgentInstance",
    schemaVersion: 1,
    aggregateId: agentInstanceId,
    expectedRevision: 0,
    correlationId: "corr-" + commandId,
    submittedAt: SCHEMA,
    identity: { projectId: PROJECT, actor: agentActor(runRef, agentInstanceId), idempotencyKey },
    payload: { workspaceId: WORKSPACE, templateId: "template-short-lived-runner", templateRevision },
  };
}

function participationCommand(input: {
  commandId: string;
  idempotencyKey: string;
  aggregateId: string;
  workContextRef: WorkContextRef;
  runRef: RunRef;
  participationRef: WorkParticipationRef;
  principal?: boolean;
  agentInstanceId?: string;
}): StartWorkParticipationCommand {
  const agentInstanceId = input.agentInstanceId ?? AGENT;
  return {
    commandId: input.commandId,
    commandType: "StartWorkParticipation",
    schemaVersion: 1,
    aggregateId: input.aggregateId,
    expectedRevision: 0,
    correlationId: "corr-" + input.commandId,
    submittedAt: SCHEMA,
    identity: {
      projectId: PROJECT,
      actor: agentActor(input.runRef, agentInstanceId),
      idempotencyKey: input.idempotencyKey,
      ...(input.principal === false ? {} : {
        agentPrincipal: principalFor({
          runRef: input.runRef,
          workContextRef: input.workContextRef,
          participationRef: input.participationRef,
          agentInstanceId,
        }),
      }),
    },
    payload: {
      workspaceId: WORKSPACE,
      workContextRef: { ...input.workContextRef },
      agentInstanceId,
      roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
      runRef: { ...input.runRef },
    },
  };
}

beforeAll(async () => {
  const h = createInMemoryHarness({});
  const adapter: P1_03TestHarness = {
    ledger: h.ledger,
    readModel: h.readModel,
    runtime: h.runtime,
    bootstrap: h.bootstrap,
    submit: (command) => h.control.submit(command),
    install: h.install,
    activate: h.activate,
    applyPlan: h.applyPlan,
    dispatchReadiness: h.dispatchReadiness,
    claimTask: h.claimTask,
    startRun: h.startRun,
    runFact: h.runFact,
    drive: h.drive,
    advanceProjection: h.advanceProjection,
    observedCursor: h.observedCursor,
    planGraph: h.planGraph,
    taskDetail: h.taskDetail,
    activeAgent: h.activeAgent,
  };
  const boot = await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-cm-boot",
    correlationId: "corr-cm-boot",
    submittedAt: SCHEMA,
  }));
  expect(boot.status).toBe("committed");
  await prepareP103Project(adapter, PROJECT, "a");

  // 真实 Run（唯一调度记录仍是 DispatchOutboxEntry；这里只借它拿到一个真 Run 聚合）。
  const claim = await h.control.claimTask(buildPreparedClaim({
    commandId: "cmd-cm-claim",
    correlationId: "corr-cm-claim",
    attemptId: "att-cm",
    runId: "run-cm",
    idempotencyKey: "claim-cm",
  }));
  expect(claim.status).toBe("committed");
  if (claim.status !== "committed") throw new Error("fixture: claimTask 未能建立 Run");
  const runRef = runRefFor(PROJECT, GOAL, "run-cm");

  const workC: WorkContextRef = { aggregateType: "WorkContextBinding", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK_C };
  const workA: WorkContextRef = { aggregateType: "WorkContextBinding", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK_A };
  for (const [workId] of [["work-c", workC], ["work-a", workA]] as const) {
    const bound = await h.control.bindWorkContext({
      commandId: "cmd-bind-" + workId,
      commandType: "BindWorkContext",
      schemaVersion: 1,
      aggregateId: workId,
      expectedRevision: 0,
      correlationId: "corr-bind-" + workId,
      submittedAt: SCHEMA,
      identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "bind-" + workId },
      payload: {
        workspaceId: WORKSPACE,
        workKind: "coordination",
        goalId: GOAL,
        taskId: null,
        planRef: null,
        planRevision: null,
        roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 },
        initialRunRef: { ...runRef },
      },
    });
    expect(bound.status, "fixture: bindWorkContext " + workId).toBe("committed");
  }

  const agent = await h.control.registerAgentInstance(agentInstanceCommand("cmd-agent-c", runRef, "agent-c"));
  expect(agent.status, "fixture: registerAgentInstance").toBe("committed");
  // 第 2 步：work-a 的应答者是**另一个** AgentInstance（同一 Agent 不能同时参与两个 Work）。
  const agentA = await h.control.registerAgentInstance(
    agentInstanceCommand("cmd-agent-a", runRef, "agent-a", "2026-09-05", AGENT_A),
  );
  expect(agentA.status, "fixture: registerAgentInstance(agent-a)").toBe("committed");

  base = { h, runRef, workC, workA };
});

// ------------------------------------------------------------------------ //
// 1. registerAgentInstance（CAS@0 / 幂等 replay / idempotency_conflict）      //
// ------------------------------------------------------------------------ //

describe("registerAgentInstance：CAS@0、幂等 replay 与同键异载荷", () => {
  it("同一命令重放 → committed(replayed=true)，事件与游标与首次一致（零新增事件）", async () => {
    const first = await base.h.control.registerAgentInstance(agentInstanceCommand("cmd-agent-c", base.runRef, "agent-c"));
    expect(first.status).toBe("committed");
    if (first.status !== "committed") return;
    expect(first.replayed).toBe(true);

    const loaded = await base.h.ledger.load(agentInstanceRefFor(PROJECT, WORKSPACE, AGENT));
    expect(loaded.status).toBe("found");
    if (loaded.status !== "found") return;
    expect(loaded.snapshot.revision).toBe(1);

    const events = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    // 只数**本次这个聚合**的注册事件：夹具现在有两个 AgentInstance（AGENT 与 AGENT_A，
    // 第 2 步的唯一约束要求 work-a 的应答者是另一个实例），所以不能数全局。
    const registered = events.events.filter((e) => e.event.eventType === "AgentInstanceRegistered"
      && (e.event as { aggregateId: string }).aggregateId === AGENT);
    expect(registered).toHaveLength(1);
  });

  it("同一命令身份 + 不同载荷 → idempotency_conflict（零写入，revision 不动）", async () => {
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const conflict = await base.h.control.registerAgentInstance(
      agentInstanceCommand("cmd-agent-c", base.runRef, "agent-c", "2099-01-01"),
    );
    expect(conflict.status).toBe("rejected");
    if (conflict.status !== "rejected") return;
    expect(conflict.code).toBe("idempotency_conflict");
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("非 agent 身份提交 → forbidden（Agent 不用假 human 身份；零写入）", async () => {
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const receipt = await base.h.control.registerAgentInstance({
      ...agentInstanceCommand("cmd-agent-human", base.runRef, "agent-human"),
      identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "agent-human" },
    });
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("forbidden");
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("工作区不存在 → not_found（零写入）", async () => {
    const receipt = await base.h.control.registerAgentInstance({
      ...agentInstanceCommand("cmd-agent-nowhere", base.runRef, "agent-nowhere"),
      payload: { workspaceId: "ws-nowhere", templateId: "t", templateRevision: "r" },
    });
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("not_found");
  });
});

// ------------------------------------------------------------------------ //
// 2. 参与 + 通信全链（当前被冻结面缺陷阻断）                                   //
// ------------------------------------------------------------------------ //

const partC: WorkParticipationRef = { aggregateType: "WorkParticipation", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK_C, participationId: "part-c" };
const partA: WorkParticipationRef = { aggregateType: "WorkParticipation", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK_A, participationId: "part-a" };
const requestRef: DirectedRequestRef = directedRequestRefFor(PROJECT, WORKSPACE, "req-1");
const deliveryRef: DeliveryRef = deliveryRefFor(PROJECT, WORKSPACE, "deliv-from-request");
const waitRef: WaitConditionRef = waitConditionRefFor(PROJECT, WORKSPACE, "wait-1");

type Chain = {
  participationC: CommunicationWriteReceipt;
  participationA: CommunicationWriteReceipt;
  request: CommunicationWriteReceipt;
  response: CommunicationWriteReceipt;
  subscription: CommunicationWriteReceipt;
  wait: CommunicationWriteReceipt;
};

let chain: Chain | null = null;
let chainBlocked = "";

beforeAll(async () => {
  const h = base.h;
  const participationC = await h.control.startWorkParticipation(participationCommand({
    commandId: "cmd-part-c", idempotencyKey: "part-c", aggregateId: "part-c",
    workContextRef: base.workC, runRef: base.runRef, participationRef: partC,
  }));
  if (participationC.status !== "committed") {
    chainBlocked =
      "startWorkParticipation 被拒绝：code=" + participationC.code +
      " issues=" + JSON.stringify(participationC.issues ?? []) +
      " —— 根因见文件头：冻结的 ledger-validation.COMMUNICATION_EVENT_TYPES 白名单缺 \"WorkRunLinked\"" +
      "（实测 validateCommunicationCommit(participation-start) = false），需要 owner 一行加法裁决。";
    return;
  }
  const participationA = await h.control.startWorkParticipation(participationCommand({
    commandId: "cmd-part-a", idempotencyKey: "part-a", aggregateId: "part-a",
    workContextRef: base.workA, runRef: base.runRef, participationRef: partA,
    agentInstanceId: AGENT_A,
  }));
  if (participationA.status !== "committed") {
    chainBlocked = "第二个 participation 建立失败：code=" + participationA.code;
    return;
  }

  const request: SendDirectedRequestCommand = {
    commandId: "cmd-req-1",
    commandType: "SendDirectedRequest",
    schemaVersion: 1,
    aggregateId: "req-1",
    expectedRevision: 0,
    correlationId: "corr-req-1",
    submittedAt: SCHEMA,
    identity: {
      projectId: PROJECT,
      actor: agentActor(base.runRef),
      idempotencyKey: "req-1",
      agentPrincipal: principalFor({ runRef: base.runRef, workContextRef: base.workC, participationRef: partC }),
    },
    payload: {
      workspaceId: WORKSPACE,
      fromParticipationRef: { ...partC },
      fromRunRef: { ...base.runRef },
      toWorkContextRef: { ...base.workA },
      expectedParticipationRef: { ...partA },
      statement: "请只读调查报告 A",
      statementBodyRef: BODY_REF,
      roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
    },
  };
  const requestReceipt = await h.control.sendDirectedRequest(request);
  if (requestReceipt.status !== "committed") {
    chainBlocked = "sendDirectedRequest 未受理：code=" + requestReceipt.code + " issues=" + JSON.stringify(requestReceipt.issues ?? []);
    return;
  }

  const requestSnapshot = await h.ledger.load(requestRef);
  const requestRevision = requestSnapshot.status === "found" ? requestSnapshot.snapshot.revision : 1;
  const requestDeliveryRef = (await findRequestDelivery(h)) ?? deliveryRef;

  const responseReceipt = await h.control.respondDirectedRequest({
    commandId: "cmd-resp-1",
    commandType: "RespondDirectedRequest",
    schemaVersion: 1,
    aggregateId: "req-1",
    expectedRevision: requestRevision,
    correlationId: "corr-resp-1",
    submittedAt: SCHEMA,
    identity: {
      projectId: PROJECT,
      actor: agentActor(base.runRef, AGENT_A),
      idempotencyKey: "resp-1",
      agentPrincipal: principalFor({ runRef: base.runRef, workContextRef: base.workA, participationRef: partA, agentInstanceId: AGENT_A }),
    },
    payload: {
      workspaceId: WORKSPACE,
      respondingParticipationRef: { ...partA },
      respondingRunRef: { ...base.runRef },
      response: { bodyRef: BODY_REF, sourceRefs: [{ kind: "workspace", refId: WORKSPACE, revision: "1" }], authorRunRef: { ...base.runRef } },
    },
  } satisfies RespondDirectedRequestCommand);

  const subscriptionReceipt = await h.control.createSubscription({
    commandId: "cmd-sub-1",
    commandType: "CreateSubscription",
    schemaVersion: 1,
    aggregateId: "sub-1",
    expectedRevision: 0,
    correlationId: "corr-sub-1",
    submittedAt: SCHEMA,
    identity: {
      projectId: PROJECT,
      actor: agentActor(base.runRef),
      idempotencyKey: "sub-1",
      agentPrincipal: principalFor({ runRef: base.runRef, workContextRef: base.workC, participationRef: partC }),
    },
    payload: {
      workspaceId: WORKSPACE,
      ownerWorkContextRef: { ...base.workC },
      ownerParticipationRef: { ...partC },
      topics: ["run.completed"],
      startCursor: "c0000000001" as CommitCursor,
    },
  } satisfies SubscribeCommand);

  const waitReceipt = await h.control.registerWait({
    commandId: "cmd-wait-1",
    commandType: "RegisterWait",
    schemaVersion: 1,
    aggregateId: "wait-1",
    expectedRevision: 0,
    correlationId: "corr-wait-1",
    submittedAt: SCHEMA,
    identity: {
      projectId: PROJECT,
      actor: agentActor(base.runRef),
      idempotencyKey: "wait-1",
      agentPrincipal: principalFor({ runRef: base.runRef, workContextRef: base.workC, participationRef: partC }),
    },
    payload: {
      workspaceId: WORKSPACE,
      ownerWorkContextRef: { ...base.workC },
      ownerParticipationRef: { ...partC },
      predecessorRunRef: { ...base.runRef },
      conditions: [{ kind: "delivery_present", deliveryRef: { ...requestDeliveryRef } }],
      // 固定时钟是 2026-09-05T12:00:00.000Z：deadline 放在过去，使 wait_deadline intent
      // 的 availableAt 已到（可领取），同时租约在 claim 的 now 之后才过期。
      deadlineAt: "2026-09-05T11:00:00.000Z",
    },
  } satisfies RegisterWaitCommand);

  chain = {
    participationC,
    participationA,
    request: requestReceipt,
    response: responseReceipt,
    subscription: subscriptionReceipt,
    wait: waitReceipt,
  };
});

async function findRequestDelivery(h: ReturnType<typeof createInMemoryHarness>): Promise<DeliveryRef | null> {
  const page = await h.ledger.events({ afterCursor: null, limit: 1000 });
  for (const positioned of page.events) {
    const event = positioned.event;
    if (event.eventType !== "DeliveryRecorded") continue;
    const delivery = event.payload.delivery;
    if (delivery.origin.kind === "directed_request" && delivery.origin.requestRef.requestId === "req-1") {
      return deliveryRefFor(PROJECT, WORKSPACE, delivery.deliveryId);
    }
  }
  return null;
}

function requireChain(): Chain {
  if (chain === null) {
    throw new Error("BLOCKED(冻结契约面缺陷，需要 owner 裁决)：参与关系无法通过 Control 建立 —— " + chainBlocked);
  }
  return chain;
}

describe("参与与定向请求（A01/A02：正式入口、body-first、CAS 与 stale 拒绝）", () => {
  it("startWorkParticipation 提交参与关系 @1，并在同一事务把发起 Run link 进该 Work", async () => {
    const c = requireChain();
    expect(c.participationC.status).toBe("committed");
    const binding = await base.h.ledger.load(base.workC);
    expect(binding.status).toBe("found");
    if (binding.status !== "found") return;
    const linked = (binding.snapshot as WorkContextBindingSnapshot).binding.linkedRunRefs.map((r) => r.runId);
    expect(linked).toContain("run-cm");
  });

  it("stale participation：expectedParticipationRef 不匹配 → stale_participation 且零写入", async () => {
    requireChain();
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const stale = await base.h.control.sendDirectedRequest({
      commandId: "cmd-req-stale",
      commandType: "SendDirectedRequest",
      schemaVersion: 1,
      aggregateId: "req-stale",
      expectedRevision: 0,
      correlationId: "corr-req-stale",
      submittedAt: SCHEMA,
      identity: {
        projectId: PROJECT,
        actor: agentActor(base.runRef),
        idempotencyKey: "req-stale",
        agentPrincipal: principalFor({ runRef: base.runRef, workContextRef: base.workC, participationRef: partC }),
      },
      payload: {
        workspaceId: WORKSPACE,
        fromParticipationRef: { ...partC },
        fromRunRef: { ...base.runRef },
        toWorkContextRef: { ...base.workA },
        // 指向发起方自己的参与关系：不属于目标 Work → 必须 stale 而不是偷偷转投。
        expectedParticipationRef: { ...partC },
        statement: "stale probe",
        statementBodyRef: BODY_REF,
        roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
      },
    });
    expect(stale.status).toBe("rejected");
    if (stale.status !== "rejected") return;
    expect(stale.code).toBe("stale_participation");
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("回应正文 body-first：respond 登记 CAS@N 且请求转为 responded", async () => {
    const c = requireChain();
    expect(c.response.status).toBe("committed");
    const loaded = await base.h.ledger.load(requestRef);
    expect(loaded.status).toBe("found");
    if (loaded.status !== "found") return;
    const request = (loaded.snapshot as DirectedRequestSnapshot).request;
    expect(request.status).toBe("responded");
    expect(request.response?.bodyRef.digest).toBe(BODY_REF.digest);
  });

  it("createSubscription 建立订阅 @1，起始位置非空时同事务建立首个 route intent", async () => {
    const c = requireChain();
    expect(c.subscription.status).toBe("committed");
    const sub = await base.h.ledger.load(subscriptionRefFor(PROJECT, WORKSPACE, "sub-1"));
    expect(sub.status).toBe("found");
    if (sub.status !== "found") return;
    expect(sub.snapshot.revision).toBe(1);
  });

  it("registerWait 建立 all-wait，并在同一事务建立 wait_deadline intent", async () => {
    const c = requireChain();
    expect(c.wait.status).toBe("committed");
    const wait = await base.h.ledger.load(waitRef);
    expect(wait.status).toBe("found");
    if (wait.status !== "found") return;
    expect(wait.snapshot.revision).toBe(1);
    const intent = await base.h.ledger.load(
      communicationIntentRefFor(PROJECT, WORKSPACE, waitDeadlineIntentIdFor("wait-1")),
    );
    expect(intent.status).toBe("found");
  });
});

describe("cancel / claim / settle（依赖 participation 与 intent）", () => {
  it("cancelCommunication：desired-state-first，请求先落 cancelled，重复取消不再写", async () => {
    const c = requireChain();
    const requestSnapshot = await base.h.ledger.load(requestRef);
    expect(requestSnapshot.status).toBe("found");
    if (requestSnapshot.status !== "found") return;
    const revision = requestSnapshot.snapshot.revision;
    const cancel: CancelCommunicationCommand = {
      commandId: "cmd-cancel-req",
      commandType: "CancelCommunication",
      schemaVersion: 1,
      aggregateId: "req-1",
      expectedRevision: revision,
      correlationId: "corr-cancel-req",
      submittedAt: SCHEMA,
      identity: {
        projectId: PROJECT,
        actor: agentActor(base.runRef),
        idempotencyKey: "cancel-req",
        agentPrincipal: principalFor({ runRef: base.runRef, workContextRef: base.workC, participationRef: partC }),
      },
      payload: { workspaceId: WORKSPACE, target: "directed_request", reason: "不再需要" },
    };
    const cancelled = await base.h.control.cancelCommunication(cancel);
    expect(cancelled.status).toBe("committed");
    const again = await base.h.control.cancelCommunication({ ...cancel, commandId: "cmd-cancel-req-2", identity: { ...cancel.identity, idempotencyKey: "cancel-req-2" } });
    expect(again.status).toBe("rejected");
    if (again.status !== "rejected") return;
    expect(again.code).toBe("forbidden");
    expect(c.request.status).toBe("committed");
  });

  it("claim：两个消费者竞争同一 intent，只有一个拿到 generation，另一个 owned_elsewhere（零写入）", async () => {
    requireChain();
    const intentId = waitDeadlineIntentIdFor("wait-1");
    const intentRef = communicationIntentRefFor(PROJECT, WORKSPACE, intentId);
    const loaded = await base.h.ledger.load(intentRef);
    expect(loaded.status).toBe("found");
    if (loaded.status !== "found") return;

    const claimFor = (consumerId: string, commandId: string): CommunicationClaimCommand => ({
      commandId,
      commandType: "CommunicationClaimIntent",
      schemaVersion: 1,
      aggregateId: intentId,
      expectedRevision: loaded.snapshot.revision,
      correlationId: "corr-" + commandId,
      submittedAt: SCHEMA,
      identity: { projectId: PROJECT, actor: { kind: "system", id: "dispatch" }, idempotencyKey: commandId },
      payload: { workspaceId: WORKSPACE, consumerId, leaseDurationMs: 30_000, now: SCHEMA },
    });

    const a = await base.h.control.claimCommunicationIntent(claimFor("consumer-a", "cmd-claim-a"));
    expect(a.status).toBe("claimed");
    if (a.status !== "claimed") return;
    const b = await base.h.control.claimCommunicationIntent(claimFor("consumer-b", "cmd-claim-b"));
    expect(b.status).toBe("owned_elsewhere");
    if (b.status !== "owned_elsewhere") return;
    expect(b.leaseOwner).toBe("consumer-a");
    expect(a.leaseGeneration).toBeGreaterThan(0);
  });

  it("settle：过期 generation 被拒（stale_generation），当前 generation 才能 settle", async () => {
    requireChain();
    const intentId = waitDeadlineIntentIdFor("wait-1");
    const intentRef = communicationIntentRefFor(PROJECT, WORKSPACE, intentId);
    const loaded = await base.h.ledger.load(intentRef);
    expect(loaded.status).toBe("found");
    if (loaded.status !== "found") return;
    const current = (loaded.snapshot as CommunicationIntentSnapshot).intent.leaseGeneration;
    expect(current).toBeGreaterThan(0);

    const settleWith = (generation: number, commandId: string): CommunicationSettleCommand => ({
      commandId,
      commandType: "CommunicationSettleIntent",
      schemaVersion: 1,
      aggregateId: intentId,
      expectedRevision: loaded.snapshot.revision,
      correlationId: "corr-" + commandId,
      submittedAt: SCHEMA,
      identity: { projectId: PROJECT, actor: { kind: "system", id: "dispatch" }, idempotencyKey: commandId },
      payload: {
        outcome: "cancel_confirmed",
        workspaceId: WORKSPACE,
        consumerId: "consumer-a",
        leaseGeneration: generation,
        settledAt: SCHEMA,
      },
    });

    const stale = await base.h.control.settleCommunicationIntent(settleWith(current - 1, "cmd-settle-stale"));
    expect(stale.status).toBe("stale_generation");
    if (stale.status !== "stale_generation") return;
    expect(stale.currentGeneration).toBe(current);

    const settled = await base.h.control.settleCommunicationIntent(settleWith(current, "cmd-settle-ok"));
    expect(settled.status).toBe("committed");
    if (settled.status !== "committed") return;
    expect(settled.intentStatus).toBe("cancelled");
  });

  it("mailboxView：可重建该 Work 的参与/请求/订阅/等待/投递关系", async () => {
    requireChain();
    const view = await base.h.control.mailboxView(base.workC);
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.view.participations.map((p) => p.ref.participationId)).toContain("part-c");
    expect(view.view.requests.map((r) => r.ref.requestId)).toContain("req-1");
    expect(view.view.subscriptions.map((s) => s.ref.subscriptionId)).toContain("sub-1");
    expect(view.view.waits.map((w) => w.ref.waitId)).toContain("wait-1");
    // 定向请求产生的 Delivery 的 targetWorkContextRef 是**目标** Work（work-a），
    // 因此它出现在 work-a 的邮箱里；work-c 作为发起方不应看到它（投递不越权）。
    expect(view.view.deliveries).toEqual([]);
    const target = await base.h.control.mailboxView(base.workA);
    expect(target.status).toBe("ready");
    if (target.status !== "ready") return;
    expect(target.view.deliveries.length).toBeGreaterThan(0);
    expect(target.view.requests.map((r) => r.ref.requestId)).toContain("req-1");
  });
});

// ------------------------------------------------------------------------ //
// 2c. endWorkParticipation：换手后等待/请求仍归 Work（A01）                    //
// ------------------------------------------------------------------------ //

const partC2: WorkParticipationRef = { ...partC, participationId: "part-c2" };

function endParticipationCommand(input: {
  commandId: string;
  idempotencyKey: string;
  participationRef: WorkParticipationRef;
  expectedRevision: number;
  reason?: string;
}): EndWorkParticipationCommand {
  return {
    commandId: input.commandId,
    commandType: "EndWorkParticipation",
    schemaVersion: 1,
    aggregateId: input.participationRef.participationId,
    expectedRevision: input.expectedRevision,
    correlationId: "corr-" + input.commandId,
    submittedAt: SCHEMA,
    identity: {
      projectId: PROJECT,
      actor: agentActor(base.runRef),
      idempotencyKey: input.idempotencyKey,
      agentPrincipal: principalFor({ runRef: base.runRef, workContextRef: base.workC, participationRef: input.participationRef }),
    },
    payload: {
      workspaceId: WORKSPACE,
      workContextRef: { ...base.workC },
      runRef: { ...base.runRef },
      reason: input.reason ?? "本段参与结束，交由下一段参与继续",
    },
  };
}

describe("endWorkParticipation：换手后等待/请求仍归 Work（A01）", () => {
  let endReceipt: CommunicationWriteReceipt | null = null;

  it("结束参与关系：CAS@N、status=ended、endedAt 落账（历史保留，不改名不删除）", async () => {
    requireChain();
    const prior = await base.h.ledger.load(partC);
    expect(prior.status).toBe("found");
    if (prior.status !== "found") return;
    expect(prior.snapshot.revision).toBe(1);

    const receipt = await base.h.control.endWorkParticipation(endParticipationCommand({
      commandId: "cmd-end-part-c",
      idempotencyKey: "end-part-c",
      participationRef: partC,
      expectedRevision: prior.snapshot.revision,
    }));
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    endReceipt = receipt;

    const after = await base.h.ledger.load(partC);
    expect(after.status).toBe("found");
    if (after.status !== "found") return;
    const participation = (after.snapshot as WorkParticipationSnapshot).participation;
    expect(after.snapshot.revision).toBe(2);
    expect(participation.status).toBe("ended");
    expect(participation.endedAt).toBe(SCHEMA);
    // 历史保留：participantId/workContextRef/agentInstanceId/roleBinding 都不改名。
    expect(participation.workContextRef.workId).toBe(WORK_C);
    expect(participation.agentInstanceId).toBe(AGENT);
  });

  it("重复结束（同一命令重放）→ committed(replayed=true)，不产生第二条 ended 事件", async () => {
    expect(endReceipt, "前置：先成功结束一次").not.toBeNull();
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const replay = await base.h.control.endWorkParticipation(endParticipationCommand({
      commandId: "cmd-end-part-c",
      idempotencyKey: "end-part-c",
      participationRef: partC,
      expectedRevision: 1,
    }));
    expect(replay.status).toBe("committed");
    if (replay.status !== "committed") return;
    expect(replay.replayed).toBe(true);
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
    const endedEvents = after.events.filter((e) => e.event.eventType === "WorkParticipationEnded");
    expect(endedEvents).toHaveLength(1);
  });

  it("重复结束（另一个命令身份 + 当前 revision）→ revision_conflict 且零写入", async () => {
    const current = await base.h.ledger.load(partC);
    expect(current.status).toBe("found");
    if (current.status !== "found") return;
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const again = await base.h.control.endWorkParticipation(endParticipationCommand({
      commandId: "cmd-end-part-c-again",
      idempotencyKey: "end-part-c-again",
      participationRef: partC,
      expectedRevision: current.snapshot.revision,
    }));
    expect(again.status).toBe("rejected");
    if (again.status !== "rejected") return;
    expect(again.code).toBe("revision_conflict");
    expect(again.currentRevision).toBe(current.snapshot.revision);
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("换手：同一 Work 上可建立新的 participation；等待/请求/订阅/投递仍归该 Work", async () => {
    requireChain();
    // 旧的一段已 ended，新的一段在同一個 workContextRef 上建立。
    const started = await base.h.control.startWorkParticipation(participationCommand({
      commandId: "cmd-part-c2",
      idempotencyKey: "part-c2",
      aggregateId: "part-c2",
      workContextRef: base.workC,
      runRef: base.runRef,
      participationRef: partC2,
    }));
    expect(started.status).toBe("committed");

    const oldOne = await base.h.ledger.load(partC);
    const newOne = await base.h.ledger.load(partC2);
    expect(oldOne.status).toBe("found");
    expect(newOne.status).toBe("found");
    if (oldOne.status !== "found" || newOne.status !== "found") return;
    expect((oldOne.snapshot as WorkParticipationSnapshot).participation.status).toBe("ended");
    expect((newOne.snapshot as WorkParticipationSnapshot).participation.status).toBe("active");

    // 等待仍归 Work：owner 是 WorkContextBinding，换手不改变它的归属，也不改变它的状态。
    const wait = await base.h.ledger.load(waitRef);
    expect(wait.status).toBe("found");
    if (wait.status !== "found") return;
    const waitValue = (wait.snapshot as WaitConditionSnapshot).wait;
    expect(waitValue.ownerWorkContextRef.workId).toBe(WORK_C);
    expect(waitValue.status).toBe("active");

    // 请求与订阅同样仍归 Work。
    const request = await base.h.ledger.load(requestRef);
    expect(request.status).toBe("found");
    if (request.status !== "found") return;
    expect((request.snapshot as DirectedRequestSnapshot).request.fromWorkContextRef.workId).toBe(WORK_C);
    const subscription = await base.h.ledger.load(subscriptionRefFor(PROJECT, WORKSPACE, "sub-1"));
    expect(subscription.status).toBe("found");
    if (subscription.status !== "found") return;
    expect((subscription.snapshot as SubscriptionSnapshot).subscription.ownerWorkContextRef.workId).toBe(WORK_C);

    // 邮箱里能同时看到两段参与（历史 + 当前），以及仍然归该 Work 的请求/订阅/等待。
    const view = await base.h.control.mailboxView(base.workC);
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    const ids = view.view.participations.map((p) => p.ref.participationId);
    expect(ids).toContain("part-c");
    expect(ids).toContain("part-c2");
    expect(view.view.requests.map((r) => r.ref.requestId)).toContain("req-1");
    expect(view.view.subscriptions.map((s) => s.ref.subscriptionId)).toContain("sub-1");
    expect(view.view.waits.map((w) => w.ref.waitId)).toContain("wait-1");
  });
});

// ------------------------------------------------------------------------ //
// 3. commit 之前的守卫（不需要 participation，必须全绿）                      //
// ------------------------------------------------------------------------ //

describe("零写入守卫与只读面（不依赖 participation）", () => {
  it("startWorkParticipation：AgentInstance 不存在 → not_found（零写入）", async () => {
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const participationRef: WorkParticipationRef = { ...partC, participationId: "part-x" };
    const command = participationCommand({
      commandId: "cmd-part-x", idempotencyKey: "part-x", aggregateId: "part-x",
      workContextRef: base.workC, runRef: base.runRef, participationRef,
    });
    const receipt = await base.h.control.startWorkParticipation({
      ...command,
      identity: {
        ...command.identity,
        actor: { kind: "agent", id: "agent-missing", runRef: { ...base.runRef } },
        agentPrincipal: { ...command.identity.agentPrincipal!, agentInstanceId: "agent-missing" },
      },
      payload: { ...command.payload, agentInstanceId: "agent-missing" },
    });
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("not_found");
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("startWorkParticipation：principal 与 payload 不一致 → forbidden（零写入）", async () => {
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const command = participationCommand({
      commandId: "cmd-part-y", idempotencyKey: "part-y", aggregateId: "part-y",
      workContextRef: base.workC, runRef: base.runRef,
      participationRef: { ...partC, participationId: "part-y" },
    });
    const mismatched: StartWorkParticipationCommand = {
      ...command,
      identity: {
        ...command.identity,
        agentPrincipal: { ...command.identity.agentPrincipal!, participationRef: { ...partC, participationId: "not-part-y" } },
      },
    };
    const receipt = await base.h.control.startWorkParticipation(mismatched);
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("forbidden");
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("claimCommunicationIntent：intent 不存在 → not_found（零写入）", async () => {
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const receipt = await base.h.control.claimCommunicationIntent({
      commandId: "cmd-claim-missing",
      commandType: "CommunicationClaimIntent",
      schemaVersion: 1,
      aggregateId: "intent-nowhere",
      expectedRevision: 1,
      correlationId: "corr-claim-missing",
      submittedAt: SCHEMA,
      identity: { projectId: PROJECT, actor: { kind: "system", id: "dispatch" }, idempotencyKey: "claim-missing" },
      payload: { workspaceId: WORKSPACE, consumerId: "consumer-a", leaseDurationMs: 1000, now: SCHEMA },
    });
    expect(receipt.status).toBe("not_found");
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("mailboxView：查询不完整 → unavailable（不把截断集合当完整答案）", async () => {
    const view = await base.h.control.mailboxView({ aggregateType: "WorkContextBinding", projectId: "", workspaceId: WORKSPACE, workId: WORK_C });
    expect(view.status).toBe("unavailable");
  });

  it("sendDirectedRequest：发起参与关系不存在 → not_found（零写入）", async () => {
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const missingParticipation: WorkParticipationRef = { ...partC, participationId: "part-missing" };
    const receipt = await base.h.control.sendDirectedRequest({
      commandId: "cmd-req-nopart",
      commandType: "SendDirectedRequest",
      schemaVersion: 1,
      aggregateId: "req-nopart",
      expectedRevision: 0,
      correlationId: "corr-req-nopart",
      submittedAt: SCHEMA,
      identity: {
        projectId: PROJECT,
        actor: agentActor(base.runRef),
        idempotencyKey: "req-nopart",
        agentPrincipal: principalFor({ runRef: base.runRef, workContextRef: base.workC, participationRef: missingParticipation }),
      },
      payload: {
        workspaceId: WORKSPACE,
        fromParticipationRef: { ...missingParticipation },
        fromRunRef: { ...base.runRef },
        toWorkContextRef: { ...base.workA },
        expectedParticipationRef: null,
        statement: "no participation yet",
        statementBodyRef: BODY_REF,
        roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
      },
    });
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("not_found");
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("respondDirectedRequest：请求不存在 → not_found（零写入）", async () => {
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const receipt = await base.h.control.respondDirectedRequest({
      commandId: "cmd-resp-missing",
      commandType: "RespondDirectedRequest",
      schemaVersion: 1,
      aggregateId: "req-nowhere",
      expectedRevision: 1,
      correlationId: "corr-resp-missing",
      submittedAt: SCHEMA,
      identity: {
        projectId: PROJECT,
        actor: agentActor(base.runRef),
        idempotencyKey: "resp-missing",
        agentPrincipal: principalFor({ runRef: base.runRef, workContextRef: base.workC, participationRef: partC }),
      },
      payload: {
        workspaceId: WORKSPACE,
        respondingParticipationRef: { ...partC },
        respondingRunRef: { ...base.runRef },
        response: { bodyRef: BODY_REF, sourceRefs: [], authorRunRef: { ...base.runRef } },
      },
    });
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("not_found");
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("createSubscription：topics 超过上界 → over_limit（零写入）", async () => {
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const receipt = await base.h.control.createSubscription({
      commandId: "cmd-sub-over",
      commandType: "CreateSubscription",
      schemaVersion: 1,
      aggregateId: "sub-over",
      expectedRevision: 0,
      correlationId: "corr-sub-over",
      submittedAt: SCHEMA,
      identity: {
        projectId: PROJECT,
        actor: agentActor(base.runRef),
        idempotencyKey: "sub-over",
        agentPrincipal: principalFor({ runRef: base.runRef, workContextRef: base.workC, participationRef: partC }),
      },
      payload: {
        workspaceId: WORKSPACE,
        ownerWorkContextRef: { ...base.workC },
        ownerParticipationRef: { ...partC },
        topics: Array.from({ length: 17 }, (_, i) => "topic-" + String(i)),
        startCursor: null,
      },
    });
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("over_limit");
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("registerWait：conditions 超过 8 条 → over_limit（零写入）", async () => {
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const receipt = await base.h.control.registerWait({
      commandId: "cmd-wait-over",
      commandType: "RegisterWait",
      schemaVersion: 1,
      aggregateId: "wait-over",
      expectedRevision: 0,
      correlationId: "corr-wait-over",
      submittedAt: SCHEMA,
      identity: {
        projectId: PROJECT,
        actor: agentActor(base.runRef),
        idempotencyKey: "wait-over",
        agentPrincipal: principalFor({ runRef: base.runRef, workContextRef: base.workC, participationRef: partC }),
      },
      payload: {
        workspaceId: WORKSPACE,
        ownerWorkContextRef: { ...base.workC },
        ownerParticipationRef: { ...partC },
        predecessorRunRef: { ...base.runRef },
        conditions: Array.from({ length: 9 }, () => ({ kind: "delivery_present" as const, deliveryRef: { ...deliveryRef } })),
        deadlineAt: null,
      },
    });
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("over_limit");
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("cancelCommunication：目标不存在 → not_found（零写入）", async () => {
    const before = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    const receipt = await base.h.control.cancelCommunication({
      commandId: "cmd-cancel-missing",
      commandType: "CancelCommunication",
      schemaVersion: 1,
      aggregateId: "req-nowhere",
      expectedRevision: 1,
      correlationId: "corr-cancel-missing",
      submittedAt: SCHEMA,
      identity: {
        projectId: PROJECT,
        actor: agentActor(base.runRef),
        idempotencyKey: "cancel-missing",
        agentPrincipal: principalFor({ runRef: base.runRef, workContextRef: base.workC, participationRef: partC }),
      },
      payload: { workspaceId: WORKSPACE, target: "directed_request", reason: "n/a" },
    });
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("not_found");
    const after = await base.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("participation-start 的专用形状校验：合法提交通过，顺序/关联被破坏时被拒", () => {
    const participationRef: WorkParticipationRef = { ...partC, participationId: "part-proof" };
    const command = participationCommand({
      commandId: "cmd-part-proof", idempotencyKey: "part-proof", aggregateId: "part-proof",
      workContextRef: base.workC, runRef: base.runRef, participationRef,
    });
    const priorBinding = {
      ref: base.workC,
      revision: 1,
      schemaVersion: 1 as const,
      binding: {
        schemaVersion: 1 as const,
        workId: WORK_C,
        projectId: PROJECT,
        workspaceId: WORKSPACE,
        workKind: "coordination" as const,
        goalId: GOAL,
        taskId: null,
        planRef: null,
        planRevision: null,
        roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 },
        initialRunRef: { ...base.runRef },
        linkedRunRefs: [{ ...base.runRef }],
        status: "active" as const,
        createdAt: SCHEMA,
      },
    };
    const batch = buildParticipationStartCommit(
      command,
      { eventId: () => "evt-proof", now: () => SCHEMA, workspaceId: WORKSPACE },
      startWorkParticipationFingerprint(command),
      priorBinding,
    );
    expect(batch.events.map((e) => e.eventType)).toEqual(["WorkParticipationStarted", "WorkRunLinked"]);

    // 要求语义：这条提交必须合法（owner 裁决 D06 的专用校验）。
    expect(validateParticipationStartCommit(batch)).toBe(true);

    // 专用校验不是"任意两条事件都算合法"：顺序颠倒、丢 link、link 的 Run 不在
    // linkedRunRefs 里、binding 指向别的 Work，都必须被拒。
    const swapped = { ...batch, events: [batch.events[1], batch.events[0]] } as typeof batch;
    expect(validateParticipationStartCommit(swapped)).toBe(false);
    const noLink = { ...batch, events: [batch.events[0]] } as unknown as typeof batch;
    expect(validateParticipationStartCommit(noLink)).toBe(false);
    const unlinkedBinding = {
      ...batch,
      snapshots: [
        batch.snapshots[0],
        { ...priorBinding, revision: 2, binding: { ...priorBinding.binding, linkedRunRefs: [] } },
      ],
    } as unknown as typeof batch;
    expect(validateParticipationStartCommit(unlinkedBinding)).toBe(false);
    const otherWork = {
      ...batch,
      snapshots: [
        batch.snapshots[0],
        {
          ...priorBinding,
          revision: 2,
          ref: { ...priorBinding.ref, workId: "work-other" },
          binding: { ...priorBinding.binding, workId: "work-other" },
        },
      ],
    } as unknown as typeof batch;
    expect(validateParticipationStartCommit(otherWork)).toBe(false);
  });

  it("participation-start 先过**通用**事件校验：eventId / schemaVersion / 作用域 / 身份 任一不符即拒绝", () => {
    const participationRef: WorkParticipationRef = { ...partC, participationId: "part-generic" };
    const command = participationCommand({
      commandId: "cmd-part-generic", idempotencyKey: "part-generic", aggregateId: "part-generic",
      workContextRef: base.workC, runRef: base.runRef, participationRef,
    });
    const priorBinding = {
      ref: base.workC,
      revision: 1,
      schemaVersion: 1 as const,
      binding: {
        schemaVersion: 1 as const,
        workId: WORK_C,
        projectId: PROJECT,
        workspaceId: WORKSPACE,
        workKind: "coordination" as const,
        goalId: GOAL,
        taskId: null,
        planRef: null,
        planRevision: null,
        roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 },
        initialRunRef: { ...base.runRef },
        linkedRunRefs: [{ ...base.runRef }],
        status: "active" as const,
        createdAt: SCHEMA,
      },
    };
    const batch = buildParticipationStartCommit(
      command,
      { eventId: () => "evt-generic", now: () => SCHEMA, workspaceId: WORKSPACE },
      startWorkParticipationFingerprint(command),
      priorBinding,
    );

    // 正向基线：未改动的提交必须**同时**被通用校验与专用校验接受。
    // 没有这一条，下面的每条反例都无法证明"是这一处改动被拒"。
    expect(validateCommunicationCommit(batch)).toBe(true);
    expect(validateParticipationStartCommit(batch)).toBe(true);

    type Batch = typeof batch;
    const patchEvent = (index: number, patch: Record<string, unknown>): Batch =>
      ({ ...batch, events: batch.events.map((e, i) => (i === index ? { ...e, ...patch } : e)) }) as unknown as Batch;
    const patchSnapshots = (mutate: (s: Record<string, unknown>) => Record<string, unknown>): Batch =>
      ({ ...batch, snapshots: batch.snapshots.map((s) => mutate({ ...s })) }) as unknown as Batch;
    const patchIdentity = (patch: Record<string, unknown>): Batch =>
      ({ ...batch, identity: { ...batch.identity, ...patch } }) as unknown as Batch;

    // ── 反例 1：事件的 eventId 为空 ────────────────────────────────────────────
    // 专用校验本身不检查 eventId（它只钉事务内的关联），通用校验必须拦住它。
    const emptyEventId = patchEvent(0, { eventId: "" });
    expect(validateCommunicationCommit(emptyEventId)).toBe(false);
    expect(validateParticipationStartCommit(emptyEventId)).toBe(false);

    // ── 反例 2：事件的 schemaVersion 不是 1 ────────────────────────────────────
    const wrongSchema = patchEvent(1, { schemaVersion: 2 });
    expect(validateCommunicationCommit(wrongSchema)).toBe(false);
    expect(validateParticipationStartCommit(wrongSchema)).toBe(false);

    // ── 反例 3：作用域不一致 —— 事件的 projectId 与提交身份不符 ──────────────────
    const otherProject = patchEvent(0, { projectId: "proj-other" });
    expect(validateCommunicationCommit(otherProject)).toBe(false);
    expect(validateParticipationStartCommit(otherProject)).toBe(false);

    // ── 反例 4：作用域不一致 —— 快照的 projectId 与提交身份不符 ──────────────────
    const snapshotOtherProject = patchSnapshots((s) => (
      (s["ref"] as { projectId: string }).projectId === PROJECT
        ? { ...s, ref: { ...(s["ref"] as Record<string, unknown>), projectId: "proj-other" } }
        : s
    ));
    expect(validateCommunicationCommit(snapshotOtherProject)).toBe(false);
    expect(validateParticipationStartCommit(snapshotOtherProject)).toBe(false);

    // ── 反例 5：作用域不一致 —— 两条事件声明的 workspaceId 不同 ──────────────────
    // CommandIdentity 里没有 workspaceId，通用校验按身份字段也看不出来；这条由专用校验的
    // "同一作用域"规则拒绝（历史缺陷：WorkRunLinked 自身的 workspaceId 完全没被核对）。
    const otherWorkspace = patchEvent(1, { workspaceId: "ws-other" });
    expect(validateCommunicationCommit(otherWorkspace)).toBe(true);
    expect(validateParticipationStartCommit(otherWorkspace)).toBe(false);

    // ── 反例 6：提交身份本身不完整（idempotencyKey / actor.id 为空）──────────────
    expect(validateParticipationStartCommit(patchIdentity({ idempotencyKey: "" }))).toBe(false);
    expect(validateParticipationStartCommit(patchIdentity({ actor: { kind: "agent", id: "", runRef: { ...base.runRef } } }))).toBe(false);

    // ── 反例 7：提交身份的 projectId 与两条事件都不符 ────────────────────────────
    expect(validateParticipationStartCommit(patchIdentity({ projectId: "proj-other" }))).toBe(false);

    // ── 反例 8：把第二条事件冒充成 WorkParticipationStarted ──────────────────────
    // 通用校验**看不出**这一条：两条事件都在白名单里、身份与版本也都对得上——这正是
    // 专用校验存在的理由（"恰好 [started, linked] 且有序"是事务内关联，不是通用形状）。
    const duplicatedStart = patchEvent(1, { eventType: "WorkParticipationStarted" });
    expect(validateCommunicationCommit(duplicatedStart)).toBe(true);
    expect(validateParticipationStartCommit(duplicatedStart)).toBe(false);

    // 反向对照：只把数组复制一遍（不改任何字段）仍然通过——上面每条拒绝都来自被改动的那一处。
    const untouched = { ...batch, events: batch.events.map((e) => ({ ...e })) } as unknown as Batch;
    expect(validateParticipationStartCommit(untouched)).toBe(true);
  });
});
