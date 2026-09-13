import { subscriptionCatchupIdFor } from "../../src/contracts/coordination.js";
/**
 * CM-1A-001 第 4 步 A 部分：**持续路由**的真实消费者验证（协议约束 1.4）。
 *
 * 走的是生产实现：真实 InMemoryLedger、真实 ControlEngineImpl、真实 DispatchEngineImpl
 * （协作驱动挂在它唯一的 drive 收口之内）。不绕 Control 直写账本，也不构造测试专用入口。
 *
 * 覆盖：
 *   A03/R2 「可路由事件与待路由 intent **同事务登记**」——源事件提交回执的 eventIds 同时含
 *           DirectedRequestSent 与该事件位置的 CommunicationIntentRecorded（同一次 ledger 提交）；
 *           该 intent 的 sourceCursor **逐字节等于**源事件的账本游标；
 *   A03/R2 「首轮 subscriptionScope **真的被固定**」——整轮候选集合（全部命中该事件的订阅）写进
 *           intent 的 domain（不是本页切片），并在 settled intent 上留下可核对的事实；
 *   A03     「范围固定」规则在**生产路径**上确实触发：范围外订阅被 Control 整页拒绝（零写入）；
 *   A03/R2 「同一事件翻页 与 跨事件推进 分别处理」——同一 topic 上只有源事件位置最靠前的
 *           未收敛 route intent 会被推进（末页完成后才推进事件处理位置）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryHarness, type InMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { buildPreparedClaim, prepareP103Project, type P1_03TestHarness } from "../contract-suite/p1-03-harness.js";
import { DISPATCH_ELIGIBLE_TASK_ID, ROLE_BINDING_FIXTURE_V1, type FakeRuntimeScriptV1 } from "../../src/fixtures/dispatch-fixtures.js";
import { runRefFor } from "../../src/contracts/dispatch.js";
import type { RunRef } from "../../src/contracts/dispatch.js";
import type { WorkContextRef } from "../../src/contracts/context-continuity.js";
import { workContextRefFor } from "../../src/contracts/context-continuity.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import { makeCommitCursor, seqOfCommitCursor } from "../../src/contracts/ledger.js";
import type { EventPage } from "../../src/contracts/ledger.js";
import type { ArtifactRef } from "../../src/contracts/artifact.js";
import {
  communicationIntentRefFor,
  deliveryRefFor,
  routePageIntentIdFor,
  subscriptionRefFor,
  waitConditionRefFor,
  workParticipationRefFor,
} from "../../src/contracts/coordination.js";
import type {
  AgentPrincipalRefV1,
  CommunicationIntentSnapshot,
  CommunicationSettleCommand,
  SendDirectedRequestCommand,
  StartWorkParticipationCommand,
  SubscribeCommand,
  SubscriptionSnapshot,
  WorkParticipationRef,
} from "../../src/contracts/coordination.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";
import { buildIntentRecordCommit, routePageIntentFor } from "../../src/control/control-engine/records/coordination.js";
import { decideIntentClaim } from "../../src/control/control-engine/policies/coordination-rules.js";
import { subscriptionDeliveryIdFor } from "../../src/control/dispatch-engine/coordination-drive.js";

const AT = "2026-09-05T12:00:00.000Z";
const PROJECT = "proj-alpha";
const WORKSPACE = "ws-shared";
const GOAL = "goal-1";
const AGENT = "agent-c";
const WORK_C = "work-c";
const WORK_A = "work-a";
const TASK = DISPATCH_ELIGIBLE_TASK_ID;
const PLAN_REF = { aggregateType: "PlanRevision", projectId: PROJECT, planId: "plan-dispatch-mvp" } as const;
const TOPIC = "DirectedRequestSent";

/** 只发 run_started：前驱 Run 停在 running（路由不需要前驱结束）。 */
const STARTED_ONLY: FakeRuntimeScriptV1 = {
  schemaVersion: 1,
  items: [{ sequence: 1, eventType: "run_started", payload: { kind: "started", startedAt: "2026-09-05T12:00:01.000Z" }, occurredAt: "2026-09-05T12:00:01.000Z" }],
};

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

async function scanEvents(h: InMemoryHarness): Promise<{ cursor: CommitCursor; eventType: string; eventId: string }[]> {
  const out: { cursor: CommitCursor; eventType: string; eventId: string }[] = [];
  let cursor: CommitCursor | null = null;
  for (;;) {
    const page: EventPage = await h.ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const positioned of page.events) {
      out.push({ cursor: positioned.cursor, eventType: positioned.event.eventType, eventId: positioned.event.eventId });
    }
    if (!page.hasMore || page.throughCursor === null || page.throughCursor === cursor) return out;
    cursor = page.throughCursor;
  }
}

async function cursorOfFirstEvent(h: InMemoryHarness): Promise<CommitCursor> {
  const page: EventPage = await h.ledger.events({ afterCursor: null, limit: 1 });
  return page.events[0]!.cursor;
}

function adapterOf(h: InMemoryHarness): P1_03TestHarness {
  return {
    ledger: h.ledger, readModel: h.readModel, runtime: h.runtime, bootstrap: h.bootstrap,
    submit: (command) => h.control.submit(command), install: h.install, activate: h.activate,
    applyPlan: h.applyPlan, dispatchReadiness: h.dispatchReadiness, claimTask: h.claimTask,
    startRun: h.startRun, runFact: h.runFact, drive: h.drive, advanceProjection: h.advanceProjection,
    observedCursor: h.observedCursor, planGraph: h.planGraph, taskDetail: h.taskDetail, activeAgent: h.activeAgent,
  };
}

type Scenario = { h: InMemoryHarness; runRef: RunRef; workC: WorkContextRef; workA: WorkContextRef; partC: WorkParticipationRef };

