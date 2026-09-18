/** CM-I02-RFP-001 public-command setup adapted from route-continuity; no production reducer copied. */
import { expect } from 'vitest';
import { createPersistentPlatform } from '../../src/composition/persistent-platform.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from '../contract-support/fixtures/bootstrap-fixture-v1.js';
import { buildPreparedClaim, prepareP103Project, type P1_03TestHarness } from '../contract-suite/p1-03-harness.js';
import { DISPATCH_ELIGIBLE_TASK_ID, ROLE_BINDING_FIXTURE_V1, type FakeRuntimeScriptV1 } from '../../src/fixtures/dispatch-fixtures.js';
import { runRefFor, type RunRef } from '../../src/contracts/dispatch.js';
import { workContextRefFor, type WorkContextRef } from '../../src/contracts/context-continuity.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { EventPage } from '../../src/contracts/ledger.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { communicationIntentRefFor, deliveryRefFor, subscriptionRefFor, waitConditionRefFor, workParticipationRefFor } from '../../src/contracts/coordination.js';
import type { AgentPrincipalRefV1, CommunicationIntentSnapshot, SendDirectedRequestCommand, StartWorkParticipationCommand, SubscribeCommand, WorkParticipationRef } from '../../src/contracts/coordination.js';
import { subscriptionDeliveryIdFor } from '../../src/control/dispatch-engine/coordination-drive.js';
type PersistentHarness = Awaited<ReturnType<typeof createPersistentPlatform>>;
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

async function scanEvents(h: PersistentHarness): Promise<{ cursor: CommitCursor; eventType: string; eventId: string }[]> {
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

async function cursorOfFirstEvent(h: PersistentHarness): Promise<CommitCursor> {
  const page: EventPage = await h.ledger.events({ afterCursor: null, limit: 1 });
  return page.events[0]!.cursor;
}

function adapterOf(h: PersistentHarness): P1_03TestHarness {
  return {
    ledger: h.ledger, readModel: h.readModel, runtime: h.runtime, bootstrap: h.bootstrap,
    submit: (command) => h.control.submit(command), install: h.install, activate: h.activate,
    applyPlan: h.applyPlan, dispatchReadiness: h.dispatchReadiness, claimTask: h.claimTask,
    startRun: h.startRun, runFact: h.runFact, drive: h.drive, advanceProjection: h.advanceProjection,
    observedCursor: h.observedCursor, planGraph: h.planGraph, taskDetail: h.taskDetail, activeAgent: h.activeAgent,
  };
}

type Scenario = { h: PersistentHarness; runRef: RunRef; workC: WorkContextRef; workA: WorkContextRef; partC: WorkParticipationRef };

async function bootstrapScenario(h: PersistentHarness, suffix: string): Promise<Scenario> {
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

export async function cancellationWorld(dir: string, suffix: string): Promise<{ s: Scenario; waitId: string }> {
  const now = AT;
  const h = await createPersistentPlatform({ dir, deps: { clock: () => now }, runtimeScript: STARTED_ONLY });
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

export { AT, PROJECT, WORKSPACE, agentActor, principalFor, admissionIntentOf };