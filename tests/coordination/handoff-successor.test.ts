/**
 * CM-1A-001 第 2 步：统一 Work／参与关系／后继身份（换手与 R7）的**真实消费者**验证。
 *
 * 走的都是生产实现：真实 InMemoryLedger、真实 ControlEngineImpl、真实 DispatchEngineImpl
 * （协作驱动挂在它唯一的 drive 收口之内）、真实 ensureWorkIdentity。不绕过 Control 直写账本，
 * 也不构造第二条调度入口。
 *
 * 覆盖（对照用户逐字要求与 CM-1A-001 §5）：
 *   1. 换手：旧参与段 endWorkParticipation → 新参与段 startWorkParticipation 之后，同一等待仍
 *      产生**同一 Work** 的唯一后继，且该后继的 Work 就是 admission 固定的那个（A01/A05）；
 *   2. 无有效参与者：保留等待、给出可读原因、零写入、不产生后继（A05）；
 *   4. 身份不混用：调度触发用 system 身份 + 来源关联；「新参与者 + 旧 Run」拼身份的尝试被拒（A01）；
 *   R7：已受理的后继在派发期**不再**按 (goal, task) 解析 —— ensureWorkIdentity 的解析面调用次数为 0，
 *      且带对抗性替身（回答 absent）时仍然把 Run link 到 admission 固定的 Work。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryHarness, type InMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { createControlEngine } from "../../src/control/control-engine/control-engine.js";
import { createDeterministicDeps } from "../../src/testing/sequences.js";
import {
  buildCoordinationPolicyActivateCommand,
  buildCoordinationPolicyInstallCommand,
  buildRoleSpecActivateCommand,
  buildRoleSpecInstallCommand,
} from "../../src/contracts/commands/governance.js";
import {
  buildCoordinationPolicyContentWithRolesV1,
  roleSpecSourceFor,
  ROLE_SOURCE_EXECUTOR,
  ROLE_SOURCE_INDEPENDENT_REVIEWER,
  ROLE_SOURCE_RECORDER,
  ROLE_SOURCE_SECRETARY,
} from "../../src/fixtures/role-spec-fixtures.js";
import { ROLE_SPEC_REVISION, roleSpecContentDigest, roleSpecRevisionRefFor, type RoleSpecContentV1 } from "../../src/contracts/role-spec.js";
import type { RoleBindingRefV1 } from "../../src/contracts/dispatch.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { buildPreparedClaim, prepareP103Project, type P1_03TestHarness } from "../contract-suite/p1-03-harness.js";
import { DISPATCH_ELIGIBLE_TASK_ID, ROLE_BINDING_FIXTURE_V1, type FakeRuntimeScriptV1 } from "../../src/fixtures/dispatch-fixtures.js";
import { dispatchOutboxRefFor, runRefFor } from "../../src/contracts/dispatch.js";
import type { DispatchOutboxEntrySnapshot, RunRef, RunSnapshot } from "../../src/contracts/dispatch.js";
import { buildRunFactCommand } from "../../src/contracts/commands/dispatch.js";
import type { WorkContextRef } from "../../src/contracts/context-continuity.js";
import type { WorkContextBindingSnapshot } from "../../src/contracts/context-continuity.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { EventPage } from "../../src/contracts/ledger.js";
import type { ArtifactRef } from "../../src/contracts/artifact.js";
import {
  communicationIntentRefFor,
  deliveryRefFor,
  subscriptionRefFor,
  successorAttemptIdFor,
  successorRunIdFor,
  waitAdmissionIntentIdFor,
  workParticipationRefFor,
} from "../../src/contracts/coordination.js";
import type {
  AdmitWaitSuccessorCommand,
  AgentPrincipalRefV1,
  CommunicationAdmissionSnapshot,
  CommunicationIntentSnapshot,
  DeliveryRef,
  DeliverySnapshot,
  EndWorkParticipationCommand,
  RegisterAgentInstanceCommand,
  RegisterWaitCommand,
  SendDirectedRequestCommand,
  StartWorkParticipationCommand,
  SubscribeCommand,
  WaitConditionRef,
  WaitConditionSnapshot,
  WorkParticipationRef,
  WorkParticipationSnapshot,
} from "../../src/contracts/coordination.js";
import { subscriptionDeliveryIdFor } from "../../src/control/dispatch-engine/coordination-drive.js";
import { ensureWorkIdentity, type WorkIdentityDeps } from "../../src/control/dispatch-engine/work-identity.js";

const AT = "2026-09-05T12:00:00.000Z";
const PROJECT = "proj-alpha";
const WORKSPACE = "ws-shared";
const GOAL = "goal-1";
const TASK = DISPATCH_ELIGIBLE_TASK_ID;
const WORK_C = "work-c";
const WORK_A = "work-a";
const AGENT_A = "agent-hand-a";
const AGENT_B = "agent-hand-b";
/** 协议约束 2.1 的换手用例里，接管者的第三个 AgentInstance（第一段的 AGENT_A 仍持有 work-a 之外的旧记录）。 */
const AGENT_C = "agent-hand-c";
/** 2.2 空交集用例第三段的接管者。 */
const AGENT_D = "agent-hand-d";
const PLAN_REF = { aggregateType: "PlanRevision", projectId: PROJECT, planId: "plan-dispatch-mvp" } as const;

/** 只发 run_started：前驱 Run 停在 running（信封已落账，后继受理要求它已公开结束）。 */
const STARTED_ONLY: FakeRuntimeScriptV1 = {
  schemaVersion: 1,
  items: [{ sequence: 1, eventType: "run_started", payload: { kind: "started", startedAt: "2026-09-05T12:00:01.000Z" }, occurredAt: "2026-09-05T12:00:01.000Z" }],
};

type Scenario = {
  h: InMemoryHarness;
  runRef: RunRef;
  workC: WorkContextRef;
  workA: WorkContextRef;
  partC: WorkParticipationRef;
};

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function agentActor(agentInstanceId: string, runRef: RunRef) {
  return { kind: "agent" as const, id: agentInstanceId, runRef: { ...runRef } };
}

function principalFor(input: {
  agentInstanceId: string;
  runRef: RunRef;
  workContextRef: WorkContextRef;
  participationRef: WorkParticipationRef;
}): AgentPrincipalRefV1 {
  return {
    schemaVersion: 1,
    agentInstanceId: input.agentInstanceId,
    workContextRef: { ...input.workContextRef },
    participationRef: { ...input.participationRef },
    roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
    runRef: { ...input.runRef },
  };
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

async function countEvents(h: InMemoryHarness, type: string): Promise<number> {
  let cursor: CommitCursor | null = null;
  let total = 0;
  for (;;) {
    const page: EventPage = await h.ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const positioned of page.events) if (positioned.event.eventType === type) total += 1;
    if (!page.hasMore || page.throughCursor === null || page.throughCursor === cursor) return total;
    cursor = page.throughCursor;
  }
}

async function cursorOfFirstEvent(h: InMemoryHarness): Promise<CommitCursor> {
  const page: EventPage = await h.ledger.events({ afterCursor: null, limit: 1 });
  return page.events[0]!.cursor;
}

async function cursorOfEvent(h: InMemoryHarness, eventType: string): Promise<CommitCursor> {
  let cursor: CommitCursor | null = null;
  for (;;) {
    const page: EventPage = await h.ledger.events({ afterCursor: cursor, limit: 1000 });
    for (const positioned of page.events) if (positioned.event.eventType === eventType) return positioned.cursor;
    if (!page.hasMore || page.throughCursor === null || page.throughCursor === cursor) throw new Error("event not found: " + eventType);
    cursor = page.throughCursor;
  }
}

function waitRefOf(waitId: string): WaitConditionRef {
  return { aggregateType: "WaitCondition", projectId: PROJECT, workspaceId: WORKSPACE, waitId };
}

