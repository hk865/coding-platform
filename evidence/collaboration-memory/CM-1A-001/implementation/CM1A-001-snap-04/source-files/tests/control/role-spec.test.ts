/**
 * RW-11（ADR 0003 D4 前半）Control 用例：角色规格实体化（RoleSpecRevision 治理种类）。
 *
 * 覆盖：
 *   - 八个角色规格经 install（CAS@0）+ activate（CAS）正式路径生效；install 绝不自动生效；
 *   - 幂等与重放：同一命令重复提交是 committed/replayed（同一 eventIds），换载荷同键是 idempotency_conflict；
 *     同 roleId 换内容再安装是 revision_conflict 且零写入（一个 roleId 只有一份安装 revision）；
 *   - 守卫：形状（缺必产出／退出条件／权限上界／非法职责词）→ invalid；摘要不符 → digest_mismatch；
 *     activate 目标未安装 → not_found；target 摘要不符 → digest_mismatch；全部零写入；
 *   - 角色矩阵：带 roles 的协调策略正文可安装；roles 里的悬空 coordinator、指向未登记角色的
 *     pin 在安装期即被拒（invalid）；没有 roles 的旧正文照旧可安装（不收紧既有来源）；
 *   - independent-reviewer 的权限与预算口径与既有 INDEPENDENT_REVIEWER_ROLE／ReviewerProfileV1
 *     逐项一致（不得放宽、不得另起一套）；
 *   - 重启后从账本重建：SQLite 落盘后重开，规格与生效引用都还在，claim 守卫仍按同一份矩阵裁决。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine/control-engine.js";
import { InMemoryLedger } from "../../src/data/state-ledger/in-memory-ledger.js";
import type { LedgerCommit, LedgerCommitReceipt, StateLedger } from "../../src/contracts/ledger.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";
import { createDeterministicDeps } from "../../src/testing/sequences.js";
import { buildRoleSpecActivateFold, buildRoleSpecInstallFold } from "../../src/control/control-engine/records/role-spec.js";
import {
  ROLE_SPEC_REVISION,
  projectRoleSpecActiveRefFor,
  roleSpecContentDigest,
  roleSpecRevisionRefFor,
  type InstallRoleSpecRevisionCommand,
  type RoleSpecContentV1,
  type RoleSpecRevisionSnapshot,
  type ProjectRoleSpecActiveSnapshot,
} from "../../src/contracts/role-spec.js";
import {
  ROLE_SOURCE_ADVISOR,
  ROLE_SOURCE_EXECUTOR,
  ROLE_SOURCE_INDEPENDENT_REVIEWER,
  ROLE_SOURCE_INTEGRATOR,
  ROLE_SOURCE_PLANNER,
  ROLE_SOURCE_RECORDER,
  ROLE_SPEC_SOURCES_V1,
  buildCoordinationPolicyContentWithRolesV1,
  buildCoordinationPolicyContentWithoutRolesV1,
  buildRoleMatrixFixture,
  buildRoleSpecActivateCommandFor,
  buildRoleSpecInstallCommandFor,
  roleSpecPinFor,
  roleSpecSourceFor,
} from "../../src/fixtures/role-spec-fixtures.js";
import { buildCoordinationPolicyActivateCommand, buildCoordinationPolicyInstallCommand } from "../../src/contracts/commands/governance.js";
import { INDEPENDENT_REVIEWER_ROLE } from "../../src/contracts/reviewer-context.js";
import { p111BootstrapGoalGovernance } from "../contract-suite/p1-11-harness.js";

const PROJECT = "proj-alpha";
const AT = "2026-09-10T00:00:00.000Z";
const ACTOR = { kind: "human", id: "tester" } as const;

class RecordingLedger extends InMemoryLedger {
  commits: LedgerCommit[] = [];
  eventCount = 0;
  override async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.commits.push(batch);
    this.eventCount += batch.events.length;
    return super.commit(batch);
  }
}

function makeHarness() {
  const ledger = new RecordingLedger();
  const d = createDeterministicDeps();
  const engine = createControlEngine({ ledger, now: d.clock, eventId: d.eventId });
  return { ledger, engine };
}

type Harness = ReturnType<typeof makeHarness>;

/**
 * 「零写入」判据用**已提交**的事件数（ledger.events 只含已提交事件）。
 * 不能用「提交了多少次」计数：被拒绝的提交与幂等重放也会走到 commit 入口，
 * 用提交次数会把一次零写入的拒绝误判成写入。
 */
