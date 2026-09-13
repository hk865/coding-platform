import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { subscriptionCatchupIdFor } from "../../src/contracts/coordination.js";
/**
 * CM-1A-001 第 3 工作段：Dispatch 侧协作通信驱动（route page / wait deadline / wait admission）
 * 的**真实消费者**验证。
 *
 * 走的都是生产实现：真实 InMemoryLedger（末例用真实 SQLite + close/reopen）、真实
 * ControlEngineImpl、真实 DispatchEngineImpl（协作驱动挂在它唯一的 drive 收口之内）。
 * 不绕过 Control 直写账本，也不构造测试专用的第二调度入口。
 *
 * 覆盖的验收点（对照 CM-1A-001 §5）：
 *   A03 固定 event position 的路由页、目标 Work 精确投递、checkpoint 严格推进、页拒绝时零部分写入；
 *   A04 两个消费者竞争同一 intent 只有一个拿到 generation；过期 generation 不能 settle；
 *   A05 事件先到 / wait 先注册两种时序都只产生**一次**后继 admission；前驱 active 不重叠启动；
 *       deadline 到点收敛为 timed_out 而不是接续；
 *   A09 重启（SQLite close + reopen）后从持久事实继续，不依赖内存队列；
 *   A10 backlog（pending/leased/retry/quarantine + 最老项年龄）来自持久状态。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryHarness, type InMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { buildPreparedClaim, prepareP103Project, type P1_03TestHarness } from "../contract-suite/p1-03-harness.js";
import { DISPATCH_ELIGIBLE_TASK_ID, ROLE_BINDING_FIXTURE_V1, type FakeRuntimeScriptV1 } from "../../src/fixtures/dispatch-fixtures.js";
import { runRefFor } from "../../src/contracts/dispatch.js";
import { buildRunFactCommand } from "../../src/contracts/commands/dispatch.js";
import type { RunRef } from "../../src/contracts/dispatch.js";
import type { WorkContextRef } from "../../src/contracts/context-continuity.js";
import { workContextRefFor } from "../../src/contracts/context-continuity.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { AggregateRef } from "../../src/contracts/ledger.js";
import type { EventPage } from "../../src/contracts/ledger.js";
import type { ArtifactRef } from "../../src/contracts/artifact.js";
import {
  communicationIntentRefFor,
  deliveryRefFor,
  routePageIntentIdFor,
  subscriptionRefFor,
  waitAdmissionIntentIdFor,
  workParticipationRefFor,
} from "../../src/contracts/coordination.js";
import type {
  AgentPrincipalRefV1,
  CommunicationClaimCommand,
  CommunicationIntentSnapshot,
  CommunicationIntentV1,
  CommunicationRoutePageCommitV1,
  CommunicationSettleCommand,
  RoutePageSubscriptionScopeEntry,
  DeliverySnapshot,
  DeliveryV1,
  RegisterWaitCommand,
  SendDirectedRequestCommand,
  StartWorkParticipationCommand,
  SubscribeCommand,
  SubscriptionSnapshot,
  WaitConditionSnapshot,
  WorkParticipationRef,
} from "../../src/contracts/coordination.js";
import { canonicalJson, sha256Hex } from "../../src/contracts/fingerprint.js";
import { subscriptionDeliveryIdFor } from "../../src/control/dispatch-engine/coordination-drive.js";
import {
  buildRoutePageCommit,
  deliveryRefForOf,
  intentSnapshotFor,
  routePageIntentFor,
} from "../../src/control/control-engine/records/coordination.js";
import { validateCommunicationRoutePageCommit } from "../../src/data/state-ledger/ledger-validation.js";

const AT = "2026-09-05T12:00:00.000Z";
const PROJECT = "proj-alpha";
const WORKSPACE = "ws-shared";
const GOAL = "goal-1";
const AGENT = "agent-c";
const WORK_C = "work-c";
const WORK_A = "work-a";
const TASK = DISPATCH_ELIGIBLE_TASK_ID;
const PLAN_REF = { aggregateType: "PlanRevision", projectId: PROJECT, planId: "plan-dispatch-mvp" } as const;

/** 只发 run_started：前驱 Run 停在 running，用来验证"前驱仍 active 不重叠启动后继"。 */
const STARTED_ONLY: FakeRuntimeScriptV1 = {
  schemaVersion: 1,
  items: [{ sequence: 1, eventType: "run_started", payload: { kind: "started", startedAt: "2026-09-05T12:00:01.000Z" }, occurredAt: "2026-09-05T12:00:01.000Z" }],
};

type AnyHarness = InMemoryHarness | Awaited<ReturnType<typeof createPersistentSqliteHarness>>;

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

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

async function countEvents(h: AnyHarness, type: string): Promise<number> {
  let cursor: CommitCursor | null = null;
  let total = 0;
  for (;;) {
    const page: EventPage = await h.ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const positioned of page.events) if (positioned.event.eventType === type) total += 1;
    if (!page.hasMore || page.throughCursor === null || page.throughCursor === cursor) return total;
    cursor = page.throughCursor;
  }
}

async function cursorOfFirstEvent(h: AnyHarness): Promise<CommitCursor> {
  const page: EventPage = await h.ledger.events({ afterCursor: null, limit: 1 });
  return page.events[0]!.cursor;
}

async function cursorOfEvent(h: AnyHarness, eventType: string): Promise<CommitCursor> {
  let cursor: CommitCursor | null = null;
  for (;;) {
    const page: EventPage = await h.ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const positioned of page.events) if (positioned.event.eventType === eventType) return positioned.cursor;
    if (!page.hasMore || page.throughCursor === null || page.throughCursor === cursor) throw new Error("event not found: " + eventType);
    cursor = page.throughCursor;
  }
}

function adapterOf(h: InMemoryHarness): P1_03TestHarness {
  return {
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
}

type Scenario = {
  h: AnyHarness;
  runRef: RunRef;
  workC: WorkContextRef;
  workA: WorkContextRef;
  partC: WorkParticipationRef;
};

/** 夹具：真实项目链 + 真实前驱 Run（停在 running）+ 两个 Work + Agent + 参与关系。 */
async function bootstrapScenario(h: AnyHarness, suffix: string): Promise<Scenario> {
  const boot = await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-rd-boot-" + suffix, correlationId: "corr-rd-boot-" + suffix, submittedAt: AT,
  }));
  expect(boot.status).toBe("committed");
  await prepareP103Project(adapterOf(h as InMemoryHarness), PROJECT, "a");

  const claim = await h.claimTask(buildPreparedClaim({
    commandId: "cmd-rd-claim-" + suffix,
    correlationId: "corr-rd-claim-" + suffix,
    attemptId: "att-pred",
    runId: "run-pred",
    idempotencyKey: "rd-claim-" + suffix,
  }));
  expect(claim.status, JSON.stringify(claim)).toBe("committed");

  const runRef = runRefFor(PROJECT, GOAL, "run-pred");
  const workC = workContextRefFor(PROJECT, WORKSPACE, WORK_C);
  const workA = workContextRefFor(PROJECT, WORKSPACE, WORK_A);
  // 先显式建立任务工作身份：派发收口的 ensureWorkIdentity 会**复用**它（不会另建第二个身份）。
  const bound = await h.bindWorkContext({
    commandId: "cmd-rd-bind-" + suffix, commandType: "BindWorkContext", schemaVersion: 1, aggregateId: WORK_C,
    expectedRevision: 0, correlationId: "corr-rd-bind-" + suffix, submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "rd-bind-" + suffix },
    payload: {
      // workKind=task：本 Work 同时是该任务的**工作身份**，因此等待/投递所属的 Work
      // 与派发收口解析出的 workId 是同一个（后继 Run 留在同一个 Work 上）。
      workspaceId: WORKSPACE, workKind: "task", goalId: GOAL, taskId: TASK,
      planRef: { ...PLAN_REF }, planRevision: 1,
      roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 }, initialRunRef: { ...runRef },
    },
  });
  expect(bound.status, JSON.stringify(bound)).toBe("committed");
  const boundA = await h.bindWorkContext({
    commandId: "cmd-rd-bind-a-" + suffix, commandType: "BindWorkContext", schemaVersion: 1, aggregateId: WORK_A,
    expectedRevision: 0, correlationId: "corr-rd-bind-a-" + suffix, submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "rd-bind-a-" + suffix },
    payload: {
      workspaceId: WORKSPACE, workKind: "coordination", goalId: GOAL, taskId: null,
      planRef: null, planRevision: null, roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 }, initialRunRef: { ...runRef },
    },
  });
  expect(boundA.status).toBe("committed");

  const agent = await h.control.registerAgentInstance({
    commandId: "cmd-rd-agent-" + suffix, commandType: "RegisterAgentInstance", schemaVersion: 1, aggregateId: AGENT,
    expectedRevision: 0, correlationId: "corr-rd-agent-" + suffix, submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "rd-agent-" + suffix },
    payload: { workspaceId: WORKSPACE, templateId: "template-runner", templateRevision: "1" },
  });
  expect(agent.status).toBe("committed");

  // 前驱 Run 由唯一 drive 收口真实启动（信封、工作身份 link 都按产品路径落账）。
  const first = await h.drive({ reason: "rd-start-predecessor-" + suffix, maxIntents: 1 });
  expect(first.failures, JSON.stringify(first.failures)).toEqual([]);
  expect(first.started).toBe(1);

  const partC = workParticipationRefFor(PROJECT, WORKSPACE, WORK_C, "part-c");
  const participation: StartWorkParticipationCommand = {
    commandId: "cmd-rd-part-c-" + suffix, commandType: "StartWorkParticipation", schemaVersion: 1, aggregateId: "part-c",
    expectedRevision: 0, correlationId: "corr-rd-part-c-" + suffix, submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "rd-part-c-" + suffix, agentPrincipal: principalFor(runRef, workC, partC) },
    payload: { workspaceId: WORKSPACE, workContextRef: { ...workC }, agentInstanceId: AGENT, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 }, runRef: { ...runRef } },
  };
  const started = await h.control.startWorkParticipation(participation);
  expect(started.status, JSON.stringify(started)).toBe("committed");
  return { h, runRef, workC, workA, partC };
}