async function loadBinding(s: Scenario): Promise<WorkContextBindingSnapshot> {
  const loaded = await s.h.ledger.load(s.workC);
  if (loaded.status !== "found") throw new Error("work binding missing");
  return loaded.snapshot as WorkContextBindingSnapshot;
}

async function loadWait(s: Scenario, waitId: string): Promise<WaitConditionSnapshot> {
  const loaded = await s.h.ledger.load(waitRefOf(waitId));
  if (loaded.status !== "found") throw new Error("wait missing");
  return loaded.snapshot as WaitConditionSnapshot;
}

async function loadParticipation(s: Scenario, ref: WorkParticipationRef): Promise<WorkParticipationSnapshot> {
  const loaded = await s.h.ledger.load(ref);
  if (loaded.status !== "found") throw new Error("participation missing: " + ref.participationId);
  return loaded.snapshot as WorkParticipationSnapshot;
}

/** 夹具：真实项目链 + 真实前驱 Run（停在 running）+ 两个 Work + 两个 AgentInstance。 */
async function bootstrapScenario(suffix: string): Promise<Scenario> {
  const h = createInMemoryHarness({ deps: { clock: () => AT }, runtimeScript: STARTED_ONLY });
  const boot = await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-hs-boot-" + suffix, correlationId: "corr-hs-boot-" + suffix, submittedAt: AT,
  }));
  expect(boot.status).toBe("committed");
  await prepareP103Project(adapterOf(h), PROJECT, "a");

  const claim = await h.claimTask(buildPreparedClaim({
    commandId: "cmd-hs-claim-" + suffix, correlationId: "corr-hs-claim-" + suffix,
    attemptId: "att-pred", runId: "run-pred", idempotencyKey: "hs-claim-" + suffix,
  }));
  expect(claim.status, JSON.stringify(claim)).toBe("committed");
  const runRef = runRefFor(PROJECT, GOAL, "run-pred");
  const workC = { aggregateType: "WorkContextBinding", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK_C } as const;
  const workA = { aggregateType: "WorkContextBinding", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK_A } as const;

  // work-c 是 TASK 的**任务工作身份**（等待/投递所属的 Work 与派发面解析出的是同一个）。
  const bound = await h.control.bindWorkContext({
    commandId: "cmd-hs-bind-" + suffix, commandType: "BindWorkContext", schemaVersion: 1, aggregateId: WORK_C,
    expectedRevision: 0, correlationId: "corr-hs-bind-" + suffix, submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "hs-bind-" + suffix },
    payload: {
      workspaceId: WORKSPACE, workKind: "task", goalId: GOAL, taskId: TASK,
      planRef: { ...PLAN_REF }, planRevision: 1,
      roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 }, initialRunRef: { ...runRef },
    },
  });
  expect(bound.status, JSON.stringify(bound)).toBe("committed");
  const boundA = await h.control.bindWorkContext({
    commandId: "cmd-hs-bind-a-" + suffix, commandType: "BindWorkContext", schemaVersion: 1, aggregateId: WORK_A,
    expectedRevision: 0, correlationId: "corr-hs-bind-a-" + suffix, submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "hs-bind-a-" + suffix },
    payload: {
      workspaceId: WORKSPACE, workKind: "coordination", goalId: GOAL, taskId: null,
      planRef: null, planRevision: null,
      roleBindingRef: { ...ROLE_BINDING_FIXTURE_V1 }, initialRunRef: { ...runRef },
    },
  });
  expect(boundA.status, JSON.stringify(boundA)).toBe("committed");

  // 前驱 Run 由唯一 drive 收口真实启动（信封与工作身份 link 都按产品路径落账）。
  const first = await h.drive({ reason: "hs-start-pred-" + suffix, maxIntents: 1 });
  expect(first.failures, JSON.stringify(first.failures)).toEqual([]);
  expect(first.started).toBe(1);

  const s: Scenario = { h, runRef, workC, workA, partC: workParticipationRefFor(PROJECT, WORKSPACE, WORK_C, "part-c") };
  await registerAgent(s, AGENT_A, suffix + "-a");
  const started = await startParticipation(s, { participationId: "part-c", agentInstanceId: AGENT_A, runRef, suffix: suffix + "-c" });
  expect(started.status, JSON.stringify(started)).toBe("committed");
  return s;
}

async function registerAgent(s: Scenario, agentInstanceId: string, suffix: string) {
  const command: RegisterAgentInstanceCommand = {
    commandId: "cmd-hs-agent-" + suffix, commandType: "RegisterAgentInstance", schemaVersion: 1,
    aggregateId: agentInstanceId, expectedRevision: 0, correlationId: "corr-hs-agent-" + suffix, submittedAt: AT,
    identity: { projectId: PROJECT, actor: agentActor(agentInstanceId, s.runRef), idempotencyKey: "hs-agent-" + suffix },
    payload: { workspaceId: WORKSPACE, templateId: "template-runner", templateRevision: "1" },
  };
  return s.h.control.registerAgentInstance(command);
}

/**
 * 建立一段参与关系。runRef 用已经 link 在该 Work 上的 Run：参与关系的发起 Run 只需真实存在
 * 且已 link（startWorkParticipation 的守卫），接管新 Work 的那一段沿用前驱 Run 因此合法。
 */
async function startParticipation(s: Scenario, input: {
  participationId: string; agentInstanceId: string; runRef: RunRef; suffix: string;
  /** 缺省用夹具绑定；协议约束 2.2 的用例会改成矩阵签发的绑定。 */
  roleBinding?: RoleBindingRefV1;
}) {
  const roleBinding = input.roleBinding ?? { ...ROLE_BINDING_FIXTURE_V1 };
  const participationRef = workParticipationRefFor(PROJECT, WORKSPACE, WORK_C, input.participationId);
  const command: StartWorkParticipationCommand = {
    commandId: "cmd-hs-part-" + input.suffix, commandType: "StartWorkParticipation", schemaVersion: 1,
    aggregateId: input.participationId, expectedRevision: 0, correlationId: "corr-hs-part-" + input.suffix, submittedAt: AT,
    identity: {
      projectId: PROJECT,
      actor: agentActor(input.agentInstanceId, input.runRef),
      idempotencyKey: "hs-part-" + input.suffix,
      agentPrincipal: {
        ...principalFor({
          agentInstanceId: input.agentInstanceId, runRef: input.runRef, workContextRef: s.workC, participationRef,
        }),
        roleBinding: { ...roleBinding },
      },
    },
    payload: {
      workspaceId: WORKSPACE, workContextRef: { ...s.workC }, agentInstanceId: input.agentInstanceId,
      roleBinding: { ...roleBinding }, runRef: { ...input.runRef },
    },
  };
  return s.h.control.startWorkParticipation(command);
}

async function endParticipation(s: Scenario, participationId: string, agentInstanceId: string, suffix: string) {
  const participationRef = workParticipationRefFor(PROJECT, WORKSPACE, WORK_C, participationId);
  const prior = await loadParticipation(s, participationRef);
  const command: EndWorkParticipationCommand = {
    commandId: "cmd-hs-end-" + suffix, commandType: "EndWorkParticipation", schemaVersion: 1,
    aggregateId: participationId, expectedRevision: prior.revision,
    correlationId: "corr-hs-end-" + suffix, submittedAt: AT,
    identity: {
      projectId: PROJECT,
      actor: agentActor(agentInstanceId, s.runRef),
      idempotencyKey: "hs-end-" + suffix,
      agentPrincipal: principalFor({
        agentInstanceId, runRef: s.runRef, workContextRef: s.workC, participationRef,
      }),
    },
    payload: { workspaceId: WORKSPACE, workContextRef: { ...s.workC }, runRef: { ...s.runRef }, reason: "本段参与结束" },
  };
  return s.h.control.endWorkParticipation(command);
}