async function bootstrapScenario(h: InMemoryHarness, suffix: string): Promise<Scenario> {
  const boot = await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-rc-boot-" + suffix, correlationId: "corr-rc-boot-" + suffix, submittedAt: AT,
  }));
  expect(boot.status).toBe("committed");
  await prepareP103Project(adapterOf(h), PROJECT, "a");
  const claim = await h.claimTask(buildPreparedClaim({
    commandId: "cmd-rc-claim-" + suffix, correlationId: "corr-rc-claim-" + suffix,
    attemptId: "att-pred", runId: "run-pred", idempotencyKey: "rc-claim-" + suffix,
  }));
  expect(claim.status, JSON.stringify(claim)).toBe("committed");
  const runRef = runRefFor(PROJECT, GOAL, "run-pred");
  const workC = workContextRefFor(PROJECT, WORKSPACE, WORK_C);
  const workA = workContextRefFor(PROJECT, WORKSPACE, WORK_A);
  await h.bindWorkContext({
    commandId: "cmd-rc-bind-" + suffix, commandType: "BindWorkContext", schemaVersion: 1, aggregateId: WORK_C,
    expectedRevision: 0, correlationId: "corr-rc-bind-" + suffix, submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "rc-bind-" + suffix },
    payload: {
      workspaceId: WORKSPACE, workKind: "task", goalId: GOAL, taskId: TASK,
      planRef: { ...PLAN_REF }, planRevision: 1,
      roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 }, initialRunRef: { ...runRef },
    },
  });
  await h.bindWorkContext({
    commandId: "cmd-rc-bind-a-" + suffix, commandType: "BindWorkContext", schemaVersion: 1, aggregateId: WORK_A,
    expectedRevision: 0, correlationId: "corr-rc-bind-a-" + suffix, submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "rc-bind-a-" + suffix },
    payload: {
      workspaceId: WORKSPACE, workKind: "coordination", goalId: GOAL, taskId: null,
      planRef: null, planRevision: null, roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 }, initialRunRef: { ...runRef },
    },
  });
  const agent = await h.control.registerAgentInstance({
    commandId: "cmd-rc-agent-" + suffix, commandType: "RegisterAgentInstance", schemaVersion: 1, aggregateId: AGENT,
    expectedRevision: 0, correlationId: "corr-rc-agent-" + suffix, submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "rc-agent-" + suffix },
    payload: { workspaceId: WORKSPACE, templateId: "template-runner", templateRevision: "1" },
  });
  expect(agent.status).toBe("committed");
  const first = await h.drive({ reason: "rc-start-predecessor-" + suffix, maxIntents: 1 });
  expect(first.failures, JSON.stringify(first.failures)).toEqual([]);
  expect(first.started).toBe(1);
  const partC = workParticipationRefFor(PROJECT, WORKSPACE, WORK_C, "part-c");
  const participation: StartWorkParticipationCommand = {
    commandId: "cmd-rc-part-c-" + suffix, commandType: "StartWorkParticipation", schemaVersion: 1, aggregateId: "part-c",
    expectedRevision: 0, correlationId: "corr-rc-part-c-" + suffix, submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(runRef), idempotencyKey: "rc-part-c-" + suffix, agentPrincipal: principalFor(runRef, workC, partC) },
    payload: { workspaceId: WORKSPACE, workContextRef: { ...workC }, agentInstanceId: AGENT, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 }, runRef: { ...runRef } },
  };
  const started = await h.control.startWorkParticipation(participation);
  expect(started.status, JSON.stringify(started)).toBe("committed");
  return { h, runRef, workC, workA, partC };
}

/** 建立一个订阅（topic 固定为本测试用的事件名；startCursor 决定它从哪个位置之后开始接收）。 */
async function subscribeAt(s: Scenario, id: string, startCursor: CommitCursor): Promise<void> {
  const command: SubscribeCommand = {
    commandId: "cmd-rc-sub-" + id, commandType: "CreateSubscription", schemaVersion: 1, aggregateId: id,
    expectedRevision: 0, correlationId: "corr-rc-sub-" + id, submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: "rc-sub-" + id, agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
    payload: {
      workspaceId: WORKSPACE, ownerWorkContextRef: { ...s.workC }, ownerParticipationRef: { ...s.partC },
      topics: [TOPIC], startCursor,
    },
  };
  const receipt = await s.h.control.createSubscription(command);
  expect(receipt.status, JSON.stringify(receipt)).toBe("committed");
}

/** 发一条定向请求（正文 body-first 真进 vault）；返回正文引用、账本位置与提交回执。 */
async function sendRequest(s: Scenario, requestId: string, nonce: string) {
  const body = JSON.stringify({ investigation: "report-A", nonce });
  const stored = await s.h.vault.put({
    contentType: "application/json", body, ownerRef: { ...s.runRef },
    sourceRefs: [{ kind: "workspace", refId: WORKSPACE, revision: "1" }], requestedAt: AT,
  });
  expect(stored.status).toBe("stored");
  if (stored.status !== "stored") throw new Error("vault put failed");
  const command: SendDirectedRequestCommand = {
    commandId: "cmd-rc-req-" + requestId, commandType: "SendDirectedRequest", schemaVersion: 1, aggregateId: requestId,
    expectedRevision: 0, correlationId: "corr-rc-req-" + requestId, submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: "rc-req-" + requestId, agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
    payload: {
      workspaceId: WORKSPACE, fromParticipationRef: { ...s.partC }, fromRunRef: { ...s.runRef },
      toWorkContextRef: { ...s.workA }, expectedParticipationRef: null,
      statement: "请只读调查报告 A", statementBodyRef: stored.ref, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
    },
  };
  const receipt = await s.h.control.sendDirectedRequest(command);
  expect(receipt.status, JSON.stringify(receipt)).toBe("committed");
  const events = await scanEvents(s.h);
  const sent = events.filter((e) => e.eventType === "DirectedRequestSent");
  const cursor = sent[sent.length - 1]!.cursor;
  return { bodyRef: stored.ref as ArtifactRef, cursor, receipt };
}

async function loadIntent(s: Scenario, intentId: string): Promise<CommunicationIntentSnapshot> {
  const loaded = await s.h.ledger.load(communicationIntentRefFor(PROJECT, WORKSPACE, intentId));
  if (loaded.status !== "found") throw new Error("intent missing: " + intentId);
  return loaded.snapshot as CommunicationIntentSnapshot;
}

