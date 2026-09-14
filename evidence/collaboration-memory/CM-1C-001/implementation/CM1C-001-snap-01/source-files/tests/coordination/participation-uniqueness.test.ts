/**
 * CM-1A-001 第 2 步：AgentInstance 的 active participation 唯一约束的**跨连接**证据。
 *
 * 不变式：「一个 AgentInstance 在同一 (project, workspace) 至多有一段 active participation」。
 * 命令面的守卫是「先查后写」，跨进程/跨连接时挡不住，所以唯一性必须由**唯一写入路径**
 * （StateLedger.commit）在同一个事务里判定并占用（participationIdentityClaim）。
 *
 * 这个文件按 tests/control/work-identity-uniqueness.test.ts:278-326 的同一配方构造：
 *   · 同一条 SQLite 文件、两条独立连接、两个独立 ControlEngine；
 *   · 一段参与通过连接 A 落账，连接 B 在**另一个 Work** 上建立第二段 active 参与 → 账本拒绝；
 *   · 绕过命令面把原始提交直接交给账本 → 账本自己也必须拒绝（并发时唯一有效的判定点）；
 *   · 旧段结束后，连接 B 建立新的一段（换手跨连接同样成立：释放与占用都在提交事务里）。
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createControlEngine } from "../../src/control/control-engine/control-engine.js";
import { createSqliteStateLedger } from "../../src/data/state-ledger/sqlite-ledger.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand, buildGoalCreateLedgerCommit } from "../contract-support/fixtures/goal-fixtures.js";
import { DISPATCH_PLAN_REVISION_FIXTURE_V1, DISPATCH_ELIGIBLE_TASK_ID, buildDispatchClaimCommand } from "../../src/fixtures/dispatch-fixtures.js";
import { ROLE_BINDING_FIXTURE_V1 } from "../../src/fixtures/dispatch-fixtures.js";
import { buildBindWorkContextCommand } from "../contract-support/fixtures/context-fixtures.js";
import { buildDispatchClaimLedgerCommit } from "../../src/control/control-engine/records/dispatch.js";
import { buildParticipationStartCommit } from "../../src/control/control-engine/records/coordination.js";
import { startWorkParticipationFingerprint } from "../../src/contracts/coordination.js";
import { workContextRefFor, type WorkContextBindingSnapshot } from "../../src/contracts/context-continuity.js";
import type {
  EndWorkParticipationCommand,
  RegisterAgentInstanceCommand,
  StartWorkParticipationCommand,
  WorkParticipationRef,
} from "../../src/contracts/coordination.js";
import { workParticipationRefFor } from "../../src/contracts/coordination.js";
import type { RunRef } from "../../src/contracts/dispatch.js";
import type { StateLedger } from "../../src/contracts/ledger.js";

const FIXED = FIXED_ISO_2026_09_05;
const SCOPE = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
const PROJECT = SCOPE.projectId;
const WORKSPACE = SCOPE.workspaceId;
const GOAL = SCOPE.goalId;
const TASK = DISPATCH_ELIGIBLE_TASK_ID;
const AGENT = "agent-pu";
const WORK_C = "work-pu-task";
const WORK_A = "work-pu-other";
const PLAN_REF = {
  aggregateType: "PlanRevision" as const,
  projectId: PROJECT,
  planId: DISPATCH_PLAN_REVISION_FIXTURE_V1.planId,
};
const runRef: RunRef = { aggregateType: "Run", projectId: PROJECT, goalId: GOAL, runId: "run-pu-1" };

/** 世界构造（与 RC-03 用例同一套夹具）：bootstrap + goal + 一条真实 claim（真 Run 聚合）。 */
async function seedWorld(ledger: StateLedger): Promise<void> {
  const boot = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, { commandId: "cmd-pu-boot", correlationId: "corr-pu-boot", submittedAt: FIXED });
  expect((await ledger.commit(buildBootstrapLedgerCommit(boot, { eventIds: ["e1", "e2", "e3", "e4"], occurredAt: FIXED }))).status).toBe("committed");
  const goal = buildCreateGoalCommand(SCOPE, { commandId: "cmd-pu-goal", correlationId: "corr-pu-goal", submittedAt: FIXED });
  expect((await ledger.commit(buildGoalCreateLedgerCommit(goal, { eventId: "e5", occurredAt: FIXED, projectRevision: 1, workspaceRevision: 1 }))).status).toBe("committed");
  const claim = buildDispatchClaimCommand({
    commandId: "claim-pu-1", correlationId: "corr-pu-1", submittedAt: FIXED, idempotencyKey: "idem-pu-1",
    projectId: PROJECT, goalId: GOAL, taskId: TASK, attemptId: "attempt-pu-1", runId: "run-pu-1",
  });
  expect((await ledger.commit(buildDispatchClaimLedgerCommit(claim, { eventId: "e6", occurredAt: FIXED, workspaceId: WORKSPACE, planRef: PLAN_REF, workspaceRevision: 1 }))).status).toBe("committed");
}