async function sendRequest(s: Scenario, nonce: string, suffix: string): Promise<ArtifactRef> {
  const body = JSON.stringify({ investigation: "report-A", nonce });
  const stored = await s.h.vault.put({
    contentType: "application/json", body, ownerRef: { ...s.runRef },
    sourceRefs: [{ kind: "workspace", refId: WORKSPACE, revision: "1" }], requestedAt: AT,
  });
  expect(stored.status).toBe("stored");
  if (stored.status !== "stored") throw new Error("vault put failed");
  const command: SendDirectedRequestCommand = {
    commandId: "cmd-hs-req-" + suffix, commandType: "SendDirectedRequest", schemaVersion: 1, aggregateId: "req-1",
    expectedRevision: 0, correlationId: "corr-hs-req-" + suffix, submittedAt: AT,
    identity: {
      projectId: PROJECT, actor: agentActor(AGENT_A, s.runRef), idempotencyKey: "hs-req-" + suffix,
      agentPrincipal: principalFor({ agentInstanceId: AGENT_A, runRef: s.runRef, workContextRef: s.workC, participationRef: s.partC }),
    },
    payload: {
      workspaceId: WORKSPACE, fromParticipationRef: { ...s.partC }, fromRunRef: { ...s.runRef },
      toWorkContextRef: { ...s.workA }, expectedParticipationRef: null,
      statement: "请只读调查报告 A", statementBodyRef: stored.ref, roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
    },
  };
  const receipt = await s.h.control.sendDirectedRequest(command);
  expect(receipt.status, JSON.stringify(receipt)).toBe("committed");
  return stored.ref;
}

async function subscribeToRequest(s: Scenario, suffix: string): Promise<CommitCursor> {
  const origin = await cursorOfFirstEvent(s.h);
  const command: SubscribeCommand = {
    commandId: "cmd-hs-sub-" + suffix, commandType: "CreateSubscription", schemaVersion: 1, aggregateId: "sub-1",
    expectedRevision: 0, correlationId: "corr-hs-sub-" + suffix, submittedAt: AT,
    identity: {
      projectId: PROJECT, actor: agentActor(AGENT_A, s.runRef), idempotencyKey: "hs-sub-" + suffix,
      agentPrincipal: principalFor({ agentInstanceId: AGENT_A, runRef: s.runRef, workContextRef: s.workC, participationRef: s.partC }),
    },
    payload: {
      workspaceId: WORKSPACE, ownerWorkContextRef: { ...s.workC }, ownerParticipationRef: { ...s.partC },
      topics: ["DirectedRequestSent"], startCursor: origin,
    },
  };
  const receipt = await s.h.control.createSubscription(command);
  expect(receipt.status, JSON.stringify(receipt)).toBe("committed");
  return origin;
}

/** 订阅路由页投给 owner Work（work-c）的那条 Delivery 的确定性引用。 */
async function deliveryRefForWorkC(s: Scenario): Promise<DeliveryRef> {
  const cursor = await cursorOfEvent(s.h, "DirectedRequestSent");
  return deliveryRefFor(PROJECT, WORKSPACE, subscriptionDeliveryIdFor({
    subscriptionRef: subscriptionRefFor(PROJECT, WORKSPACE, "sub-1"),
    topic: "DirectedRequestSent",
    cursor,
    targetWorkContextRef: { ...s.workC },
  }));
}

function waitCommandFor(s: Scenario, waitId: string, deliveryRef: DeliveryRef, suffix: string): RegisterWaitCommand {
  return {
    commandId: "cmd-hs-wait-" + suffix, commandType: "RegisterWait", schemaVersion: 1, aggregateId: waitId,
    expectedRevision: 0, correlationId: "corr-hs-wait-" + suffix, submittedAt: AT,
    identity: {
      projectId: PROJECT, actor: agentActor(AGENT_A, s.runRef), idempotencyKey: "hs-wait-" + suffix,
      agentPrincipal: principalFor({ agentInstanceId: AGENT_A, runRef: s.runRef, workContextRef: s.workC, participationRef: s.partC }),
    },
    payload: {
      workspaceId: WORKSPACE, ownerWorkContextRef: { ...s.workC }, ownerParticipationRef: { ...s.partC },
      predecessorRunRef: { ...s.runRef }, conditions: [{ kind: "delivery_present", deliveryRef }], deadlineAt: null,
    },
  };
}

async function endPredecessor(s: Scenario): Promise<void> {
  const loaded = await s.h.ledger.load(s.runRef);
  expect(loaded.status).toBe("found");
  if (loaded.status !== "found") return;
  const receipt = await s.h.runFact(buildRunFactCommand({
    actor: { kind: "human", id: "user-1" }, idempotencyKey: "hs-end-pred", commandId: "cmd-hs-end-pred",
    correlationId: "corr-hs-end-pred", submittedAt: AT, projectId: PROJECT, runId: s.runRef.runId,
    expectedRevision: loaded.snapshot.revision,
    fact: {
      kind: "runtime_event",
      event: {
        eventType: "run_completed", schemaVersion: 1, eventId: "rt-hs-pred-end", runRef: { ...s.runRef },
        sequence: 2, occurredAt: AT, payload: { kind: "completed", exitCode: 0 },
      },
    },
  }));
  expect(receipt.status, JSON.stringify(receipt)).toBe("committed");
}

/** 后继的事实计数：相对夹具基线的增量（夹具本身已有一个真实前驱 Run 与它的 Attempt/outbox）。 */
async function successorFacts(s: Scenario): Promise<{ attempts: number; runs: number; pending: number }> {
  return {
    attempts: (await countEvents(s.h, "TaskClaimed")) - 1,
    runs: (await countEvents(s.h, "RunStarted")) - 1,
    pending: (await s.h.ledger.pendingDispatchIntents(50, { workKind: "ordinary" })).length,
  };
}

/**
 * 把等待推到「条件已满足 + wait_admission intent 已建立」的状态。
 * 顺序刻意与真实链一致：订阅（起点固定）→ 注册等待 → 一次 drive 把路由页投给该 Work，页在同一
 * 事务里满足等待条件，并由 Control 幂等建立 wait_admission intent（前驱仍 active 时只 deferred）。
 */
async function prepareWait(s: Scenario, waitId: string, suffix: string): Promise<DeliveryRef> {
  await sendRequest(s, "NONCE-" + suffix, suffix);
  await subscribeToRequest(s, suffix);
  // Delivery 引用由 (订阅, topic, 源事件位置, 目标 Work) 确定性派生 —— 页还没提交就可以算出。
  const deliveryRef = await deliveryRefForWorkC(s);
  const registered = await s.h.control.registerWait(waitCommandFor(s, waitId, deliveryRef, suffix));
  expect(registered.status, JSON.stringify(registered)).toBe("committed");
  const routed = await s.h.drive({ reason: "hs-route-" + suffix, maxIntents: 6 });
  expect(routed.coordination?.failures, JSON.stringify(routed.coordination?.failures)).toEqual([]);
  expect(routed.coordination?.deliveries).toBe(1);
  expect(routed.coordination?.admissions).toBe(0);
  return deliveryRef;
}

