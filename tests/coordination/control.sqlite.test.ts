/**
 * CM-1A-001 Control 受理面的 **SQLite** 适配器复跑（关键跨适配器语义 + 重启后可读）。
 *
 * 为什么单独一个文件：本工作段改了账本侧的 participation-start 校验分派
 * （ledger-validation.validateParticipationStartCommit），两个适配器必须共用同一份规则、
 * 给出同一结论。control.test.ts 跑 InMemory；这里用**真实持久** harness
 * （SqliteStateLedger + 真实 ControlEngineImpl）复跑同一批关键断言，并额外证明
 * 「重启（close + reopen）后参与/等待/intent 仍在账本里，且可以继续机械推进」。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPersistentPlatform } from "../../src/composition/persistent-platform.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { buildPreparedClaim, prepareP103Project, type P1_03TestHarness } from "../contract-suite/p1-03-harness.js";
import { ROLE_BINDING_FIXTURE_V1 } from "../../src/fixtures/dispatch-fixtures.js";
import { runRefFor } from "../../src/contracts/dispatch.js";
import type { RunRef } from "../../src/contracts/dispatch.js";
import type { WorkContextRef } from "../../src/contracts/context-continuity.js";
import type {
  AgentPrincipalRefV1,
  CommunicationClaimReceipt,
  CommunicationWriteReceipt,
  RegisterAgentInstanceCommand,
  StartWorkParticipationCommand,
  WorkParticipationRef,
} from "../../src/contracts/coordination.js";
import {
  communicationIntentRefFor,
  waitConditionRefFor,
  waitDeadlineIntentIdFor,
  workParticipationRefFor,
} from "../../src/contracts/coordination.js";
import type { WorkContextBindingSnapshot } from "../../src/contracts/context-continuity.js";
import type { CommunicationIntentSnapshot, WaitConditionSnapshot, WorkParticipationSnapshot } from "../../src/contracts/coordination.js";

const SCHEMA = "2026-09-05T12:00:00.000Z";
const PROJECT = "proj-alpha";
const WORKSPACE = "ws-shared";
const GOAL = "goal-1";
const AGENT = "agent-sqlite";
const WORK = "work-sqlite";

type Harness = Awaited<ReturnType<typeof createPersistentPlatform>>;

let h: Harness;
let runRef: RunRef;
let workRef: WorkContextRef;
const participationRef: WorkParticipationRef = { aggregateType: "WorkParticipation", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK, participationId: "part-sqlite" };
const waitRef = waitConditionRefFor(PROJECT, WORKSPACE, "wait-sqlite");
let endReceipt: CommunicationWriteReceipt | null = null;

function agentActor() {
  return { kind: "agent" as const, id: AGENT, runRef: { ...runRef } };
}

function principal(): AgentPrincipalRefV1 {
  return {
    schemaVersion: 1,
    agentInstanceId: AGENT,
    workContextRef: { ...workRef },
    participationRef: { ...participationRef },
    roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
    runRef: { ...runRef },
  };
}

beforeAll(async () => {
  h = await createPersistentPlatform({ deps: {} });
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
    commandId: "cmd-sq-boot",
    correlationId: "corr-sq-boot",
    submittedAt: SCHEMA,
  }));
  expect(boot.status).toBe("committed");
  await prepareP103Project(adapter, PROJECT, "a");
  const claim = await h.control.claimTask(buildPreparedClaim({
    commandId: "cmd-sq-claim",
    correlationId: "corr-sq-claim",
    attemptId: "att-sq",
    runId: "run-sq",
    idempotencyKey: "claim-sq",
  }));
  expect(claim.status).toBe("committed");
  runRef = runRefFor(PROJECT, GOAL, "run-sq");
  workRef = { aggregateType: "WorkContextBinding", projectId: PROJECT, workspaceId: WORKSPACE, workId: WORK };
  const bound = await h.control.bindWorkContext({
    commandId: "cmd-sq-bind",
    commandType: "BindWorkContext",
    schemaVersion: 1,
    aggregateId: WORK,
    expectedRevision: 0,
    correlationId: "corr-sq-bind",
    submittedAt: SCHEMA,
    identity: { projectId: PROJECT, actor: { kind: "human", id: "user-1" }, idempotencyKey: "bind-sq" },
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
  expect(bound.status).toBe("committed");
});

afterAll(async () => {
  await h.cleanup();
});

describe("SQLite 适配器上的协作通信受理面", () => {
  it("registerAgentInstance + startWorkParticipation：同一份专用校验在持久账本上给出同一结论", async () => {
    const register: RegisterAgentInstanceCommand = {
      commandId: "cmd-sq-agent",
      commandType: "RegisterAgentInstance",
      schemaVersion: 1,
      aggregateId: AGENT,
      expectedRevision: 0,
      correlationId: "corr-sq-agent",
      submittedAt: SCHEMA,
      identity: { projectId: PROJECT, actor: agentActor(), idempotencyKey: "agent-sqlite" },
      payload: { workspaceId: WORKSPACE, templateId: "template-short-lived-runner", templateRevision: "2026-09-05" },
    };
    const registered = await h.control.registerAgentInstance(register);
    expect(registered.status).toBe("committed");

    const start: StartWorkParticipationCommand = {
      commandId: "cmd-sq-part",
      commandType: "StartWorkParticipation",
      schemaVersion: 1,
      aggregateId: "part-sqlite",
      expectedRevision: 0,
      correlationId: "corr-sq-part",
      submittedAt: SCHEMA,
      identity: { projectId: PROJECT, actor: agentActor(), idempotencyKey: "part-sqlite", agentPrincipal: principal() },
      payload: {
        workspaceId: WORKSPACE,
        workContextRef: { ...workRef },
        agentInstanceId: AGENT,
        roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
        runRef: { ...runRef },
      },
    };
    const started = await h.control.startWorkParticipation(start);
    expect(started.status).toBe("committed");

    const loaded = await h.ledger.load(participationRef);
    expect(loaded.status).toBe("found");
    if (loaded.status !== "found") return;
    const participation = (loaded.snapshot as WorkParticipationSnapshot).participation;
    expect(loaded.snapshot.revision).toBe(1);
    expect(participation.status).toBe("active");
    const binding = await h.ledger.load(workRef);
    expect(binding.status).toBe("found");
    if (binding.status !== "found") return;
    expect((binding.snapshot as WorkContextBindingSnapshot).binding.linkedRunRefs.map((r) => r.runId)).toContain("run-sq");
  });

  it("registerWait 的 deadline intent 在持久账本上可读（deadline 非空 → 同事务建立）", async () => {
    const registered = await h.control.registerWait({
      commandId: "cmd-sq-wait",
      commandType: "RegisterWait",
      schemaVersion: 1,
      aggregateId: "wait-sqlite",
      expectedRevision: 0,
      correlationId: "corr-sq-wait",
      submittedAt: SCHEMA,
      identity: { projectId: PROJECT, actor: agentActor(), idempotencyKey: "wait-sqlite", agentPrincipal: principal() },
      payload: {
        workspaceId: WORKSPACE,
        ownerWorkContextRef: { ...workRef },
        ownerParticipationRef: { ...participationRef },
        predecessorRunRef: { ...runRef },
        conditions: [{ kind: "request_closed", requestRef: { aggregateType: "DirectedRequest", projectId: PROJECT, workspaceId: WORKSPACE, requestId: "req-never" } }],
        deadlineAt: "2026-09-05T11:00:00.000Z",
      },
    });
    expect(registered.status).toBe("committed");
    const intent = await h.ledger.load(communicationIntentRefFor(PROJECT, WORKSPACE, waitDeadlineIntentIdFor("wait-sqlite")));
    expect(intent.status).toBe("found");
  });

  it("endWorkParticipation：CAS@N 落账；重复结束（另一命令身份 + 当前 revision）→ revision_conflict", async () => {
    const loaded = await h.ledger.load(participationRef);
    expect(loaded.status).toBe("found");
    if (loaded.status !== "found") return;
    endReceipt = await h.control.endWorkParticipation({
      commandId: "cmd-sq-end",
      commandType: "EndWorkParticipation",
      schemaVersion: 1,
      aggregateId: "part-sqlite",
      expectedRevision: loaded.snapshot.revision,
      correlationId: "corr-sq-end",
      submittedAt: SCHEMA,
      identity: { projectId: PROJECT, actor: agentActor(), idempotencyKey: "end-part-sqlite", agentPrincipal: principal() },
      payload: { workspaceId: WORKSPACE, workContextRef: { ...workRef }, runRef: { ...runRef }, reason: "换手" },
    });
    expect(endReceipt.status).toBe("committed");
    const after = await h.ledger.load(participationRef);
    expect(after.status).toBe("found");
    if (after.status !== "found") return;
    expect((after.snapshot as WorkParticipationSnapshot).participation.status).toBe("ended");

    const again = await h.control.endWorkParticipation({
      commandId: "cmd-sq-end-again",
      commandType: "EndWorkParticipation",
      schemaVersion: 1,
      aggregateId: "part-sqlite",
      expectedRevision: after.snapshot.revision,
      correlationId: "corr-sq-end-again",
      submittedAt: SCHEMA,
      identity: { projectId: PROJECT, actor: agentActor(), idempotencyKey: "end-part-sqlite-again", agentPrincipal: principal() },
      payload: { workspaceId: WORKSPACE, workContextRef: { ...workRef }, runRef: { ...runRef }, reason: "换手" },
    });
    expect(again.status).toBe("rejected");
    if (again.status !== "rejected") return;
    expect(again.code).toBe("revision_conflict");
  });

  it("重启（close + reopen）后：参与/等待/intent 都可从账本读回，且 intent 仍可领取", async () => {
    expect(endReceipt, "前置：参与关系已结束").not.toBeNull();
    await h.close();
    const reopened = await h.reopen();
    h = reopened;

    const participation = await h.ledger.load(participationRef);
    expect(participation.status).toBe("found");
    if (participation.status !== "found") return;
    expect((participation.snapshot as WorkParticipationSnapshot).participation.status).toBe("ended");

    const wait = await h.ledger.load(waitRef);
    expect(wait.status).toBe("found");
    if (wait.status !== "found") return;
    // 换手/结束参与不改变等待的归属：owner 仍是那个 WorkContextBinding。
    expect((wait.snapshot as WaitConditionSnapshot).wait.ownerWorkContextRef.workId).toBe(WORK);
    expect((wait.snapshot as WaitConditionSnapshot).wait.status).toBe("active");

    const intentRef = communicationIntentRefFor(PROJECT, WORKSPACE, waitDeadlineIntentIdFor("wait-sqlite"));
    const intent = await h.ledger.load(intentRef);
    expect(intent.status).toBe("found");
    if (intent.status !== "found") return;
    expect((intent.snapshot as CommunicationIntentSnapshot).intent.status).toBe("pending");

    // 重启后不依赖原内存队列：同一个 pending intent 仍可被机械领取。
    const claimed: CommunicationClaimReceipt = await h.control.claimCommunicationIntent({
      commandId: "cmd-sq-claim-intent",
      commandType: "CommunicationClaimIntent",
      schemaVersion: 1,
      aggregateId: waitDeadlineIntentIdFor("wait-sqlite"),
      expectedRevision: intent.snapshot.revision,
      correlationId: "corr-sq-claim-intent",
      submittedAt: SCHEMA,
      identity: { projectId: PROJECT, actor: { kind: "system", id: "dispatch" }, idempotencyKey: "claim-intent-sq" },
      payload: { workspaceId: WORKSPACE, consumerId: "consumer-sqlite", leaseDurationMs: 30_000, now: SCHEMA },
    });
    expect(claimed.status).toBe("claimed");
    if (claimed.status !== "claimed") return;
    expect(claimed.leaseGeneration).toBe(1);
  });
});