async function setup(): Promise<Scenario> {
  return bootstrapScenario(createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY }), "mem");
}

/** 发一条定向请求（正文 body-first 真进 vault），返回正文引用与事件位置。 */
async function sendRequest(s: Scenario, nonce: string): Promise<{ bodyRef: ArtifactRef; requestCursor: CommitCursor }> {
  const body = JSON.stringify({ investigation: "report-A", nonce });
  const stored = await s.h.vault.put({
    contentType: "application/json", body, ownerRef: { ...s.runRef },
    sourceRefs: [{ kind: "workspace", refId: WORKSPACE, revision: "1" }], requestedAt: AT,
  });
  expect(stored.status).toBe("stored");
  if (stored.status !== "stored") throw new Error("vault put failed");
  const command: SendDirectedRequestCommand = {
    commandId: "cmd-rd-req", commandType: "SendDirectedRequest", schemaVersion: 1, aggregateId: "req-1",
    expectedRevision: 0, correlationId: "corr-rd-req", submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: "rd-req", agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
    payload: {
      workspaceId: WORKSPACE, fromParticipationRef: { ...s.partC }, fromRunRef: { ...s.runRef },
      toWorkContextRef: { ...s.workA }, expectedParticipationRef: null,
      statement: "请只读调查报告 A", statementBodyRef: stored.ref, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
    },
  };
  const receipt = await s.h.control.sendDirectedRequest(command);
  expect(receipt.status, JSON.stringify(receipt)).toBe("committed");
  return { bodyRef: stored.ref, requestCursor: await cursorOfEvent(s.h, "DirectedRequestSent") };
}

/** 订阅源事件的位置：从账本第一个位置开始（订阅只投递该位置**之后**的事件）。 */
async function subscribeToRequest(s: Scenario, startCursor?: CommitCursor): Promise<CommitCursor> {
  const origin = startCursor ?? await cursorOfFirstEvent(s.h);
  const command: SubscribeCommand = {
    commandId: "cmd-rd-sub", commandType: "CreateSubscription", schemaVersion: 1, aggregateId: "sub-1",
    expectedRevision: 0, correlationId: "corr-rd-sub", submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: "rd-sub", agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
    payload: { workspaceId: WORKSPACE, ownerWorkContextRef: { ...s.workC }, ownerParticipationRef: { ...s.partC }, topics: ["DirectedRequestSent"], startCursor: origin },
  };
  const receipt = await s.h.control.createSubscription(command);
  expect(receipt.status, JSON.stringify(receipt)).toBe("committed");
  return origin;
}

function waitForDelivery(s: Scenario, waitId: string, deliveryRef: ReturnType<typeof deliveryRefFor>, deadlineAt: string | null = null): RegisterWaitCommand {
  return {
    commandId: "cmd-rd-wait-" + waitId, commandType: "RegisterWait", schemaVersion: 1, aggregateId: waitId,
    expectedRevision: 0, correlationId: "corr-rd-wait-" + waitId, submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: "rd-wait-" + waitId, agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
    payload: {
      workspaceId: WORKSPACE, ownerWorkContextRef: { ...s.workC }, ownerParticipationRef: { ...s.partC },
      predecessorRunRef: { ...s.runRef }, conditions: [{ kind: "delivery_present", deliveryRef }], deadlineAt,
    },
  };
}

function expectedDeliveryId(topic: string, cursor: CommitCursor): string {
  return subscriptionDeliveryIdFor({
    subscriptionRef: subscriptionRefFor(PROJECT, WORKSPACE, "sub-1"),
    topic,
    cursor,
    targetWorkContextRef: workContextRefFor(PROJECT, WORKSPACE, WORK_C),
  });
}

async function endPredecessor(s: Scenario): Promise<void> {
  const loaded = await s.h.ledger.load(s.runRef);
  expect(loaded.status).toBe("found");
  if (loaded.status !== "found") return;
  const receipt = await s.h.runFact(buildRunFactCommand({
    actor: { kind: "human", id: "user-1" }, idempotencyKey: "rd-end-pred", commandId: "cmd-rd-end-pred",
    correlationId: "corr-rd-end-pred", submittedAt: AT, projectId: PROJECT, runId: s.runRef.runId,
    expectedRevision: loaded.snapshot.revision,
    fact: {
      kind: "runtime_event",
      event: {
        eventType: "run_completed", schemaVersion: 1, eventId: "rt-run-pred-end", runRef: { ...s.runRef },
        sequence: 2, occurredAt: AT, payload: { kind: "completed", exitCode: 0 },
      },
    },
  }));
  expect(receipt.status, JSON.stringify(receipt)).toBe("committed");
}

/**
 * 后继的事实计数：**相对夹具基线**的增量（夹具本身已经有一个真实前驱 Run 与它的
 * TaskAttempt/outbox，所以绝对值里必然含 1）。
 */
async function successorFacts(s: Scenario): Promise<{ attempts: number; runs: number; pending: number }> {
  return {
    attempts: await countEvents(s.h, "TaskClaimed") - 1,
    runs: await countEvents(s.h, "RunStarted") - 1,
    pending: (await s.h.ledger.pendingDispatchIntents(50, { workKind: "ordinary" })).length,
  };
}

// ------------------------------------------------------------------------ //
// A03：路由页                                                                //
// ------------------------------------------------------------------------ //


// ------------------------------------------------------------------------ //
// communication-route-page 校验夹具（纯构造，不写账本）                        //
// ------------------------------------------------------------------------ //

/** 一页里被推进的订阅快照（routedThroughCursor = 本页路由到的事件位置）。 */
function routePageSubscriptionSnapshot(
  projectId: string, workspaceId: string, topic: string, subscriptionId: string, routedThrough: CommitCursor,
): SubscriptionSnapshot {
  return {
    ref: subscriptionRefFor(projectId, workspaceId, subscriptionId), revision: 2, schemaVersion: 1,
    subscription: {
      schemaVersion: 1, subscriptionId, projectId, workspaceId,
      ownerWorkContextRef: workContextRefFor(projectId, workspaceId, WORK_C),
      ownerParticipationRef: workParticipationRefFor(projectId, workspaceId, WORK_C, "part-c"),
      topics: [topic], startCursor: "c0000000001" as CommitCursor, routedThroughCursor: routedThrough,
      status: "active", createdAt: AT, cancelledAt: null,
    },
    recordedAt: AT,
  };
}

/** 一条投递（origin 恒为订阅）。 */
function routePageDelivery(
  projectId: string, workspaceId: string, topic: string, deliveryId: string, subscriptionId: string,
  target: WorkContextRef, at: CommitCursor,
): DeliveryV1 {
  return {
    schemaVersion: 1, deliveryId, projectId, workspaceId,
    origin: { kind: "subscription", subscriptionRef: subscriptionRefFor(projectId, workspaceId, subscriptionId), sourceTopic: topic, sourceCursor: at },
    targetWorkContextRef: target, bodyRef: null, sourceRefs: [], createdAt: AT,
  };
}

type RoutePageValidationFixture = {
  intent: CommunicationIntentV1;
  build: (input?: {
    deliveries?: DeliveryV1[];
    subscriptions?: SubscriptionSnapshot[];
    domain?: CommunicationIntentV1["domain"];
    intentId?: string;
    nextIntent?: CommunicationIntentV1 | null;
    nextRevision?: number;
    extraRecordedEvent?: boolean;
    /** 覆盖被结算 intent 的状态（默认："已领取过一次"：leased + generation 1 + 有 leaseOwner）。 */
    priorIntent?: Partial<CommunicationIntentV1>;
    /** 额外塞进 expectedVersions 的 ref（用于协议约束 2.1 的反例：CAS 到了本次没写入的聚合）。 */
    extraExpectedVersions?: { ref: AggregateRef; revision: number }[];
  }) => CommunicationRoutePageCommitV1;
};