function admitCommandFor(s: Scenario, input: {
  commandId: string;
  waitId: string;
  actor: AdmitWaitSuccessorCommand["identity"]["actor"];
  principal?: AgentPrincipalRefV1;
  participationRef: WorkParticipationRef;
  agentInstanceId: string;
}): Promise<AdmitWaitSuccessorCommand> {
  return (async () => {
    const wait = await loadWait(s, input.waitId);
    const binding = (await loadBinding(s)).binding;
    const participation = await loadParticipation(s, input.participationRef);
    const predecessor = await s.h.ledger.load(s.runRef);
    if (predecessor.status !== "found") throw new Error("predecessor missing");
    const run = predecessor.snapshot as RunSnapshot;
    if (run.envelope === null) throw new Error("predecessor has no envelope");
    const satisfiedRevision = wait.revision + 1;
    const intentRef = communicationIntentRefFor(PROJECT, WORKSPACE, waitAdmissionIntentIdFor(input.waitId, satisfiedRevision));
    const intent = await s.h.ledger.load(intentRef);
    const active = intent.status === 'found' ? intent.snapshot as import('../../src/contracts/coordination.js').CommunicationIntentSnapshot : undefined;
    const claim = active?.intent.status === 'leased' && active.intent.leaseOwner ? {
      intentRef, consumerId: active.intent.leaseOwner, leaseGeneration: active.intent.leaseGeneration, revision: active.revision,
    } : undefined;
    const actor = input.actor.kind === 'system' && claim ? { ...input.actor, id: claim.consumerId } : input.actor;
    const attemptId = successorAttemptIdFor(WORK_C, input.waitId, satisfiedRevision);
    const deliveryRefs = wait.wait.conditions
      .filter((term) => term.kind === "delivery_present")
      .map((term) => (term as Extract<typeof term, { kind: "delivery_present" }>).deliveryRef);
    return {
      commandId: input.commandId, commandType: "AdmitWaitSuccessor", schemaVersion: 1,
      aggregateId: input.waitId, expectedRevision: wait.revision, correlationId: input.commandId, submittedAt: AT,
      identity: {
        projectId: PROJECT,
        actor,
        idempotencyKey: input.commandId,
        ...(input.principal === undefined ? {} : { agentPrincipal: input.principal }),
      },
      payload: {
        workspaceId: WORKSPACE, waitRef: wait.ref, ...(claim ? { intentClaim: claim } : {}), workContextRef: { ...s.workC },
        participationRef: { ...input.participationRef }, agentInstanceId: input.agentInstanceId,
        predecessorRunRef: { ...s.runRef }, goalId: GOAL, taskId: TASK,
        attemptId, runId: successorRunIdFor(attemptId),
        planRef: binding.planRef ?? run.planRef,
        roleBinding: { ...participation.participation.roleBinding },
        declaredPermissions: {
          tools: [...run.envelope.permissions.tools], writeScope: [...run.envelope.permissions.writeScope],
        },
        budget: run.budget,
        workspaceRevision: run.workspaceSnapshot.revision,
        deliveryRefs,
      },
    };
  })();
}

async function loadAdmission(s: Scenario, waitId: string): Promise<CommunicationAdmissionSnapshot> {
  const loaded = await s.h.ledger.load({ aggregateType: "CommunicationAdmission", projectId: PROJECT, workspaceId: WORKSPACE, waitId });
  if (loaded.status !== "found") throw new Error("admission missing");
  return loaded.snapshot as CommunicationAdmissionSnapshot;
}

// ------------------------------------------------------------------------ //
// 换手（A01/A05）与 R7                                                     //
// ------------------------------------------------------------------------ //

describe("第 2 步：换手后的唯一后继与 admission 固定的 Work", () => {
  it("旧参与段结束后新参与段建立：等待仍产生同一 Work 的唯一后继，且用的是 admission 固定的参与关系", async () => {
    const s = await bootstrapScenario("handoff");
    const deliveryRef = await prepareWait(s, "wait-hand", "handoff");
    expect(await successorFacts(s)).toEqual({ attempts: 0, runs: 0, pending: 0 });

    // 条件已满足但前驱仍 active：只建立 wait_admission intent，零写入不重叠启动。
    const deferredDrive = await s.h.drive({ reason: "hs-defer", maxIntents: 6 });
    expect(deferredDrive.coordination?.admissions).toBe(0);
    expect(await successorFacts(s)).toEqual({ attempts: 0, runs: 0, pending: 0 });
    const intentRef = communicationIntentRefFor(PROJECT, WORKSPACE, waitAdmissionIntentIdFor("wait-hand", 3));
    const intent = await s.h.ledger.load(intentRef);
    expect(intent.status, "wait_admission intent 必须已建立").toBe("found");

    // ── 换手第 1 步：旧参与段结束（Work 的当前参与关系因此指向一段已 ended 的参与）──────
    const ended = await endParticipation(s, "part-c", AGENT_A, "handoff-1");
    expect(ended.status, JSON.stringify(ended)).toBe("committed");
    expect((await loadBinding(s)).binding.currentParticipationRef?.participationId).toBe("part-c");
    await endPredecessor(s);

    // ── 无有效参与者：保留等待 + 明确原因 + 零写入（完成条件 2）─────────────────────────
    const noParticipant = await s.h.drive({ reason: "hs-no-participant", maxIntents: 6 });
    expect(noParticipant.coordination?.admissions).toBe(0);
    expect(noParticipant.coordination?.failures.length ?? 0).toBeGreaterThanOrEqual(1);
    const failure = (noParticipant.coordination?.failures ?? []).map((f) => f.message).join(" | ");
    expect(failure, "拒绝原因必须可读且指向当前参与关系").toContain("当前参与关系");
    expect(failure).toContain("ended");
    expect(await successorFacts(s)).toEqual({ attempts: 0, runs: 0, pending: 0 });
    expect((await loadWait(s, "wait-hand")).wait.status, "等待必须保留").toBe("active");
    // 直接问 Control：权威原因是 no_active_participation（零写入）。
    const direct = await s.h.control.admitWaitSuccessor(await admitCommandFor(s, {
      commandId: "coord-admit-wait-hand-direct", waitId: "wait-hand",
      actor: { kind: "system", id: "handoff-direct-probe" },
      participationRef: s.partC, agentInstanceId: AGENT_A,
    }));
    expect(direct.status).toBe("rejected");
    if (direct.status === "rejected") {
      expect(direct.code).toBe("no_active_participation");
      expect((direct.issues ?? []).join(" ")).toContain("等待保持 active");
    }
    expect(await successorFacts(s)).toEqual({ attempts: 0, runs: 0, pending: 0 });
    expect((await loadWait(s, "wait-hand")).wait.status).toBe("active");

    // ── 换手第 2 步：新参与段建立（新的 AgentInstance 接管同一个 Work）─────────────────
    const agentB = await registerAgent(s, AGENT_B, "handoff-b");
    expect(agentB.status, JSON.stringify(agentB)).toBe("committed");
    const partC2 = workParticipationRefFor(PROJECT, WORKSPACE, WORK_C, "part-c2");
    const startedB = await startParticipation(s, { participationId: "part-c2", agentInstanceId: AGENT_B, runRef: s.runRef, suffix: "handoff-c2" });
    expect(startedB.status, JSON.stringify(startedB)).toBe("committed");
    expect((await loadBinding(s)).binding.currentParticipationRef?.participationId).toBe("part-c2");

    // ── 同一等待仍产生**同一个 Work** 的唯一后继 ─────────────────────────────────────
    const admitted = await s.h.drive({ reason: "hs-admit", maxIntents: 6 });
    expect(admitted.coordination?.failures, JSON.stringify(admitted.coordination?.failures)).toEqual([]);
    expect(admitted.coordination?.admissions).toBe(1);
    expect(await successorFacts(s)).toEqual({ attempts: 1, runs: 1, pending: 0 });
    expect(await countEvents(s.h, "CommunicationAdmissionRecorded")).toBe(1);

    // 协议约束 2.1（后继接续事务）：wait satisfied + admission + Attempt + Run + 唯一 outbox
    // 必须**一起提交** —— 三条事件落在同一个 commit cursor 上，且唯一 outbox 已经被同一收口消费。
    const allEvents = (await s.h.ledger.events({ afterCursor: null, limit: 2048 })).events;
    const claimEvents = allEvents.filter((positioned) =>
      ["TaskClaimed", "WaitConditionSatisfied", "CommunicationAdmissionRecorded"].includes(positioned.event.eventType));
    // 夹具本身有一个真实前驱 claim，所以只取**本次接续命令**产生的那三条（同一 causationId）。
    const successorCommand = (await loadAdmission(s, "wait-hand")).admission.admissionCommandId;
    const successorEvents = claimEvents.filter((positioned) => positioned.event.causationId === successorCommand);
    expect(successorEvents.map((positioned) => positioned.event.eventType),
      "wait satisfied + admission + Attempt/Run/唯一 outbox 必须在同一次提交里").toEqual(
      ["TaskClaimed", "WaitConditionSatisfied", "CommunicationAdmissionRecorded"]);
    // 三条事件在事件日志里位置**连续**：同一次原子追加，中间没有任何别的提交插进来。
    const seqs = successorEvents.map((positioned) => Number.parseInt(String(positioned.cursor).slice(1), 10));
    expect(Math.max(...seqs) - Math.min(...seqs), "三条事件必须落在连续的事件位置上").toBe(successorEvents.length - 1);
    expect(await s.h.ledger.pendingDispatchIntents(50, { workKind: "ordinary" })).toHaveLength(0);

    const admission = await loadAdmission(s, "wait-hand");
    // admission 原子固定了本次采用的参与关系 + 授权版本 + 目标 Delivery 集合。
    expect(admission.admission.participationRef.participationId).toBe("part-c2");
    expect(admission.admission.agentInstanceId).toBe(AGENT_B);
    expect(admission.admission.workContextRef.workId).toBe(WORK_C);
    expect(admission.admission.roleBinding).toEqual({ ...ROLE_BINDING_FIXTURE_V1 });
    expect(admission.admission.deliveryRefs.map((r) => r.deliveryId)).toEqual([deliveryRef.deliveryId]);
    expect(admission.admission.predecessorRunRef.runId).toBe("run-pred");
    // 协议约束 2.2 的**无矩阵分支**：本项目没有生效的角色矩阵（既有策略返回 spec=null，表示
    // 未校验、不等于已授权），此时保持前驱信封的权限原值 —— 不静默收成空集、也不假装已授权。
    const predecessorRun = await s.h.ledger.load(s.runRef);
    if (predecessorRun.status !== "found") throw new Error("predecessor missing");
    const inheritedPermissions = (predecessorRun.snapshot as RunSnapshot).envelope!.permissions;
    expect(admission.admission.declaredPermissions.tools).toEqual(inheritedPermissions.tools);
    expect(admission.admission.declaredPermissions.writeScope).toEqual(inheritedPermissions.writeScope);
    // 并且**落账**说明这次没有上界可比（审计要能只凭账本区分 no_matrix 与 within_spec）。
    expect(admission.admission.permissionBasis).toBe("no_matrix");

    // 等待保留**注册时**的参与关系用于追溯（历史事实），状态推进为 satisfied。
    const settled = (await loadWait(s, "wait-hand")).wait;
    expect(settled.status).toBe("satisfied");
    expect(settled.ownerParticipationRef.participationId, "注册时的参与关系必须保留").toBe("part-c");

    // 唯一后继落在同一个 Work 上：后继 Run 被 link 进 work-c。
    const successorRunId = successorRunIdFor(successorAttemptIdFor(WORK_C, "wait-hand", settled.satisfiedRevision!));
    const bindingAfter = await loadBinding(s);
    expect(bindingAfter.binding.linkedRunRefs.map((r) => r.runId)).toContain(successorRunId);

    // 再 drive 不产生第二个后继（唯一键 (workRef, waitRef, satisfiedRevision)）。
    const again = await s.h.drive({ reason: "hs-admit-again", maxIntents: 6 });
    expect(again.coordination?.admissions).toBe(0);
    expect(await successorFacts(s)).toEqual({ attempts: 1, runs: 1, pending: 0 });
    expect(await countEvents(s.h, "CommunicationAdmissionRecorded")).toBe(1);
  });
});