/** 账本里全部"来源为订阅"的投递（按账本顺序）。 */
async function subscriptionDeliveries(s: Scenario): Promise<{ subscriptionId: string; sourceCursor: string }[]> {
  const out: { subscriptionId: string; sourceCursor: string }[] = [];
  let cursor: CommitCursor | null = null;
  for (;;) {
    const page: EventPage = await s.h.ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const positioned of page.events) {
      if (positioned.event.eventType !== "DeliveryRecorded") continue;
      const delivery = (positioned.event as { payload: { delivery: { origin: { kind: string; subscriptionRef?: { subscriptionId: string }; sourceCursor?: string } } } }).payload.delivery;
      if (delivery.origin.kind !== "subscription") continue;
      out.push({ subscriptionId: delivery.origin.subscriptionRef!.subscriptionId, sourceCursor: String(delivery.origin.sourceCursor) });
    }
    if (!page.hasMore || page.throughCursor === null || page.throughCursor === cursor) return out;
    cursor = page.throughCursor;
  }
}

// ------------------------------------------------------------------------ //
// 1. 可路由事件与待路由 intent 同事务登记                                     //
// ------------------------------------------------------------------------ //

describe("持续路由（A03/R2）：可路由事件与待路由 intent 同事务登记", () => {
  it("DirectedRequestSent 的提交回执同时含源事件与同位置的 CommunicationIntentRecorded，且 sourceCursor 逐字节等于源事件游标", async () => {
    const h = createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY });
    const s = await bootstrapScenario(h, "same-tx");
    const c0 = await cursorOfFirstEvent(h);
    // 订阅先建立并驱动到收敛：这样它没有"未收敛的轮次"，本次事件才会由**新**的 route intent 负责。
    await subscribeAt(s, "sub-1", c0);
    const pre = await h.drive({ reason: "rc-pre", maxIntents: 4 });
    expect(pre.coordination?.failures, JSON.stringify(pre.coordination?.failures)).toEqual([]);

    const { cursor, receipt } = await sendRequest(s, "req-1", "NONCE-SAME-TX");
    const expectedIntentId = routePageIntentIdFor(PROJECT, WORKSPACE, TOPIC, cursor);
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;

    // ── 同事务：源事件与 intent 事件来自**同一次** ledger 提交（回执的 eventIds 是那一次提交的）。
    const planEventId = "route-plan-" + expectedIntentId;
    expect(receipt.eventIds).toContain(planEventId);

    // ── 位置精确：intent 的 sourceCursor 就是该源事件的账本游标。
    const intent = await loadIntent(s, expectedIntentId);
    expect(intent.intent.domain.kind).toBe("route_page");
    if (intent.intent.domain.kind !== "route_page") return;
    expect(String(intent.intent.domain.sourceCursor)).toBe(String(cursor));
    expect(intent.intent.domain.sourceTopic).toBe(TOPIC);
    expect(intent.intent.status).toBe("pending");
    expect(intent.intent.domain.subscriptionPosition).toBeNull();
    // ── 首轮范围：整轮候选集合（此刻只有一个订阅）。
    expect(intent.intent.domain.subscriptionScope.map((entry) => entry.subscriptionRef.subscriptionId)).toEqual(["sub-1"]);
    expect(intent.intent.domain.subscriptionScope[0]!.expectedRevision).toBe(
      ((await s.h.ledger.load(subscriptionRefFor(PROJECT, WORKSPACE, "sub-1"))) as { snapshot: SubscriptionSnapshot }).snapshot.revision,
    );

    // ── 真实消费：一次 drive 让该 intent 收敛，并把正文投给订阅的 owner Work。
    const drive = await h.drive({ reason: "rc-route", maxIntents: 4 });
    expect(drive.coordination?.failures, JSON.stringify(drive.coordination?.failures)).toEqual([]);
    const deliveries = await subscriptionDeliveries(s);
    expect(deliveries).toEqual([{ subscriptionId: "sub-1", sourceCursor: String(cursor) }]);
    const settled = await loadIntent(s, expectedIntentId);
    expect(settled.intent.status).toBe("done");
    if (settled.intent.domain.kind !== "route_page") return;
    // 范围是**本轮**的事实，落在 settled intent 上（不是只存在于提案里）。
    expect(settled.intent.domain.subscriptionScope.map((entry) => entry.subscriptionRef.subscriptionId)).toEqual(["sub-1"]);
  });

  it("整轮候选集合而不是本页切片：3 个订阅 + 页大小 1 → 首轮就把 3 个都固定进范围，翻满 3 页并全部投递", async () => {
    const h = createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY, coordinationPageSize: 1 });
    const s = await bootstrapScenario(h, "round-scope");
    const c0 = await cursorOfFirstEvent(h);
    for (const id of ["sub-a", "sub-b", "sub-c"]) await subscribeAt(s, id, c0);
    const pre = await h.drive({ reason: "rc-scope-pre", maxIntents: 8 });
    expect(pre.coordination?.failures, JSON.stringify(pre.coordination?.failures)).toEqual([]);

    const { cursor } = await sendRequest(s, "req-scope", "NONCE-ROUND-SCOPE");
    const baseId = routePageIntentIdFor(PROJECT, WORKSPACE, TOPIC, cursor);
    const base = await loadIntent(s, baseId);
    expect(base.intent.domain.kind).toBe("route_page");
    if (base.intent.domain.kind !== "route_page") return;
    // 首轮固定 = 整轮候选集合（3 个），不是本页切片（1 个）。
    expect(base.intent.domain.subscriptionScope).toHaveLength(3);

    const drive = await h.drive({ reason: "rc-scope", maxIntents: 8 });
    expect(drive.coordination?.failures, JSON.stringify(drive.coordination?.failures)).toEqual([]);
    expect(drive.coordination?.pagesRouted).toBe(3);
    expect(drive.coordination?.deliveries).toBe(3);
    const deliveries = await subscriptionDeliveries(s);
    expect(new Set(deliveries.map((d) => d.subscriptionId))).toEqual(new Set(["sub-a", "sub-b", "sub-c"]));
    for (const d of deliveries) expect(d.sourceCursor).toBe(String(cursor));
    // 每个订阅都恰好被投递一次（没有因为"范围只含本页切片"而重复或漏投）。
    expect(deliveries).toHaveLength(3);
    // 已经固定的范围不允许被下一页改变：整条链上的范围逐字节相同。
    const chain = (await scanEvents(s.h)).filter((e) => e.eventType === "CommunicationIntentRecorded")
      .map((e) => e.eventId);
    expect(chain).toContain("route-plan-" + baseId);
    const settledBase = await loadIntent(s, baseId);
    if (settledBase.intent.domain.kind !== "route_page") return;
    expect(settledBase.intent.domain.subscriptionScope).toEqual(base.intent.domain.subscriptionScope);
  });
});