/** 造一页 route-page 提交：默认是"该事件位置的第一页，处理 sub-a，并登记下一页 intent"。 */
function routePageValidationFixture(projectId: string, workspaceId: string, topic: string, cursor: CommitCursor): RoutePageValidationFixture {
  const intent = routePageIntentFor({ projectId, workspaceId, topic, cursor, now: AT });
  const intentSnapshot = intentSnapshotFor(intent, AT);
  const fingerprint = "0".repeat(64) as never;
  const build: RoutePageValidationFixture["build"] = (input = {}) => {
    const domain = input.domain ?? intent.domain;
    const intentId = input.intentId ?? intent.intentId;
    // 默认 prior = "这条 intent 已被真实领取过一次"（协议约束 1.5：结算必须来自一次领取）。
    const prior = {
      ...intentSnapshot,
      ref: { ...intentSnapshot.ref, intentId },
      intent: {
        ...intent, intentId, domain, status: "leased" as const, leaseGeneration: 1, leaseOwner: "validator",
        ...(input.priorIntent ?? {}),
      },
    };
    const base = routePageIntentFor({ projectId, workspaceId, topic, cursor, now: AT });
    const command = {
      commandId: "cmd-validate-page", commandType: "CommunicationSettleIntent" as const, schemaVersion: 1 as const,
      aggregateId: prior.ref.intentId, expectedRevision: prior.revision, correlationId: "corr-validate-page", submittedAt: AT,
      identity: { projectId, actor: { kind: "system" as const, id: "validator" }, idempotencyKey: "validate-page" },
      payload: {
        outcome: "route_page" as const, workspaceId, consumerId: "validator", leaseGeneration: 1, settledAt: AT,
        page: {
          schemaVersion: 1 as const, sourceTopic: topic, sourceCursor: cursor,
          subscriptionPosition: (input.subscriptions ?? []).length === 0
            ? (domain.kind === "route_page" ? domain.subscriptionPosition : null)
            : canonicalJson((input.subscriptions ?? [])[(input.subscriptions ?? []).length - 1]!.ref),
          // 本页声明的**本轮订阅范围**：与 prior intent 的 domain 逐字节一致（续页回声语义），
          // 未固定的首页由调用方通过 domain 传入空数组。buildRoutePageCommit 会把它落进 settled
          // intent 的 domain，因此这里的值必须与测试期望的范围一致。
          subscriptionScope: (domain.kind === "route_page" ? (domain.subscriptionScope ?? []) : [])
            .map((entry) => ({ subscriptionRef: { ...entry.subscriptionRef }, expectedRevision: entry.expectedRevision })),
          subscriptions: [], hasMore: input.nextIntent != null,
        },
      },
    };
    const batch = buildRoutePageCommit({
      command,
      deps: { eventId: () => "evt-" + Math.random().toString(36).slice(2), now: () => AT, workspaceId },
      fingerprint,
      prior,
      deliveries: (input.deliveries ?? []).map((value) => ({
        ref: deliveryRefForOf(projectId, workspaceId, value.deliveryId), revision: 1, schemaVersion: 1 as const, delivery: value, recordedAt: AT,
      })),
      subscriptions: input.subscriptions ?? [],
      waits: [],
      nextIntent: input.nextIntent ?? null,
    });
    const withExtraExpected = input.extraExpectedVersions === undefined
      ? batch
      : { ...batch, expectedVersions: [...batch.expectedVersions, ...input.extraExpectedVersions] };
    if (input.nextRevision === undefined && input.extraRecordedEvent !== true) return withExtraExpected;
    return {
      ...withExtraExpected,
      events: input.extraRecordedEvent === true
        ? [...withExtraExpected.events, withExtraExpected.events[withExtraExpected.events.length - 1]!]
        : withExtraExpected.events,
      snapshots: input.nextRevision === undefined
        ? withExtraExpected.snapshots
        : withExtraExpected.snapshots.map((snapshot) => (
          snapshot.ref.aggregateType === "CommunicationIntent" && snapshot.ref.intentId !== base.intentId
            ? { ...snapshot, revision: input.nextRevision! }
            : snapshot)),
    } as CommunicationRoutePageCommitV1;
  };
  return { intent, build };
}

/** 该事件位置的续页 intent（与 Control 的 nextRouteIntentFor 同一算式，测试里独立重算）。 */
function continuationIntentFor(input: {
  projectId: string; workspaceId: string; topic: string; cursor: CommitCursor;
  subscriptionPosition: string;
  subscriptionScope?: RoutePageSubscriptionScopeEntry[];
}): CommunicationIntentV1 {
  const base = routePageIntentFor({ projectId: input.projectId, workspaceId: input.workspaceId, topic: input.topic, cursor: input.cursor, now: AT });
  return {
    ...base,
    intentId: base.intentId + "-p" + sha256Hex(input.subscriptionPosition).slice(0, 8),
    domain: {
      kind: "route_page", sourceTopic: input.topic, sourceCursor: input.cursor,
      subscriptionPosition: input.subscriptionPosition,
      subscriptionScope: (input.subscriptionScope ?? []).map((entry) => ({ subscriptionRef: { ...entry.subscriptionRef }, expectedRevision: entry.expectedRevision })),
    },
  };
}