async function committedEventCount(ledger: StateLedger): Promise<number> {
  const page = await ledger.events({ afterCursor: null, limit: 5000 });
  return page.events.length;
}

async function setupWorld(harness: Harness, projectId: string = PROJECT): Promise<void> {
  await p111BootstrapGoalGovernance(harness.ledger, projectId);
}

function installDeps(roleId: string, suffix: string) {
  return {
    commandId: "rw11-install-" + roleId + "-" + suffix,
    correlationId: "rw11-corr-install-" + roleId + "-" + suffix,
    submittedAt: AT,
    projectId: PROJECT,
    actor: ACTOR,
    idempotencyKey: "rw11-install-key-" + roleId + "-" + suffix,
  };
}

function activateDeps(roleId: string, suffix: string, expectedRevision = 1) {
  return {
    commandId: "rw11-activate-" + roleId + "-" + suffix,
    correlationId: "rw11-corr-activate-" + roleId + "-" + suffix,
    submittedAt: AT,
    projectId: PROJECT,
    actor: ACTOR,
    idempotencyKey: "rw11-activate-key-" + roleId + "-" + suffix,
    expectedRevision,
  };
}

async function installRole(harness: Harness, roleId: string, suffix = "a"): Promise<InstallRoleSpecRevisionCommand> {
  const command = buildRoleSpecInstallCommandFor(roleId, installDeps(roleId, suffix));
  const receipt = await harness.engine.installRoleSpec(command);
  expect(receipt.status, "install " + roleId).toBe("committed");
  return command;
}

async function installAndActivateRole(harness: Harness, roleId: string, suffix = "a"): Promise<void> {
  await installRole(harness, roleId, suffix);
  const receipt = await harness.engine.activateRoleSpec(buildRoleSpecActivateCommandFor(roleId, activateDeps(roleId, suffix)));
  expect(receipt.status, "activate " + roleId).toBe("committed");
}