// ------------------------------------------------------------------------ //
// 2. 范围固定规则在生产路径上确实触发                                          //
// ------------------------------------------------------------------------ //

describe("持续路由（A03）：范围固定规则在生产路径上触发", () => {
  it("本页引入本轮范围外的订阅 → Control 整页拒绝（零写入）", async () => {
    const h = createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY });
    const s = await bootstrapScenario(h, "out-of-scope");
    const c0 = await cursorOfFirstEvent(h);
    await subscribeAt(s, "sub-in", c0);
    const pre = await h.drive({ reason: "rc-oos-pre", maxIntents: 4 });
    expect(pre.coordination?.failures, JSON.stringify(pre.coordination?.failures)).toEqual([]);
    const { cursor } = await sendRequest(s, "req-oos", "NONCE-OOS");
    const intentId = routePageIntentIdFor(PROJECT, WORKSPACE, TOPIC, cursor);

    // 建一个**不在本轮范围里**的订阅（它的 startCursor 早于该事件，因此是有资格的候选，
    // 只是本轮范围在规划时还不够它——正是"范围固定、翻页期间不得改变"要挡住的输入）。
    await subscribeAt(s, "sub-out", c0);
    const outRevision = ((await s.h.ledger.load(subscriptionRefFor(PROJECT, WORKSPACE, "sub-out"))) as { snapshot: SubscriptionSnapshot }).snapshot.revision;

    const before = await s.h.ledger.load(communicationIntentRefFor(PROJECT, WORKSPACE, intentId));
    if (before.status !== "found") throw new Error("intent missing");
    const claimed = await s.h.control.claimCommunicationIntent({
      commandId: "cmd-rc-oos-claim", commandType: "CommunicationClaimIntent", schemaVersion: 1,
      aggregateId: intentId, expectedRevision: before.snapshot.revision, correlationId: "corr-rc-oos-claim", submittedAt: AT,
      identity: { projectId: PROJECT, actor: { kind: "system", id: "test-consumer" }, idempotencyKey: "rc-oos-claim" },
      payload: { workspaceId: WORKSPACE, consumerId: "test-consumer", leaseDurationMs: 60000, now: AT },
    });
    expect(claimed.status).toBe("claimed");
    if (claimed.status !== "claimed") return;

    const command: CommunicationSettleCommand = {
      commandId: "cmd-rc-oos-settle", commandType: "CommunicationSettleIntent", schemaVersion: 1,
      aggregateId: intentId, expectedRevision: claimed.revision, correlationId: "corr-rc-oos-settle", submittedAt: AT,
      identity: { projectId: PROJECT, actor: { kind: "system", id: "test-consumer" }, idempotencyKey: "rc-oos-settle" },
      payload: {
        outcome: "route_page", workspaceId: WORKSPACE, consumerId: "test-consumer",
        leaseGeneration: claimed.leaseGeneration, settledAt: AT,
        page: {
          schemaVersion: 1, sourceTopic: TOPIC, sourceCursor: cursor,
          // 提案把范围外订阅塞进来（回声不再等同本轮固定的范围）。
          subscriptionScope: [
            { subscriptionRef: subscriptionRefFor(PROJECT, WORKSPACE, "sub-in"), expectedRevision: 1 },
            { subscriptionRef: subscriptionRefFor(PROJECT, WORKSPACE, "sub-out"), expectedRevision: outRevision },
          ],
          subscriptionPosition: canonicalJson(subscriptionRefFor(PROJECT, WORKSPACE, "sub-out")),
          subscriptions: [{
            subscriptionRef: subscriptionRefFor(PROJECT, WORKSPACE, "sub-out"),
            expectedRevision: outRevision,
            deliveries: [], satisfiedWaitIndexes: [],
          }],
          hasMore: false,
        },
      },
    };
    const rejected = await s.h.control.settleCommunicationIntent(command);
    expect(rejected.status).toBe("rejected");
    if (rejected.status !== "rejected") return;
    expect((rejected.issues ?? []).join(" ")).toContain("本轮订阅范围");

    // 零写入：intent 仍是 leased、订阅 checkpoint 未推进。
    const after = await s.h.ledger.load(communicationIntentRefFor(PROJECT, WORKSPACE, intentId));
    if (after.status !== "found") throw new Error("intent missing after");
    expect((after.snapshot as CommunicationIntentSnapshot).intent.status).toBe("leased");
    const out = await s.h.ledger.load(subscriptionRefFor(PROJECT, WORKSPACE, "sub-out"));
    if (out.status !== "found") throw new Error("sub-out missing");
    expect((out.snapshot as SubscriptionSnapshot).subscription.routedThroughCursor).toBeNull();
  });
});

// ------------------------------------------------------------------------ //
// 3. 跨事件推进：末页完成后才推进事件处理位置                                   //
// ------------------------------------------------------------------------ //