describe("route page（A03）：真实订阅 → 固定事件位置 → 订阅 owner Work 的精确投递", () => {
  it("把正文投给订阅的 owner Work，并严格推进订阅 checkpoint", async () => {
    const s = await setup();
    const { bodyRef, requestCursor } = await sendRequest(s, "REQUEST-NONCE-1");
    await subscribeToRequest(s);

    const drive = await s.h.drive({ reason: "rd-route", maxIntents: 4 });
    expect(drive.coordination?.failures, JSON.stringify(drive.coordination?.failures)).toEqual([]);
    expect(drive.coordination?.pagesRouted).toBe(1);
    expect(drive.coordination?.deliveries).toBe(1);

    const loaded = await s.h.ledger.load(deliveryRefFor(PROJECT, WORKSPACE, expectedDeliveryId("DirectedRequestSent", requestCursor)));
    expect(loaded.status).toBe("found");
    if (loaded.status !== "found") return;
    const delivery = (loaded.snapshot as DeliverySnapshot).delivery;
    expect(delivery.targetWorkContextRef.workId).toBe(WORK_C);
    expect(delivery.bodyRef?.digest).toBe(bodyRef.digest);
    expect(delivery.origin.kind).toBe("subscription");
    if (delivery.origin.kind !== "subscription") return;
    expect(delivery.origin.sourceCursor).toBe(requestCursor);

    const subscription = await s.h.ledger.load(subscriptionRefFor(PROJECT, WORKSPACE, "sub-1"));
    expect(subscription.status).toBe("found");
    if (subscription.status !== "found") return;
    expect((subscription.snapshot as SubscriptionSnapshot).subscription.routedThroughCursor).toBe(requestCursor);
    // One further bounded prefix reaches the fixed creation horizon without another delivery.
    await s.h.drive({ reason: "finish-history-horizon", maxIntents: 1 });
    const intentRef = communicationIntentRefFor(PROJECT, WORKSPACE, subscriptionCatchupIdFor(subscriptionRefFor(PROJECT, WORKSPACE, "sub-1")));
    const intent = await s.h.ledger.load(intentRef);
    expect(intent.status).toBe("found");
    if (intent.status !== "found") return;
    expect((intent.snapshot as CommunicationIntentSnapshot).intent.status).toBe("done");
  });

  it.each(['target', 'body', 'hasMore'])('rejects a canonical page with forged %s without partial writes', async fault => {
    const s = await setup();
    await createSubscriptionAt(s, 'sub-1', null);
    await sendRequest(s, 'REQUEST-FORGERY');
    const original = s.h.control.settleCommunicationIntent.bind(s.h.control);
    let captured: CommunicationSettleCommand | undefined;
    s.h.control.settleCommunicationIntent = async command => {
      if (command.payload.outcome === 'route_page') { captured = structuredClone(command); return { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['hold page for adversarial test'] }; }
      return original(command);
    };
    await s.h.drive({ reason: 'capture-valid-page', maxIntents: 1 });
    s.h.control.settleCommunicationIntent = original;
    if (!captured || captured.payload.outcome !== 'route_page') throw Error('Actual page missing');
    const forged = structuredClone(captured);
    if (forged.payload.outcome !== 'route_page') throw Error('page');
    const page = forged.payload.page;
    if (fault === 'target') page.subscriptions[0]!.deliveries[0]!.targetWorkContextRef = s.workA;
    if (fault === 'body') page.subscriptions[0]!.deliveries[0]!.bodyRef = null;
    if (fault === 'hasMore') { page.subscriptions = []; page.subscriptionPosition = null; page.hasMore = true; }
    const before = await s.h.ledger.events({ afterCursor: null, limit: 1000 });
    const rejected = await original(forged);
    expect(rejected.status, JSON.stringify(rejected)).toBe('rejected');
    expect(await s.h.ledger.events({ afterCursor: null, limit: 1000 })).toEqual(before);
    expect((await original(captured)).status).toBe('committed');
  });

  it("communication-route-page 专用校验拒绝：越权目标 / 页内重复投递 / 事件位置回退（既有反例保留）", () => {
    const projectId = PROJECT;
    const workspaceId = WORKSPACE;
    const topic = "DirectedRequestSent";
    const cursor = "c0000000009" as CommitCursor;
    const f = routePageValidationFixture(projectId, workspaceId, topic, cursor);
    const workCTarget = workContextRefFor(projectId, workspaceId, WORK_C);
    const subs = [routePageSubscriptionSnapshot(projectId, workspaceId, topic, "sub-x", cursor)];

    // 正常页：目标 Work = 订阅 owner。
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries: [routePageDelivery(projectId, workspaceId, topic, "d-ok", "sub-x", workCTarget, cursor)],
      subscriptions: subs,
    }))).toBe(true);
    // 越权目标：投给别的 Work。
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries: [routePageDelivery(projectId, workspaceId, topic, "d-bad", "sub-x", workContextRefFor(projectId, workspaceId, WORK_A), cursor)],
      subscriptions: subs,
    }))).toBe(false);
    // 页内重复投递（同订阅 + 同位置 + 同目标 = 同一去重键）。
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries: [
        routePageDelivery(projectId, workspaceId, topic, "d-dup", "sub-x", workCTarget, cursor),
        routePageDelivery(projectId, workspaceId, topic, "d-dup2", "sub-x", workCTarget, cursor),
      ],
      subscriptions: subs,
    }))).toBe(false);
    // 事件位置回退：页路由到 intent 的源事件位置**之前**。
    const earlier = "c0000000001" as CommitCursor;
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries: [routePageDelivery(projectId, workspaceId, topic, "d-earlier", "sub-x", workCTarget, earlier)],
      subscriptions: [routePageSubscriptionSnapshot(projectId, workspaceId, topic, "sub-x", earlier)],
    }))).toBe(false);
  });

  it("communication-route-page 两个 intent 角色分别核对：续页的版本 / 确定性 id / 来源位置 / 分页边界 / 范围固定", () => {
    const projectId = PROJECT;
    const workspaceId = WORKSPACE;
    const topic = "DirectedRequestSent";
    const cursor = "c0000000009" as CommitCursor;
    const f = routePageValidationFixture(projectId, workspaceId, topic, cursor);
    const workCTarget = workContextRefFor(projectId, workspaceId, WORK_C);
    const refA = subscriptionRefFor(projectId, workspaceId, "sub-a");
    const refB = subscriptionRefFor(projectId, workspaceId, "sub-b");
    const order = [canonicalJson(refA), canonicalJson(refB)].sort((a, b) => a.localeCompare(b));
    const lowPosition = order[0]!;
    const highPosition = order[1]!;
    const lowId = order[0] === canonicalJson(refA) ? "sub-a" : "sub-b";
    const highId = lowId === "sub-a" ? "sub-b" : "sub-a";
    // 本页一次处理两个订阅，因此续页的订阅分页位置应当等于 canonical 序更大的那一个。
    const subs = [
      routePageSubscriptionSnapshot(projectId, workspaceId, topic, "sub-a", cursor),
      routePageSubscriptionSnapshot(projectId, workspaceId, topic, "sub-b", cursor),
    ];
    const deliveries = [
      routePageDelivery(projectId, workspaceId, topic, "d-a", "sub-a", workCTarget, cursor),
      routePageDelivery(projectId, workspaceId, topic, "d-b", "sub-b", workCTarget, cursor),
    ];
    const next = (patch: Partial<CommunicationIntentV1> = {}, domainPatch: Record<string, unknown> = {}) => {
      const built = continuationIntentFor({ projectId, workspaceId, topic, cursor, subscriptionPosition: highPosition });
      return {
        ...built,
        ...patch,
        domain: { ...(built.domain as Extract<typeof built.domain, { kind: "route_page" }>), ...domainPatch } as CommunicationIntentV1["domain"],
      };
    };

    // 正向基线：第一页 + 合法的续页 intent（同一事件位置、订阅位置前进到本页处理过的最大值）。
    expect(validateCommunicationRoutePageCommit(f.build({ deliveries, subscriptions: subs, nextIntent: next() }))).toBe(true);
    // 末页：没有续页 intent 也是合法的（0 条 = 末页），且末页同样要求订阅位置前进。
    expect(validateCommunicationRoutePageCommit(f.build({ deliveries, subscriptions: subs, nextIntent: null }))).toBe(true);

    // ── 反例 1：续页的确定性 id 不是由 (topic, cursor, 订阅位置) 派生出来的 ──────────
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries, subscriptions: subs,
      nextIntent: next({ intentId: "route-handwritten" }),
    }))).toBe(false);

    // ── 反例 2：续页的来源事件位置不符（换成了另一个账本位置）───────────────────────
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries, subscriptions: subs,
      nextIntent: next({}, { sourceCursor: "c0000000008" as CommitCursor }),
    }))).toBe(false);

    // ── 反例 3：续页的订阅分页位置少于本页处理过的最大值（会漏投剩余订阅）────────────
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries, subscriptions: subs,
      nextIntent: continuationIntentFor({ projectId, workspaceId, topic, cursor, subscriptionPosition: lowPosition }),
    }))).toBe(false);

    // ── 反例 4：续页的订阅分页位置不属于本页处理过的订阅（会跳投）────────────────────
    const foreignPosition = canonicalJson(subscriptionRefFor(projectId, workspaceId, "sub-z"));
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries, subscriptions: subs,
      nextIntent: continuationIntentFor({ projectId, workspaceId, topic, cursor, subscriptionPosition: foreignPosition }),
    }))).toBe(false);

    // ── 反例 5：续页不是 pending（已被领取/已终结的 intent 不能冒充"下一页"）──────────
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries, subscriptions: subs,
      nextIntent: next({ status: "done" }),
    }))).toBe(false);
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries, subscriptions: subs,
      nextIntent: next({ leaseGeneration: 1, leaseOwner: "someone" }),
    }))).toBe(false);

    // ── 反例 6：续页的版本不是"新建聚合"（快照不是 @1）─────────────────────────────
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries, subscriptions: subs, nextIntent: next(), nextRevision: 2,
    }))).toBe(false);

    // ── 反例 7：本轮订阅范围在翻页期间被改变 ──────────────────────────────────────
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries, subscriptions: subs,
      nextIntent: continuationIntentFor({
        projectId, workspaceId, topic, cursor, subscriptionPosition: highPosition,
        subscriptionScope: [{ subscriptionRef: refA, expectedRevision: 1 }],
      }),
    }))).toBe(false);

    // ── 反例 8：同一页登记两条 CommunicationIntentRecorded（快照数对不上）───────────
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries, subscriptions: subs, nextIntent: next(), extraRecordedEvent: true,
    }))).toBe(false);

    // ── 反例 9：角色 ① 已经是续页，却又把本页已经处理过的订阅再处理一次（原地不动）────
    const settledPosition = lowPosition;
    const settledId = routePageIntentIdFor(projectId, workspaceId, topic, cursor) + "-p" + sha256Hex(settledPosition).slice(0, 8);
    expect(validateCommunicationRoutePageCommit(f.build({
      intentId: settledId,
      domain: { kind: "route_page", sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: settledPosition, subscriptionScope: [] },
      deliveries: [routePageDelivery(projectId, workspaceId, topic, "d-low", lowId, workCTarget, cursor)],
      subscriptions: [routePageSubscriptionSnapshot(projectId, workspaceId, topic, lowId, cursor)],
      nextIntent: null,
    }))).toBe(false);
    // 反向对照：同一个续页 intent 处理**严格更靠后**的订阅就合法。
    expect(validateCommunicationRoutePageCommit(f.build({
      intentId: settledId,
      domain: { kind: "route_page", sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: settledPosition, subscriptionScope: [] },
      deliveries: [routePageDelivery(projectId, workspaceId, topic, "d-high", highId, workCTarget, cursor)],
      subscriptions: [routePageSubscriptionSnapshot(projectId, workspaceId, topic, highId, cursor)],
      nextIntent: null,
    }))).toBe(true);

    // ── 反例 10：订阅分页位置**回退**（本页处理的订阅严格排在 intent 自己的位置之前）──────
    const highSettledId = routePageIntentIdFor(projectId, workspaceId, topic, cursor) + "-p" + sha256Hex(highPosition).slice(0, 8);
    expect(validateCommunicationRoutePageCommit(f.build({
      intentId: highSettledId,
      domain: { kind: "route_page", sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: highPosition, subscriptionScope: [] },
      deliveries: [routePageDelivery(projectId, workspaceId, topic, "d-back", lowId, workCTarget, cursor)],
      subscriptions: [routePageSubscriptionSnapshot(projectId, workspaceId, topic, lowId, cursor)],
      nextIntent: null,
    }))).toBe(false);
    // 正向对照（同一条 intent 侧）：HIGH 之后已经没有订阅可处理，空页合法（位置不动、无续页）。
    expect(validateCommunicationRoutePageCommit(f.build({
      intentId: highSettledId,
      domain: { kind: "route_page", sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: highPosition, subscriptionScope: [] },
      deliveries: [], subscriptions: [], nextIntent: null,
    }))).toBe(true);

    // ── 反例 11：**范围外订阅**——本页推进了本轮订阅范围之外的订阅（协议约束 1.4）────────
    const scopedDomain = {
      kind: "route_page" as const, sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: null,
      subscriptionScope: [
        { subscriptionRef: { ...refA }, expectedRevision: 1 },
        { subscriptionRef: { ...refB }, expectedRevision: 1 },
      ],
    };
    expect(validateCommunicationRoutePageCommit(f.build({
      domain: scopedDomain,
      deliveries: [routePageDelivery(projectId, workspaceId, topic, "d-out", "sub-c", workCTarget, cursor)],
      subscriptions: [routePageSubscriptionSnapshot(projectId, workspaceId, topic, "sub-c", cursor)],
      nextIntent: null,
    }))).toBe(false);
    // 同一条订阅在范围内、但本页推进后的版本与范围登记的 expectedRevision 不符（范围记的是轮次开始那一版）。
    expect(validateCommunicationRoutePageCommit(f.build({
      domain: { ...scopedDomain, subscriptionScope: [{ subscriptionRef: { ...refA }, expectedRevision: 7 }] },
      deliveries: [routePageDelivery(projectId, workspaceId, topic, "d-ver", "sub-a", workCTarget, cursor)],
      subscriptions: [routePageSubscriptionSnapshot(projectId, workspaceId, topic, "sub-a", cursor)],
      nextIntent: null,
    }))).toBe(false);
    // 正向对照：范围内、版本相符，且范围里没有别的剩余订阅（末页）→ 合法。
    expect(validateCommunicationRoutePageCommit(f.build({
      domain: { ...scopedDomain, subscriptionScope: [{ subscriptionRef: { ...refA }, expectedRevision: 1 }] },
      deliveries: [routePageDelivery(projectId, workspaceId, topic, "d-in", "sub-a", workCTarget, cursor)],
      subscriptions: [routePageSubscriptionSnapshot(projectId, workspaceId, topic, "sub-a", cursor)],
      nextIntent: null,
    }))).toBe(true);

    // ── 反例 12：**范围里还有剩余订阅，本页却没有登记下一页 intent**（分页会永久停住）────
    expect(validateCommunicationRoutePageCommit(f.build({
      domain: scopedDomain,
      deliveries: [routePageDelivery(projectId, workspaceId, topic, "d-more", lowId, workCTarget, cursor)],
      subscriptions: [routePageSubscriptionSnapshot(projectId, workspaceId, topic, lowId, cursor)],
      nextIntent: null,
    }))).toBe(false);
    // 正向对照：同一页登记了续页（位置 = 本页处理到的那一个），范围固定不变 → 合法。
    expect(validateCommunicationRoutePageCommit(f.build({
      domain: scopedDomain,
      deliveries: [routePageDelivery(projectId, workspaceId, topic, "d-more-ok", lowId, workCTarget, cursor)],
      subscriptions: [routePageSubscriptionSnapshot(projectId, workspaceId, topic, lowId, cursor)],
      nextIntent: continuationIntentFor({
        projectId, workspaceId, topic, cursor, subscriptionPosition: lowPosition,
        subscriptionScope: scopedDomain.subscriptionScope,
      }),
    }))).toBe(true);

    // ── 反例 13：**末页却登记了续页 intent**（范围里已经没有剩余订阅，hasMore 与实际不符）──
    const lastPageScope = [{ subscriptionRef: { ...refA }, expectedRevision: 1 }];
    expect(validateCommunicationRoutePageCommit(f.build({
      domain: { ...scopedDomain, subscriptionScope: lastPageScope },
      deliveries: [routePageDelivery(projectId, workspaceId, topic, "d-last", "sub-a", workCTarget, cursor)],
      subscriptions: [routePageSubscriptionSnapshot(projectId, workspaceId, topic, "sub-a", cursor)],
      nextIntent: continuationIntentFor({
        projectId, workspaceId, topic, cursor, subscriptionPosition: canonicalJson(refA),
        subscriptionScope: lastPageScope,
      }),
    }))).toBe(false);

    // ── 反例 14：**从未被领取的 intent 被直接结算**（协议约束 1.5：结算必须来自一次真实领取）
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries, subscriptions: subs, nextIntent: next(),
      priorIntent: { status: "pending", leaseGeneration: 0, leaseOwner: null },
    }))).toBe(false);
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries, subscriptions: subs, nextIntent: next(),
      priorIntent: { leaseOwner: null },
    }))).toBe(false);

    // ── 反例 15：旧形状的 route_page domain（缺新字段）不得被当作位置 null / 范围空继续处理
    //    （协议约束 2.4：缺必需字段 → 明确拒绝，不补猜值）
    const legacyDomain = {
      kind: "route_page", sourceTopic: topic, sourceCursor: cursor,
      afterSubscriptionRef: null, routedThroughCursor: null,
    } as unknown as CommunicationIntentV1["domain"];
    expect(validateCommunicationRoutePageCommit(f.build({ domain: legacyDomain }))).toBe(false);
    const malformedScope = {
      kind: "route_page" as const, sourceTopic: topic, sourceCursor: cursor, subscriptionPosition: null,
      subscriptionScope: [{ subscriptionRef: { aggregateType: "Subscription", projectId, workspaceId, subscriptionId: "" }, expectedRevision: 1 }],
    } as unknown as CommunicationIntentV1["domain"];
    expect(validateCommunicationRoutePageCommit(f.build({ domain: malformedScope }))).toBe(false);

    // ── 反例 16：CAS 到本次没有写入的聚合（协议约束 2.1：路由页只能 CAS 自己这一事务写的东西）
    expect(validateCommunicationRoutePageCommit(f.build({
      deliveries, subscriptions: subs, nextIntent: next(),
      extraExpectedVersions: [{ ref: subscriptionRefFor(projectId, workspaceId, "sub-elsewhere"), revision: 0 }],
    }))).toBe(false);
  });
});