/** 该任务在账本里的全部 task 工作身份（由已提交的 WorkContextBound 事件数出来，不猜）。 */
async function taskWorkIdentities(s: Scenario): Promise<string[]> {
  const page = await s.h.ledger.events({ afterCursor: null, limit: 2048 });
  return page.events
    .filter((positioned) => positioned.event.eventType === "WorkContextBound")
    .map((positioned) => positioned.event as { projectId: string; workspaceId: string; aggregateId: string; payload: { binding: { workKind: string; goalId: string | null; taskId: string | null } } })
    .filter((event) => event.projectId === PROJECT && event.workspaceId === WORKSPACE
      && event.payload.binding.workKind === "task" && event.payload.binding.goalId === GOAL
      && event.payload.binding.taskId === TASK)
    .map((event) => event.aggregateId);
}

/** 走到「换手已完成、前驱已结束、条件已满足」——只差一次接续受理的状态。 */
async function readyForHandoffAdmission(suffix: string): Promise<{ s: Scenario; partC2: WorkParticipationRef }> {
  const s = await bootstrapScenario(suffix);
  await prepareWait(s, "wait-" + suffix, suffix);
  const deferred = await s.h.drive({ reason: "hs-ready-" + suffix, maxIntents: 6 });
  expect(deferred.coordination?.admissions).toBe(0);
  await endPredecessor(s);
  const ended = await endParticipation(s, "part-c", AGENT_A, suffix + "-end");
  expect(ended.status, JSON.stringify(ended)).toBe("committed");
  const agentB = await registerAgent(s, AGENT_B, suffix + "-b");
  expect(agentB.status, JSON.stringify(agentB)).toBe("committed");
  const startedB = await startParticipation(s, {
    participationId: "part-c2", agentInstanceId: AGENT_B, runRef: s.runRef, suffix: suffix + "-c2",
  });
  expect(startedB.status, JSON.stringify(startedB)).toBe("committed");
  return { s, partC2: workParticipationRefFor(PROJECT, WORKSPACE, WORK_C, "part-c2") };
}

describe("第 2 步：调度触发与 Agent 命令的身份不得混用（A01）", () => {
  it("新参与者 + 旧 Run 拼成的 agent 身份被拒（零写入）；真实调度路径用 system + 来源关联", async () => {
    const { s, partC2 } = await readyForHandoffAdmission("identity");
    const before = await successorFacts(s);

    // (a) 伪造：actor 是**新参与者**（agent B），runRef/principal.runRef 却是**旧 Run**（前驱）。
    const forged = await admitCommandFor(s, {
      commandId: "coord-admit-wait-identity-forged",
      waitId: "wait-identity",
      actor: { kind: "agent", id: AGENT_B, runRef: { ...s.runRef } },
      principal: principalFor({
        agentInstanceId: AGENT_B, runRef: s.runRef, workContextRef: s.workC, participationRef: partC2,
      }),
      participationRef: partC2,
      agentInstanceId: AGENT_B,
    });
    const rejected = await s.h.control.admitWaitSuccessor(forged);
    expect(rejected.status).toBe("rejected");
    if (rejected.status === "rejected") {
      expect(rejected.code).toBe("forbidden");
      const issues = (rejected.issues ?? []).join(" ");
      expect(issues).toContain("system");
      expect(issues).toContain("旧 Run");
    }
    expect(await successorFacts(s), "被拒的伪造尝试必须零写入").toEqual(before);
    expect((await loadWait(s, "wait-identity")).wait.status).toBe("active");
    expect(await countEvents(s.h, "CommunicationAdmissionRecorded")).toBe(0);

    // (b) 真实调度路径：唯一后继的命令身份是 system，且 correlationId 由被触发的等待确定性派生。
    const admitted = await s.h.drive({ reason: "hs-identity-admit", maxIntents: 6 });
    expect(admitted.coordination?.failures, JSON.stringify(admitted.coordination?.failures)).toEqual([]);
    expect(admitted.coordination?.admissions).toBe(1);
    const events = (await s.h.ledger.events({ afterCursor: null, limit: 2048 })).events;
    for (const eventType of ["TaskClaimed", "WaitConditionSatisfied", "CommunicationAdmissionRecorded"]) {
      const recorded = events.filter((positioned) => positioned.event.eventType === eventType);
      const last = recorded[recorded.length - 1]!;
      expect(last.event.actor.kind, eventType + " 的 actor 必须是调度侧 system，而不是某段参与的 agent").toBe("system");
      expect(last.event.actor.id.length).toBeGreaterThan(0);
      expect(last.event.correlationId, eventType + " 必须带来源关联").toContain("wait-identity");
    }
    const admission = await loadAdmission(s, "wait-identity");
    expect(admission.admission.participationRef.participationId).toBe("part-c2");
    expect(admission.admission.agentInstanceId).toBe(AGENT_B);
  });
});