describe("持续路由（A03/R2）：跨事件推进与同一事件翻页分别处理", () => {
  it("同一 topic 上更靠后的事件位置，在前一条未收敛的 route intent 完成前不被推进", async () => {
    const h = createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY });
    const s = await bootstrapScenario(h, "frontier");
    const c0 = await cursorOfFirstEvent(h);
    await subscribeAt(s, "sub-1", c0);
    expect((await h.drive({ reason: "rc-f-pre", maxIntents: 4 })).coordination?.failures).toEqual([]);

    // 第一条可路由事件 → 它的轮次（sourceCursor = E1 的位置），由同事务计划建立。
    const e1 = await sendRequest(s, "req-e1", "NONCE-E1");
    const e1IntentId = routePageIntentIdFor(PROJECT, WORKSPACE, TOPIC, e1.cursor);
    expect((await loadIntent(s, e1IntentId)).intent.status).toBe("pending");

    // 手工登记一条**更靠后**的 pending route intent（同一条 canonical 提交类型
    // communication-intent-record；本用例要证明的是驱动的推进顺序，不是某条 Control 准入）。
    const events = await scanEvents(s.h);
    const lastCursor = events[events.length - 1]!.cursor;
    const laterCursor = makeCommitCursor(seqOfCommitCursor(lastCursor) + 1);
    const laterIntent = routePageIntentFor({ projectId: PROJECT, workspaceId: WORKSPACE, topic: TOPIC, cursor: laterCursor, now: AT });
    const seeded = await s.h.ledger.commit(buildIntentRecordCommit({
      command: {
        commandId: "cmd-rc-seed-later", correlationId: "corr-rc-seed-later",
        identity: { projectId: PROJECT, actor: { kind: "system", id: "rc-seed" }, idempotencyKey: "rc-seed-later" },
      },
      deps: { eventId: () => "evt-rc-seed-later", now: () => AT, workspaceId: WORKSPACE },
      fingerprint: "0".repeat(64) as never,
      intent: laterIntent,
    }));
    expect(seeded.status, JSON.stringify(seeded)).toBe("committed");
    expect((await loadIntent(s, laterIntent.intentId)).intent.status).toBe("pending");

    // 一次预算受限的 drive：只允许推进**源事件位置最靠前**的那一条（E1）。
    const first = await h.drive({ reason: "rc-f-1", maxIntents: 1 });
    expect(first.coordination?.failures, JSON.stringify(first.coordination?.failures)).toEqual([]);
    expect((await loadIntent(s, e1IntentId)).intent.status).toBe("done");
    // 更靠后的位置**必须原封不动**（末页完成后才推进事件处理位置）。
    const stillPending = await loadIntent(s, laterIntent.intentId);
    expect(stillPending.intent.status).toBe("pending");
    expect(stillPending.intent.leaseGeneration).toBe(0);
    expect(stillPending.revision).toBe(1);
    const deliveries = await subscriptionDeliveries(s);
    expect(deliveries.map((d) => d.subscriptionId)).toEqual(["sub-1"]);

    // 前一条完成之后，后一条才可以被推进（这里它没有可路由事件 → 空页收敛为 done）。
    const second = await h.drive({ reason: "rc-f-2", maxIntents: 2 });
    expect(second.coordination?.failures, JSON.stringify(second.coordination?.failures)).toEqual([]);
    expect((await loadIntent(s, laterIntent.intentId)).intent.status).toBe("done");
    expect(await subscriptionDeliveries(s)).toHaveLength(1);
  });
});
// ------------------------------------------------------------------------ //
// 4. 取消与 unknown（A07/A08）：先持久化取消意图、结果分开、退避只对已证实无副作用      //
// ------------------------------------------------------------------------ //

async function claimIntent(s: Scenario, intentId: string, now: string, leaseDurationMs = 60_000, consumerId = "test-consumer") {
  const loaded = await s.h.ledger.load(communicationIntentRefFor(PROJECT, WORKSPACE, intentId));
  if (loaded.status !== "found") throw new Error("intent missing: " + intentId);
  const claimed = await s.h.control.claimCommunicationIntent({
    commandId: "cmd-rc-claim-" + intentId + "-" + now, commandType: "CommunicationClaimIntent", schemaVersion: 1,
    aggregateId: intentId, expectedRevision: loaded.snapshot.revision, correlationId: "corr-rc-claim-" + intentId, submittedAt: now,
    identity: { projectId: PROJECT, actor: { kind: "system", id: "test-consumer" }, idempotencyKey: "rc-claim-" + intentId + "-" + now },
    payload: { workspaceId: WORKSPACE, consumerId, leaseDurationMs, now },
  });
  expect(claimed.status, JSON.stringify(claimed)).toBe("claimed");
  if (claimed.status !== "claimed") throw new Error("claim failed");
  return claimed;
}

function settleCommand(
  intentId: string, revision: number, generation: number, payload: Record<string, unknown>, tag: string,
): CommunicationSettleCommand {
  return {
    commandId: "cmd-rc-settle-" + intentId + "-" + tag, commandType: "CommunicationSettleIntent", schemaVersion: 1,
    aggregateId: intentId, expectedRevision: revision, correlationId: "corr-rc-settle-" + tag, submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "system", id: "test-consumer" }, idempotencyKey: "rc-settle-" + tag },
    payload: { ...payload, leaseGeneration: generation } as unknown as CommunicationSettleCommand["payload"],
  };
}