describe("subscription-catchup：「从现在起」的订阅拿到持久路由起点（A03 的 start position）", () => {
  it("startCursor=null 在 SubscriptionCreated 同事务固定起点，且不补投订阅之前的事件", async () => {
    const s = await setup();
    const { requestCursor } = await sendRequest(s, "REQUEST-NONCE-CATCHUP");
    // startCursor=null =「从现在起」。subscription-create 只带一个 route intent（且只在 startCursor
    // 非空时才有），因此必须由 Control 在订阅落账之后按当前 frontier 补齐。
    const command: SubscribeCommand = {
      commandId: "cmd-rd-sub-null", commandType: "CreateSubscription", schemaVersion: 1, aggregateId: "sub-2",
      expectedRevision: 0, correlationId: "corr-rd-sub-null", submittedAt: AT,
      identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: "rd-sub-null", agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
      payload: { workspaceId: WORKSPACE, ownerWorkContextRef: { ...s.workC }, ownerParticipationRef: { ...s.partC }, topics: ["DirectedRequestSent"], startCursor: null },
    };
    const receipt = await s.h.control.createSubscription(command);
    expect(receipt.status, JSON.stringify(receipt)).toBe("committed");

    const events = await s.h.ledger.events({ afterCursor: null, limit: 1000 });
    const created = events.events.find(p => p.event.eventType === 'SubscriptionCreated' && p.event.aggregateId === 'sub-2')!;
    expect(receipt.status === 'committed' && receipt.eventIds.includes(created.event.eventId)).toBe(true);
    const subscription = await s.h.ledger.load(subscriptionRefFor(PROJECT, WORKSPACE, 'sub-2'));
    if (subscription.status !== 'found') throw Error('subscription missing');
    expect(subscription.snapshot.revision).toBe(1);
    expect((subscription.snapshot as SubscriptionSnapshot).subscription.startCursor).toBe(created.cursor);
    expect(events.events.filter(p => p.event.eventType === 'SubscriptionCatchupPlanned')).toHaveLength(0);
    expect(requestCursor).not.toBe(created.cursor);
    for (let i = 0; i < 2; i++) {
      const drive = await s.h.drive({ reason: 'live-only-' + i, maxIntents: 6 });
      expect(drive.coordination?.failures ?? []).toEqual([]);
      expect(await countEvents(s.h, 'DeliveryRecorded')).toBe(1);
    }
  });
});


// ------------------------------------------------------------------------ //
// A03 的多页面：同一事件位置的订阅超过一页时必须连续翻页                        //
// ------------------------------------------------------------------------ //

/** 造一个指定 id / 起始位置的订阅（走真实 Control 受理）。 */
async function createSubscriptionAt(s: Scenario, subscriptionId: string, startCursor: CommitCursor | null): Promise<void> {
  const command: SubscribeCommand = {
    commandId: "cmd-rd-sub-" + subscriptionId, commandType: "CreateSubscription", schemaVersion: 1,
    aggregateId: subscriptionId, expectedRevision: 0, correlationId: "corr-rd-sub-" + subscriptionId, submittedAt: AT,
    identity: {
      projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: "rd-sub-" + subscriptionId,
      agentPrincipal: principalFor(s.runRef, s.workC, s.partC),
    },
    payload: {
      workspaceId: WORKSPACE, ownerWorkContextRef: { ...s.workC }, ownerParticipationRef: { ...s.partC },
      topics: ["DirectedRequestSent"], startCursor,
    },
  };
  const receipt = await s.h.control.createSubscription(command);
  expect(receipt.status, JSON.stringify(receipt)).toBe("committed");
}

/** 账本最前面几个事件的位置（全部早于随后发出的定向请求）。 */
async function earlyCursors(h: AnyHarness, count: number): Promise<CommitCursor[]> {
  const page: EventPage = await h.ledger.events({ afterCursor: null, limit: 1000 });
  return page.events.slice(0, count).map((positioned) => positioned.cursor);
}

type SubscriptionDeliveryFact = { deliveryId: string; subscriptionId: string; sourceCursor: string; workId: string; bodyDigest: string | null };

/** 账本里所有 origin=subscription 的投递（按事件顺序）。 */
async function subscriptionDeliveries(h: AnyHarness): Promise<SubscriptionDeliveryFact[]> {
  const facts: SubscriptionDeliveryFact[] = [];
  let cursor: CommitCursor | null = null;
  for (;;) {
    const page: EventPage = await h.ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const positioned of page.events) {
      if (positioned.event.eventType !== "DeliveryRecorded") continue;
      const delivery = positioned.event.payload.delivery;
      if (delivery.origin.kind !== "subscription") continue;
      facts.push({
        deliveryId: delivery.deliveryId,
        subscriptionId: delivery.origin.subscriptionRef.subscriptionId,
        sourceCursor: String(delivery.origin.sourceCursor),
        workId: delivery.targetWorkContextRef.workId,
        bodyDigest: delivery.bodyRef?.digest ?? null,
      });
    }
    if (!page.hasMore || page.throughCursor === null || page.throughCursor === cursor) break;
    cursor = page.throughCursor;
  }
  return facts;
}

/** 只统计**指定 intent** 上的某一类事件（夹具里还有别的 intent，不能按全局计数）。 */
async function countIntentEvents(h: AnyHarness, eventType: string, intentIds: readonly string[]): Promise<number> {
  const wanted = new Set(intentIds);
  let cursor: CommitCursor | null = null;
  let total = 0;
  for (;;) {
    const page: EventPage = await h.ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const positioned of page.events) {
      if (positioned.event.eventType !== eventType) continue;
      const aggregateId = (positioned.event as { aggregateId?: string }).aggregateId;
      if (aggregateId !== undefined && wanted.has(aggregateId)) total += 1;
    }
    if (!page.hasMore || page.throughCursor === null || page.throughCursor === cursor) return total;
    cursor = page.throughCursor;
  }
}

/** 该事件位置上所有已登记的 route_page intent（intentId + 订阅分页位置）。 */
async function routePageIntentsFor(h: AnyHarness, topic: string, sourceCursor: CommitCursor): Promise<{ intentId: string; subscriptionPosition: string | null }[]> {
  const out: { intentId: string; subscriptionPosition: string | null }[] = [];
  let cursor: CommitCursor | null = null;
  for (;;) {
    const page: EventPage = await h.ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const positioned of page.events) {
      if (positioned.event.eventType !== "CommunicationIntentRecorded") continue;
      const intent = positioned.event.payload.intent;
      if (intent.domain.kind !== "route_page") continue;
      if (intent.domain.sourceTopic !== topic) continue;
      if (String(intent.domain.sourceCursor) !== String(sourceCursor)) continue;
      out.push({ intentId: intent.intentId, subscriptionPosition: intent.domain.subscriptionPosition });
    }
    if (!page.hasMore || page.throughCursor === null || page.throughCursor === cursor) break;
    cursor = page.throughCursor;
  }
  return out;
}