describe("RW-11 RoleSpecRevision 治理（install/activate/CAS/幂等/重放）", () => {
  it("八个角色规格都能安装，且 install 绝不自动生效", async () => {
    const harness = makeHarness();
    await setupWorld(harness);
    for (const source of ROLE_SPEC_SOURCES_V1) {
      const before = harness.ledger.commits.length;
      const command = buildRoleSpecInstallCommandFor(source.roleId, installDeps(source.roleId, "main"));
      const receipt = await harness.engine.installRoleSpec(command);
      expect(receipt.status, source.roleId).toBe("committed");
      if (receipt.status !== "committed") continue;

      // fold 等价：同一个 eventId／occurredAt 下，引擎提交的批次与冻结的构造器逐字相同。
      const batch = harness.ledger.commits[before]!;
      expect(canonicalJson(batch)).toBe(
        canonicalJson(buildRoleSpecInstallFold(command, { eventId: batch.events[0]!.eventId, occurredAt: batch.events[0]!.occurredAt })),
      );
      expect(receipt.revisionRef).toEqual(roleSpecRevisionRefFor(PROJECT, source.roleId, ROLE_SPEC_REVISION));
      expect(receipt.contentDigest).toBe(roleSpecContentDigest(source.content, source.roleId, ROLE_SPEC_REVISION));
      expect(receipt.replayed).toBe(false);

      // 安装**不**自动生效：该角色在 Project 上仍然没有生效引用。
      const active = await harness.ledger.load(projectRoleSpecActiveRefFor(PROJECT, source.roleId));
      expect(active.status, source.roleId + " 不应自动生效").toBe("not_found");

      // 落账快照与 source 逐字一致（内容不可改写）。
      const loaded = await harness.ledger.load(receipt.revisionRef);
      expect(loaded.status).toBe("found");
      if (loaded.status === "found") {
        const snapshot = loaded.snapshot as RoleSpecRevisionSnapshot;
        expect(canonicalJson(snapshot.content)).toBe(canonicalJson(source.content));
        expect(snapshot.contentRevision).toBe(source.revision);
      }
    }
  });

  it("同一命令重复安装是重放；同 roleId 换内容再安装是 revision_conflict 且零写入", async () => {
    const harness = makeHarness();
    await setupWorld(harness);
    const command = await installRole(harness, ROLE_SOURCE_PLANNER, "replay");

    const eventsAfterFirst = await committedEventCount(harness.ledger);
    const replay = await harness.engine.installRoleSpec(command);
    expect(replay.status).toBe("committed");
    if (replay.status !== "committed") return;
    expect(replay.replayed).toBe(true);
    expect(replay.eventIds).toEqual((await harness.engine.installRoleSpec(command) as { eventIds: string[] }).eventIds);
    expect(await committedEventCount(harness.ledger)).toBe(eventsAfterFirst);

    // 同一个 roleId、不同内容：安装入口是 CAS@0，第二次必然是 revision_conflict（不覆盖旧内容）。
    const tampered: RoleSpecContentV1 = { ...roleSpecSourceFor(ROLE_SOURCE_PLANNER).content, purpose: "被改写过的用途" };
    const conflictCommand: InstallRoleSpecRevisionCommand = {
      ...command,
      commandId: "rw11-install-conflict",
      identity: { ...command.identity, idempotencyKey: "rw11-install-conflict-key" },
      payload: { roleId: ROLE_SOURCE_PLANNER, content: tampered, contentDigest: roleSpecContentDigest(tampered, ROLE_SOURCE_PLANNER, ROLE_SPEC_REVISION) },
    };
    const before = await committedEventCount(harness.ledger);
    const conflict = await harness.engine.installRoleSpec(conflictCommand);
    expect(conflict.status).toBe("rejected");
    if (conflict.status === "rejected") expect(conflict.code).toBe("revision_conflict");
    expect(await committedEventCount(harness.ledger)).toBe(before);

    const loaded = await harness.ledger.load(roleSpecRevisionRefFor(PROJECT, ROLE_SOURCE_PLANNER, ROLE_SPEC_REVISION));
    expect(loaded.status).toBe("found");
    if (loaded.status === "found") {
      expect(canonicalJson((loaded.snapshot as RoleSpecRevisionSnapshot).content)).toBe(canonicalJson(roleSpecSourceFor(ROLE_SOURCE_PLANNER).content));
    }
  });

  it("同幂等键、不同载荷 = idempotency_conflict，零写入", async () => {
    const harness = makeHarness();
    await setupWorld(harness);
    const command = await installRole(harness, ROLE_SOURCE_RECORDER, "idem");
    const other = buildRoleSpecInstallCommandFor(ROLE_SOURCE_ADVISOR, { ...installDeps(ROLE_SOURCE_ADVISOR, "idem"), idempotencyKey: command.identity.idempotencyKey });
    const before = await committedEventCount(harness.ledger);
    const receipt = await harness.engine.installRoleSpec(other);
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("idempotency_conflict");
    expect(await committedEventCount(harness.ledger)).toBe(before);
  });

  it("activate：CAS + 每角色独立生效引用；重放同一 eventIds；按新 expectedRevision 再次激活推进 revision", async () => {
    const harness = makeHarness();
    await setupWorld(harness);
    await installRole(harness, ROLE_SOURCE_EXECUTOR, "act");
    const activateCmd = buildRoleSpecActivateCommandFor(ROLE_SOURCE_EXECUTOR, activateDeps(ROLE_SOURCE_EXECUTOR, "act"));

    const before = harness.ledger.commits.length;
    const first = await harness.engine.activateRoleSpec(activateCmd);
    expect(first.status).toBe("committed");
    if (first.status !== "committed") return;
    expect(first.replayed).toBe(false);
    expect(first.activeRef).toEqual(projectRoleSpecActiveRefFor(PROJECT, ROLE_SOURCE_EXECUTOR));
    expect(first.activeRevision).toEqual(roleSpecRevisionRefFor(PROJECT, ROLE_SOURCE_EXECUTOR, ROLE_SPEC_REVISION));

    // fold 等价（CAS：Project@expected + 该角色生效聚合 @(revision-1)）。
    const batch = harness.ledger.commits[before]!;
    expect(canonicalJson(batch)).toBe(
      canonicalJson(
        buildRoleSpecActivateFold(activateCmd, {
          eventId: batch.events[0]!.eventId,
          occurredAt: batch.events[0]!.occurredAt,
          activeAggregateRevision: 1,
          projectRevision: 1,
        }),
      ),
    );

    const active = await harness.ledger.load(first.activeRef);
    expect(active.status).toBe("found");
    if (active.status === "found") {
      const snapshot = active.snapshot as ProjectRoleSpecActiveSnapshot;
      expect(snapshot.revision).toBe(1);
      expect(canonicalJson(snapshot.activeRevision)).toBe(canonicalJson(first.activeRevision));
    }

    // 重放：账本按身份 + 指纹判重放，不产生第二条激活事件。
    const replay = await harness.engine.activateRoleSpec(activateCmd);
    expect(replay.status).toBe("committed");
    if (replay.status === "committed") {
      expect(replay.replayed).toBe(true);
      expect(replay.eventIds).toEqual(first.eventIds);
    }

    // 另一个角色独立生效（互不影响）。
    await installAndActivateRole(harness, ROLE_SOURCE_INTEGRATOR, "act");
    const executorAfter = await harness.ledger.load(first.activeRef);
    expect(executorAfter.status).toBe("found");
    if (executorAfter.status === "found") expect((executorAfter.snapshot as ProjectRoleSpecActiveSnapshot).revision).toBe(1);

    // 再次激活同一角色（新命令、新 expectedRevision）：生效聚合推进到 revision 2，Project CAS 仍是 1。
    const second = await harness.engine.activateRoleSpec(buildRoleSpecActivateCommandFor(ROLE_SOURCE_EXECUTOR, activateDeps(ROLE_SOURCE_EXECUTOR, "act-2")));
    expect(second.status).toBe("committed");
    const after = await harness.ledger.load(first.activeRef);
    expect(after.status).toBe("found");
    if (after.status === "found") expect((after.snapshot as ProjectRoleSpecActiveSnapshot).revision).toBe(2);

    // 过期 CAS：拿旧 Project revision 激活必须是 revision_conflict 且零写入。
    const staleBefore = await committedEventCount(harness.ledger);
    const stale = await harness.engine.activateRoleSpec(buildRoleSpecActivateCommandFor(ROLE_SOURCE_PLANNER, activateDeps(ROLE_SOURCE_PLANNER, "stale", 99)));
    expect(stale.status).toBe("rejected");
    expect(await committedEventCount(harness.ledger)).toBe(staleBefore);
  });

  it("activate 的 not_found / digest_mismatch 都零写入", async () => {
    const harness = makeHarness();
    await setupWorld(harness);

    // 未安装的角色：not_found。
    const beforeMissing = await committedEventCount(harness.ledger);
    const missing = await harness.engine.activateRoleSpec(buildRoleSpecActivateCommandFor(ROLE_SOURCE_ADVISOR, activateDeps(ROLE_SOURCE_ADVISOR, "missing")));
    expect(missing).toEqual({ status: "rejected", commandId: "rw11-activate-" + ROLE_SOURCE_ADVISOR + "-missing", code: "not_found" });
    expect(await committedEventCount(harness.ledger)).toBe(beforeMissing);

    // 已安装但 pin 摘要被篡改：digest_mismatch（绝不按「差不多」生效）。
    await installRole(harness, ROLE_SOURCE_EXECUTOR, "tamper");
    const goodPin = roleSpecPinFor(PROJECT, ROLE_SOURCE_EXECUTOR);
    const beforeTamper = await committedEventCount(harness.ledger);
    const tampered = await harness.engine.activateRoleSpec({
      commandId: "rw11-activate-tampered",
      commandType: "ActivateRoleSpecRevision",
      schemaVersion: 1,
      identity: { projectId: PROJECT, actor: ACTOR, idempotencyKey: "rw11-activate-tampered-key" },
      aggregateId: ROLE_SOURCE_EXECUTOR,
      expectedRevision: 1,
      correlationId: "rw11-corr-activate-tampered",
      submittedAt: AT,
      payload: { target: { ref: goodPin.ref, digest: "0".repeat(64) } },
    });
    expect(tampered.status).toBe("rejected");
    if (tampered.status === "rejected") expect(tampered.code).toBe("digest_mismatch");
    expect(await committedEventCount(harness.ledger)).toBe(beforeTamper);

    const active = await harness.ledger.load(projectRoleSpecActiveRefFor(PROJECT, ROLE_SOURCE_EXECUTOR));
    expect(active.status).toBe("not_found");
  });

  it("install 形状守卫与摘要守卫都零写入", async () => {
    const harness = makeHarness();
    await setupWorld(harness);
    const good = roleSpecSourceFor(ROLE_SOURCE_ADVISOR).content;

    const invalidVariants: RoleSpecContentV1[] = [
      { ...good, requiredOutputs: [] },
      { ...good, exit: { ...good.exit, handoff: "" } },
      { ...good, responsibility: [] },
      { ...good, responsibility: ["不存在的职责"] as never },
      { ...good, permissions: { tools: [], writeScope: "none" } },
      { ...good, permissions: { tools: ["read"], writeScope: "everywhere" as never } },
      { ...good, budget: { source: "task-budget", scope: "producer-task", } as never, requiredMaterials: [] },
      { ...good, requiredMaterials: [{ kind: "unknown-kind" as never, reason: "x" }] },
    ];
    for (const [index, content] of invalidVariants.entries()) {
      const before = await committedEventCount(harness.ledger);
      const command: InstallRoleSpecRevisionCommand = {
        commandId: "rw11-install-invalid-" + index,
        commandType: "InstallRoleSpecRevision",
        schemaVersion: 1,
        identity: { projectId: PROJECT, actor: ACTOR, idempotencyKey: "rw11-invalid-" + index },
        correlationId: "rw11-corr-invalid-" + index,
        submittedAt: AT,
        payload: { roleId: ROLE_SOURCE_ADVISOR, content, contentDigest: roleSpecContentDigest(content, ROLE_SOURCE_ADVISOR, ROLE_SPEC_REVISION) },
      };
      const receipt = await harness.engine.installRoleSpec(command);
      expect(receipt.status, "variant " + index).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code, "variant " + index).toBe("invalid");
      expect(await committedEventCount(harness.ledger), "variant " + index).toBe(before);
    }

    // 摘要不符：digest_mismatch（结构本身合法）。
    const before = await committedEventCount(harness.ledger);
    const digestMismatch = await harness.engine.installRoleSpec({
      commandId: "rw11-install-digest",
      commandType: "InstallRoleSpecRevision",
      schemaVersion: 1,
      identity: { projectId: PROJECT, actor: ACTOR, idempotencyKey: "rw11-digest" },
      correlationId: "rw11-corr-digest",
      submittedAt: AT,
      payload: { roleId: ROLE_SOURCE_ADVISOR, content: good, contentDigest: "f".repeat(64) },
    });
    expect(digestMismatch).toEqual({ status: "rejected", commandId: "rw11-install-digest", code: "digest_mismatch" });
    expect(await committedEventCount(harness.ledger)).toBe(before);
  });
});