/**
 * 把账本包一层「门」：指定的那次提交**到达账本之前**先执行一段真实现场操作。
 * 用来把「换手恰好发生在 Control 读取当前参与关系之后、提交之前」这个交错变成确定性的，
 * 从而证明判定点在**提交事务**里（协议约束 2.1），而不是命令面的先查后写。
 */
function gateNextCommit(ledger: InMemoryHarness["ledger"], hook: (commitKind: string) => Promise<void>): InMemoryHarness["ledger"] {
  let fired = false;
  return {
    alternativeReport: ref => ledger.alternativeReport(ref),
    load: (ref) => ledger.load(ref),
    events: (query) => ledger.events(query),
    pendingDispatchIntents: (limit, selection) => ledger.pendingDispatchIntents(limit, selection),
    commit: async (batch) => {
      if (!fired && batch.commitKind === "communication-successor-claim") {
        fired = true;
        await hook(batch.commitKind);
      }
      return ledger.commit(batch);
    },
  };
}

describe("协议约束 2.1：换手版本进入后继接续的同一事务检查", () => {
  it("换手插在「读取当前参与关系」与「提交」之间：受理被 CAS 拒绝（零写入），重新读取后可接续", async () => {
    const { s, partC2 } = await readyForHandoffAdmission("race");
    const deps = createDeterministicDeps();
    const gated = gateNextCommit(s.h.ledger, async () => {
      // 真实换手（全部经真实 Control 与未包装的账本）：旧段结束 → 新参与者建立新段。
      const ended = await endParticipation(s, "part-c2", AGENT_B, "race-end");
      expect(ended.status, JSON.stringify(ended)).toBe("committed");
      const agentC = await registerAgent(s, AGENT_C, "race-c");
      expect(agentC.status, JSON.stringify(agentC)).toBe("committed");
      const started = await startParticipation(s, {
        participationId: "part-c3", agentInstanceId: AGENT_C, runRef: s.runRef, suffix: "race-c3",
      });
      expect(started.status, JSON.stringify(started)).toBe("committed");
    });
    const gatedControl = createControlEngine({ ledger: gated, now: () => AT, eventId: () => "race-" + deps.eventId() });

    // 命令按**换手前**的事实构造：参与关系 = part-c2。
    const before = await successorFacts(s);
    const raced = await gatedControl.admitWaitSuccessor(await admitCommandFor(s, {
      commandId: "coord-admit-wait-race-direct",
      waitId: "wait-race",
      actor: { kind: "system", id: "handoff-race-probe" },
      participationRef: partC2,
      agentInstanceId: AGENT_B,
    }));
    expect(raced.status, "换手后仍按过期参与关系受理必须被拒").toBe("rejected");
    if (raced.status === "rejected") {
      expect(raced.code).toBe("revision_conflict");
      const issues = (raced.issues ?? []).join(" ");
      expect(issues).toContain("被推进");
      expect(issues).toContain("WorkParticipation");
    }
    // 零写入：没有 Attempt/Run/唯一 outbox，等待仍是 active，也没有 admission。
    expect(await successorFacts(s)).toEqual(before);
    expect((await loadWait(s, "wait-race")).wait.status).toBe("active");
    expect(await countEvents(s.h, "CommunicationAdmissionRecorded")).toBe(0);

    // 重新读取当前参与关系（换手后的 part-c3）再受理：同一等待产生唯一后继。
    const partC3 = workParticipationRefFor(PROJECT, WORKSPACE, WORK_C, "part-c3");
    const retried = await gatedControl.admitWaitSuccessor(await admitCommandFor(s, {
      commandId: "coord-admit-wait-race-retry",
      waitId: "wait-race",
      actor: { kind: "system", id: "handoff-race-probe" },
      participationRef: partC3,
      agentInstanceId: AGENT_C,
    }));
    expect(retried.status, JSON.stringify(retried)).toBe("committed");
    const admission = await loadAdmission(s, "wait-race");
    expect(admission.admission.participationRef.participationId, "admission 必须固定换手后的当前参与关系").toBe("part-c3");
    expect(admission.admission.agentInstanceId).toBe(AGENT_C);
    expect(await countEvents(s.h, "CommunicationAdmissionRecorded")).toBe(1);
  });
});
describe("第 2 步 / R7：后继派发期只消费 admission 固定的 Work", () => {
  it("已受理的后继不再按 (goal, task) 解析：解析面调用为 0，且对抗性 absent 也照旧 link 到同一个 Work", async () => {
    const { s, partC2 } = await readyForHandoffAdmission("r7");
    // 直接经 Control 受理（不经过 drive 的 ordinary 段）：唯一后继 outbox 因此保持 pending。
    const receipt = await s.h.control.admitWaitSuccessor(await admitCommandFor(s, {
      commandId: "coord-admit-wait-r7-direct",
      waitId: "wait-r7",
      actor: { kind: "system", id: "handoff-r7-probe" },
      participationRef: partC2,
      agentInstanceId: AGENT_B,
    }));
    expect(receipt.status, JSON.stringify(receipt)).toBe("committed");

    const pending = await s.h.ledger.pendingDispatchIntents(10, { workKind: "ordinary" });
    const successor = pending.filter((entry) => entry.intent.attemptRef.attemptId !== "att-pred");
    expect(successor, "后继 intent 必须仍留在唯一 outbox 里待派发").toHaveLength(1);
    const intent = successor[0]!.intent;
    // 唯一调度记录本身带上了 admission 固定的 Work（R7 的载体）。
    expect(intent.admittedWorkRef?.workId).toBe(WORK_C);
    expect(intent.goalId).toBe(GOAL);
    expect(intent.taskId).toBe(TASK);

    // 对抗性替身：解析面若被调用就回答 absent —— 旧实现会据此为 (goal, 起源任务) 另建一个 Work。
    let resolutionCalls = 0;
    const hostile = {
      bindWorkContext: (command: Parameters<WorkIdentityDeps["control"]["bindWorkContext"]>[0]) => s.h.control.bindWorkContext(command),
      linkWorkRun: (command: Parameters<WorkIdentityDeps["control"]["linkWorkRun"]>[0]) => s.h.control.linkWorkRun(command),
      resolveTaskWorkIdentity: async () => { resolutionCalls += 1; return { status: "absent" as const }; },
    } as unknown as WorkIdentityDeps["control"];
    const outcome = await ensureWorkIdentity({ ledger: s.h.ledger, control: hostile, now: () => AT }, intent);
    expect(resolutionCalls, "已受理的协作后继不得重新按 (goal, task) 解析").toBe(0);
    expect(outcome.status, JSON.stringify(outcome)).toBe("established");
    if (outcome.status === "established") expect(outcome.workId).toBe(WORK_C);
    expect(await taskWorkIdentities(s), "不得出现第二条任务工作身份").toEqual([WORK_C]);
    const binding = await loadBinding(s);
    expect(binding.binding.linkedRunRefs.map((ref) => ref.runId)).toContain(intent.runRef.runId);
  });
});

// ------------------------------------------------------------------------ //
// 协议约束 2.2：后继权限集按当前 RoleBinding 收窄（fail-closed 的确定性推导）   //
// ------------------------------------------------------------------------ //

type GovDeps = {
  commandId: string; correlationId: string; submittedAt: string;
  projectId: string; actor: { kind: "human"; id: string }; idempotencyKey: string;
};