describe("取消与 unknown（A07/A08）：非终态退避与已开始的副作用", () => {
  it("已证实无副作用的失败进入 retry_scheduled（availableAt = settledAt + 退避）；已开始的副作用一律拒绝退避", async () => {
    const h = createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY });
    const s = await bootstrapScenario(h, "retry");
    const c0 = await cursorOfFirstEvent(h);
    await subscribeAt(s, "sub-r", c0);
    const intentId = subscriptionCatchupIdFor(subscriptionRefFor(PROJECT, WORKSPACE, "sub-r"));

    const first = await claimIntent(s, intentId, AT);
    const scheduled = await s.h.control.settleCommunicationIntent(settleCommand(intentId, first.revision, first.leaseGeneration, {
      outcome: "no_effect_failure", workspaceId: WORKSPACE, consumerId: "test-consumer",
      reason: "执行能力不可用，提交未发生", backoffMs: 60_000, settledAt: AT,
    }, "retry"));
    expect(scheduled.status, JSON.stringify(scheduled)).toBe("committed");
    const retried = await loadIntent(s, intentId);
    expect(retried.intent.status).toBe("retry_scheduled");
    expect(retried.intent.settledAt).toBeNull();
    expect(retried.intent.availableAt).toBe("2026-09-05T12:01:00.000Z");
    expect(decideIntentClaim({ intent: retried.intent, consumerId: "test-consumer", now: AT }).allow).toBe(false);
    expect(decideIntentClaim({ intent: retried.intent, consumerId: "test-consumer", now: "2026-09-05T12:01:00.000Z" }).allow).toBe(true);

    const second = await claimIntent(s, intentId, "2026-09-05T12:01:00.000Z");
    const started = await s.h.control.settleCommunicationIntent(settleCommand(intentId, second.revision, second.leaseGeneration, {
      outcome: "side_effect_started", workspaceId: WORKSPACE, consumerId: "test-consumer",
      reason: "即将调用执行能力", settledAt: AT,
    }, "started"));
    expect(started.status, JSON.stringify(started)).toBe("committed");
    const startedIntent = await loadIntent(s, intentId);
    expect(startedIntent.intent.sideEffectStarted).toBe(true);
    expect(startedIntent.intent.status).toBe("leased");

    const denied = await s.h.control.settleCommunicationIntent(settleCommand(intentId, startedIntent.revision, startedIntent.intent.leaseGeneration, {
      outcome: "no_effect_failure", workspaceId: WORKSPACE, consumerId: "test-consumer",
      reason: "不该被接受", backoffMs: 60_000, settledAt: AT,
    }, "retry-denied"));
    expect(denied.status).toBe("rejected");
    const after = await loadIntent(s, intentId);
    expect(after.intent.status).toBe("leased");
    expect(after.intent.sideEffectStarted).toBe(true);
    expect(after.revision).toBe(startedIntent.revision);
  });

  it("租约到期不构成重跑依据：sideEffectStarted 的 intent 经正式对账进入可见 quarantine", async () => {
    let now = AT;
    const h = createInMemoryHarness({ deps: { clock: () => now }, runtimeScript: STARTED_ONLY });
    const s = await bootstrapScenario(h, "lease");
    const c0 = await cursorOfFirstEvent(h);
    await subscribeAt(s, "sub-l", c0);
    const intentId = subscriptionCatchupIdFor(subscriptionRefFor(PROJECT, WORKSPACE, "sub-l"));
    const claimed = await claimIntent(s, intentId, AT, 1_000);
    const started = await s.h.control.settleCommunicationIntent(settleCommand(intentId, claimed.revision, claimed.leaseGeneration, {
      outcome: "side_effect_started", workspaceId: WORKSPACE, consumerId: "test-consumer",
      reason: "即将调用执行能力", settledAt: AT,
    }, "lease-started"));
    expect(started.status).toBe("committed");
    const beforeExpiry = await loadIntent(s, intentId);

    now = "2026-09-05T12:30:00.000Z";
    const drive = await h.drive({ reason: "rc-lease-expired", maxIntents: 4 });
    expect(drive.coordination?.failures).toEqual([]);
    const after = await loadIntent(s, intentId);
    expect(after.intent.leaseGeneration).toBe(claimed.leaseGeneration);
    expect(after.revision).toBe(beforeExpiry.revision + 1);
    expect(after.intent.status).toBe("quarantined");
    expect(after.intent.sideEffectStarted).toBe(true);
    expect(drive.coordination?.backlog?.quarantined).toBeGreaterThanOrEqual(1);
    expect(after.intent.lastFailureClass).toContain('No verifiable external receipt');
    const repeat = await h.drive({ reason: 'isolated-again', maxIntents: 4 });
    expect(repeat.coordination?.claimed).toBe(0);
    expect((await loadIntent(s, intentId)).revision).toBe(after.revision);
  });
});
// ------------------------------------------------------------------------ //
// 5. 先持久化取消意图：真实生产者（等待被取消 → 它派生的机械 intent 先被标记）      //
// ------------------------------------------------------------------------ //

/** 找一个等待派生出来的 wait_admission intent（真实账本事实，不猜 id）。 */
async function admissionIntentOf(s: Scenario, waitId: string): Promise<CommunicationIntentSnapshot> {
  let cursor: CommitCursor | null = null;
  for (;;) {
    const page: EventPage = await s.h.ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const positioned of page.events) {
      if (positioned.event.eventType !== "CommunicationIntentRecorded") continue;
      const intent = (positioned.event as { payload: { intent: CommunicationIntentSnapshot["intent"] } }).payload.intent;
      if (intent.domain.kind !== "wait_admission") continue;
      if (intent.domain.waitRef.waitId !== waitId) continue;
      return loadIntent(s, intent.intentId);
    }
    if (!page.hasMore || page.throughCursor === null || page.throughCursor === cursor) break;
    cursor = page.throughCursor;
  }
  throw new Error("wait_admission intent missing: " + waitId);
}

async function scenarioWithSatisfiedWait(suffix: string): Promise<{ s: Scenario; waitId: string }> {
  const now = AT;
  const h = createInMemoryHarness({ deps: { clock: () => now }, runtimeScript: STARTED_ONLY });
  const s = await bootstrapScenario(h, suffix);
  const c0 = await cursorOfFirstEvent(h);
  const sent = await sendRequest(s, "req-" + suffix, "NONCE-" + suffix);
  await subscribeAt(s, "sub-w", c0);
  const waitId = "wait-" + suffix;
  const deliveryRef = deliveryRefFor(PROJECT, WORKSPACE, subscriptionDeliveryIdFor({
    subscriptionRef: subscriptionRefFor(PROJECT, WORKSPACE, "sub-w"),
    topic: TOPIC, cursor: sent.cursor, targetWorkContextRef: { ...s.workC },
  }));
  const registered = await s.h.control.registerWait({
    commandId: "cmd-rc-wait-" + suffix, commandType: "RegisterWait", schemaVersion: 1, aggregateId: waitId,
    expectedRevision: 0, correlationId: "corr-rc-wait-" + suffix, submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: "rc-wait-" + suffix, agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
    payload: {
      workspaceId: WORKSPACE, ownerWorkContextRef: { ...s.workC }, ownerParticipationRef: { ...s.partC },
      predecessorRunRef: { ...s.runRef }, conditions: [{ kind: "delivery_present", deliveryRef }], deadlineAt: null,
    },
  });
  expect(registered.status, JSON.stringify(registered)).toBe("committed");
  const drive = await h.drive({ reason: "rc-wait-" + suffix, maxIntents: 6 });
  expect(drive.coordination?.failures, JSON.stringify(drive.coordination?.failures)).toEqual([]);
  return { s, waitId };
}

async function cancelWait(s: Scenario, waitId: string): Promise<void> {
  const loaded = await s.h.ledger.load(waitConditionRefFor(PROJECT, WORKSPACE, waitId));
  if (loaded.status !== "found") throw new Error("wait missing");
  const receipt = await s.h.control.cancelCommunication({
    commandId: "cmd-rc-cancel-" + waitId, commandType: "CancelCommunication", schemaVersion: 1, aggregateId: waitId,
    expectedRevision: loaded.snapshot.revision, correlationId: "corr-rc-cancel-" + waitId, submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: "rc-cancel-" + waitId, agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
    payload: { workspaceId: WORKSPACE, target: "wait", reason: "不再需要这条等待" },
  });
  expect(receipt.status, JSON.stringify(receipt)).toBe("committed");
}