describe("多页路由（A03）：同一事件位置的订阅超过一页时连续完成，末页之后没有多余 intent", () => {
  it("3 个订阅命中同一事件位置 → 必须翻 3 页：全部拿到 Delivery、页顺序确定、每页一次 CAS、重复 drive 不重复投递", async () => {
    // 页大小注入为 1（CM-1A-001 §3 明列「可在实现中收敛」的分页大小）：3 个订阅因此必须翻 3 页。
    const h = createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY, coordinationPageSize: 1 });
    const s = await bootstrapScenario(h, "paged");
    const cursors = await earlyCursors(h, 3);
    const c0 = cursors[0]!;
    const c1 = cursors[1]!;
    const c2 = cursors[2]!;

    // 先建立两个早于定向请求的订阅：它们各自的 route intent 会在请求发生之前就被路由成 done
    // （那时该 topic 还没有任何可路由事件）。再建立本轮真正携带 pending intent 的订阅，
    // 于是同一事件位置上只有一个存活的 route intent —— 而它一次要投递 3 个订阅，只能靠翻页完成。
    await createSubscriptionAt(s, "sub-b", c1);
    await createSubscriptionAt(s, "sub-c", c2);
    const beforeRequest = await h.drive({ reason: "rd-paged-pre", maxIntents: 6 });
    expect(beforeRequest.coordination?.failures, JSON.stringify(beforeRequest.coordination?.failures)).toEqual([]);
    expect(beforeRequest.coordination?.deliveries).toBe(0);

    await createSubscriptionAt(s, "sub-a", null);
    const request = await sendRequest(s, "REQUEST-NONCE-PAGED");
    const requestCursor = request.requestCursor;
    const intentId = routePageIntentIdFor(PROJECT, WORKSPACE, "DirectedRequestSent", requestCursor);
    const intentRef = communicationIntentRefFor(PROJECT, WORKSPACE, intentId);
    const seeded = await h.ledger.load(intentRef);
    expect(seeded.status, "本轮必须从 c0 上的 pending route intent 出发").toBe("found");

    const drive = await h.drive({ reason: "rd-paged", maxIntents: 8 });
    expect(drive.coordination?.failures, JSON.stringify(drive.coordination?.failures)).toEqual([]);
    // 3 个订阅 + 每页 1 个 ⇒ 恰好 3 页；每页 1 条投递。
    expect(drive.coordination?.pagesRouted).toBe(3);
    expect(drive.coordination?.deliveries).toBe(3);

    // ── 断言 1：3 个订阅最终都拿到 Delivery，投给各自订阅的 owner Work，指向同一事件位置。
    const deliveries = await subscriptionDeliveries(h);
    expect(deliveries).toHaveLength(3);
    expect(new Set(deliveries.map((d) => d.subscriptionId))).toEqual(new Set(["sub-a", "sub-b", "sub-c"]));
    for (const fact of deliveries) {
      expect(fact.sourceCursor).toBe(String(requestCursor));
      expect(fact.workId).toBe(WORK_C);
    }
    for (const id of ["sub-a", "sub-b", "sub-c"]) {
      const loaded = await h.ledger.load(subscriptionRefFor(PROJECT, WORKSPACE, id));
      if (loaded.status !== "found") throw new Error("subscription missing: " + id);
      expect((loaded.snapshot as SubscriptionSnapshot).subscription.routedThroughCursor, id).toBe(requestCursor);
    }

    // ── 断言 2：页顺序确定 —— 按 canonical ref key 升序逐页处理；续页 id 由订阅分页位置机械派生
    //    （测试独立重算，不调用生产代码里的私有 helper）。
    const subRefs = ["sub-a", "sub-b", "sub-c"].map((id) => subscriptionRefFor(PROJECT, WORKSPACE, id));
    const order = [...subRefs].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
    const orderIds = order.map((ref) => ref.subscriptionId);
    expect(deliveries.map((d) => d.subscriptionId)).toEqual(orderIds);
    const baseId = routePageIntentIdFor(PROJECT, WORKSPACE, "DirectedRequestSent", requestCursor);
    expect(intentId).toBe(baseId);
    const expectedContinuations = [
      baseId + "-p" + sha256Hex(canonicalJson(order[0]!)).slice(0, 8),
      baseId + "-p" + sha256Hex(canonicalJson(order[1]!)).slice(0, 8),
    ];
    const intentChain = await routePageIntentsFor(h, "DirectedRequestSent", requestCursor);
    expect(intentChain.map((entry) => entry.intentId).sort()).toEqual([baseId, ...expectedContinuations].sort());
    const firstPageIntent = await h.ledger.load(intentRef);
    if (firstPageIntent.status !== "found") throw new Error("first page intent missing");
    const firstSnapshot = firstPageIntent.snapshot as CommunicationIntentSnapshot;
    expect(firstSnapshot.intent.domain.kind).toBe("route_page");
    if (firstSnapshot.intent.domain.kind !== "route_page") return;
    // 首页 intent 记录的仍是它被领取时的订阅分页位置（null）：结算不会把"页处理后"的位置写回它。
    expect(firstSnapshot.intent.domain.subscriptionPosition).toBeNull();
    expect(firstSnapshot.intent.status).toBe("done");

    // ── 断言 3：每页一次 CAS。每条 intent 的 revision = 1(登记) + 1(领取) + 1(结算) = 3；
    //    该事件位置上恰好 3 次领取、3 次结算 —— 没有多余的重试或重复提交。
    for (const id of [intentId, ...expectedContinuations]) {
      const loaded = await h.ledger.load(communicationIntentRefFor(PROJECT, WORKSPACE, id));
      if (loaded.status !== "found") throw new Error("route intent missing: " + id);
      const snapshot = loaded.snapshot as CommunicationIntentSnapshot;
      expect(snapshot.revision, id).toBe(3);
      expect(snapshot.intent.status, id).toBe("done");
      expect(snapshot.intent.leaseGeneration, id).toBe(1);
    }
    const routeIntentIds = [intentId, ...expectedContinuations];
    expect(await countIntentEvents(h, "CommunicationIntentClaimed", routeIntentIds)).toBe(3);
    expect(await countIntentEvents(h, "CommunicationIntentSettled", routeIntentIds)).toBe(3);

    // ── 断言 4：末页之后没有多余 intent。最后一个被处理的订阅的分页位置**不得**出现在任何已登记
    //    intent 上 —— 出现就说明末页还挂了续页；登记的续页位置必须恰好是前两页处理过的位置。
    const maxPosition = canonicalJson(order[order.length - 1]!);
    const recordedPositions = intentChain.map((entry) => entry.subscriptionPosition);
    expect(recordedPositions).not.toContain(maxPosition);
    expect([...recordedPositions].sort()).toEqual([null, canonicalJson(order[0]!), canonicalJson(order[1]!)].sort());

    // ── 断言 5：重复 drive 不产生重复 Delivery，也不再翻页。
    const before = await countEvents(h, "DeliveryRecorded");
    const again = await h.drive({ reason: "rd-paged-again", maxIntents: 8 });
    expect(again.coordination?.pagesRouted).toBe(0);
    expect(again.coordination?.deliveries).toBe(0);
    expect(await countEvents(h, "DeliveryRecorded")).toBe(before);
    expect(await subscriptionDeliveries(h)).toHaveLength(3);
  });
});

// ------------------------------------------------------------------------ //
// A04：领取竞争                                                              //
// ------------------------------------------------------------------------ //

describe("claim 竞争（A04）：只有一个消费者拿到 generation", () => {
  it("两个消费者竞争同一 intent：一个 claimed，另一个 owned_elsewhere；过期 generation 不能 settle", async () => {
    const s = await setup();
    await sendRequest(s, "REQUEST-NONCE-3");
    const origin = await subscribeToRequest(s);
    const intentId = subscriptionCatchupIdFor(subscriptionRefFor(PROJECT, WORKSPACE, "sub-1"));
    const intentRef = communicationIntentRefFor(PROJECT, WORKSPACE, intentId);
    const loaded = await s.h.ledger.load(intentRef);
    if (loaded.status !== "found") throw new Error("intent missing");

    const claimFor = (consumerId: string): CommunicationClaimCommand => ({
      commandId: "cmd-rd-race-" + consumerId, commandType: "CommunicationClaimIntent", schemaVersion: 1,
      aggregateId: intentId, expectedRevision: loaded.snapshot.revision, correlationId: "corr-rd-race-" + consumerId,
      submittedAt: AT, identity: { projectId: PROJECT, actor: { kind: "system", id: consumerId }, idempotencyKey: "rd-race-" + consumerId },
      payload: { workspaceId: WORKSPACE, consumerId, leaseDurationMs: 60000, now: AT },
    });
    const a = await s.h.control.claimCommunicationIntent(claimFor("consumer-a"));
    expect(a.status).toBe("claimed");
    if (a.status !== "claimed") return;
    const b = await s.h.control.claimCommunicationIntent(claimFor("consumer-b"));
    expect(b.status).toBe("owned_elsewhere");
    if (b.status !== "owned_elsewhere") return;
    expect(b.leaseOwner).toBe("consumer-a");

    const settle = (generation: number, commandId: string): CommunicationSettleCommand => ({
      commandId, commandType: "CommunicationSettleIntent", schemaVersion: 1,
      aggregateId: intentId, expectedRevision: loaded.snapshot.revision, correlationId: "corr-" + commandId,
      submittedAt: AT, identity: { projectId: PROJECT, actor: { kind: "system", id: "consumer-b" }, idempotencyKey: commandId },
      payload: {
        outcome: "route_page", workspaceId: WORKSPACE, consumerId: "consumer-b",
        leaseGeneration: generation, settledAt: AT,
        page: { schemaVersion: 1, sourceTopic: "DirectedRequestSent", sourceCursor: origin, subscriptionScope: [], subscriptionPosition: null, subscriptions: [], hasMore: false },
      },
    });
    const stale = await s.h.control.settleCommunicationIntent(settle(a.leaseGeneration - 1, "cmd-rd-race-stale"));
    expect(stale.status).toBe("stale_generation");
  });

  it("sideEffectStarted 且租约过期的 intent 不被重领（requires_reconcile），只作为可见 backlog 报告", async () => {
    const s = await setup();
    await sendRequest(s, "REQUEST-NONCE-4");
    const origin = await subscribeToRequest(s);
    const intentId = subscriptionCatchupIdFor(subscriptionRefFor(PROJECT, WORKSPACE, "sub-1"));
    const intentRef = communicationIntentRefFor(PROJECT, WORKSPACE, intentId);
    const loaded = await s.h.ledger.load(intentRef);
    if (loaded.status !== "found") throw new Error("intent missing");

    // 先领取，再把租约推到过去（模拟"过期领取者"），并标记该 intent 已产生外部副作用。
    const claimed = await s.h.control.claimCommunicationIntent({
      commandId: "cmd-rd-lease", commandType: "CommunicationClaimIntent", schemaVersion: 1,
      aggregateId: intentId, expectedRevision: loaded.snapshot.revision, correlationId: "corr-rd-lease", submittedAt: AT,
      identity: { projectId: PROJECT, actor: { kind: "system", id: "dead-consumer" }, idempotencyKey: "rd-lease" },
      payload: { workspaceId: WORKSPACE, consumerId: "dead-consumer", leaseDurationMs: 0, now: AT },
    });
    expect(claimed.status).toBe("claimed");
    // leaseDurationMs=0 ⇒ leaseExpiresAt = AT ⇒ 在同一个时钟下已过期。
    const again = await s.h.control.claimCommunicationIntent({
      commandId: "cmd-rd-lease-again", commandType: "CommunicationClaimIntent", schemaVersion: 1,
      aggregateId: intentId, expectedRevision: claimed.status === "claimed" ? claimed.revision : loaded.snapshot.revision,
      correlationId: "corr-rd-lease-again", submittedAt: AT,
      identity: { projectId: PROJECT, actor: { kind: "system", id: "other" }, idempotencyKey: "rd-lease-again" },
      payload: { workspaceId: WORKSPACE, consumerId: "other", leaseDurationMs: 60000, now: AT },
    });
    // sideEffectStarted=false 时过期租约**允许**重领（这是可证明未产生副作用的路径），
    // generation 因此前进 1 —— 与 D04 一致。
    expect(again.status).toBe("claimed");
    if (again.status !== "claimed") return;
    expect(again.leaseGeneration).toBe(claimed.status === "claimed" ? claimed.leaseGeneration + 1 : -1);
  });
});