function govDeps(suffix: string): GovDeps {
  return {
    commandId: "cmd-gov-" + suffix, correlationId: "corr-gov-" + suffix, submittedAt: AT,
    projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "gov-" + suffix,
  };
}

/**
 * 安装并激活若干角色规格，再安装并激活登记它们的角色矩阵（全部走正式治理命令）。
 * 返回按矩阵签发口径构造 RoleBindingRefV1 的函数：templateRevision 必须是规格 revision 的十进制写法。
 */
async function installRoleMatrix(s: Scenario, input: {
  suffix: string; policyId: string;
  roles: { roleId: string; content?: RoleSpecContentV1 }[];
}): Promise<{ bindingFor: (roleId: string) => RoleBindingRefV1 }> {
  const pins = new Map<string, { ref: ReturnType<typeof roleSpecRevisionRefFor>; digest: string }>();
  for (const role of input.roles) {
    const content = role.content ?? roleSpecSourceFor(role.roleId).content;
    const ref = roleSpecRevisionRefFor(PROJECT, role.roleId, ROLE_SPEC_REVISION);
    const digest = roleSpecContentDigest(content, role.roleId, ROLE_SPEC_REVISION);
    pins.set(role.roleId, { ref, digest });
    const install = await s.h.control.installRoleSpec(
      buildRoleSpecInstallCommand({ roleId: role.roleId, content }, govDeps(input.suffix + "-spec-" + role.roleId)),
    );
    expect(install.status, JSON.stringify(install)).toBe("committed");
    const activate = await s.h.control.activateRoleSpec(buildRoleSpecActivateCommand(
      { ref, digest },
      { ...govDeps(input.suffix + "-spec-act-" + role.roleId), expectedRevision: 1 },
    ));
    expect(activate.status, JSON.stringify(activate)).toBe("committed");
  }
  const base = buildCoordinationPolicyContentWithRolesV1(PROJECT, input.roles.map((role) => role.roleId));
  const catalog: Record<string, { ref: ReturnType<typeof roleSpecRevisionRefFor>; digest: string }> = { ...base.roles!.catalog };
  for (const [roleId, pin] of pins) catalog[roleId] = { ref: pin.ref, digest: pin.digest };
  const content = { ...base, roles: { ...base.roles!, catalog } };
  const install = await s.h.control.installCoordinationPolicy(
    buildCoordinationPolicyInstallCommand({ policyId: input.policyId, content }, govDeps(input.suffix + "-policy")),
  );
  expect(install.status, JSON.stringify(install)).toBe("committed");
  if (install.status !== "committed") throw new Error("policy install failed");
  const activate = await s.h.control.activateCoordinationPolicy(buildCoordinationPolicyActivateCommand(
    { ref: install.revisionRef, digest: install.contentDigest },
    { ...govDeps(input.suffix + "-policy-act"), expectedRevision: 1 },
  ));
  expect(activate.status, JSON.stringify(activate)).toBe("committed");
  return {
    bindingFor: (roleId: string): RoleBindingRefV1 => ({
      schemaVersion: 1, bindingId: "binding-" + roleId, templateId: roleId,
      templateRevision: String(ROLE_SPEC_REVISION), bindingVersion: 1,
      policyRevision: "matrix-" + input.policyId,
    }),
  };
}