describe("先持久化取消意图（A07）：等待被取消 → 派生 intent 先被标记、再被收敛", () => {
  it("未产生副作用：取消等待后 intent **先**落成 cancel_requested，drive 之后收敛为 cancelled", async () => {
    const { s, waitId } = await scenarioWithSatisfiedWait("cancel-ok");
    const before = await admissionIntentOf(s, waitId);
    expect(["pending", "leased"]).toContain(before.intent.status);

    await cancelWait(s, waitId);
    // **先持久化取消意图**：这一步没有任何执行能力被调用，账本里已经是 cancel_requested。
    const marked = await loadIntent(s, before.intent.intentId);
    expect(marked.intent.status).toBe("cancel_requested");
    expect(marked.intent.sideEffectStarted).toBe(false);
    expect(marked.revision).toBe(before.revision + 1);

    const drive = await s.h.drive({ reason: "rc-cancel-converge", maxIntents: 4 });
    expect(drive.coordination?.failures, JSON.stringify(drive.coordination?.failures)).toEqual([]);
    const converged = await loadIntent(s, before.intent.intentId);
    expect(converged.intent.status).toBe("cancelled");
  });

  it("副作用已经开始：同一个取消请求只能收敛为 outcome_unknown，绝不声称 cancelled", async () => {
    const { s, waitId } = await scenarioWithSatisfiedWait("cancel-unknown");
    const before = await admissionIntentOf(s, waitId);
    // 这条 intent 已经被协作驱动领取过（前驱仍 active → not_ready，租约保留）：同一个消费者
    // 可以直接续租，别人的租约要等过期——这里沿用驱动自己的消费者身份，避免制造伪竞争。
    const claimed = await claimIntent(s, before.intent.intentId, AT, 60_000, "coordination-drive");
    const started = await s.h.control.settleCommunicationIntent(settleCommand(before.intent.intentId, claimed.revision, claimed.leaseGeneration, {
      outcome: "side_effect_started", workspaceId: WORKSPACE, consumerId: "coordination-drive",
      reason: "即将调用执行能力", settledAt: AT,
    }, "unknown-start"));
    expect(started.status, JSON.stringify(started)).toBe("committed");

    await cancelWait(s, waitId);
    const marked = await loadIntent(s, before.intent.intentId);
    expect(marked.intent.status).toBe("cancel_requested");
    expect(marked.intent.sideEffectStarted).toBe(true);

    const drive = await s.h.drive({ reason: "rc-cancel-unknown", maxIntents: 4 });
    expect(drive.coordination?.failures, JSON.stringify(drive.coordination?.failures)).toEqual([]);
    const converged = await loadIntent(s, before.intent.intentId);
    expect(converged.intent.status).toBe("outcome_unknown");
    expect(converged.intent.sideEffectStarted).toBe(true);
  });
});

it('a burst of source events during pagination creates every round and delivers each subscription once in order', async () => {
  const h = createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY, coordinationPageSize: 1 });
  const s = await bootstrapScenario(h, 'burst');
  const first = await cursorOfFirstEvent(h);
  for (const id of ['sub-a', 'sub-b', 'sub-c']) await subscribeAt(s, id, first);
  await h.drive({ reason: 'initial-empty-round', maxIntents: 8 });
  const e1 = await sendRequest(s, 'burst-1', 'burst-one');
  expect((await h.drive({ reason: 'first-page', maxIntents: 1 })).coordination?.pagesRouted).toBe(1);
  const e2 = await sendRequest(s, 'burst-2', 'burst-two');
  const e3 = await sendRequest(s, 'burst-3', 'burst-three');
  for (const e of [e1, e2, e3]) expect((await loadIntent(s, routePageIntentIdFor(PROJECT, WORKSPACE, TOPIC, e.cursor))).intent.domain.kind).toBe('route_page');
  for (let page = 0; page < 12; page++) {
    const result = await h.drive({ reason: 'drain-one-page', maxIntents: 1 });
    expect(result.coordination?.failures ?? []).toEqual([]);
  }
  const delivered = await subscriptionDeliveries(s);
  expect(delivered).toHaveLength(9);
  for (const id of ['sub-a', 'sub-b', 'sub-c']) {
    expect(delivered.filter(d => d.subscriptionId === id).map(d => d.sourceCursor)).toEqual([e1, e2, e3].map(e => String(e.cursor)));
  }
});

async function subscribeTopics(s: Scenario, id: string, startCursor: CommitCursor | null, topics = [TOPIC]) {
  const receipt = await s.h.control.createSubscription({ commandId: id, commandType: 'CreateSubscription', schemaVersion: 1, aggregateId: id,
    expectedRevision: 0, correlationId: id, submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: id, agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
    payload: { workspaceId: WORKSPACE, ownerWorkContextRef: s.workC, ownerParticipationRef: s.partC, startCursor, topics } });
  expect(receipt.status, JSON.stringify(receipt)).toBe('committed');
}

it('one historical subscription preserves multiple topics and hands over to live sources at its fixed creation horizon', async () => {
  const h = createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY });
  const s = await bootstrapScenario(h, 'multi-history');
  const start = await cursorOfFirstEvent(h);
  const e1 = await sendRequest(s, 'history-request', 'history');
  const prior = await h.ledger.load(s.partC); if (prior.status !== 'found') throw Error('participation missing');
  const ended = await h.control.endWorkParticipation({ commandId: 'history-end', commandType: 'EndWorkParticipation', schemaVersion: 1,
    aggregateId: s.partC.participationId, expectedRevision: prior.snapshot.revision, correlationId: 'history-end', submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: 'history-end', agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
    payload: { workspaceId: WORKSPACE, workContextRef: s.workC, runRef: s.runRef, reason: 'handover' } });
  expect(ended.status, JSON.stringify(ended)).toBe('committed');
  const endCursor = (await scanEvents(h)).find(e => e.eventType === 'WorkParticipationEnded')!.cursor;
  s.partC = workParticipationRefFor(PROJECT, WORKSPACE, WORK_C, 'history-new-part');
  expect((await h.control.startWorkParticipation({ commandId: 'history-new-part', commandType: 'StartWorkParticipation', schemaVersion: 1,
    aggregateId: s.partC.participationId, expectedRevision: 0, correlationId: 'history-new-part', submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(s.runRef), idempotencyKey: 'history-new-part', agentPrincipal: principalFor(s.runRef, s.workC, s.partC) },
    payload: { workspaceId: WORKSPACE, workContextRef: s.workC, agentInstanceId: AGENT, roleBinding: ROLE_BINDING_FIXTURE_V1, runRef: s.runRef } })).status).toBe('committed');
  await subscribeTopics(s, 'history-multi', start, [TOPIC, 'WorkParticipationEnded']);
  const subRef = subscriptionRefFor(PROJECT, WORKSPACE, 'history-multi');
  const original = await h.ledger.load(subRef); if (original.status !== 'found') throw Error('sub');
  const fixed = (original.snapshot as SubscriptionSnapshot).subscription.catchup!;
  const e2 = await sendRequest(s, 'live-during-history', 'live');
  const first = await h.drive({ reason: 'one-historical-page', maxIntents: 1 });
  expect(first.coordination?.deliveries).toBe(1);
  expect((await subscriptionDeliveries(s)).map(d => d.sourceCursor)).toEqual([String(e1.cursor)]);
  for (let i = 0; i < 8; i++) expect((await h.drive({ reason: 'history-drain', maxIntents: 1 })).coordination?.failures ?? []).toEqual([]);
  expect((await subscriptionDeliveries(s)).map(d => d.sourceCursor)).toEqual([e1.cursor, endCursor, e2.cursor].map(String));
  const intent = await h.ledger.load(fixed.intentRef); if (intent.status !== 'found') throw Error('intent');
  const domain = (intent.snapshot as CommunicationIntentSnapshot).intent.domain;
  expect(domain.kind === 'subscription_catchup' && domain.scanCursor).toBe(fixed.horizonCursor);
  expect((intent.snapshot as CommunicationIntentSnapshot).intent.status).toBe('done');
});