describe("RW-11 角色矩阵（协调策略正文里的 roles）", () => {
  async function installPolicy(harness: Harness, content: Parameters<typeof buildCoordinationPolicyInstallCommand>[0]["content"], policyId: string) {
    const command = buildCoordinationPolicyInstallCommand({ policyId, content }, {
      commandId: "rw11-policy-" + policyId,
      correlationId: "rw11-corr-policy-" + policyId,
      submittedAt: AT,
      projectId: PROJECT,
      actor: ACTOR,
      idempotencyKey: "rw11-policy-key-" + policyId,
    });
    const receipt = await harness.engine.installCoordinationPolicy(command);
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") throw new Error("policy install failed");
    const activate = buildCoordinationPolicyActivateCommand({ ref: receipt.revisionRef, digest: receipt.contentDigest }, {
      commandId: "rw11-policy-act-" + policyId,
      correlationId: "rw11-corr-policy-act-" + policyId,
      submittedAt: AT,
      projectId: PROJECT,
      actor: ACTOR,
      idempotencyKey: "rw11-policy-act-key-" + policyId,
      expectedRevision: 1,
    });
    const activated = await harness.engine.activateCoordinationPolicy(activate);
    expect(activated.status).toBe("committed");
  }

  it("带角色矩阵的策略正文可安装并生效；没有 roles 的旧正文照旧可安装", async () => {
    const harness = makeHarness();
    await setupWorld(harness);
    for (const source of ROLE_SPEC_SOURCES_V1) await installAndActivateRole(harness, source.roleId, "matrix");

    await installPolicy(harness, buildCoordinationPolicyContentWithRolesV1(PROJECT), "coordination-policy-with-roles");
    const legacyHarness = makeHarness();
    await setupWorld(legacyHarness);
    await installPolicy(legacyHarness, buildCoordinationPolicyContentWithoutRolesV1(), "coordination-policy-legacy");
  });

  it("矩阵形状非法（悬空 coordinator／未登记 pin 的角色名不符）在安装期即被拒且零写入", async () => {
    const harness = makeHarness();
    await setupWorld(harness);
    const good = buildCoordinationPolicyContentWithRolesV1(PROJECT, [ROLE_SOURCE_EXECUTOR]);

    const danglingCoordinator = { ...good, roles: { ...good.roles!, coordinator: { roleId: "nobody", note: "悬空" } } };
    const mismatchedKey = {
      ...good,
      roles: {
        catalog: { writer: roleSpecPinFor(PROJECT, ROLE_SOURCE_EXECUTOR) },
        coordinator: { roleId: "writer", note: "键与 pin 的角色名不符" },
      },
    };
    for (const [index, content] of [danglingCoordinator, mismatchedKey].entries()) {
      const before = await committedEventCount(harness.ledger);
      const receipt = await harness.engine.installCoordinationPolicy(
        buildCoordinationPolicyInstallCommand({ policyId: "bad-matrix-" + index, content }, {
          commandId: "rw11-bad-matrix-" + index,
          correlationId: "rw11-corr-bad-matrix-" + index,
          submittedAt: AT,
          projectId: PROJECT,
          actor: ACTOR,
          idempotencyKey: "rw11-bad-matrix-key-" + index,
        }),
      );
      expect(receipt.status, "matrix variant " + index).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code, "matrix variant " + index).toBe("invalid");
      expect(await committedEventCount(harness.ledger), "matrix variant " + index).toBe(before);
    }
  });
});