// ------------------------------------------------------------------------ //
// A05：wait → 唯一后继                                                       //
// ------------------------------------------------------------------------ //

describe("all-wait（A05）：两种时序都只产生一次后继 admission", () => {
  it("wait 先注册、事件后到：页满足条件 → 前驱 active 不重叠启动 → 前驱结束后恰好一次后继", async () => {
    const s = await setup();
    await sendRequest(s, "REQUEST-NONCE-5");
    const origin = await subscribeToRequest(s);
    const requestCursor = await cursorOfEvent(s.h, "DirectedRequestSent");
    const deliveryRef = deliveryRefFor(PROJECT, WORKSPACE, expectedDeliveryId("DirectedRequestSent", requestCursor));
    const wait = await s.h.control.registerWait(waitForDelivery(s, "wait-1", deliveryRef));
    expect(wait.status, JSON.stringify(wait)).toBe("committed");
    expect(await successorFacts(s)).toEqual({ attempts: 0, runs: 0, pending: 0 });

    const routed = await s.h.drive({ reason: "rd-wait-first", maxIntents: 6 });
    expect(routed.coordination?.failures, JSON.stringify(routed.coordination?.failures)).toEqual([]);
    expect(routed.coordination?.deliveries).toBe(1);
    expect(routed.coordination?.admissions).toBe(0);
    // 条件已满足但前驱仍 active：**不重叠启动**同一 Work 的后继（零写入 not_ready）。
    expect(routed.coordination?.deferred).toBeGreaterThanOrEqual(1);
    expect(await successorFacts(s)).toEqual({ attempts: 0, runs: 0, pending: 0 });
    const waitSnapshot = await s.h.ledger.load(waitRefOf("wait-1"));
    if (waitSnapshot.status !== "found") throw new Error("wait missing");
    expect((waitSnapshot.snapshot as WaitConditionSnapshot).wait.status).toBe("active");
    // wait_admission intent 已经幂等建立（条件满足 + 前驱 active）。satisfiedRevision 是
    // "若现在接续，等待会落在哪个 revision"——页刚把 wait 推进到 2，因此是 3。
    const intent = await s.h.ledger.load(communicationIntentRefFor(PROJECT, WORKSPACE, waitAdmissionIntentIdFor("wait-1", 3)));
    expect(intent.status).toBe("found");

    // 前驱公开结束：同一次 drive 里恰好产生一个后继，并被唯一 outbox 收口派发。
    await endPredecessor(s);
    const admitted = await s.h.drive({ reason: "rd-wait-first-admit", maxIntents: 6 });
    expect(admitted.coordination?.failures, JSON.stringify(admitted.coordination?.failures)).toEqual([]);
    expect(admitted.coordination?.admissions).toBe(1);
    expect(await successorFacts(s)).toEqual({ attempts: 1, runs: 1, pending: 0 });

    // 再 drive 一次不产生第二个后继（唯一键 (workRef, waitRef, satisfiedRevision)）。
    const again = await s.h.drive({ reason: "rd-wait-first-again", maxIntents: 6 });
    expect(again.coordination?.admissions).toBe(0);
    expect(await successorFacts(s)).toEqual({ attempts: 1, runs: 1, pending: 0 });
    const settled = await s.h.ledger.load(waitRefOf("wait-1"));
    if (settled.status !== "found") throw new Error("wait missing");
    expect((settled.snapshot as WaitConditionSnapshot).wait.status).toBe("satisfied");
    expect(await countEvents(s.h, "CommunicationAdmissionRecorded")).toBe(1);
  });

  it("事件先发生、wait 后注册：条件事实已在账本里，仍然只产生一次后继", async () => {
    const s = await setup();
    await sendRequest(s, "REQUEST-NONCE-6");
    await subscribeToRequest(s);
    const routed = await s.h.drive({ reason: "rd-event-first", maxIntents: 6 });
    expect(routed.coordination?.deliveries).toBe(1);
    const requestCursor = await cursorOfEvent(s.h, "DirectedRequestSent");
    const deliveryRef = deliveryRefFor(PROJECT, WORKSPACE, expectedDeliveryId("DirectedRequestSent", requestCursor));
    // 事件已经在账本里，wait 是**之后**才注册的。
    expect((await s.h.control.registerWait(waitForDelivery(s, "wait-2", deliveryRef))).status).toBe("committed");

    const pending = await s.h.drive({ reason: "rd-event-first-ensure", maxIntents: 6 });
    expect(pending.coordination?.failures, JSON.stringify(pending.coordination?.failures)).toEqual([]);
    expect(pending.coordination?.admissions).toBe(0);
    expect(await successorFacts(s)).toEqual({ attempts: 0, runs: 0, pending: 0 });

    await endPredecessor(s);
    const admitted = await s.h.drive({ reason: "rd-event-first-admit", maxIntents: 6 });
    expect(admitted.coordination?.failures, JSON.stringify(admitted.coordination?.failures)).toEqual([]);
    expect(admitted.coordination?.admissions).toBe(1);
    expect(await successorFacts(s)).toEqual({ attempts: 1, runs: 1, pending: 0 });
    expect(await countEvents(s.h, "CommunicationAdmissionRecorded")).toBe(1);
  });

  it("同一 intent 连续硬失败到上界：收敛为可见 quarantine，而不是无限重试", async () => {
    const s = await setup();
    await sendRequest(s, "REQUEST-NONCE-QUARANTINE");
    await subscribeToRequest(s);
    const requestCursor = await cursorOfEvent(s.h, "DirectedRequestSent");
    const deliveryRef = deliveryRefFor(PROJECT, WORKSPACE, expectedDeliveryId("DirectedRequestSent", requestCursor));
    expect((await s.h.control.registerWait(waitForDelivery(s, "wait-q", deliveryRef))).status).toBe("committed");
    // 第一次 drive：条件满足 + 前驱 active → 建立并领取 wait_admission intent（零写入 not_ready）。
    const first = await s.h.drive({ reason: "rd-q-1", maxIntents: 6 });
    expect(first.coordination?.deferred).toBeGreaterThanOrEqual(1);
    // 换手：这一段参与结束。等待的 ownerParticipationRef 因此永远不再是 active，
    // 后继受理会**确定性地**被拒绝（不是瞬时故障）——这正是熔断要收敛的情形。
    const participation = await s.h.ledger.load(s.partC);
    if (participation.status !== "found") throw new Error("participation missing");
    const ended = await s.h.control.endWorkParticipation({
      commandId: "cmd-rd-end-part", commandType: "EndWorkParticipation", schemaVersion: 1, aggregateId: "part-c",
      expectedRevision: participation.snapshot.revision, correlationId: "corr-rd-end-part", submittedAt: AT,
      identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: "rd-end-part", agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
      payload: { workspaceId: WORKSPACE, workContextRef: { ...s.workC }, runRef: { ...s.runRef }, reason: "本段参与结束" },
    });
    expect(ended.status, JSON.stringify(ended)).toBe("committed");
    // 反复 drive：每次领取都失败一次，attemptCount 递增；到上界即以当前 generation 收敛为 quarantined。
    let quarantined = false;
    for (let round = 0; round < 10 && !quarantined; round += 1) {
      const drive = await s.h.drive({ reason: "rd-q-" + String(round + 2), maxIntents: 6 });
      expect(drive.coordination?.admissions).toBe(0);
      const intent = await s.h.ledger.load(communicationIntentRefFor(PROJECT, WORKSPACE, waitAdmissionIntentIdFor("wait-q", 3)));
      if (intent.status !== "found") throw new Error("wait_admission intent missing");
      quarantined = (intent.snapshot as CommunicationIntentSnapshot).intent.status === "quarantined";
    }
    expect(quarantined, "连续失败必须收敛为可见 quarantine").toBe(true);
    // 终态之后不再被领取：backlog 如实给出 quarantine 数，且不再产生失败。
    const after = await s.h.drive({ reason: "rd-q-final", maxIntents: 6 });
    expect(after.coordination?.failures).toEqual([]);
    expect(after.coordination?.backlog.quarantined).toBe(1);
    expect(await countEvents(s.h, "TaskClaimed")).toBe(1);
  });

  it("deadline 到点：收敛为 timed_out，而不是接续", async () => {
    const s = await setup();
    const wait = await s.h.control.registerWait(waitForDelivery(
      s, "wait-3",
      deliveryRefFor(PROJECT, WORKSPACE, "deliv-never-arrives"),
      "2026-09-05T11:00:00.000Z",
    ));
    expect(wait.status, JSON.stringify(wait)).toBe("committed");
    const drive = await s.h.drive({ reason: "rd-deadline", maxIntents: 6 });
    expect(drive.coordination?.failures, JSON.stringify(drive.coordination?.failures)).toEqual([]);
    expect(drive.coordination?.deadlinesSettled).toBe(1);
    expect(drive.coordination?.admissions).toBe(0);
    const loaded = await s.h.ledger.load(waitRefOf("wait-3"));
    if (loaded.status !== "found") throw new Error("wait missing");
    expect((loaded.snapshot as WaitConditionSnapshot).wait.status).toBe("timed_out");
    expect(await countEvents(s.h, "TaskClaimed")).toBe(1);
  });
});