it('a subscription committed while a source is awaiting commit joins that source atomically', async () => {
  const h = createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY });
  const s = await bootstrapScenario(h, 'subscription-race');
  const original = h.ledger.commit.bind(h.ledger);
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(r => entered = r), go = new Promise<void>(r => release = r);
  h.ledger.commit = async batch => {
    if (batch.commitKind === 'directed-request-send') { entered(); await go; }
    return original(batch);
  };
  const source = sendRequest(s, 'racing-request', 'race');
  await ready;
  try { await subscribeTopics(s, 'racing-sub', null); } finally { release(); }
  const event = await source; h.ledger.commit = original;
  const intent = await loadIntent(s, routePageIntentIdFor(PROJECT, WORKSPACE, TOPIC, event.cursor));
  expect(intent.intent.domain.kind === 'route_page' && intent.intent.domain.subscriptionScope.map(e => e.subscriptionRef.subscriptionId)).toEqual(['racing-sub']);
  const driven = await h.drive({ reason: 'after-race', maxIntents: 1 });
  expect(driven.coordination?.failures).toEqual([]);
  expect((await subscriptionDeliveries(s)).map(d => d.subscriptionId)).toEqual(['racing-sub']);
});

it('cancelling the final subscription during a fixed three-page round advances the page without delivering to it', async () => {
  const h = createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY, coordinationPageSize: 1 });
  const s = await bootstrapScenario(h, 'cancel-page');
  for (const id of ['cancel-a','cancel-b','cancel-c']) await subscribeTopics(s, id, null);
  await sendRequest(s, 'cancel-page-source', 'cancel-page');
  expect((await h.drive({ reason: 'cancel-first-page', maxIntents: 1 })).coordination?.deliveries).toBe(1);
  const sub = await h.ledger.load(subscriptionRefFor(PROJECT, WORKSPACE, 'cancel-c')); if (sub.status !== 'found') throw Error('sub');
  expect((await h.control.cancelCommunication({ commandId: 'cancel-c', commandType: 'CancelCommunication', schemaVersion: 1,
    aggregateId: 'cancel-c', expectedRevision: sub.snapshot.revision, correlationId: 'cancel-c', submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: 'human', id: 'user-1' }, idempotencyKey: 'cancel-c' },
    payload: { workspaceId: WORKSPACE, target: 'subscription', reason: 'stop delivery' } })).status).toBe('committed');
  for (let i = 0; i < 3; i++) expect((await h.drive({ reason: 'cancel-rest', maxIntents: 1 })).coordination?.failures).toEqual([]);
  expect((await subscriptionDeliveries(s)).map(d => d.subscriptionId)).toEqual(['cancel-a','cancel-b']);
});

it('restart-style recovery finishes derived cancellation after the Wait commit succeeded and the caller disappeared', async () => {
  const { s, waitId } = await scenarioWithSatisfiedWait('cancel-crash');
  const intent = await admissionIntentOf(s, waitId);
  const original = s.h.ledger.commit.bind(s.h.ledger);
  s.h.ledger.commit = async batch => {
    const result = await original(batch);
    if (batch.commitKind === 'wait-cancel' && result.status === 'committed') throw Error('simulated loss after wait commit');
    return result;
  };
  await expect(cancelWait(s, waitId)).rejects.toThrow('simulated loss');
  s.h.ledger.commit = original;
  expect((await loadIntent(s, intent.intent.intentId)).intent.status).toBe('leased');
  const recovered = await s.h.drive({ reason: 'rebuild-after-cancel-crash', maxIntents: 4 });
  expect(recovered.coordination?.failures).toEqual([]);
  expect((await loadIntent(s, intent.intent.intentId)).intent.status).toBe('cancelled');
  expect((await scanEvents(s.h)).filter(e => e.eventType === 'CommunicationAdmissionRecorded')).toHaveLength(0);
});


it('a one-intent budget rotates historical subscriptions by durable progress even when wall time is fixed', async () => {
  const h = createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY });
  const s = await bootstrapScenario(h, 'finite-fairness');
  const start = await cursorOfFirstEvent(h);
  for (let i = 0; i < 5; i++) await sendRequest(s, 'fair-source-' + i, 'fair-' + i);
  for (const id of ['fair-a','fair-b','fair-c']) await subscribeTopics(s, id, start);
  for (let i = 0; i < 3; i++) {
    const result = await h.drive({ reason: 'fair-one-slot', maxIntents: 1 });
    expect(result.coordination?.pagesRouted).toBe(1);
    expect(result.coordination?.backlog.oldestPendingIntent).not.toBeNull();
    expect(result.coordination?.failures).toEqual([]);
  }
  const refs = (await subscriptionDeliveries(s)).map(d => d.subscriptionId);
  expect(new Set(refs)).toEqual(new Set(['fair-a','fair-b','fair-c']));
});