describe("RW-11 independent-reviewer 规格与既有 Reviewer 配置一致（不得放宽）", () => {
  it("权限与预算口径逐项对齐既有 INDEPENDENT_REVIEWER_ROLE 与 ReviewerProfileV1 语义", () => {
    const spec = roleSpecSourceFor(ROLE_SOURCE_INDEPENDENT_REVIEWER);
    // 角色绑定 identity 必须是既有常量里的 templateId／templateRevision，不另立一套。
    expect(spec.roleId).toBe(INDEPENDENT_REVIEWER_ROLE.templateId);
    expect(String(spec.revision)).toBe(INDEPENDENT_REVIEWER_ROLE.templateRevision);
    // 权限：ReviewerProfileCompiler 固定 permissions { tools: ['read'], writeScope: [] }。
    expect(spec.content.permissions.tools).toEqual(["read"]);
    expect(spec.content.permissions.writeScope).toBe("none");
    // 预算：审阅用的是**生产者 Task 的已提交预算**（ReviewerProfileCompiler.current 选中的那份），
    // 规格只声明来源，不写数字——写数字就是另起一套预算。
    expect(spec.content.budget).toEqual({ source: "task-budget", scope: "producer-task" });
    // 除 independent-reviewer 外，其余角色都不允许占用 producer-task 预算口径。
    for (const source of ROLE_SPEC_SOURCES_V1.filter((item) => item.roleId !== ROLE_SOURCE_INDEPENDENT_REVIEWER)) {
      expect(source.content.budget.scope, source.roleId).toBe("assigned-task");
    }
  });
});