function bindCommand(workId: string, workKind: "task" | "coordination", taskId: string | null) {
  return buildBindWorkContextCommand({
    commandId: "bind-" + workId, projectId: PROJECT, workId, workspaceId: WORKSPACE,
    workKind, goalId: GOAL, taskId, initialRunRef: runRef,
  });
}

function agentCommand(): RegisterAgentInstanceCommand {
  return {
    commandId: "cmd-pu-agent", commandType: "RegisterAgentInstance", schemaVersion: 1,
    aggregateId: AGENT, expectedRevision: 0, correlationId: "corr-pu-agent", submittedAt: FIXED,
    identity: { projectId: PROJECT, actor: { kind: "agent", id: AGENT, runRef: { ...runRef } }, idempotencyKey: "agent-pu" },
    payload: { workspaceId: WORKSPACE, templateId: "template-runner", templateRevision: "1" },
  };
}

function participationRefFor(workId: string, participationId: string): WorkParticipationRef {
  return workParticipationRefFor(PROJECT, WORKSPACE, workId, participationId);
}

function principalFor(workId: string, participationRef: WorkParticipationRef) {
  return {
    schemaVersion: 1 as const,
    agentInstanceId: AGENT,
    workContextRef: workContextRefFor(PROJECT, WORKSPACE, workId),
    participationRef,
    roleBinding: { ...ROLE_BINDING_FIXTURE_V1 },
    runRef: { ...runRef },
  };
}

function startCommand(workId: string, participationId: string, suffix: string): StartWorkParticipationCommand {
  const participationRef = participationRefFor(workId, participationId);
  return {
    commandId: "cmd-pu-part-" + suffix, commandType: "StartWorkParticipation", schemaVersion: 1,
    aggregateId: participationId, expectedRevision: 0, correlationId: "corr-pu-part-" + suffix, submittedAt: FIXED,
    identity: {
      projectId: PROJECT,
      actor: { kind: "agent", id: AGENT, runRef: { ...runRef } },
      idempotencyKey: "part-pu-" + suffix,
      agentPrincipal: principalFor(workId, participationRef),
    },
    payload: {
      workspaceId: WORKSPACE, workContextRef: workContextRefFor(PROJECT, WORKSPACE, workId), agentInstanceId: AGENT,
      roleBinding: { ...ROLE_BINDING_FIXTURE_V1 }, runRef: { ...runRef },
    },
  };
}

function endCommand(workId: string, participationId: string, expectedRevision: number, suffix: string): EndWorkParticipationCommand {
  const participationRef = participationRefFor(workId, participationId);
  return {
    commandId: "cmd-pu-end-" + suffix, commandType: "EndWorkParticipation", schemaVersion: 1,
    aggregateId: participationId, expectedRevision, correlationId: "corr-pu-end-" + suffix, submittedAt: FIXED,
    identity: {
      projectId: PROJECT,
      actor: { kind: "agent", id: AGENT, runRef: { ...runRef } },
      idempotencyKey: "end-pu-" + suffix,
      agentPrincipal: principalFor(workId, participationRef),
    },
    payload: { workspaceId: WORKSPACE, workContextRef: workContextRefFor(PROJECT, WORKSPACE, workId), runRef: { ...runRef }, reason: "本段参与结束" },
  };
}

async function countEvents(ledger: StateLedger): Promise<number> {
  return (await ledger.events({ afterCursor: null, limit: 4096 })).events.length;
}