describe("协议约束 2.2：后继权限集 = 前驱信封 ∩ 当前 RoleBinding 规格上界（只收窄）", () => {
  it("新参与者是只读角色：写权限被收掉，收窄后的权限集同时进 admission 与唯一 outbox", async () => {
    const s = await bootstrapScenario("narrow");
    await prepareWait(s, "wait-narrow", "narrow");
    await endPredecessor(s);
    expect((await endParticipation(s, "part-c", AGENT_A, "narrow-end")).status).toBe("committed");

    // 前驱信封里的权限：工具含 write、写范围非空 —— 下面要看到它们被真正收窄。
    const predecessor = await s.h.ledger.load(s.runRef);
    if (predecessor.status !== "found") throw new Error("predecessor missing");
    const envelope = (predecessor.snapshot as RunSnapshot).envelope;
    if (envelope === null) throw new Error("predecessor envelope missing");
    expect(envelope.permissions.tools).toContain("write");
    expect(envelope.permissions.writeScope.length).toBeGreaterThan(0);

    // 治理事实：只读角色（tools=["read"], writeScope=none）+ 登记并激活它的矩阵。
    const matrix = await installRoleMatrix(s, {
      suffix: "narrow", policyId: "policy-narrow", roles: [{ roleId: ROLE_SOURCE_INDEPENDENT_REVIEWER }],
    });
    const roleBinding = matrix.bindingFor(ROLE_SOURCE_INDEPENDENT_REVIEWER);
    await registerAgent(s, AGENT_B, "narrow-b");
    const started = await startParticipation(s, {
      participationId: "part-c2", agentInstanceId: AGENT_B, runRef: s.runRef, suffix: "narrow-c2", roleBinding,
    });
    expect(started.status, JSON.stringify(started)).toBe("committed");

    const admitted = await s.h.drive({ reason: "hs-narrow-admit", maxIntents: 6 });
    expect(admitted.coordination?.failures, JSON.stringify(admitted.coordination?.failures)).toEqual([]);
    expect(admitted.coordination?.admissions).toBe(1);

    const admission = await loadAdmission(s, "wait-narrow");
    expect(admission.admission.roleBinding).toEqual(roleBinding);
    expect(admission.admission.declaredPermissions, "只读角色把 write 与写范围都收掉").toEqual({ tools: ["read"], writeScope: [] });
    expect(admission.admission.permissionBasis, "确实收窄过就必须落账").toBe("narrowed");
    // 协议约束 1.2：受理时读到的两个 revision 留痕（同时是那次提交的 CAS 期望值）。
    expect(admission.admission.participationRevision).toBe(1);
    expect(admission.admission.bindingRevision).toBeGreaterThanOrEqual(2);
    // 唯一 outbox 的 intent 用的是同一份收窄后的权限集（派发面据此组装 Context 请求）。
    const outboxRef = dispatchOutboxRefFor(PROJECT, GOAL, TASK, admission.admission.attemptRef.attemptId);
    const outbox = await s.h.ledger.load(outboxRef);
    if (outbox.status !== "found") throw new Error("outbox missing");
    const intent = (outbox.snapshot as DispatchOutboxEntrySnapshot).intent;
    expect(intent.declaredPermissions).toEqual({ tools: ["read"], writeScope: [] });
    expect(intent.roleBinding).toEqual(roleBinding);
    // 同一次 drive 已经把后继 Run 真的启动：它的信封权限必须就是这份收窄后的集合
    // （否则「只许收窄」只停在调度记录上，没有进到实际运行）。
    const successorRun = await s.h.ledger.load(admission.admission.runRef);
    if (successorRun.status !== "found") throw new Error("successor run missing");
    const runEnvelope = (successorRun.snapshot as RunSnapshot).envelope;
    expect(runEnvelope, "后继 Run 必须已经带着信封启动").not.toBeNull();
    expect(runEnvelope!.permissions.tools).toEqual(["read"]);
    expect(runEnvelope!.permissions.writeScope).toEqual([]);
    // 信封里的授权版本也必须来自**新**参与者的 RoleBinding（不是前驱那一份）。
    expect(runEnvelope!.roleBinding).toEqual(roleBinding);
    expect((runEnvelope!.permissions as { policyRevision?: string }).policyRevision).toBe(roleBinding.policyRevision);
  });

  it("交集为空：零写入拒绝并保留等待；换成有资格的参与者后同一等待仍能接续", async () => {
    const s = await bootstrapScenario("empty");
    await prepareWait(s, "wait-empty", "empty");
    await endPredecessor(s);
    expect((await endParticipation(s, "part-c", AGENT_A, "empty-end")).status).toBe("committed");

    // 两份「没有可用授权」的规格（都和前驱的 read/write 没有交集）+ 一份有资格的规格：
    //   · secretary 定制：tools=["shell"]（工具无交集）、writeScope=none；
    //   · recorder 定制：tools=["shell"]（与前驱的 read/write 无任何交集）、writeScope="workspace"
    //     —— 交集后**工具为 0 但写范围还在**：裁决要求这种模糊状态也必须拒绝，
    //     否则事后复核会把它读成「仍有写权限」（角色规格装不进「零工具」的正文，这是另一条既有守卫）；
    //   · executor（夹具）：tools 含 read/write、可写工作区 → 有资格。
    const noToolContent: RoleSpecContentV1 = {
      ...roleSpecSourceFor(ROLE_SOURCE_SECRETARY).content,
      permissions: { tools: ["shell"], writeScope: "none" },
    };
    const emptyToolsContent: RoleSpecContentV1 = {
      ...roleSpecSourceFor(ROLE_SOURCE_RECORDER).content,
      permissions: { tools: ["shell"], writeScope: "workspace" },
    };
    const matrix = await installRoleMatrix(s, {
      suffix: "empty", policyId: "policy-empty",
      roles: [
        { roleId: ROLE_SOURCE_SECRETARY, content: noToolContent },
        { roleId: ROLE_SOURCE_RECORDER, content: emptyToolsContent },
        { roleId: ROLE_SOURCE_EXECUTOR },
      ],
    });
    await registerAgent(s, AGENT_B, "empty-b");
    const started = await startParticipation(s, {
      participationId: "part-c2", agentInstanceId: AGENT_B, runRef: s.runRef, suffix: "empty-c2",
      roleBinding: matrix.bindingFor(ROLE_SOURCE_SECRETARY),
    });
    expect(started.status, JSON.stringify(started)).toBe("committed");

    const before = await successorFacts(s);
    const rejected = await s.h.control.admitWaitSuccessor(await admitCommandFor(s, {
      commandId: "coord-admit-wait-empty-direct", waitId: "wait-empty",
      actor: { kind: "system", id: "handoff-empty-probe" },
      participationRef: workParticipationRefFor(PROJECT, WORKSPACE, WORK_C, "part-c2"),
      agentInstanceId: AGENT_B,
    }));
    expect(rejected.status, JSON.stringify(rejected)).toBe("rejected");
    if (rejected.status === "rejected") {
      expect(rejected.code).toBe("no_admissible_permissions");
      expect((rejected.issues ?? []).join(" ")).toContain("工具为 0 项");
    }
    // 零写入：没有 Attempt/Run/唯一 outbox、等待仍 active、没有 admission。
    expect(await successorFacts(s)).toEqual(before);
    expect((await loadWait(s, "wait-empty")).wait.status).toBe("active");
    expect(await countEvents(s.h, "CommunicationAdmissionRecorded")).toBe(0);

    // 第二段：规格 tools=[] 而 writeScope 仍是 workspace —— 工具为 0 即视为没有可用授权，
    // 即使写范围还留着也一律拒绝（不留模糊状态）。
    expect((await endParticipation(s, "part-c2", AGENT_B, "empty-end-2")).status).toBe("committed");
    await registerAgent(s, AGENT_C, "empty-c");
    const startedC = await startParticipation(s, {
      participationId: "part-c3", agentInstanceId: AGENT_C, runRef: s.runRef, suffix: "empty-c3",
      roleBinding: matrix.bindingFor(ROLE_SOURCE_RECORDER),
    });
    expect(startedC.status, JSON.stringify(startedC)).toBe("committed");
    const rejectedZeroTools = await s.h.control.admitWaitSuccessor(await admitCommandFor(s, {
      commandId: "coord-admit-wait-empty-zero-tools", waitId: "wait-empty",
      actor: { kind: "system", id: "handoff-empty-probe" },
      participationRef: workParticipationRefFor(PROJECT, WORKSPACE, WORK_C, "part-c3"),
      agentInstanceId: AGENT_C,
    }));
    expect(rejectedZeroTools.status, JSON.stringify(rejectedZeroTools)).toBe("rejected");
    if (rejectedZeroTools.status === "rejected") {
      expect(rejectedZeroTools.code).toBe("no_admissible_permissions");
      const issues = (rejectedZeroTools.issues ?? []).join(" ");
      expect(issues).toContain("工具为 0 项");
      expect(issues, "写范围还留着也必须拒绝，不能读成仍有写权限").not.toContain("写范围=空");
      expect(issues, "拒绝原因必须如实报出还留着的写范围").toContain("写范围=src/contracts,tests/dispatch");
    }
    expect(await successorFacts(s)).toEqual(before);
    expect((await loadWait(s, "wait-empty")).wait.status).toBe("active");

    // 第三段：换成有资格的参与者（executor：工具含 read/write、可写工作区）→ 同一等待仍能接续。
    expect((await endParticipation(s, "part-c3", AGENT_C, "empty-end-3")).status).toBe("committed");
    await registerAgent(s, AGENT_D, "empty-d");
    const startedD = await startParticipation(s, {
      participationId: "part-c4", agentInstanceId: AGENT_D, runRef: s.runRef, suffix: "empty-c4",
      roleBinding: matrix.bindingFor(ROLE_SOURCE_EXECUTOR),
    });
    expect(startedD.status, JSON.stringify(startedD)).toBe("committed");
    const admitted = await s.h.drive({ reason: "hs-empty-admit", maxIntents: 6 });
    expect(admitted.coordination?.failures, JSON.stringify(admitted.coordination?.failures)).toEqual([]);
    expect(admitted.coordination?.admissions).toBe(1);
    const admission = await loadAdmission(s, "wait-empty");
    expect(admission.admission.participationRef.participationId).toBe("part-c4");
    expect(admission.admission.declaredPermissions.tools.slice().sort()).toEqual(["read", "write"]);
    expect(admission.admission.declaredPermissions.writeScope.length).toBeGreaterThan(0);
    // executor 规格的工具是 read/write/shell：shell 不在前驱集合里，但交集与前驱逐字段相同 →
    // 落账为 within_spec（有上界且已在界内），与 no_matrix 区分开。
    expect(admission.admission.permissionBasis).toBe("within_spec");
  });
});


it('successor admission rejects a stale claimed generation and missing claim even with the current Wait revision', async () => {
  const { s, partC2 } = await readyForHandoffAdmission('generation');
  const command = await admitCommandFor(s, { commandId: 'coord-admit-wait-generation-old', waitId: 'wait-generation',
    actor: { kind: 'system', id: 'old' }, participationRef: partC2, agentInstanceId: AGENT_B });
  const claim = command.payload.intentClaim!;
  expect(claim).toBeDefined();
  const next = await s.h.control.claimCommunicationIntent({ commandId: 'reclaim-generation', commandType: 'CommunicationClaimIntent', schemaVersion: 1,
    aggregateId: claim.intentRef.intentId, expectedRevision: claim.revision, correlationId: 'reclaim-generation', submittedAt: AT,
    identity: { projectId: PROJECT, actor: { kind: 'system', id: claim.consumerId }, idempotencyKey: 'reclaim-generation' },
    payload: { workspaceId: WORKSPACE, consumerId: claim.consumerId, leaseDurationMs: 60000, now: AT } });
  expect(next.status).toBe('claimed');
  expect(await s.h.control.admitWaitSuccessor(command)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  const absent = structuredClone(command); delete absent.payload.intentClaim;
  expect(await s.h.control.admitWaitSuccessor(absent)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(await countEvents(s.h, 'CommunicationAdmissionRecorded')).toBe(0);
  const current = await admitCommandFor(s, { commandId: 'coord-admit-wait-generation-new', waitId: 'wait-generation',
    actor: { kind: 'system', id: claim.consumerId }, participationRef: partC2, agentInstanceId: AGENT_B });
  expect(await s.h.control.admitWaitSuccessor(current)).toMatchObject({ status: 'committed' });
});