describe("RW-11 重启后从账本重建", () => {
  it("SQLite 重开后角色规格与生效引用仍在，claim 守卫按同一份矩阵裁决", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rw11-role-spec-"));
    try {
      const { createPersistentSqliteHarness } = await import("../../src/harness/persistent-harness.js");
      const { buildBootstrapCommand } = await import("../../src/contracts/bootstrap.js");
      const { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } = await import("../contract-support/fixtures/bootstrap-fixture-v1.js");
      const { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand, buildGoalCreateLedgerCommit } = await import("../contract-support/fixtures/goal-fixtures.js");

      let host = await createPersistentSqliteHarness({ dir });
      const bootstrap = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, { commandId: "cmd-bootstrap", correlationId: "corr-bootstrap", submittedAt: AT });
      expect((await host.ledger.commit(buildBootstrapLedgerCommit(bootstrap, { eventIds: ["evt-b1", "evt-b2", "evt-b3", "evt-b4"], occurredAt: AT }))).status).toBe("committed");
      const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes.find((s) => s.projectId === PROJECT)!;
      const goal = buildCreateGoalCommand(scope, { commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: AT });
      expect((await host.ledger.commit(buildGoalCreateLedgerCommit(goal, { eventId: "evt-goal", occurredAt: AT, projectRevision: 1, workspaceRevision: 1 }))).status).toBe("committed");

      const installed = await host.control.installRoleSpec(buildRoleSpecInstallCommandFor(ROLE_SOURCE_EXECUTOR, installDeps(ROLE_SOURCE_EXECUTOR, "restart")));
      expect(installed.status).toBe("committed");
      const activated = await host.control.activateRoleSpec(buildRoleSpecActivateCommandFor(ROLE_SOURCE_EXECUTOR, activateDeps(ROLE_SOURCE_EXECUTOR, "restart")));
      expect(activated.status).toBe("committed");
      await host.close();

      // 重开：新的账本实例，同一批文件。
      host = await createPersistentSqliteHarness({ dir });
      const loaded = await host.ledger.load(roleSpecRevisionRefFor(PROJECT, ROLE_SOURCE_EXECUTOR, ROLE_SPEC_REVISION));
      expect(loaded.status).toBe("found");
      if (loaded.status === "found") expect((loaded.snapshot as RoleSpecRevisionSnapshot).contentDigest).toBe(roleSpecPinFor(PROJECT, ROLE_SOURCE_EXECUTOR).digest);
      const active = await host.ledger.load(projectRoleSpecActiveRefFor(PROJECT, ROLE_SOURCE_EXECUTOR));
      expect(active.status).toBe("found");
      if (active.status === "found") {
        expect(canonicalJson((active.snapshot as ProjectRoleSpecActiveSnapshot).activeRevision)).toBe(canonicalJson(roleSpecRevisionRefFor(PROJECT, ROLE_SOURCE_EXECUTOR, ROLE_SPEC_REVISION)));
      }
      // 再次安装同一份 source：账本按身份 + 指纹判为重放，而不是新建 revision。
      const replay = await host.control.installRoleSpec(buildRoleSpecInstallCommandFor(ROLE_SOURCE_EXECUTOR, installDeps(ROLE_SOURCE_EXECUTOR, "restart")));
      expect(replay.status).toBe("committed");
      if (replay.status === "committed") expect(replay.replayed).toBe(true);
      await host.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("RW-11 角色矩阵内容与规格正文的一致性", () => {
  it("矩阵 pin 指向的 revision 与摘要在安装后与落账内容一致（矩阵不能引用别的东西）", async () => {
    const harness = makeHarness();
    await setupWorld(harness);
    await installAndActivateRole(harness, ROLE_SOURCE_EXECUTOR, "pin");
    const matrix = buildRoleMatrixFixture(PROJECT, [ROLE_SOURCE_EXECUTOR]);
    const pin = matrix.catalog[ROLE_SOURCE_EXECUTOR]!;
    const loaded = await harness.ledger.load(pin.ref);
    expect(loaded.status).toBe("found");
    if (loaded.status === "found") {
      expect((loaded.snapshot as RoleSpecRevisionSnapshot).contentDigest).toBe(pin.digest);
    }
    expect(pin.ref.revision).toBe(ROLE_SPEC_REVISION);
    // 收敛责任必须落在已登记的角色上；登记全集时默认是规划者。
    expect(matrix.coordinator.roleId).toBe(ROLE_SOURCE_EXECUTOR);
    expect(buildRoleMatrixFixture(PROJECT).coordinator.roleId).toBe(ROLE_SOURCE_PLANNER);
  });
});