describe("第 2 步：一个 AgentInstance 在同一 (project, workspace) 至多一段 active 参与", () => {
  it("两条独立 SQLite 连接：第二段 active 参与被账本拒绝（零写入），旧段结束后换手成立", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cm1a-part-uniq-"));
    const path = join(dir, "ledger.sqlite");
    const connA = createSqliteStateLedger({ path });
    const connB = createSqliteStateLedger({ path });
    try {
      await seedWorld(connA);
      const depsA = createDeterministicDeps();
      const controlA = createControlEngine({ ledger: connA, now: depsA.clock, eventId: depsA.eventId });
      expect((await controlA.bindWorkContext(bindCommand(WORK_C, "task", TASK))).status).toBe("committed");
      expect((await controlA.bindWorkContext(bindCommand(WORK_A, "coordination", null))).status).toBe("committed");
      expect((await controlA.registerAgentInstance(agentCommand())).status).toBe("committed");

      // 连接 A：在 work-pu-task 上建立第一段 active 参与。
      const first = await controlA.startWorkParticipation(startCommand(WORK_C, "part-pu-1", "1"));
      expect(first.status, JSON.stringify(first)).toBe("committed");

      // 连接 B：另一条连接、另一个引擎实例，在**另一个 Work** 上建立第二段 active 参与。
      const depsB = createDeterministicDeps();
      const controlB = createControlEngine({ ledger: connB, now: depsB.clock, eventId: () => "connb-" + depsB.eventId() });
      const eventsBefore = await countEvents(connB);
      const second = await controlB.startWorkParticipation(startCommand(WORK_A, "part-pu-2", "2"));
      expect(second.status, "跨连接的第二段 active 参与必须被拒绝").toBe("rejected");
      if (second.status === "rejected") {
        expect(second.code).toBe("revision_conflict");
        expect((second.issues ?? []).join(" ")).toContain("参与身份槽");
        // 判别：身份槽拒绝**不**带 currentVersions（CAS 冲突才会带），因此这里不是"版本没对上"。
        expect(second.currentRevision).toBeUndefined();
      }
      // 零写入：没有新事件、没有第二段参与聚合、work-pu-other 仍没有当前参与关系。
      expect(await countEvents(connB)).toBe(eventsBefore);
      expect((await connB.load(participationRefFor(WORK_A, "part-pu-2"))).status).toBe("not_found");
      const bindingA = await connB.load(workContextRefFor(PROJECT, WORKSPACE, WORK_A));
      expect(bindingA.status).toBe("found");
      if (bindingA.status === "found") {
        expect((bindingA.snapshot as WorkContextBindingSnapshot).binding.currentParticipationRef ?? null).toBeNull();
      }

      // 绕过命令面守卫，把原始 participation-start 提交直接交给账本：账本自己必须拒绝。
      const priorBinding = await connB.load(workContextRefFor(PROJECT, WORKSPACE, WORK_A));
      if (priorBinding.status !== "found") throw new Error("binding missing");
      const rawCommand = startCommand(WORK_A, "part-pu-raw", "raw");
      const beforeRaw = await countEvents(connB);
      const raw = await connB.commit(buildParticipationStartCommit(
        rawCommand,
        { eventId: () => "raw-pu-evt", now: () => FIXED, workspaceId: WORKSPACE },
        startWorkParticipationFingerprint(rawCommand),
        priorBinding.snapshot as WorkContextBindingSnapshot,
      ));
      expect(raw.status, "账本层必须拒绝第二条 active 参与（这是并发时唯一有效的判定点）").toBe("rejected");
      if (raw.status === "rejected") {
        expect(raw.code).toBe("revision_conflict");
        expect((raw as { currentVersions?: unknown }).currentVersions, "必须是身份槽拒绝，而不是 CAS 冲突").toBeUndefined();
      }
      expect(await countEvents(connB)).toBe(beforeRaw);
      expect((await connB.load(participationRefFor(WORK_A, "part-pu-raw"))).status).toBe("not_found");

      // 同一条连接上也一样（命令面读到的是 Work 权威状态里的当前参与关系）。
      const sameConn = await controlA.startWorkParticipation(startCommand(WORK_C, "part-pu-same", "same"));
      expect(sameConn.status).toBe("rejected");
      if (sameConn.status === "rejected") expect(sameConn.code).toBe("forbidden");

      // 旧段结束 → 参与身份槽在同一个事务里被释放 → 另一条连接可以建立新的一段（换手）。
      const loadedPart = await connA.load(participationRefFor(WORK_C, "part-pu-1"));
      if (loadedPart.status !== "found") throw new Error("participation missing");
      const ended = await controlA.endWorkParticipation(endCommand(WORK_C, "part-pu-1", loadedPart.snapshot.revision, "1"));
      expect(ended.status, JSON.stringify(ended)).toBe("committed");
      const handoff = await controlB.startWorkParticipation(startCommand(WORK_A, "part-pu-3", "3"));
      expect(handoff.status, "释放之后另一条连接必须能建立新的参与关系").toBe("committed");
      const bindingAAfter = await connA.load(workContextRefFor(PROJECT, WORKSPACE, WORK_A));
      if (bindingAAfter.status !== "found") throw new Error("binding missing");
      expect((bindingAAfter.snapshot as WorkContextBindingSnapshot).binding.currentParticipationRef?.participationId).toBe("part-pu-3");
    } finally {
      await connA.close();
      await connB.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