function waitRefOf(waitId: string) {
  return { aggregateType: "WaitCondition" as const, projectId: PROJECT, workspaceId: WORKSPACE, waitId };
}

// ------------------------------------------------------------------------ //
// A09/A10：重启与 backlog                                                     //
// ------------------------------------------------------------------------ //

describe("重启与 backlog（A09/A10）：从持久事实继续，不依赖内存队列", () => {
  it("SQLite close + reopen 后仍能领取既有 wait_admission intent 并完成唯一后继", async () => {
    let h = await createPersistentSqliteHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY });
    cleanup.push(async () => { await h.cleanup(); });
    let s = await bootstrapScenario(h, "sqlite");
    await sendRequest(s, "REQUEST-NONCE-7");
    await subscribeToRequest(s);
    const routed = await h.drive({ reason: "rd-sqlite-route", maxIntents: 6 });
    expect(routed.coordination?.deliveries).toBe(1);
    const requestCursor = await cursorOfEvent(h, "DirectedRequestSent");
    const deliveryRef = deliveryRefFor(PROJECT, WORKSPACE, expectedDeliveryId("DirectedRequestSent", requestCursor));
    expect((await h.control.registerWait(waitForDelivery(s, "wait-4", deliveryRef))).status).toBe("committed");
    const deferred = await h.drive({ reason: "rd-sqlite-defer", maxIntents: 6 });
    expect(deferred.coordination?.admissions).toBe(0);
    const intentId = waitAdmissionIntentIdFor("wait-4", 2);
    const before = await h.ledger.load(communicationIntentRefFor(PROJECT, WORKSPACE, intentId));
    expect(before.status, "重启前必须已经存在持久 wait_admission intent").toBe("found");
    const backlogBefore = deferred.coordination!.backlog;
    expect(backlogBefore.observed).toBeGreaterThanOrEqual(2);
    expect(backlogBefore.oldestPendingAgeMs).not.toBeNull();
    // 前驱公开结束（在重启**之前**），验收"重启后仅凭持久事实接续"。
    await endPredecessor(s);

    await h.close();
    h = await h.reopen();
    cleanup.push(async () => { await h.close(); });
    s = { ...s, h };
    const after = await h.drive({ reason: "rd-sqlite-after-restart", maxIntents: 6 });
    expect(after.coordination?.failures, JSON.stringify(after.coordination?.failures)).toEqual([]);
    expect(after.coordination?.admissions, "重启后必须从持久 intent 继续，而不是依赖内存队列").toBe(1);
    // backlog 来自持久状态：重启后观察到的 intent 数不减少。
    expect(after.coordination!.backlog.observed).toBeGreaterThanOrEqual(backlogBefore.observed);
    const successor = await h.ledger.load({ aggregateType: "TaskAttempt", projectId: PROJECT, goalId: GOAL, taskId: TASK, attemptId: (await successorAttemptId(h)) });
    expect(successor.status).toBe("found");
    expect(await countEvents(h, "CommunicationAdmissionRecorded")).toBe(1);
  });

  it("同一个 intent 重复 drive 不会重复推进（页只提交一次）", async () => {
    const s = await setup();
    await sendRequest(s, "REQUEST-NONCE-8");
    await subscribeToRequest(s);
    const first = await s.h.drive({ reason: "rd-idem-1", maxIntents: 4 });
    expect(first.coordination?.pagesRouted, JSON.stringify(first.coordination?.failures)).toBe(1);
    const deliveriesAfterFirst = await countEvents(s.h, "DeliveryRecorded");
    // 定向请求本身产生一条 direct Delivery；路由页再产生一条 subscription Delivery。
    expect(deliveriesAfterFirst).toBe(2);
    const second = await s.h.drive({ reason: "rd-idem-2", maxIntents: 4 });
    expect(second.coordination?.pagesRouted).toBe(1); // finish the separate historical horizon
    expect((await s.h.drive({ reason: "rd-idem-3", maxIntents: 4 })).coordination?.pagesRouted).toBe(0);
    expect(second.coordination?.deliveries).toBe(0);
    // 同一个 intent 不会第二次提交页：没有新 Delivery，也没有第二次 settle。
    expect(await countEvents(s.h, "DeliveryRecorded")).toBe(deliveriesAfterFirst);
    expect(await countEvents(s.h, "CommunicationIntentSettled")).toBe(2);
  });
});

async function successorAttemptId(h: AnyHarness): Promise<string> {
  let cursor: CommitCursor | null = null;
  for (;;) {
    const page: EventPage = await h.ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const positioned of page.events) {
      if (positioned.event.eventType !== "TaskClaimed") continue;
      const payload = positioned.event.payload as { attemptRef?: { attemptId?: string } };
      if (payload.attemptRef?.attemptId !== undefined && payload.attemptRef.attemptId !== "att-pred") return payload.attemptRef.attemptId;
    }
    if (!page.hasMore || page.throughCursor === null || page.throughCursor === cursor) throw new Error("successor attempt not found");
    cursor = page.throughCursor;
  }
}

async function persistentRoutingWorld() {
  const dir = await mkdtemp(join(tmpdir(), 'cm1a-route-process-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const h = await createPersistentSqliteHarness({ dir, deps: { clock: () => AT }, runtimeScript: STARTED_ONLY, coordinationPageSize: 1 });
  try {
    const s = await bootstrapScenario(h, 'process');
    for (let i = 0; i < 3; i++) {
      const id = 'process-sub-' + i;
      expect(await h.control.createSubscription({ commandId: id, commandType: 'CreateSubscription', schemaVersion: 1,
        aggregateId: id, expectedRevision: 0, correlationId: id, submittedAt: AT,
        identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: id, agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
        payload: { workspaceId: WORKSPACE, ownerWorkContextRef: s.workC, ownerParticipationRef: s.partC, topics: ['DirectedRequestSent'], startCursor: null } })).toMatchObject({ status: 'committed' });
    }
    const { requestCursor } = await sendRequest(s, 'process-source');
    return { dir, requestCursor, intentId: routePageIntentIdFor(PROJECT, WORKSPACE, 'DirectedRequestSent', requestCursor) };
  } finally { await h.close(); }
}
async function routeChild(dir: string, suffix: string, options: Record<string, unknown>) {
  const path = join(dir, suffix + '.json');
  await writeFile(path, JSON.stringify({ stateDir: dir, projectId: PROJECT, workspaceId: WORKSPACE, at: AT, ...options }));
  try {
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./coordination-process.mjs', import.meta.url)), path], { maxBuffer: 1024 * 1024 });
    return { code: 0, value: JSON.parse(result.stdout) };
  } catch (error) {
    const e = error as { code: number; stderr: string; stdout: string };
    if (e.code !== 86) throw Error(e.stderr + e.stdout);
    return { code: 86, value: null };
  }
}
it.each(['before_page', 'after_page'])('independent process exit %s recovers fixed subscription pages exactly once', async fault => {
  const w = await persistentRoutingWorld();
  expect((await routeChild(w.dir, 'crash', { fault })).code).toBe(86);
  const at = new Date(Date.parse(AT) + 120000).toISOString();
  const resumed = await routeChild(w.dir, 'restart', { at });
  expect(resumed.value.results.flatMap((r: any) => r.coordination.failures)).toEqual([]);
  const h = await createPersistentSqliteHarness({ dir: w.dir, deps: { clock: () => at } });
  try {
    const page = await h.ledger.events({ afterCursor: w.requestCursor, limit: 1000 });
    const deliveries = page.events.filter(p => p.event.eventType === 'DeliveryRecorded' && p.event.payload.delivery.origin.kind === 'subscription');
    expect(deliveries).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const sub = await h.ledger.load(subscriptionRefFor(PROJECT, WORKSPACE, 'process-sub-' + i));
      expect(sub.status === 'found' && (sub.snapshot as SubscriptionSnapshot).subscription.routedThroughCursor).toBe(w.requestCursor);
    }
  } finally { await h.close(); }
}, 90000);
it('independent consumers preserve the new generation result when the old process settles late', async () => {
  const w = await persistentRoutingWorld(), ready = join(w.dir, 'old-ready'), go = join(w.dir, 'old-go');
  const old = routeChild(w.dir, 'old', { intentId: w.intentId, consumerId: 'old', ready, go, settle: true });
  const deadline = Date.now() + 30000;
  while (!(await access(ready).then(() => true, () => false))) { if (Date.now() > deadline) throw Error('old consumer timeout'); await new Promise(r => setTimeout(r, 10)); }
  try {
    const next = await routeChild(w.dir, 'new', { intentId: w.intentId, consumerId: 'new', at: new Date(Date.parse(AT) + 2000).toISOString(), settle: true });
    expect(next.value.claim).toMatchObject({ status: 'claimed', leaseGeneration: 2 });
    expect(next.value.settled).toMatchObject({ status: 'committed', intentStatus: 'quarantined' });
  } finally { await writeFile(go, 'release'); }
  const late = await old;
  expect(late.value.settled).toMatchObject({ status: 'stale_generation', currentGeneration: 2 });
}, 90000);
